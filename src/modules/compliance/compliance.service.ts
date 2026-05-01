import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import {
  complianceFlags,
  complianceThresholds,
  transactions,
} from '@db/schema';

/**
 * AML / CTF compliance flag engine.
 *
 * Rules are configurable via the `compliance_thresholds` table (so ops
 * can edit them without a deploy). Three built-in rule families:
 *
 *   • aggregate_<currency>      — sum of debit volume in window > threshold
 *   • single_<currency>         — single transaction amount > threshold
 *   • count_<currency>          — transaction COUNT in window > threshold
 *
 * If no thresholds exist for a user yet, conservative built-in defaults
 * are used. `scanUser()` is idempotent: it re-evaluates each rule and
 * creates an `open` flag only when no open flag for that ruleKey exists.
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  // Built-in defaults — replaced by DB rows when present.
  private static readonly DEFAULT_RULES: Array<{
    ruleKey: string;
    thresholdMinor: number;
    windowDays: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }> = [
    { ruleKey: 'aggregate_30d_default', thresholdMinor: 50_000_00, windowDays: 30, severity: 'high' },
    { ruleKey: 'single_txn_default', thresholdMinor: 10_000_00, windowDays: 1, severity: 'high' },
    { ruleKey: 'count_24h_default', thresholdMinor: 20, windowDays: 1, severity: 'medium' },
  ];

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  // ─── Threshold administration ────────────────────────────────────
  listThresholds() {
    return this.db
      .select()
      .from(complianceThresholds)
      .orderBy(desc(complianceThresholds.createdAt));
  }

  async createThreshold(input: {
    ruleKey: string;
    thresholdMinor: number;
    windowDays?: number;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    audience?: Record<string, unknown>;
  }) {
    const [row] = await this.db
      .insert(complianceThresholds)
      .values({
        ruleKey: input.ruleKey,
        thresholdMinor: input.thresholdMinor,
        windowDays: input.windowDays ?? 30,
        severity: input.severity ?? 'medium',
        audience: input.audience ?? {},
      })
      .returning();
    return row;
  }

  async updateThreshold(
    ruleKey: string,
    patch: Partial<{
      thresholdMinor: number;
      windowDays: number;
      severity: 'low' | 'medium' | 'high' | 'critical';
      audience: Record<string, unknown>;
      isActive: boolean;
    }>,
  ) {
    const update: Record<string, unknown> = { version: sql`${complianceThresholds.version} + 1` };
    if (patch.thresholdMinor !== undefined) update.thresholdMinor = patch.thresholdMinor;
    if (patch.windowDays !== undefined) update.windowDays = patch.windowDays;
    if (patch.severity !== undefined) update.severity = patch.severity;
    if (patch.audience !== undefined) update.audience = patch.audience;
    if (patch.isActive !== undefined) update.isActive = patch.isActive;
    const [row] = await this.db
      .update(complianceThresholds)
      .set(update as never)
      .where(eq(complianceThresholds.ruleKey, ruleKey))
      .returning();
    if (!row) throw new NotFoundException(`Threshold ${ruleKey} not found`);
    return row;
  }

  async deleteThreshold(ruleKey: string) {
    const result = await this.db
      .delete(complianceThresholds)
      .where(eq(complianceThresholds.ruleKey, ruleKey))
      .returning();
    if (!result[0]) throw new NotFoundException(`Threshold ${ruleKey} not found`);
    return { deleted: true };
  }

  // ─── Flag administration (ops portal) ────────────────────────────
  listFlags(opts: { status?: string; cursor?: string; limit?: number } = {}) {
    const safeLimit = Math.min(opts.limit ?? 50, 200);
    const conditions: ReturnType<typeof eq>[] = [];
    if (opts.status) {
      conditions.push(eq(complianceFlags.status, opts.status as 'open' | 'under_review' | 'cleared' | 'escalated' | 'dismissed'));
    }
    if (opts.cursor) {
      conditions.push(sql`${complianceFlags.triggeredAt} < ${new Date(opts.cursor)}` as never);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const q = this.db.select().from(complianceFlags);
    return where
      ? q.where(where).orderBy(desc(complianceFlags.triggeredAt)).limit(safeLimit)
      : q.orderBy(desc(complianceFlags.triggeredAt)).limit(safeLimit);
  }

  listFlagsForUser(userId: string) {
    return this.db
      .select()
      .from(complianceFlags)
      .where(eq(complianceFlags.userId, userId))
      .orderBy(desc(complianceFlags.triggeredAt));
  }

  async decide(
    flagId: string,
    reviewerId: string,
    status: 'under_review' | 'cleared' | 'escalated' | 'dismissed',
    reason?: string,
  ) {
    const [row] = await this.db
      .update(complianceFlags)
      .set({
        status,
        reviewerId,
        decidedAt: new Date(),
        reason: reason ?? null,
      })
      .where(eq(complianceFlags.id, flagId))
      .returning();
    if (!row) throw new NotFoundException('Flag not found');
    return row;
  }

  // ─── Rule evaluation ─────────────────────────────────────────────
  /**
   * Runs every active threshold rule against the user's recent
   * transactions. Returns the new flags created in this scan.
   */
  async scanUser(userId: string) {
    const rules = await this.activeRulesFor(userId);
    const created: Array<typeof complianceFlags.$inferSelect> = [];

    for (const rule of rules) {
      const triggered = await this.evaluate(userId, rule);
      if (!triggered) continue;
      const existingOpen = await this.db
        .select()
        .from(complianceFlags)
        .where(
          and(
            eq(complianceFlags.userId, userId),
            eq(complianceFlags.ruleKey, rule.ruleKey),
            eq(complianceFlags.status, 'open'),
          ),
        )
        .limit(1);
      if (existingOpen.length > 0) continue;

      const [row] = await this.db
        .insert(complianceFlags)
        .values({
          userId,
          ruleKey: rule.ruleKey,
          status: 'open',
        })
        .returning();
      created.push(row);
      this.logger.warn(
        `Compliance flag created — user=${userId} rule=${rule.ruleKey} severity=${rule.severity}`,
      );
    }

    return created;
  }

  private async activeRulesFor(_userId: string) {
    const dbRules = await this.db
      .select()
      .from(complianceThresholds)
      .where(eq(complianceThresholds.isActive, true));
    if (dbRules.length > 0) return dbRules;
    // Fall back to in-code defaults so the system fails safe (rules
    // active even before ops has populated the table).
    return ComplianceService.DEFAULT_RULES.map((r) => ({
      id: '00000000-0000-0000-0000-000000000000',
      ruleKey: r.ruleKey,
      thresholdMinor: r.thresholdMinor,
      windowDays: r.windowDays,
      severity: r.severity,
      audience: {},
      version: 0,
      isActive: true,
      createdAt: new Date(),
    }));
  }

  /**
   * Evaluates a single rule. The ruleKey prefix selects the kind of check:
   *   aggregate_*  — sum(amountMinor) where direction='debit' in window
   *   single_*     — max(amountMinor) where direction='debit' in window
   *   count_*      — COUNT(*) in window
   */
  private async evaluate(
    userId: string,
    rule: {
      ruleKey: string;
      thresholdMinor: number;
      windowDays: number;
    },
  ): Promise<boolean> {
    const since = new Date(Date.now() - rule.windowDays * 24 * 60 * 60 * 1000);
    const kind = rule.ruleKey.split('_')[0];

    if (kind === 'aggregate') {
      const [row] = await this.db
        .select({ total: sql<number>`COALESCE(SUM(${transactions.amountMinor}), 0)::bigint` })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.direction, 'debit'),
            gte(transactions.bookedAt, since),
          ),
        );
      return Number(row?.total ?? 0) > rule.thresholdMinor;
    }

    if (kind === 'single') {
      const [row] = await this.db
        .select({ max: sql<number>`COALESCE(MAX(${transactions.amountMinor}), 0)::bigint` })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.direction, 'debit'),
            gte(transactions.bookedAt, since),
          ),
        );
      return Number(row?.max ?? 0) > rule.thresholdMinor;
    }

    if (kind === 'count') {
      const [row] = await this.db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            gte(transactions.bookedAt, since),
          ),
        );
      // For count rules the threshold is a count, not a money amount.
      return Number(row?.c ?? 0) > rule.thresholdMinor;
    }

    this.logger.warn(`Unknown rule kind for key ${rule.ruleKey}; skipping`);
    return false;
  }
}
