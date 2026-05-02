import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';

import { DatabaseService } from '@/common/database.service';
import {
  CursorPaginationParams,
  PaginatedResult,
  decodeCursor,
  encodeCursor,
  normalizeLimit,
} from '@/common/pagination';
import { AuditService } from '@/modules/audit/audit.service';
import { SanctionsService } from '@/modules/compliance/sanctions.service';
import { deals, disbursementMethods, disbursementOrders } from '@db/schema';

/**
 * KYC tier limits (in minor units). `monthly: null` = unbounded for tier.
 * Tier `none` is intentionally zero — un-KYC'd users cannot disburse.
 */
const TIER_LIMITS: Record<string, { perTransaction: bigint; monthly: bigint | null }> = {
  none: { perTransaction: 0n, monthly: 0n },
  basic: { perTransaction: 1_000_000n, monthly: 5_000_000n },
  verified: { perTransaction: 10_000_000n, monthly: 50_000_000n },
  premium: { perTransaction: 100_000_000n, monthly: null },
};

/**
 * Statuses that consume the rolling-window allowance. The previous
 * implementation only counted 'received' (terminal-success), which let a
 * user pile up unlimited in-flight orders far above their tier cap. Any
 * non-cancelled order that has not been refunded must count.
 */
const IN_FLIGHT_STATUSES = ['pending', 'sent', 'received'] as const;

export interface CreateOrderPayload {
  dealId?: number;
  methodId: number;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  recipientHash: string;
  recipientCountry?: string;
  userUuid: string;
}

