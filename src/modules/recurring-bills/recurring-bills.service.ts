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

  /**
   * Record a payment for the current period by advancing `nextExpected`
   * to the next frequency anchor. Stateless approach — no payment-history
   * audit log (a follow-up can add `bill_payments` if needed).
   *
   * If `nextExpected` was null, it stays null (caller didn't pin a
   * schedule). The list/detail responses still reflect the bill is
   * configured.
   */
  async markPaid(userId: string, id: string) {
    const existing = await this.db.query.recurringBills.findFirst({
      where: and(eq(recurringBills.id, id), eq(recurringBills.userId, userId)),
    });
    if (!existing) throw new NotFoundException('Recurring bill not found');

    const nextExpected = existing.nextExpected
      ? this._advance(existing.nextExpected, existing.frequency)
      : null;

    const [updated] = await this.db
      .update(recurringBills)
      .set({ nextExpected })
      .where(and(eq(recurringBills.id, id), eq(recurringBills.userId, userId)))
      .returning();
    return updated;
  }

  /**
   * Advance an ISO yyyy-mm-dd date string by one frequency interval.
   * Pure function — exported via the class for ease of testing later.
   */
  private _advance(
    isoDate: string,
    frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly',
  ): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    switch (frequency) {
      case 'weekly':
        d.setUTCDate(d.getUTCDate() + 7);
        break;
      case 'monthly':
        d.setUTCMonth(d.getUTCMonth() + 1);
        break;
      case 'quarterly':
        d.setUTCMonth(d.getUTCMonth() + 3);
        break;
      case 'yearly':
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        break;
    }
    return d.toISOString().slice(0, 10); // back to yyyy-mm-dd
  }
}
