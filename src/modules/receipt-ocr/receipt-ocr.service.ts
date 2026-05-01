import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { receiptUploads, transactions } from '@db/schema';

import {
  GoogleVisionAdapter,
} from './adapters/google-vision.adapter';
import { MockOcrAdapter } from './adapters/mock-ocr.adapter';
import { OcrProvider } from './adapters/ocr-provider.port';

@Injectable()
export class ReceiptOcrService {
  private readonly logger = new Logger(ReceiptOcrService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly visionAdapter: GoogleVisionAdapter,
    private readonly mockAdapter: MockOcrAdapter,
  ) {}

  private adapterFor(name?: string): OcrProvider {
    const choice = (name ?? process.env.OCR_PROVIDER ?? '').toLowerCase();
    if (choice === 'google-vision') return this.visionAdapter;
    if (choice === 'mock' || !choice) return this.mockAdapter;
    // Default to mock so CI / dev never accidentally call a paid vendor.
    return this.mockAdapter;
  }

  /**
   * Step 1 of the flow: register a freshly uploaded image. The mobile
   * client uploads to Supabase Storage first, then POSTs the public URL
   * here. We immediately enqueue OCR by calling the provider; in a real
   * deployment this should be moved to a background queue.
   */
  async upload(userId: string, imageUrl: string, providerName?: string) {
    const adapter = this.adapterFor(providerName);
    const [row] = await this.db
      .insert(receiptUploads)
      .values({
        userId,
        imageUrl,
        ocrProvider: adapter.name,
        status: 'processing',
      })
      .returning();
    return row;
  }

  /** Step 2: run OCR; persist parsed data + raw response. */
  async parse(userId: string, receiptId: string) {
    const [row] = await this.db
      .select()
      .from(receiptUploads)
      .where(and(eq(receiptUploads.id, receiptId), eq(receiptUploads.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('Receipt not found');
    if (row.status === 'parsed') return row;

    const adapter = this.adapterFor(row.ocrProvider);
    try {
      const result = await adapter.parse(row.imageUrl);
      const [updated] = await this.db
        .update(receiptUploads)
        .set({
          status: 'parsed',
          ocrResponse: result.rawResponse,
          merchant: result.merchant,
          totalMinor: result.totalMinor,
          currency: result.currency,
          lineItems: result.lineItems,
          confidence: result.confidence.toFixed(4),
          parsedAt: new Date(),
        })
        .where(eq(receiptUploads.id, receiptId))
        .returning();
      return updated;
    } catch (err) {
      this.logger.warn(
        `OCR failed for receipt=${receiptId}: ${err instanceof Error ? err.message : err}`,
      );
      const [failed] = await this.db
        .update(receiptUploads)
        .set({
          status: 'failed',
          ocrResponse: { error: err instanceof Error ? err.message : String(err) },
        })
        .where(eq(receiptUploads.id, receiptId))
        .returning();
      return failed;
    }
  }

  /**
   * Step 3: confirm and turn the parsed receipt into a transaction.
   * The user is allowed to override merchant / total / currency at
   * this step (the OCR result is a suggestion, not the source of truth).
   */
  async confirm(
    userId: string,
    receiptId: string,
    override: { merchant?: string; totalMinor?: number; currency?: string } = {},
  ) {
    const [row] = await this.db
      .select()
      .from(receiptUploads)
      .where(and(eq(receiptUploads.id, receiptId), eq(receiptUploads.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('Receipt not found');
    if (row.status !== 'parsed') {
      throw new NotFoundException(`Receipt is in '${row.status}' state — parse it first`);
    }

    const merchant = override.merchant ?? row.merchant ?? 'Unknown';
    const totalMinor = override.totalMinor ?? Number(row.totalMinor ?? 0);
    const currency = (override.currency ?? row.currency ?? 'USD').toUpperCase();
    if (totalMinor <= 0) {
      throw new NotFoundException('Receipt has no total — please enter manually');
    }

    const [txn] = await this.db
      .insert(transactions)
      .values({
        userId,
        merchant,
        amountMinor: totalMinor,
        currency,
        direction: 'debit',
        source: 'ocr',
        bookedAt: row.parsedAt ?? new Date(),
        category: 'Uncategorized',
      } as never)
      .returning();

    await this.db
      .update(receiptUploads)
      .set({ transactionId: txn.id })
      .where(eq(receiptUploads.id, receiptId));

    return { receipt: { ...row, transactionId: txn.id }, transaction: txn };
  }

  async list(userId: string, cursor?: string, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    if (cursor) {
      return this.db
        .select()
        .from(receiptUploads)
        .where(
          and(
            eq(receiptUploads.userId, userId),
            sql`${receiptUploads.createdAt} < ${new Date(cursor)}`,
          ),
        )
        .orderBy(desc(receiptUploads.createdAt))
        .limit(safeLimit);
    }
    return this.db
      .select()
      .from(receiptUploads)
      .where(eq(receiptUploads.userId, userId))
      .orderBy(desc(receiptUploads.createdAt))
      .limit(safeLimit);
  }

  async get(userId: string, receiptId: string) {
    const [row] = await this.db
      .select()
      .from(receiptUploads)
      .where(and(eq(receiptUploads.id, receiptId), eq(receiptUploads.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('Receipt not found');
    return row;
  }
}
