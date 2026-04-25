import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { budgets, transactions } from '@db/schema';

export type InsightPeriod = 'week' | 'month' | 'quarter';

function periodStart(period: InsightPeriod): Date {
  const now = new Date();
  const d = new Date(now);
  if (period === 'week') d.setDate(d.getDate() - 7);
  else if (period === 'month') d.setMonth(d.getMonth() - 1);
  else d.setMonth(d.getMonth() - 3);
  return d;
}

@Injectable()
export class InsightsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * Spending insights for a given period — aggregates the user's debit
   * transactions into category, merchant, and time-series rollups.
   *
   * Currency-naive: assumes all transactions in the user's primary
   * currency. A multi-currency rollup is a Phase-2 enhancement.
   */
  async spending(userId: string, period: InsightPeriod = 'month') {
    const start = periodStart(period);

    const totalRow = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${transactions.amountMinor}), 0)::bigint` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.direction, 'debit'),
          gte(transactions.bookedAt, start),
        ),
      );

    const totalMinor = Number(totalRow[0]?.total ?? 0);

    const byCategory = await this.db
      .select({
        category: transactions.category,
        totalMinor: sql<number>`SUM(${transactions.amountMinor})::bigint`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.direction, 'debit'),
          gte(transactions.bookedAt, start),
        ),
      )
      .groupBy(transactions.category);

    const byMerchant = await this.db
      .select({
        merchant: transactions.merchant,
        totalMinor: sql<number>`SUM(${transactions.amountMinor})::bigint`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.direction, 'debit'),
          gte(transactions.bookedAt, start),
        ),
      )
      .groupBy(transactions.merchant)
      .orderBy(sql`SUM(${transactions.amountMinor}) DESC`)
      .limit(10);

    const trends = await this.db
      .select({
        date: sql<string>`date_trunc('day', ${transactions.bookedAt})::date`,
        totalMinor: sql<number>`SUM(${transactions.amountMinor})::bigint`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.direction, 'debit'),
          gte(transactions.bookedAt, start),
        ),
      )
      .groupBy(sql`date_trunc('day', ${transactions.bookedAt})::date`)
      .orderBy(sql`date_trunc('day', ${transactions.bookedAt})::date`);

    return {
      period,
      startDate: start.toISOString(),
      totalMinor,
      byCategory: byCategory.map((r) => ({
        category: r.category ?? 'Uncategorized',
        totalMinor: Number(r.totalMinor),
        count: Number(r.count),
        pct: totalMinor === 0 ? 0 : Number(r.totalMinor) / totalMinor,
      })),
      byMerchant: byMerchant.map((r) => ({
        merchant: r.merchant ?? '(unknown)',
        totalMinor: Number(r.totalMinor),
        count: Number(r.count),
      })),
      trends: trends.map((r) => ({
        date: String(r.date),
        totalMinor: Number(r.totalMinor),
      })),
    };
  }

  /**
   * Budget adherence — how each active budget is tracking against its
   * limit this period. Used by the Coach rule engine.
   *
   * Single round-trip: a correlated subquery computes per-budget spend
   * against its own `starts_on`, replacing the previous N+1 loop.
   */
  async budgetAdherence(userId: string) {
    type Row = {
      id: string;
      category: string;
      limitMinor: string | number;
      spentMinor: string | number | null;
    };
    const result = await this.db.execute(sql`
      SELECT
        b.id,
        b.category,
        b.limit_minor       AS "limitMinor",
        COALESCE((
          SELECT SUM(t.amount_minor)
          FROM ${transactions} t
          WHERE t.user_id = b.user_id
            AND t.category = b.category
            AND t.direction = 'debit'
            AND t.booked_at >= b.starts_on
        ), 0) AS "spentMinor"
      FROM ${budgets} b
      WHERE b.user_id = ${userId}
        AND b.is_archived = false
    `);

    return (result as unknown as Row[]).map((r) => {
      const limitMinor = Number(r.limitMinor);
      const spentMinor = Number(r.spentMinor ?? 0);
      return {
        budgetId: r.id,
        category: r.category,
        limitMinor,
        spentMinor,
        pct: limitMinor === 0 ? 0 : spentMinor / limitMinor,
        overBudget: spentMinor > limitMinor,
      };
    });
  }
}
