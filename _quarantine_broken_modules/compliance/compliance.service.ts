import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, gte, lt } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { complianceFlags, transactions } from '@db/schema';

import { PatchFlagDto } from './dto/compliance.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Velocity check thresholds. */
const VELOCITY_THRESHOLDS = {
  dailyTxnCount: 20,
  dailyAmountMinor: 500_000_00, // $500K CAD
  singleTxnMinor: 50_000_00, // $50K CAD
};

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /** Get review queue (open + assigned flags), sorted by severity then created. */
  async getReviewQueue(opts: { cursor?: string; limit?: number; status?: string } = {}) {
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const where = [
      opts.status
        ? eq(complianceFlags.status, opts.status as 'open' | 'assigned' | 'approved' | 'rejected' | 'escalated')
        : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[];

    // Default: show open and assigned
    if (!opts.status) {
      where.push(eq(complianceFlags.status, 'open'));
    }

    const rows = await this.db
      .select()
      .from(complianceFlags)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(complianceFlags.createdAt))
      .limit(limit);

    return {
      data: rows,
      nextCursor: rows.length === limit ? rows[rows.length - 1]?.createdAt.toISOString() : undefined,
    };
  }

  /** Update a flag status (assign, approve, reject, escalate). */
  async patchFlag(id: string, dto: PatchFlagDto, adminId: string) {
    const flag = await this.db.query.complianceFlags.findFirst({
      where: eq(complianceFlags.id, id),
    });
    if (!flag) throw new NotFoundException('Flag not found');

    const now = new Date();

    const updateSet: Record<string, unknown> = {
      status: dto.status,
      updatedAt: now,
    };

    if (dto.status === 'assigned') {
      updateSet.assignedTo = dto.assignedTo ?? adminId;
    }

    if (['approved', 'rejected', 'escalated'].includes(dto.status)) {
      updateSet.resolvedAt = now;
      updateSet.resolvedBy = adminId;
      updateSet.resolutionNote = dto.resolutionNote ?? null;
    }

    const updated = await this.db
      .update(complianceFlags)
      .set(updateSet)
      .where(eq(complianceFlags.id, id))
      .returning();

    return updated[0];
  }

  /** Nightly cron: scan aggregate transfers and create flags. */
  @Cron('0 3 * * *')
  async nightlyScan() {
    this.logger.log('Compliance nightly scan started...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Velocity flags: users with >20 transactions today
    await this.scanVelocity(today);

    // 2. Amount threshold flags: single transaction > $50K
    await this.scanAmountThresholds(today);

    // 3. Daily aggregate flags: total daily volume > $500K
    await this.scanDailyAggregate(today);

    this.logger.log('Compliance nightly scan complete');
  }

  // ------------------------------------------------------------------
  // Scan helpers
  // ------------------------------------------------------------------

  private async scanVelocity(today: Date) {
    const tomorrow = new Date(today.getTime() + 86_400_000);

    // Find users with more than threshold transactions today
    const rows = await this.db
      .select({
        userId: transactions.userId,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.bookedAt, today),
          lt(transactions.bookedAt, tomorrow),
        ),
      )
      .groupBy(transactions.userId);

    for (const row of rows) {
      if (row.count >= VELOCITY_THRESHOLDS.dailyTxnCount) {
        await this.createFlagIfNotExists({
          userId: row.userId,
          flagType: 'velocity',
          severity: 'medium',
          description: `User made ${row.count} transactions today (threshold: ${VELOCITY_THRESHOLDS.dailyTxnCount})`,
          evidence: { transactionCount: row.count, date: today.toISOString() },
        });
      }
    }
  }

  private async scanAmountThresholds(today: Date) {
    const rows = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.bookedAt, today),
          gte(transactions.amountMinor, VELOCITY_THRESHOLDS.singleTxnMinor),
        ),
      );

    for (const txn of rows) {
      await this.createFlagIfNotExists({
        userId: txn.userId,
        flagType: 'amount_threshold',
        severity: txn.amountMinor >= 100_000_00 ? 'high' : 'medium',
        description: `Single transaction of ${txn.amountMinor / 100} ${txn.currency} exceeds threshold`,
        evidence: {
          transactionId: txn.id,
          amountMinor: txn.amountMinor,
          currency: txn.currency,
          merchant: txn.merchant,
        },
      });
    }
  }

  private async scanDailyAggregate(today: Date) {
    const tomorrow = new Date(today.getTime() + 86_400_000);

    const rows = await this.db
      .select({
        userId: transactions.userId,
        total: sql<number>`sum(${transactions.amountMinor})`,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.bookedAt, today),
          lt(transactions.bookedAt, tomorrow),
        ),
      )
      .groupBy(transactions.userId);

    for (const row of rows) {
      if (row.total >= VELOCITY_THRESHOLDS.dailyAmountMinor) {
        await this.createFlagIfNotExists({
          userId: row.userId,
          flagType: 'frequency',
          severity: 'high',
          description: `Daily aggregate volume ${row.total / 100} CAD exceeds threshold`,
          evidence: { totalMinor: row.total, date: today.toISOString() },
        });
      }
    }
  }

  private async createFlagIfNotExists(params: {
    userId: string;
    flagType: 'velocity' | 'amount_threshold' | 'frequency' | 'pattern' | 'manual';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    evidence: Record<string, unknown>;
  }) {
    // Check for existing open flag of same type for same user today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await this.db
      .select({ id: complianceFlags.id })
      .from(complianceFlags)
      .where(
        and(
          eq(complianceFlags.userId, params.userId),
          eq(complianceFlags.flagType, params.flagType),
          gte(complianceFlags.createdAt, today),
        ),
      )
      .limit(1);

    if (existing.length > 0) return;

    await this.db.insert(complianceFlags).values({
      userId: params.userId,
      flagType: params.flagType,
      severity: params.severity,
      description: params.description,
      evidence: params.evidence,
      status: 'open',
    });

    this.logger.log(`Created ${params.flagType} flag for user ${params.userId}`);
  }
}
