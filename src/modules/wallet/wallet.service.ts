import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql, sum } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { accounts, transactions } from '@db/schema';

export interface WalletBalance {
  userId: string;
  totalBalanceMinor: number;
  currency: string;
  accountCount: number;
}

export interface WalletTransaction {
  id: string;
  merchant: string | null;
  category: string | null;
  currency: string;
  amountMinor: number;
  direction: 'debit' | 'credit';
  bookedAt: Date;
  source: string;
}

@Injectable()
export class WalletService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Aggregate balance across all active accounts for a user. */
  async getBalance(userId: string): Promise<WalletBalance> {
    const rows = await this.db
      .select({
        currency: accounts.currency,
        totalMinor: sum(accounts.balanceMinor),
      })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.isArchived, false)))
      .groupBy(accounts.currency);

    const primary = rows[0] ?? { currency: 'CAD', totalMinor: '0' };

    const countResult = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.isArchived, false)));

    return {
      userId,
      totalBalanceMinor: parseInt(primary.totalMinor ?? '0', 10),
      currency: primary.currency ?? 'CAD',
      accountCount: countResult[0]?.count ?? 0,
    };
  }

  /** Paginated list of wallet transactions for a user. */
  async getTransactions(
    userId: string,
    opts: { page?: number; limit?: number; category?: string } = {},
  ): Promise<WalletTransaction[]> {
    const limit = Math.min(opts.limit ?? 20, 100);
    const offset = ((opts.page ?? 1) - 1) * limit;

    const where = [eq(transactions.userId, userId)];
    if (opts.category) where.push(eq(transactions.category, opts.category));

    const rows = await this.db
      .select()
      .from(transactions)
      .where(and(...where))
      .orderBy(desc(transactions.bookedAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({
      id: r.id,
      merchant: r.merchant,
      category: r.category,
      currency: r.currency,
      amountMinor: Number(r.amountMinor),
      direction: r.direction as 'debit' | 'credit',
      bookedAt: r.bookedAt,
      source: r.source,
    }));
  }

  /** Transaction detail by ID, scoped to the user. */
  async getTransactionDetail(userId: string, transactionId: string): Promise<WalletTransaction> {
    const row = await this.db.query.transactions.findFirst({
      where: and(eq(transactions.id, transactionId), eq(transactions.userId, userId)),
    });

    if (!row) throw new NotFoundException('Transaction not found');

    return {
      id: row.id,
      merchant: row.merchant,
      category: row.category,
      currency: row.currency,
      amountMinor: Number(row.amountMinor),
      direction: row.direction as 'debit' | 'credit',
      bookedAt: row.bookedAt,
      source: row.source,
    };
  }

  /** Summary of spend by category for the current month. */
  async getMonthlySummary(userId: string): Promise<Array<{ category: string | null; totalMinor: number }>> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const rows = await this.db
      .select({
        category: transactions.category,
        totalMinor: sum(transactions.amountMinor),
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.direction, 'debit'),
          sql`${transactions.bookedAt} >= ${startOfMonth}`,
        ),
      )
      .groupBy(transactions.category)
      .orderBy(desc(sql`SUM(${transactions.amountMinor})`));

    return rows.map((r) => ({
      category: r.category,
      totalMinor: parseInt(r.totalMinor ?? '0', 10),
    }));
  }
}
