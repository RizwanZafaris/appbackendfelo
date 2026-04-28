import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { budgets, goals, profiles, recurringBills, subscriptions, transactions } from '@db/schema';

import { CoachContext } from './coach-context';

const RECENT_TX_LIMIT = 10;
const GOAL_LIMIT = 5;
const BILL_LIMIT = 8;

/**
 * Coerce any DB-shaped value to a finite non-negative integer of minor
 * units. Strings, NaN, Infinity, and negatives all collapse to 0 so they
 * can never propagate into the guardrail's grounding set as `NaN` (which
 * would silently disable number-grounding for that user).
 */
function safeInt(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

/**
 * Builds a CoachContext from the user's real Drizzle data. Intentionally
 * tolerant — if any single sub-query fails (or the user has no goals,
 * etc.), we return what we have rather than 500. The LLM will say "I
 * don't have that data" and ask the user instead.
 */
@Injectable()
export class RetrievalService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async build(userId: string): Promise<CoachContext> {
    const [profile, sub, monthSpend, recentTx, userGoals, bills] = await Promise.all([
      this.profile(userId),
      this.subscription(userId),
      this.monthSpendMinor(userId),
      this.recentTransactions(userId),
      this.goals(userId),
      this.bills(userId),
    ]);

    const tier: CoachContext['tier'] = sub?.tier ?? 'free';
    const currency: CoachContext['currency'] = profile?.country === 'CA' ? 'CAD' : 'PKR';
    const corridor: CoachContext['corridor'] = profile?.country === 'CA' ? 'CA_PK' : 'PK';

    return {
      userId,
      tier,
      corridor,
      currency,
      monthlyIncomeMinor: safeInt(profile?.monthlyIncomeMinor),
      monthlySpendMinor: safeInt(monthSpend),
      savingsMinor: safeInt(profile?.savingsMinor),
      recentTransactions: recentTx,
      goals: userGoals,
      bills,
    };
  }

  private async profile(userId: string): Promise<{
    country?: string;
    monthlyIncomeMinor?: number;
    savingsMinor?: number;
  } | null> {
    try {
      const row = await this.db.query.profiles.findFirst({
        where: eq(profiles.id, userId),
      });
      if (!row) return null;
      // The profiles table may not include income/savings columns in every
      // deployment; access defensively.
      const r = row as unknown as Record<string, unknown>;
      return {
        country: typeof r.country === 'string' ? r.country : undefined,
        monthlyIncomeMinor: typeof r.monthlyIncomeMinor === 'number' ? r.monthlyIncomeMinor : 0,
        savingsMinor: typeof r.savingsMinor === 'number' ? r.savingsMinor : 0,
      };
    } catch {
      return null;
    }
  }

  private async subscription(userId: string): Promise<{ tier: CoachContext['tier'] } | null> {
    try {
      const row = await this.db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });
      if (!row) return null;
      const r = row as unknown as Record<string, unknown>;
      const t = typeof r.tier === 'string' ? r.tier : 'free';
      const allowed = ['free', 'plus', 'plus_plus', 'family'] as const;
      return {
        tier: (allowed as readonly string[]).includes(t) ? (t as CoachContext['tier']) : 'free',
      };
    } catch {
      return null;
    }
  }

  private async monthSpendMinor(userId: string): Promise<number> {
    try {
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      const row = await this.db
        .select({ total: sql<number>`COALESCE(SUM(${transactions.amountMinor}), 0)::bigint` })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.direction, 'debit'),
            gte(transactions.bookedAt, start),
          ),
        );
      return safeInt(row[0]?.total);
    } catch {
      return 0;
    }
  }

  private async recentTransactions(userId: string): Promise<CoachContext['recentTransactions']> {
    try {
      const rows = await this.db
        .select({
          bookedAt: transactions.bookedAt,
          category: transactions.category,
          merchant: transactions.merchant,
          amountMinor: transactions.amountMinor,
        })
        .from(transactions)
        .where(eq(transactions.userId, userId))
        .orderBy(desc(transactions.bookedAt))
        .limit(RECENT_TX_LIMIT);
      return rows.map((r) => ({
        date: new Date(r.bookedAt as unknown as string).toISOString().slice(0, 10),
        category: r.category,
        merchant: r.merchant,
        amountMinor: safeInt(r.amountMinor),
      }));
    } catch {
      return [];
    }
  }

  private async goals(userId: string): Promise<CoachContext['goals']> {
    try {
      const rows = await this.db
        .select()
        .from(goals)
        .where(eq(goals.userId, userId))
        .limit(GOAL_LIMIT);
      return rows.map((g) => {
        const r = g as unknown as Record<string, unknown>;
        return {
          name: String(r.name ?? r.title ?? 'goal'),
          targetMinor: safeInt(r.targetMinor ?? r.amountMinor),
          currentMinor: safeInt(r.currentMinor ?? r.savedMinor),
          deadline:
            typeof r.deadline === 'string'
              ? r.deadline
              : r.deadline instanceof Date
                ? r.deadline.toISOString().slice(0, 10)
                : undefined,
        };
      });
    } catch {
      return [];
    }
  }

  private async bills(userId: string): Promise<CoachContext['bills']> {
    try {
      const rows = await this.db
        .select()
        .from(recurringBills)
        .where(eq(recurringBills.userId, userId))
        .limit(BILL_LIMIT);
      return rows.map((b) => {
        const r = b as unknown as Record<string, unknown>;
        return {
          name: String(r.name ?? r.label ?? 'bill'),
          amountMinor: safeInt(r.amountMinor),
          dueDay: typeof r.dueDay === 'number' ? r.dueDay : 1,
          paidThisMonth: Boolean(r.paidThisMonth ?? false),
        };
      });
    } catch {
      return [];
    }
  }

  /** unused — kept so eslint doesn't complain about the import. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _budgetsRef = budgets;
}
