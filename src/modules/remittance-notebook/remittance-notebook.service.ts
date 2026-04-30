import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { remittanceNotebookEntries } from '@db/schema';

@Injectable()
export class RemittanceNotebookService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async findAll(userId: string) {
    return this.db
      .select()
      .from(remittanceNotebookEntries)
      .where(eq(remittanceNotebookEntries.userId, userId))
      .orderBy(desc(remittanceNotebookEntries.createdAt));
  }

  async findByStatus(userId: string, status: string) {
    return this.db
      .select()
      .from(remittanceNotebookEntries)
      .where(
        and(
          eq(remittanceNotebookEntries.userId, userId),
          eq(remittanceNotebookEntries.status, status as 'planned' | 'sent' | 'received' | 'cancelled'),
        ),
      )
      .orderBy(desc(remittanceNotebookEntries.createdAt));
  }

  async create(userId: string, data: {
    recipientName: string;
    recipientCountry?: string;
    relationship?: string;
    provider: string;
    sourceCurrency: string;
    targetCurrency?: string;
    sourceAmountMinor: number;
    targetAmountMinor?: number;
    feeMinor?: number;
    fxRate?: number;
    deliveryMethod?: string;
    status?: string;
    plannedDate?: string;
    notes?: string;
  }) {
    const result = await this.db
      .insert(remittanceNotebookEntries)
      .values({
        userId,
        recipientName: data.recipientName,
        recipientCountry: data.recipientCountry || 'PK',
        relationship: data.relationship,
        provider: data.provider,
        sourceCurrency: data.sourceCurrency.toUpperCase(),
        targetCurrency: (data.targetCurrency || 'PKR').toUpperCase(),
        sourceAmountMinor: data.sourceAmountMinor,
        targetAmountMinor: data.targetAmountMinor,
        feeMinor: data.feeMinor,
        fxRate: data.fxRate ? String(data.fxRate) : undefined,
        deliveryMethod: data.deliveryMethod,
        status: (data.status || 'planned') as 'planned' | 'sent' | 'received' | 'cancelled',
        plannedDate: data.plannedDate ? new Date(data.plannedDate) : undefined,
        notes: data.notes,
      })
      .returning();
    return result[0];
  }

  async update(userId: string, entryId: string, data: Partial<{
    recipientName: string; status: string; notes: string;
    targetAmountMinor: number; feeMinor: number; fxRate: string;
  }>) {
    const result = await this.db
      .update(remittanceNotebookEntries)
      .set(data)
      .where(
        and(
          eq(remittanceNotebookEntries.id, entryId),
          eq(remittanceNotebookEntries.userId, userId),
        ),
      )
      .returning();
    if (!result[0]) throw new NotFoundException('Entry not found');
    return result[0];
  }

  async markAsSent(userId: string, entryId: string) {
    return this.update(userId, entryId, {
      status: 'sent',
      sentAt: new Date(),
    } as any);
  }

  async markAsReceived(userId: string, entryId: string) {
    return this.update(userId, entryId, {
      status: 'received',
      receivedAt: new Date(),
    } as any);
  }

  async delete(userId: string, entryId: string) {
    const result = await this.db
      .delete(remittanceNotebookEntries)
      .where(
        and(
          eq(remittanceNotebookEntries.id, entryId),
          eq(remittanceNotebookEntries.userId, userId),
        ),
      )
      .returning();
    if (!result[0]) throw new NotFoundException('Entry not found');
    return { deleted: true };
  }

  async getSummary(userId: string) {
    const entries = await this.findAll(userId);
    const yearStart = new Date();
    yearStart.setMonth(0, 1);

    const sentThisYear = entries.filter(
      (e) => e.status === 'sent' && e.sentAt && new Date(e.sentAt) >= yearStart,
    );
    const planned = entries.filter((e) => e.status === 'planned');

    const totalSentThisYear = sentThisYear.reduce(
      (sum, e) => sum + Number(e.sourceAmountMinor),
      0,
    );
    const totalPlanned = planned.reduce(
      (sum, e) => sum + Number(e.sourceAmountMinor),
      0,
    );

    const rates = sentThisYear
      .filter((e) => e.fxRate)
      .map((e) => Number(e.fxRate));
    const averageFxRate = rates.length > 0
      ? rates.reduce((a, b) => a + b, 0) / rates.length
      : 0;

    const countByProvider: Record<string, number> = {};
    for (const e of entries) {
      countByProvider[e.provider] = (countByProvider[e.provider] || 0) + 1;
    }

    return { totalSentThisYear, totalPlanned, averageFxRate, countByProvider };
  }
}