@Injectable()
export class DisbursementService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly sanctions: SanctionsService,
  ) {}

  async createOrder(
    actorId: number,
    userKycTier: string,
    payload: CreateOrderPayload,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ orderId: number; idempotent: boolean }> {
    if (!payload.idempotencyKey || payload.idempotencyKey.length < 8) {
      throw new ConflictException('idempotencyKey required (min 8 chars)');
    }

    // ── Idempotency replay ────────────────────────────────────────────
    const existing = await this.dbService.db
      .select({ id: disbursementOrders.id })
      .from(disbursementOrders)
      .where(
        and(
          eq(disbursementOrders.actorId, actorId),
          eq(disbursementOrders.idempotencyKey, payload.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return { orderId: existing[0].id, idempotent: true };
    }

    const tier = TIER_LIMITS[userKycTier] ?? TIER_LIMITS.none;
    if (tier.perTransaction <= 0n) {
      throw new ForbiddenException(
        `KYC tier '${userKycTier}' is not permitted to disburse. Complete identity verification first.`,
      );
    }
    if (payload.amountMinor > tier.perTransaction) {
      throw new ForbiddenException(`Amount exceeds KYC tier ${userKycTier} per-transaction limit`);
    }

    // ── Sanctions / PEP screen — must pass before we touch funds. ────
    const screening = await this.sanctions.screen({
      userUuid: payload.userUuid,
      recipientHash: payload.recipientHash,
      recipientCountry: payload.recipientCountry,
    });
    if (screening.outcome !== 'clear') {
      throw new ForbiddenException(
        `Disbursement blocked by compliance screening (${screening.outcome}).`,
      );
    }

    // ── Method validation ────────────────────────────────────────────
    const methodRows = await this.dbService.db
      .select()
      .from(disbursementMethods)
      .where(eq(disbursementMethods.id, payload.methodId));
    if (!methodRows.length) {
      throw new NotFoundException(`Disbursement method ${payload.methodId} not found`);
    }
    const method = methodRows[0];
    if (!method.isActive) {
      throw new ConflictException(`Disbursement method ${payload.methodId} is inactive`);
    }
    const supportedCurrencies: string[] = (method.supportsCurrencies as string[]) ?? [];
    if (!supportedCurrencies.includes(payload.currency)) {
      throw new ConflictException(
        `Currency ${payload.currency} not supported by method ${payload.methodId}.`,
      );
    }

    if (payload.dealId !== undefined) {
      const dealRows = await this.dbService.db
        .select()
        .from(deals)
        .where(eq(deals.id, payload.dealId));
      if (!dealRows.length) throw new NotFoundException(`Deal ${payload.dealId} not found`);
      if (dealRows[0].status !== 'settled') {
        throw new ConflictException(
          `Deal ${payload.dealId} must be settled before disbursement`,
        );
      }
    }

    // ── Atomic rolling-window check + insert ─────────────────────────
    // Both reads and writes happen inside a single transaction so two
    // parallel POSTs cannot each see the same in-flight total and both
    // pass the cap.
    const orderId = await this.dbService.db.transaction(async (tx) => {
      if (tier.monthly !== null) {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const monthly = await tx
          .select({
            total: sql<bigint>`coalesce(sum(${disbursementOrders.amountMinor}), 0)`.mapWith(
              BigInt,
            ),
          })
          .from(disbursementOrders)
          .where(
            and(
              eq(disbursementOrders.actorId, actorId),
              gte(disbursementOrders.createdAt, thirtyDaysAgo),
              lte(disbursementOrders.createdAt, now),
              inArray(disbursementOrders.status, IN_FLIGHT_STATUSES as unknown as string[]),
            ),
          );
        const monthlyTotal = monthly[0]?.total ?? 0n;
        if (monthlyTotal + payload.amountMinor > tier.monthly) {
          throw new ForbiddenException(
            `Amount exceeds KYC tier ${userKycTier} monthly limit (rolling 30-day window)`,
          );
        }
      }

      const inserted = await tx
        .insert(disbursementOrders)
        .values({
          actorId,
          dealId: payload.dealId ?? null,
          methodId: payload.methodId,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          status: 'pending',
          idempotencyKey: payload.idempotencyKey,
        } as never)
        .returning({ id: disbursementOrders.id });

      return inserted[0].id as number;
    });

    await this.auditService.record({
      actorId,
      action: 'disbursement_created',
      entityType: 'disbursement_order',
      entityId: orderId,
      payload: {
        methodId: payload.methodId,
        amountMinor: payload.amountMinor.toString(),
        currency: payload.currency,
        dealId: payload.dealId,
        idempotencyKey: payload.idempotencyKey,
      },
      ipAddress,
      userAgent,
    });

    return { orderId, idempotent: false };
  }

  async getOrderStatus(orderId: number): Promise<typeof disbursementOrders.$inferSelect | null> {
    const rows = await this.dbService.db
      .select()
      .from(disbursementOrders)
      .where(eq(disbursementOrders.id, orderId));
    return rows[0] ?? null;
  }

  /**
   * Retry a 'failed' order. Uses an optimistic-lock CAS on (id, version,
   * status='failed') to prevent two operators racing the retry button.
   */
  async retryFailed(
    operatorActorId: number,
    orderId: number,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const rows = await this.dbService.db
      .select()
      .from(disbursementOrders)
      .where(eq(disbursementOrders.id, orderId));
    if (!rows.length) throw new NotFoundException(`Order ${orderId} not found`);
    const order = rows[0];
    if (order.status !== 'failed') {
      throw new ConflictException(
        `Order ${orderId} must be 'failed' to retry; status: ${order.status}`,
      );
    }

    const result = await this.dbService.db
      .update(disbursementOrders)
      .set({
        status: 'pending',
        providerRef: null,
        version: sql`${disbursementOrders.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(disbursementOrders.id, orderId),
          eq(disbursementOrders.version, order.version),
          eq(disbursementOrders.status, 'failed'),
        ),
      )
      .returning({ id: disbursementOrders.id });

    if (!result.length) {
      throw new ConflictException('Order changed while we were retrying — refresh and try again');
    }

    await this.auditService.record({
      actorId: operatorActorId,
      action: 'disbursement_retried',
      entityType: 'disbursement_order',
      entityId: orderId,
      payload: { previousVersion: order.version },
      ipAddress,
      userAgent,
    });
  }

  async listOrders(
    actorId: number,
    params: CursorPaginationParams,
  ): Promise<PaginatedResult<typeof disbursementOrders.$inferSelect>> {
    const limit = normalizeLimit(params.limit);
    const cursor = params.cursor ? Number(decodeCursor(params.cursor)) : null;

    const conditions = [eq(disbursementOrders.actorId, actorId)];
    if (cursor) conditions.push(lt(disbursementOrders.id, cursor));

    const rows = await this.dbService.db
      .select()
      .from(disbursementOrders)
      .where(and(...conditions))
      .orderBy(desc(disbursementOrders.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null;
    const prevCursor = cursor ? encodeCursor(cursor) : null;
    return { data, nextCursor, prevCursor, hasMore };
  }
}
