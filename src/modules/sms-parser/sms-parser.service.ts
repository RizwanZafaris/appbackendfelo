import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, gt, lt } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  smsBankRoutes,
  smsIngestionLogs,
  smsParserTemplates,
  transactions,
} from '@db/schema';

import {
  IngestSmsDto,
  SmsMessageDto,
} from './dto/sms-parser.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CONFIDENCE_THRESHOLD = 0.8;

/** Parsed field mapping from a template. */
interface ParsedFields {
  amountMinor: number;
  currency: string;
  merchant?: string;
  direction: 'debit' | 'credit';
  date?: string;
}

@Injectable()
export class SmsParserService {
  private readonly logger = new Logger(SmsParserService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * Ingest a batch of SMS messages. Each message is matched against
   * active bank routes and templates; on confidence >= 0.8 a Transaction
   * is created automatically.
   */
  async ingest(userId: string, dto: IngestSmsDto) {
    const results: Array<{
      messageIndex: number;
      status: string;
      transactionId?: string;
      confidence?: number;
    }> = [];

    for (let i = 0; i < dto.messages.length; i++) {
      const msg = dto.messages[i];
      const result = await this.processMessage(userId, msg, i);
      results.push(result);
    }

    return { processed: results.length, results };
  }

  private async processMessage(userId: string, msg: SmsMessageDto, index: number) {
    // Match route by sender pattern
    const route = await this.matchRoute(msg.sender);
    if (!route) {
      await this.createLog(userId, msg, null, null, null, 'no_match');
      return { messageIndex: index, status: 'no_match' };
    }

    // Find active templates for this route
    const templates = await this.db
      .select()
      .from(smsParserTemplates)
      .where(
        and(
          eq(smsParserTemplates.routeId, route.id),
          eq(smsParserTemplates.isActive, true),
        ),
      )
      .orderBy(desc(smsParserTemplates.accuracyPercent));

    if (templates.length === 0) {
      await this.createLog(userId, msg, route.id, null, null, 'no_match');
      return { messageIndex: index, status: 'no_match' };
    }

    // Try each template in priority order
    for (const template of templates) {
      const parsed = this.applyTemplate(msg.body, template.regexPattern, template.fieldMapping);
      if (parsed) {
        const confidence = this.computeConfidence(parsed, template);

        if (confidence >= CONFIDENCE_THRESHOLD) {
          // Check for duplicates
          const isDuplicate = await this.checkDuplicate(userId, parsed);
          if (isDuplicate) {
            await this.createLog(userId, msg, route.id, template.id, confidence, 'parsed');
            return { messageIndex: index, status: 'duplicate', confidence };
          }

          const txn = await this.createTransaction(userId, parsed, msg.body, confidence);
          await this.createLog(userId, msg, route.id, template.id, confidence, 'parsed', txn.id);
          await this.incrementTemplateUsage(template.id, true);
          return { messageIndex: index, status: 'parsed', transactionId: txn.id, confidence };
        } else {
          await this.createLog(userId, msg, route.id, template.id, confidence, 'low_confidence');
          await this.incrementTemplateUsage(template.id, false);
          return { messageIndex: index, status: 'low_confidence', confidence };
        }
      }
    }

    await this.createLog(userId, msg, route.id, null, null, 'no_match');
    return { messageIndex: index, status: 'no_match' };
  }

  /** Match sender against active sms_bank_routes patterns. */
  async matchRoute(sender: string) {
    const routes = await this.db
      .select()
      .from(smsBankRoutes)
      .where(eq(smsBankRoutes.isActive, true))
      .orderBy(desc(smsBankRoutes.priority));

    for (const route of routes) {
      try {
        const regex = new RegExp(route.senderPattern, 'i');
        if (regex.test(sender)) {
          return route;
        }
      } catch {
        this.logger.warn(`Invalid sender pattern for route ${route.id}: ${route.senderPattern}`);
      }
    }
    return null;
  }

  /** Apply a regex template to an SMS body. */
  applyTemplate(
    body: string,
    pattern: string,
    fieldMapping: Record<string, unknown>,
  ): ParsedFields | null {
    try {
      const regex = new RegExp(pattern, 'i');
      const match = body.match(regex);
      if (!match) return null;

      const mapping = fieldMapping as Record<string, number | string>;
      const getGroup = (key: string): string | undefined => {
        const idx = mapping[key];
        if (typeof idx === 'number' && match[idx]) return match[idx];
        return undefined;
      };

      const amountStr = getGroup('amount');
      if (!amountStr) return null;

      const amount = parseFloat(amountStr.replace(/[,\s]/g, ''));
      if (Number.isNaN(amount) || amount <= 0) return null;

      const amountMinor = Math.round(amount * 100);
      const currency = (getGroup('currency') ?? 'CAD').toUpperCase();
      const merchant = getGroup('merchant') ?? 'Unknown';
      const directionRaw = getGroup('direction') ?? 'debit';
      const direction = directionRaw.toLowerCase() === 'credit' ? 'credit' : 'debit';

      return {
        amountMinor,
        currency,
        merchant,
        direction,
        date: getGroup('date'),
      };
    } catch {
      return null;
    }
  }

  /** Create a Transaction from parsed SMS data. */
  async createTransaction(
    userId: string,
    parsed: ParsedFields,
    rawSms: string,
    confidence: number,
  ) {
    const inserted = await this.db
      .insert(transactions)
      .values({
        userId,
        merchant: parsed.merchant ?? 'Unknown',
        currency: parsed.currency,
        amountMinor: parsed.amountMinor,
        direction: parsed.direction,
        source: 'sms',
        rawSms,
        parserConfidence: confidence.toFixed(2),
        bookedAt: parsed.date ? new Date(parsed.date) : new Date(),
      })
      .returning();
    return inserted[0];
  }

  /** Cursor-paginated ingestion log for a user. */
  async getLog(userId: string, opts: { cursor?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const where = [eq(smsIngestionLogs.userId, userId)];
    if (opts.cursor) {
      where.push(lt(smsIngestionLogs.createdAt, new Date(opts.cursor)));
    }

    const rows = await this.db
      .select()
      .from(smsIngestionLogs)
      .where(and(...where))
      .orderBy(desc(smsIngestionLogs.createdAt))
      .limit(limit);

    return {
      data: rows,
      nextCursor: rows.length === limit ? rows[rows.length - 1]?.createdAt.toISOString() : undefined,
    };
  }

  /** List active parser templates with their routes. */
  async getTemplates() {
    return this.db
      .select({
        template: smsParserTemplates,
        route: { id: smsBankRoutes.id, bankName: smsBankRoutes.bankName, senderPattern: smsBankRoutes.senderPattern },
      })
      .from(smsParserTemplates)
      .innerJoin(smsBankRoutes, eq(smsParserTemplates.routeId, smsBankRoutes.id))
      .where(eq(smsParserTemplates.isActive, true))
      .orderBy(desc(smsParserTemplates.accuracyPercent));
  }

  /** Nightly cron: recompute template accuracy from logs. */
  @Cron('0 2 * * *')
  async recomputeTemplateAccuracy() {
    this.logger.log('Recomputing SMS template accuracy...');

    const templates = await this.db
      .select()
      .from(smsParserTemplates)
      .where(eq(smsParserTemplates.isActive, true));

    for (const template of templates) {
      const logs = await this.db
        .select()
        .from(smsIngestionLogs)
        .where(eq(smsIngestionLogs.matchedTemplateId, template.id));

      const total = logs.length;
      const successful = logs.filter(
        (l) => l.status === 'parsed' && l.confidence && parseFloat(String(l.confidence)) >= CONFIDENCE_THRESHOLD,
      ).length;

      const accuracyPercent = total > 0 ? Math.round((successful / total) * 100) : null;

      await this.db
        .update(smsParserTemplates)
        .set({
          accuracyPercent: accuracyPercent ?? template.accuracyPercent,
          totalUses: total,
          successfulUses: successful,
          updatedAt: new Date(),
        })
        .where(eq(smsParserTemplates.id, template.id));
    }

    this.logger.log(`Accuracy recomputed for ${templates.length} templates`);
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private async createLog(
    userId: string,
    msg: SmsMessageDto,
    routeId: string | null,
    templateId: string | null,
    confidence: number | null,
    status: string,
    transactionId?: string,
  ) {
    await this.db.insert(smsIngestionLogs).values({
      userId,
      sender: msg.sender,
      body: msg.body,
      receivedAt: new Date(msg.receivedAt),
      matchedRouteId: routeId,
      matchedTemplateId: templateId,
      confidence: confidence?.toFixed(2) ?? null,
      status: status as SmsIngestionLogStatus,
      transactionId: transactionId ?? null,
    });
  }

  private async checkDuplicate(
    userId: string,
    parsed: ParsedFields,
  ): Promise<boolean> {
    // Deduplicate by amount + currency + approximate date (same day)
    const startOfDay = parsed.date
      ? new Date(new Date(parsed.date).setHours(0, 0, 0, 0))
      : new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);

    const existing = await this.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.amountMinor, parsed.amountMinor),
          eq(transactions.currency, parsed.currency),
          gt(transactions.bookedAt, startOfDay),
          lt(transactions.bookedAt, endOfDay),
          eq(transactions.source, 'sms'),
        ),
      )
      .limit(1);

    return existing.length > 0;
  }

  private computeConfidence(
    parsed: ParsedFields,
    template: { totalUses: number; successfulUses: number; accuracyPercent: number | null },
  ): number {
    let score = 0.7; // base score for successful parse
    if (parsed.merchant && parsed.merchant !== 'Unknown') score += 0.1;
    if (parsed.currency) score += 0.1;
    if (parsed.date) score += 0.05;

    // Historical accuracy bonus
    if (template.accuracyPercent && template.accuracyPercent >= 90) {
      score += 0.05;
    }

    return Math.min(score, 0.99);
  }

  private async incrementTemplateUsage(templateId: string, success: boolean) {
    const template = await this.db.query.smsParserTemplates.findFirst({
      where: eq(smsParserTemplates.id, templateId),
    });
    if (!template) return;

    await this.db
      .update(smsParserTemplates)
      .set({
        totalUses: template.totalUses + 1,
        successfulUses: template.successfulUses + (success ? 1 : 0),
        updatedAt: new Date(),
      })
      .where(eq(smsParserTemplates.id, templateId));
  }
}

type SmsIngestionLogStatus = 'pending' | 'parsed' | 'low_confidence' | 'no_match' | 'error';
