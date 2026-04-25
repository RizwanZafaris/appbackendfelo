import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { budgets, transactions } from '@db/schema';

import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

@Injectable()
export class BudgetsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * List active budgets enriched with `spent_minor` for the current
   * period. Uses a single correlated subquery per row (one indexed sum
   * each) — not N+1 round-trips.
   *
   * `spent_minor` aggregation rules (mirrors `getWithSpend()`):
   *   • debits only (credits = income, ignored)
   *   • category match against `budgets.category`
   *   • booked_at >= budgets.starts_on (the period anchor)
   *   • booked_at <= now()
   *   • tenant-scoped via budgets.user_id = transactions.user_id
   *     (defense-in-depth on top of RLS)
   */
  list(userId: string) {
    return this.db
      .select({
        id: budgets.id,
        userId: budgets.userId,
        category: budgets.category,
        currency: budgets.currency,
        limitMinor: budgets.limitMinor,
        period: budgets.period,
        rolloverEnabled: budgets.rolloverEnabled,
        alertThresholdPercent: budgets.alertThresholdPercent,
        startsOn: budgets.startsOn,
        isArchived: budgets.isArchived,
        createdAt: budgets.createdAt,
        spentMinor: sql<number>`COALESCE((
          SELECT SUM(${transactions.amountMinor})::int
          FROM ${transactions}
          WHERE ${transactions.userId} = ${budgets.userId}
            AND ${transactions.category} = ${budgets.category}
            AND ${transactions.direction} = 'debit'
            AND ${transactions.bookedAt} >= ${budgets.startsOn}
            AND ${transactions.bookedAt} <= NOW()
        ), 0)::int`.as('spent_minor'),
      })
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.isArchived, false)))
      .orderBy(desc(budgets.createdAt));
  }

  /**
   * Returns a single budget enriched with the spent_minor for the current
   * period (best-effort: sums debits in matching category since startsOn).
   */
  async getWithSpend(userId: string, id: string) {
    const row = await this.db.query.budgets.findFirst({
      where: and(eq(budgets.id, id), eq(budgets.userId, userId)),
    });
    if (!row) throw new NotFoundException('Budget not found');

    const spentRow = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(${transactions.amountMinor}), 0)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.category, row.category),
          eq(transactions.direction, 'debit'),
          gte(transactions.bookedAt, new Date(row.startsOn)),
          lte(transactions.bookedAt, new Date()),
        ),
      );

    return { ...row, spentMinor: spentRow[0]?.total ?? 0 };
  }

  async create(userId: string, dto: CreateBudgetDto) {
    const inserted = await this.db
      .insert(budgets)
      .values({
        userId,
        category: dto.category,
        currency: dto.currency.toUpperCase(),
        limitMinor: dto.limitMinor,
        period: dto.period,
        rolloverEnabled: dto.rolloverEnabled ?? false,
        alertThresholdPercent: dto.alertThresholdPercent ?? 80,
        startsOn: dto.startsOn,
      })
      .returning();
    return inserted[0];
  }

  async update(userId: string, id: string, dto: UpdateBudgetDto) {
    const updated = await this.db
      .update(budgets)
      .set({
        category: dto.category,
        currency: dto.currency?.toUpperCase(),
        limitMinor: dto.limitMinor,
        period: dto.period,
        rolloverEnabled: dto.rolloverEnabled,
        alertThresholdPercent: dto.alertThresholdPercent,
        startsOn: dto.startsOn,
        isArchived: dto.isArchived,
      })
      .where(and(eq(budgets.id, id), eq(budgets.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Budget not found');
    return updated[0];
  }

  async remove(userId: string, id: string) {
    const removed = await this.db
      .update(budgets)
      .set({ isArchived: true })
      .where(and(eq(budgets.id, id), eq(budgets.userId, userId)))
      .returning();
    if (!removed[0]) throw new NotFoundException('Budget not found');
    return { ok: true };
  }
}
