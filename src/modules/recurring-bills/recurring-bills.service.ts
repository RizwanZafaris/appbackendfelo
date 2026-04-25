import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { recurringBills } from '@db/schema';

import { CreateRecurringBillDto, UpdateRecurringBillDto } from './dto/recurring-bill.dto';

@Injectable()
export class RecurringBillsService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  list(userId: string) {
    return this.db
      .select()
      .from(recurringBills)
      .where(and(eq(recurringBills.userId, userId), eq(recurringBills.isActive, true)))
      .orderBy(desc(recurringBills.createdAt));
  }

  async create(userId: string, dto: CreateRecurringBillDto) {
    const inserted = await this.db
      .insert(recurringBills)
      .values({
        userId,
        merchant: dto.merchant,
        amountMinor: dto.amountMinor,
        currency: dto.currency.toUpperCase(),
        category: dto.category ?? null,
        frequency: dto.frequency,
        nextExpected: dto.nextExpected ?? null,
      })
      .returning();
    return inserted[0];
  }

  async update(userId: string, id: string, dto: UpdateRecurringBillDto) {
    const updated = await this.db
      .update(recurringBills)
      .set({
        merchant: dto.merchant,
        amountMinor: dto.amountMinor,
        currency: dto.currency?.toUpperCase(),
        category: dto.category,
        frequency: dto.frequency,
        nextExpected: dto.nextExpected,
        isActive: dto.isActive,
      })
      .where(and(eq(recurringBills.id, id), eq(recurringBills.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('Recurring bill not found');
    return updated[0];
  }

  async remove(userId: string, id: string) {
    const removed = await this.db
      .update(recurringBills)
      .set({ isActive: false })
      .where(and(eq(recurringBills.id, id), eq(recurringBills.userId, userId)))
      .returning();
    if (!removed[0]) throw new NotFoundException('Recurring bill not found');
    return { ok: true };
  }
}
