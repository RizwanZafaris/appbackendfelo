import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, lt } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { transactions } from '@db/schema';

import { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class TransactionsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Cursor-paginated by booked_at descending. */
  list(userId: string, opts: { cursor?: string; limit?: number; category?: string } = {}) {
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const where = [eq(transactions.userId, userId)];
    if (opts.category) where.push(eq(transactions.category, opts.category));
    if (opts.cursor) where.push(lt(transactions.bookedAt, new Date(opts.cursor)));

    return this.db
      .select()
      .from(transactions)
      .where(and(...where))
      .orderBy(desc(transactions.bookedAt))
      .limit(limit);
  }

  /** Delta sync: rows updated after `since`. */
  syncSince(userId: string, since: Date) {
    return this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), gt(transactions.updatedAt, since)))
      .orderBy(transactions.updatedAt);
  }

  async detail(userId: string, id: string) {
    const row = await this.db.query.transactions.findFirst({
      where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
    });
    if (!row) throw new NotFoundException('Transaction not found');
    return row;
  }

  async create(userId: string, dto: CreateTransactionDto) {
    const inserted = await this.db
      .insert(transactions)
      .values({
        userId,
        accountId: dto.accountId ?? null,
        merchant: dto.merchant ?? null,
        category: dto.category ?? null,
        currency: dto.currency.toUpperCase(),
        amountMinor: dto.amountMinor,
        direction: dto.direction,
        source: dto.source,
        parserConfidence: dto.parserConfidence ?? null,
        bookedAt: new Date(dto.bookedAt),
        receiptUrl: dto.receiptUrl ?? null,
      })
      .returning();
    return inserted[0];
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    const updated = await this.db
      .update(transactions)
      .set({
        accountId: dto.accountId,
        merchant: dto.merchant,
        category: dto.category,
        currency: dto.currency?.toUpperCase(),
        amountMinor: dto.amountMinor,
        direction: dto.direction,
        source: dto.source,
        parserConfidence: dto.parserConfidence,
        bookedAt: dto.bookedAt ? new Date(dto.bookedAt) : undefined,
        receiptUrl: dto.receiptUrl,
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Transaction not found');
    return updated[0];
  }

  async remove(userId: string, id: string) {
    const removed = await this.db
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .returning();
    if (!removed[0]) throw new NotFoundException('Transaction not found');
    return { ok: true };
  }
}
