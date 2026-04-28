import { Inject, Injectable } from '@nestjs/common';
import { and, between, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { coachQueries } from '@db/schema';

import { CoachContext } from './retrieval/coach-context';

/**
 * Monthly tier limits for the LLM Coach. The existing `coachQueries`
 * table is per-day; we sum across the current month for the cap check
 * so we don't need a new table — one source of truth.
 */
export const TIER_LIMITS: Record<CoachContext['tier'], number> = {
  free: 30,
  plus: 150,
  plus_plus: 400,
  family: 400,
};

export interface QuotaInfo {
  tier: CoachContext['tier'];
  used: number;
  limit: number;
  remaining: number;
  yearMonth: string;
}

@Injectable()
export class CoachQuotaService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async check(userId: string, tier: CoachContext['tier']): Promise<QuotaInfo> {
    const { start, end, ym } = this.monthBounds();
    const limit = TIER_LIMITS[tier];

    const row = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(${coachQueries.queryCount}), 0)::int`,
      })
      .from(coachQueries)
      .where(and(eq(coachQueries.userId, userId), between(coachQueries.queryDate, start, end)));
    const used = Number(row[0]?.total ?? 0);
    return { tier, used, limit, remaining: Math.max(0, limit - used), yearMonth: ym };
  }

  /**
   * Atomically reserve one quota slot. Increments the daily counter and
   * returns the new monthly total in a single transaction so two concurrent
   * requests can't both pass the check at remaining=1 and overshoot.
   *
   * If the new total is over the limit, the increment is rolled back via
   * the transaction so the user isn't charged for a request we're rejecting.
   */
  async tryReserve(
    userId: string,
    tier: CoachContext['tier'],
  ): Promise<QuotaInfo & { reserved: boolean }> {
    const { start, end, ym } = this.monthBounds();
    const limit = TIER_LIMITS[tier];
    const today = new Date().toISOString().slice(0, 10);

    return this.db.transaction(async (tx) => {
      // Insert-or-bump today's row (atomic).
      await tx
        .insert(coachQueries)
        .values({ userId, queryDate: today, queryCount: 1 })
        .onConflictDoUpdate({
          target: [coachQueries.userId, coachQueries.queryDate],
          set: { queryCount: sql`${coachQueries.queryCount} + 1` },
        });

      // Re-sum the month under the same transaction.
      const row = await tx
        .select({ total: sql<number>`COALESCE(SUM(${coachQueries.queryCount}), 0)::int` })
        .from(coachQueries)
        .where(and(eq(coachQueries.userId, userId), between(coachQueries.queryDate, start, end)));
      const used = Number(row[0]?.total ?? 0);

      if (used > limit) {
        // Refund — we overshot the cap because of a race.
        await tx
          .update(coachQueries)
          .set({ queryCount: sql`GREATEST(${coachQueries.queryCount} - 1, 0)` })
          .where(and(eq(coachQueries.userId, userId), eq(coachQueries.queryDate, today)));
        return {
          tier,
          used: used - 1,
          limit,
          remaining: 0,
          yearMonth: ym,
          reserved: false,
        };
      }
      return {
        tier,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        yearMonth: ym,
        reserved: true,
      };
    });
  }

  private monthBounds(): { start: string; end: string; ym: string } {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
    return { start, end, ym };
  }
}
