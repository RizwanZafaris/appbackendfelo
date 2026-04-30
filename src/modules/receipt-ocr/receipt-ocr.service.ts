import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { ocrUsageLog, receipts, subscriptionUsage, transactions } from '@db/schema';
import {
  OCR_PROVIDER,
  OcrProvider,
} from '@/integrations/ocr/ocr-provider.port';

import {
  ConfirmReceiptDto,
  UploadReceiptDto,
} from './dto/receipt-ocr.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class ReceiptOcrService {
  private readonly logger = new Logger(ReceiptOcrService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    @Inject(OCR_PROVIDER) private readonly ocr: OcrProvider,
  ) {}

  /** Upload receipt metadata — actual file goes to Supabase Storage. */
  async upload(userId: string, dto: UploadReceiptDto, filePath: string) {
    const inserted = await this.db
      .insert(receipts)
      .values({
        userId,
        filePath,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        status: 'uploaded',
      })
      .returning();
    return inserted[0];
  }

  /** Parse a receipt using the configured OCR provider. */
  async parse(userId: string, receiptId: string) {
    const receipt = await this.db.query.receipts.findFirst({
      where: and(eq(receipts.id, receiptId), eq(receipts.userId, userId)),
    });
    if (!receipt) throw new NotFoundException('Receipt not found');

    // Check OCR quota via subscription_usage
    const hasQuota = await this.checkQuota(userId);
    if (!hasQuota) {
      throw new BadRequestException('OCR quota exceeded for today. Upgrade your plan.');
    }

    // Update status to parsing
    await this.db
      .update(receipts)
      .set({ status: 'parsing', updatedAt: new Date() })
      .where(eq(receipts.id, receiptId));

    try {
      // Build public URL from Supabase storage path
      const imageUrl = this.buildPublicUrl(receipt.filePath);
      const result = await this.ocr.parse(imageUrl);

      // Update receipt with parsed data
      const updated = await this.db
        .update(receipts)
        .set({
          status: 'parsed',
          parsedData: result as unknown as Record<string, unknown>,
          ocrProvider: this.ocr.name,
          updatedAt: new Date(),
        })
        .where(eq(receipts.id, receiptId))
        .returning();

      // Log OCR usage
      await this.logOcrUsage(userId, receiptId, 'success');

      return updated[0];
    } catch (err) {
      this.logger.error(`OCR parse failed for receipt ${receiptId}: ${err instanceof Error ? err.message : String(err)}`);

      await this.db
        .update(receipts)
        .set({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
          updatedAt: new Date(),
        })
        .where(eq(receipts.id, receiptId));

      await this.logOcrUsage(userId, receiptId, 'error');
      throw new BadRequestException('OCR parsing failed');
    }
  }

  /** Confirm parsed receipt data and create a Transaction. */
  async confirm(userId: string, receiptId: string, dto: ConfirmReceiptDto) {
    const receipt = await this.db.query.receipts.findFirst({
      where: and(eq(receipts.id, receiptId), eq(receipts.userId, userId)),
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (receipt.status !== 'parsed') {
      throw new BadRequestException('Receipt must be parsed before confirming');
    }

    const totalMinor = dto.totalMinor;
    const currency = dto.currency.toUpperCase();

    const inserted = await this.db
      .insert(transactions)
      .values({
        userId,
        merchant: dto.merchant ?? 'Receipt',
        currency,
        amountMinor: totalMinor,
        direction: dto.direction ?? 'debit',
        source: 'ocr',
        bookedAt: dto.bookedAt ? new Date(dto.bookedAt) : new Date(),
        receiptUrl: receipt.filePath,
        metadata: {
          receiptId,
          lineItems: dto.lineItems ?? [],
          taxMinor: dto.taxMinor ?? null,
          ocrProvider: receipt.ocrProvider,
        },
      })
      .returning();

    const txn = inserted[0];

    // Link receipt to transaction
    await this.db
      .update(receipts)
      .set({ status: 'confirmed', transactionId: txn.id, updatedAt: new Date() })
      .where(eq(receipts.id, receiptId));

    return { receipt: { ...receipt, status: 'confirmed' as const, transactionId: txn.id }, transaction: txn };
  }

  /** List user receipts, newest first. */
  async list(userId: string, opts: { cursor?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const where = [eq(receipts.userId, userId)];

    if (opts.cursor) {
      // Cursor is an ISO timestamp
      const cursorDate = new Date(opts.cursor);
      where.push(desc(receipts.createdAt));
    }

    const rows = await this.db
      .select()
      .from(receipts)
      .where(and(...where))
      .orderBy(desc(receipts.createdAt))
      .limit(limit);

    return {
      data: rows,
      nextCursor: rows.length === limit ? rows[rows.length - 1]?.createdAt.toISOString() : undefined,
    };
  }

  /** Check daily OCR quota. */
  private async checkQuota(userId: string): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];
    const usage = await this.db.query.subscriptionUsage.findFirst({
      where: and(
        eq(subscriptionUsage.userId, userId),
        eq(subscriptionUsage.usageDate, today),
      ),
    });

    // Default free tier: 10 OCR/day
    const limit = 10;
    return (usage?.receiptOcrCount ?? 0) < limit;
  }

  /** Write OCR cost entry to ocr_usage_log. */
  private async logOcrUsage(
    userId: string,
    receiptId: string,
    status: 'success' | 'error',
  ) {
    // Approximate cost: Google Vision $1.50 per 1000 pages = 0.15 cents per page
    const costUsdCents = status === 'success' ? 1 : 0;

    await this.db.insert(ocrUsageLog).values({
      userId,
      receiptId,
      provider: this.ocr.name,
      costUsdCents,
      status,
    });
  }

  private buildPublicUrl(filePath: string): string {
    // Supabase storage public URL — env override for bucket name
    const bucket = process.env.SUPABASE_RECEIPTS_BUCKET ?? 'receipts';
    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
  }
}
