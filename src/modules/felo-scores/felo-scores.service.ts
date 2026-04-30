import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  budgets,
  feloScoreFormula,
  feloScores,
  goals,
  profiles,
  recurringBills,
  transactions,
} from '@db/schema';

interface ScoreWeights {
  budgetAdherence: number;
  goalProgress: number;
  billOnTime: number;
  savingsRate: number;
  debtRatio: number;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  budgetAdherence: 30,
  goalProgress: 20,
  billOnTime: 20,
  savingsRate: 15,
  debtRatio: 15,
};

@Injectable()
export class FeloScoresService {
  private readonly log = new Logger(FeloScoresService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  // ---- Queries ----

  history(userId: string, limit = 30) {
    return this.db
      .select()
      .from(feloScores)
      .where(eq(feloScores.userId, userId))
      .orderBy(desc(feloScores.calculatedAt))
      .limit(limit);
  }

  async latest(userId: string) {
    const rows = await this.db
      .select()
      .from(feloScores)
      .where(eq(feloScores.userId, userId))
      .orderBy(desc(feloScores.calculatedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async breakdown(userId: string) {
    const weights = await this.loadWeights();
    const latestScore = await this.latest(userId);

    return {
      score: latestScore?.score ?? null,
      weights,
      components: {
        budgetAdherence: latestScore?.budgetAdherence ?? null,
        goalProgress: latestScore?.goalProgress ?? null,
        billConsistency: latestScore?.billConsistency ?? null,
        savingsRate: latestScore?.savingsRate ?? null,
      },
      calculatedAt: latestScore?.calculatedAt ?? null,
    };
  }

  // ---- Score Computation ----

  /**
   * Compute Felo Score for a single user.
   * Algorithm:
   *   - Budget adherence (30%): % of budgets not exceeded
   *   - Goal progress (20%): avg(saved/target) across active goals
   *   - Bill on-time (20%): % of recurring bills paid on time
   *   - Savings rate (15%): (income - expenses) / income, clamped 0-100
   *   - Debt ratio (15%): 100 - min(100, debt_payments/income * 100)
   */
  async computeScore(userId: string): Promise<{
    score: number;
    savingsRate: number | null;
    budgetAdherence: number | null;
    goalProgress: number | null;
    billConsistency: number | null;
  }> {
    const weights = await this.loadWeights();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Fetch user's monthly income
    const profileRows = await this.db
      .select({ monthlyIncomeMinor: profiles.monthlyIncomeMinor })
      .from(profiles)
      .where(eq(profiles.id, userId));
    const monthlyIncomeMinor = profileRows[0]?.monthlyIncomeMinor ?? 0;

    // Budget adherence
    const budgetAdherence = await this.computeBudgetAdherence(userId, monthStart);

    // Goal progress
    const goalProgress = await this.computeGoalProgress(userId);

    // Bill consistency
    const billConsistency = await this.computeBillConsistency(userId, monthStart);

    // Savings rate
    const savingsRate = await this.computeSavingsRate(userId, monthStart, monthlyIncomeMinor);

    // Debt ratio (simplified: use expense ratio as proxy)
    const debtRatio = this.computeDebtRatio(monthlyIncomeMinor, savingsRate);

    const score = Math.round(
      (budgetAdherence * weights.budgetAdherence +
        goalProgress * weights.goalProgress +
        billConsistency * weights.billOnTime +
        savingsRate * weights.savingsRate +
        debtRatio * weights.debtRatio) /
        100,
    );

    return {
      score: Math.min(100, Math.max(0, score)),
      savingsRate,
      budgetAdherence,
      goalProgress,
      billConsistency,
    };
  }

  async saveScore(userId: string) {
    const computed = await this.computeScore(userId);

    const [row] = await this.db
      .insert(feloScores)
      .values({
        userId,
        score: computed.score,
        savingsRate: computed.savingsRate,
        budgetAdherence: computed.budgetAdherence,
        goalProgress: computed.goalProgress,
        billConsistency: computed.billConsistency,
      })
      .returning();

    // Update profile cache
    await this.db.update(profiles).set({ feloScore: computed.score }).where(eq(profiles.id, userId));

    return row;
  }

  /** Nightly cron: compute scores for all users with profiles. */
  @Cron('0 2 * * *')
  async computeAllScores() {
    this.log.log('Starting nightly Felo Score computation...');

    const allProfiles = await this.db.select({ id: profiles.id }).from(profiles);

    let computed = 0;
    let failed = 0;
    for (const p of allProfiles) {
      try {
        await this.saveScore(p.id);
        computed++;
      } catch (e) {
        this.log.error(`Failed computing score for ${p.id}: ${(e as Error).message}`);
        failed++;
      }
    }

    this.log.log(`Felo Score computation complete: ${computed} computed, ${failed} failed`);
  }

  // ---- Component Calculations ----

  private async computeBudgetAdherence(userId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.isArchived, false)));

    if (rows.length === 0) return 50; // neutral default

    // Sum transaction amounts per budget category in the period
    const spentByCategory = await this.db
      .select({
        category: transactions.category,
        total: sql<number>`COALESCE(SUM(${transactions.amountMinor}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.direction, 'debit'),
          gte(transactions.bookedAt, since),
        ),
      )
      .groupBy(transactions.category);

    const spentMap = new Map(spentByCategory.map((r) => [r.category, Number(r.total)]));

    let totalAdherence = 0;
    for (const b of rows) {
      const spent = spentMap.get(b.category) ?? 0;
      const limit = b.limitMinor;
      if (limit === 0) continue;
      const adherence = Math.min(100, Math.round(((limit - spent) / limit) * 100));
      totalAdherence += Math.max(0, adherence);
    }

    return rows.length > 0 ? Math.round(totalAdherence / rows.length) : 50;
  }

  private async computeGoalProgress(userId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.isCompleted, false)));

    if (rows.length === 0) return 50; // neutral default

    let totalProgress = 0;
    for (const g of rows) {
      if (g.targetMinor === 0) continue;
      const progress = Math.min(100, Math.round((g.savedMinor / g.targetMinor) * 100));
      totalProgress += progress;
    }

    return rows.length > 0 ? Math.round(totalProgress / rows.length) : 50;
  }

  private async computeBillConsistency(userId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select()
      .from(recurringBills)
      .where(and(eq(recurringBills.userId, userId), eq(recurringBills.isActive, true)));

    if (rows.length === 0) return 50;

    // Check which bills have matching transactions in the current period
    const billTransactions = await this.db
      .select({
        merchant: transactions.merchant,
        count: sql<number>`COUNT(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.bookedAt, since),
          eq(transactions.direction, 'debit'),
        ),
      )
      .groupBy(transactions.merchant);

    const txnMap = new Map(billTransactions.map((r) => [r.merchant?.toLowerCase(), Number(r.count)]));

    let paidCount = 0;
    for (const b of rows) {
      if (txnMap.has(b.merchant.toLowerCase())) {
        paidCount++;
      }
    }

    return rows.length > 0 ? Math.round((paidCount / rows.length) * 100) : 50;
  }

  private async computeSavingsRate(
    userId: string,
    since: Date,
    income: number,
  ): Promise<number> {
    if (income === 0) return 0;

    const rows = await this.db
      .select({
        totalDebit: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.direction} = 'debit' THEN ${transactions.amountMinor} ELSE 0 END), 0)`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), gte(transactions.bookedAt, since)));

    const totalExpenses = Number(rows[0]?.totalDebit ?? 0);
    const savingsRate = Math.round(((income - totalExpenses) / income) * 100);
    return Math.min(100, Math.max(0, savingsRate));
  }

  private computeDebtRatio(income: number, savingsRate: number): number {
    // Proxy: higher savings rate = lower debt ratio
    // Debt ratio component = 100 - (expense_rate), where expense_rate = 100 - savingsRate
    if (income === 0) return 50;
    return Math.min(100, Math.max(0, savingsRate));
  }

  private async loadWeights(): Promise<ScoreWeights> {
    try {
      const rows = await this.db
        .select()
        .from(feloScoreFormula)
        .where(eq(feloScoreFormula.isActive, true));

      if (rows.length === 0) return DEFAULT_WEIGHTS;

      const weights: Partial<ScoreWeights> = {};
      for (const row of rows) {
        const key = row.name as keyof ScoreWeights;
        if (key in DEFAULT_WEIGHTS) {
          weights[key] = row.weightPercent;
        }
      }
      return { ...DEFAULT_WEIGHTS, ...weights };
    } catch {
      return DEFAULT_WEIGHTS;
    }
  }
}
