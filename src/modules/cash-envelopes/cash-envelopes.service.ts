import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { cashEnvelopes } from '@db/schema';

@Injectable()
export class CashEnvelopesService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async findAll(userId: string) {
    return this.db
      .select()
      .from(cashEnvelopes)
      .where(eq(cashEnvelopes.userId, userId))
      .orderBy(desc(cashEnvelopes.createdAt));
  }

  async findActive(userId: string) {
    return this.db
      .select()
      .from(cashEnvelopes)
      .where(and(eq(cashEnvelopes.userId, userId), eq(cashEnvelopes.isActive, true)))
      .orderBy(desc(cashEnvelopes.createdAt));
  }

  async create(userId: string, data: {
    name: string;
    category: string;
    budgetMinor: number;
    currency?: string;
    period?: string;
  }) {
    const result = await this.db
      .insert(cashEnvelopes)
      .values({
        userId,
        name: data.name,
        category: data.category,
        budgetMinor: data.budgetMinor,
        currency: (data.currency || 'PKR').toUpperCase(),
        period: (data.period || 'monthly') as 'weekly' | 'monthly',
        isActive: true,
      })
      .returning();
    return result[0];
  }

  async update(userId: string, envelopeId: string, data: Partial<{
    name: string; category: string; budgetMinor: number; isActive: boolean;
  }>) {
    const result = await this.db
      .update(cashEnvelopes)
      .set(data)
      .where(and(eq(cashEnvelopes.id, envelopeId), eq(cashEnvelopes.userId, userId)))
      .returning();
    if (!result[0]) throw new NotFoundException('Envelope not found');
    return result[0];
  }

  async spend(userId: string, envelopeId: string, amountMinor: number) {
    const envelope = await this.db
      .select()
      .from(cashEnvelopes)
      .where(and(eq(cashEnvelopes.id, envelopeId), eq(cashEnvelopes.userId, userId)))
      .limit(1);

    if (!envelope[0]) throw new NotFoundException('Envelope not found');

    const newSpent = Number(envelope[0].spentMinor) + amountMinor;
    return this.update(userId, envelopeId, { spentMinor: newSpent });
  }

  async archive(userId: string, envelopeId: string) {
    return this.update(userId, envelopeId, { isActive: false });
  }

  async delete(userId: string, envelopeId: string) {
    const result = await this.db
      .delete(cashEnvelopes)
      .where(and(eq(cashEnvelopes.id, envelopeId), eq(cashEnvelopes.userId, userId)))
      .returning();
    if (!result[0]) throw new NotFoundException('Envelope not found');
    return { deleted: true };
  }
}
