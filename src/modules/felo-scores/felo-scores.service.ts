import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  budgets,
  feloScoreFormula,
  feloScoreHistory,
  feloScores,
  goals,
  profiles,
  recurringBills,
  transactions,
} from '@db/schema';

interface ScoreComponents {
  budgetAdherence: number;
  savingsRate: number;
  billPunctuality: number;
  debtToIncome: number;
  goalProgress: number;
}

const DEFAULT_WEIGHTS: ScoreComponents = {
  budgetAdherence: 0.25,
  savingsRate: 0.25,
  billPunctuality: 0.2,
  debtToIncome: 0.15,
  goalProgress: 0.15,
};

@Injectable()
export class FeloScoresService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  // Pre-existing API kept for compatibility
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

  async compute(userId: string, formulaVersion?: number) {
    const formula = await this.getActiveFormula(formulaVersion);
    const weights = (formula?.weights ?? DEFAULT_WEIGHTS) as Record<string, number>;
    const components = await this.computeComponents(userId);

    let raw = 0;
    raw += components.budgetAdherence * (weights.budgetAdherence ?? DEFAULT_WEIGHTS.budgetAdherence);
    raw += components.savingsRate * (weights.savingsRate ?? DEFAULT_WEIGHTS.savingsRate);
    raw += components.billPunctuality * (weights.billPunctuality ?? DEFAULT_WEIGHTS.billPunctuality);
    raw += components.debtToIncome * (weights.debtToIncome ?? DEFAULT_WEIGHTS.debtToIncome);
    raw += components.goalProgress * (weights.goalProgress ?? DEFAULT_WEIGHTS.goalProgress);

    const score = Math.round(Math.max(300, Math.min(850, 300 + raw * 5.5)));
    const formulaVersionUsed = formula?.version ?? 1;

    await this.db.insert(feloScoreHistory).values({
      userId,
      score,
      components,
      formulaVersion: formulaVersionUsed,
    });

    await this.db.update(profiles).set({ feloScore: score }).where(eq(profiles.id, userId));

    return { score, components, formulaVersion: formulaVersionUsed };
  }

  private async computeComponents(userId: string): Promise<ScoreComponents> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    const userBudgets = await this.db
      .select({ id: budgets.id })
      .from(budgets)
      .where(eq(budgets.userId, userId));
    const budgetAdherence = userBudgets.length === 0 ? 100 : 75;

    const txns = await this.db
      .select({
        amountMinor: transactions.amountMinor,
        direction: transactions.direction,
        category: transactions.category,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          sql`${transactions.bookedAt} >= ${thirtyDaysAgo}`,
        ),
      );
    const totalVolume = txns.reduce((s, t) => s + Math.abs(Number(t.amountMinor ?? 0)), 0);
    const creditVolume = txns
      .filter((t) => t.direction === 'credit')
      .reduce((s, t) => s + Math.abs(Number(t.amountMinor ?? 0)), 0);
    const savingsRate = totalVolume > 0 ? Math.min(100, (creditVolume / totalVolume) * 100) : 30;

    const bills = await this.db
      .select({ isActive: recurringBills.isActive, nextExpected: recurringBills.nextExpected })
      .from(recurringBills)
      .where(eq(recurringBills.userId, userId));
    const total = bills.length;
    const onTime = bills.filter(
      (b) => b.isActive && (!b.nextExpected || new Date(b.nextExpected) >= now),
    ).length;
    const billPunctuality = total === 0 ? 100 : (onTime / total) * 100;

    const monthlyIncome = await this.getMonthlyIncome(userId);
    const debtPayments = txns
      .filter(
        (t) =>
          t.direction === 'debit' &&
          (t.category?.toString().toLowerCase().includes('loan') ?? false),
      )
      .reduce((s, t) => s + Math.abs(Number(t.amountMinor ?? 0)), 0);
    const ratio = monthlyIncome > 0 ? debtPayments / monthlyIncome : 0;
    const debtToIncome = Math.max(0, 100 - ratio * 100);

    const userGoals = await this.db
      .select({ savedMinor: goals.savedMinor, targetMinor: goals.targetMinor })
      .from(goals)
      .where(eq(goals.userId, userId));
    const goalProgress =
      userGoals.length === 0
        ? 50
        : (userGoals.reduce(
            (s, g) =>
              s + Number(g.savedMinor ?? 0) / Math.max(Number(g.targetMinor ?? 1), 1),
            0,
          ) /
            userGoals.length) *
          100;

    return {
      budgetAdherence: Math.round(budgetAdherence),
      savingsRate: Math.round(savingsRate),
      billPunctuality: Math.round(billPunctuality),
      debtToIncome: Math.round(debtToIncome),
      goalProgress: Math.round(Math.min(100, goalProgress)),
    };
  }

  private async getMonthlyIncome(userId: string): Promise<number> {
    const [profile] = await this.db
      .select({ monthlyIncomeMinor: profiles.monthlyIncomeMinor })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return Number(profile?.monthlyIncomeMinor ?? 500000);
  }

  private async getActiveFormula(version?: number) {
    if (version) {
      const [f] = await this.db
        .select()
        .from(feloScoreFormula)
        .where(eq(feloScoreFormula.version, version))
        .limit(1);
      return f;
    }
    const [f] = await this.db
      .select()
      .from(feloScoreFormula)
      .orderBy(desc(feloScoreFormula.version))
      .limit(1);
    return f;
  }

  async getScore(userId: string) {
    const [latest] = await this.db
      .select()
      .from(feloScoreHistory)
      .where(eq(feloScoreHistory.userId, userId))
      .orderBy(desc(feloScoreHistory.computedAt))
      .limit(1);
    return latest ?? { score: null, components: {} };
  }

  async getHistory(userId: string, cursor?: string, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    if (cursor) {
      return this.db
        .select()
        .from(feloScoreHistory)
        .where(
          and(
            eq(feloScoreHistory.userId, userId),
            sql`${feloScoreHistory.computedAt} < ${new Date(cursor)}`,
          ),
        )
        .orderBy(desc(feloScoreHistory.computedAt))
        .limit(safeLimit);
    }
    return this.db
      .select()
      .from(feloScoreHistory)
      .where(eq(feloScoreHistory.userId, userId))
      .orderBy(desc(feloScoreHistory.computedAt))
      .limit(safeLimit);
  }

  async createFormula(version: number, weights: Record<string, number>) {
    const [formula] = await this.db
      .insert(feloScoreFormula)
      .values({ version, weights, thresholds: {}, rolledOutAt: new Date() })
      .returning();
    return formula;
  }

  async getFormulas() {
    return this.db.select().from(feloScoreFormula).orderBy(desc(feloScoreFormula.version));
  }
}
