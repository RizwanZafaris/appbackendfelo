import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/common/database.service';
import { AuditService } from '@/modules/audit/audit.service';
import { disbursementOrders, disbursementMethods, deals } from '@db/schema';
import { eq, and, desc, sql, gte, lte, gt, lt } from 'drizzle-orm';
import { CursorPaginationParams, normalizeLimit, encodeCursor, decodeCursor, PaginatedResult } from '@/common/pagination';

const TIER_LIMITS: Record<string, { perTransaction: bigint; monthly: bigint | null }> = {
  none: { perTransaction: 0n, monthly: 0n },
  basic: { perTransaction: 1000000n, monthly: 5000000n },
  verified: { perTransaction: 10000000n, monthly: 50000000n },
  premium: { perTransaction: 100000000n, monthly: null },
};

export interface CreateOrderPayload {
  dealId?: number;
  methodId: number;
  amountMinor: bigint;
  currency: string;
}

@Injectable()
export class DisbursementService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  async createOrder(
    userId: number,
    userKycTier: string,
    payload: CreateOrderPayload,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ orderId: number }> {
    const tier = TIER_LIMITS[userKycTier] ?? TIER_LIMITS.none;

    if (tier.perTransaction !== null && payload.amountMinor > tier.perTransaction) {
      throw new Error(`Amount exceeds KYC tier ${userKycTier} per-transaction limit`);
    }

    if (tier.monthly !== null) {
      const now = new Date();
      // Rolling 30-day window (not calendar month)
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const monthlyResult = await this.dbService.db
        .select({
          total: sql<bigint>`coalesce(sum(${disbursementOrders.amountMinor}), 0)`.mapWith(BigInt),
        })
        .from(disbursementOrders)
        .where(
          and(
            eq(disbursementOrders.actorId, userId),
            gte(disbursementOrders.createdAt, thirtyDaysAgo),
            lte(disbursementOrders.createdAt, now),
            eq(disbursementOrders.status, 'received'),
          ),
        );

      const monthlyTotal = monthlyResult[0]?.total ?? 0n;
      if (monthlyTotal + payload.amountMinor > tier.monthly) {
        throw new Error(`Amount exceeds KYC tier ${userKycTier} monthly limit (rolling 30-day window)`);
      }
    }

    const methodRows = await this.dbService.db
      .select()
      .from(disbursementMethods)
      .where(eq(disbursementMethods.id, payload.methodId));

    if (!methodRows.length) {
      throw new Error(`Disbursement method ${payload.methodId} not found`);
    }

    const method = methodRows[0];
    if (!method.isActive) {
      throw new Error(`Disbursement method ${payload.methodId} is inactive`);
    }

    const supportedCurrencies: string[] = (method.supportsCurrencies as string[]) ?? [];
    if (!supportedCurrencies.includes(payload.currency)) {
      throw new Error(
        `Currency ${payload.currency} not supported by method ${payload.methodId}. Supported: ${supportedCurrencies.join(', ')}`,
      );
    }

    if (payload.dealId !== undefined) {
      const dealRows = await this.dbService.db
        .select()
        .from(deals)
        .where(eq(deals.id, payload.dealId));

      if (!dealRows.length) {
        throw new Error(`Deal ${payload.dealId} not found`);
      }

      if (dealRows[0].status !== 'settled') {
        throw new Error(`Deal ${payload.dealId} must be settled before creating a disbursement order`);
      }
    }

    const result = await this.dbService.db
      .insert(disbursementOrders)
      .values({
        actorId: userId,
        dealId: payload.dealId ?? null,
        methodId: payload.methodId,
        amountMinor: payload.amountMinor,
        currency: payload.currency,
        status: 'pending',
      })
      .returning({ id: disbursementOrders.id });

    const orderId = result[0].id;

    await this.auditService.record({
      actorId: userId,
      action: 'disbursement_created',
      entityType: 'disbursement_order',
      entityId: orderId,
      payload: {
        methodId: payload.methodId,
        amountMinor: payload.amountMinor.toString(),
        currency: payload.currency,
        dealId: payload.dealId,
      },
      ipAddress,
      userAgent,
    });

    return { orderId };
  }

  async getOrderStatus(orderId: number): Promise<typeof disbursementOrders.$inferSelect | null> {
    const rows = await this.dbService.db
      .select()
      .from(disbursementOrders)
      .where(eq(disbursementOrders.id, orderId));

    return rows[0] ?? null;
  }

  async retryFailed(
    operatorId: number,
    orderId: number,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const rows = await this.dbService.db
      .select()
      .from(disbursementOrders)
      .where(eq(disbursementOrders.id, orderId));

    if (!rows.length) {
      throw new Error(`Order ${orderId} not found`);
    }

    const order = rows[0];
    if (order.status !== 'failed') {
      throw new Error(`Order ${orderId} must be in 'failed' status to retry; current status: ${order.status}`);
    }

    await this.dbService.db
      .update(disbursementOrders)
      .set({
        status: 'pending',
        providerRef: null,
        updatedAt: new Date(),
      })
      .where(eq(disbursementOrders.id, orderId));

    await this.auditService.record({
      actorId: operatorId,
      action: 'disbursement_retried',
      entityType: 'disbursement_order',
      entityId: orderId,
      payload: { previousStatus: order.status },
      ipAddress,
      userAgent,
    });
  }

  async listOrders(
    userId: number,
    params: CursorPaginationParams,
  ): Promise<PaginatedResult<typeof disbursementOrders.$inferSelect>> {
    const limit = normalizeLimit(params.limit);
    const cursor = params.cursor ? Number(decodeCursor(params.cursor)) : null;
    const direction = params.direction ?? 'next';

    const conditions = [eq(disbursementOrders.actorId, userId)];
    if (cursor) {
      if (direction === 'next') {
        conditions.push(lt(disbursementOrders.id, cursor));
      } else {
        conditions.push(gt(disbursementOrders.id, cursor));
      }
    }

    const rows = await this.dbService.db
      .select()
      .from(disbursementOrders)
      .where(and(...conditions))
      .orderBy(desc(disbursementOrders.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null;
    const prevCursor = cursor ? encodeCursor(cursor) : null;

    return { data, nextCursor, prevCursor, hasMore };
  }
}
