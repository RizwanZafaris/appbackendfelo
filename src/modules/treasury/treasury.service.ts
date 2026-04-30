import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/common/database.service';
import { AuditService } from '@/modules/audit/audit.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { deals, treasuryAccounts } from '@db/schema';
import { eq, and, desc, sql, gte, lte, gt, lt, or } from 'drizzle-orm';
import { CursorPaginationParams, normalizeLimit, encodeCursor, decodeCursor, PaginatedResult } from '@/common/pagination';

export interface BookDealPayload {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmountMinor: bigint;
  targetAmountMinor: bigint;
  ourRate: string;
  marketRate: string;
  marginBps: number;
}

@Injectable()
export class TreasuryService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly ledgerService: LedgerService,
  ) {}

  async bookDeal(
    operatorId: number,
    payload: BookDealPayload,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ dealId: number }> {
    const [sourceTreasury, targetTreasury] = await Promise.all([
      this.dbService.db.select().from(treasuryAccounts).where(eq(treasuryAccounts.currency, payload.sourceCurrency)),
      this.dbService.db.select().from(treasuryAccounts).where(eq(treasuryAccounts.currency, payload.targetCurrency)),
    ]);

    if (!sourceTreasury.length || !sourceTreasury[0].isActive) {
      throw new Error(`Source treasury account for ${payload.sourceCurrency} not found or inactive`);
    }
    if (!targetTreasury.length || !targetTreasury[0].isActive) {
      throw new Error(`Target treasury account for ${payload.targetCurrency} not found or inactive`);
    }

    const result = await this.dbService.db
      .insert(deals)
      .values({
        sourceCurrency: payload.sourceCurrency,
        targetCurrency: payload.targetCurrency,
        sourceAmountMinor: payload.sourceAmountMinor,
        targetAmountMinor: payload.targetAmountMinor,
        ourRate: payload.ourRate,
        marketRate: payload.marketRate,
        marginBps: payload.marginBps,
        status: 'booked',
        bookedAt: new Date(),
      })
      .returning({ id: deals.id });

    const dealId = result[0].id;
    const txnId = `DEAL-${dealId}`;

    await this.ledgerService.postEntry(
      operatorId,
      txnId,
      [
        {
          ledgerAccountId: sourceTreasury[0].id,
          debitMinor: payload.sourceAmountMinor,
          creditMinor: 0n,
          currency: payload.sourceCurrency,
        },
        {
          ledgerAccountId: targetTreasury[0].id,
          debitMinor: 0n,
          creditMinor: payload.targetAmountMinor,
          currency: payload.targetCurrency,
        },
      ],
      ipAddress,
      userAgent,
    );

    await this.auditService.record({
      actorId: operatorId,
      action: 'deal_booked',
      entityType: 'deal',
      entityId: dealId,
      payload: {
        sourceCurrency: payload.sourceCurrency,
        targetCurrency: payload.targetCurrency,
        sourceAmountMinor: payload.sourceAmountMinor.toString(),
        targetAmountMinor: payload.targetAmountMinor.toString(),
        ourRate: payload.ourRate,
        marketRate: payload.marketRate,
        marginBps: payload.marginBps,
      },
      ipAddress,
      userAgent,
    });

    return { dealId };
  }

  async getPositions(): Promise<Array<{ currency: string; balanceMinor: string; longShort: 'long' | 'short' | 'flat' }>> {
    const rows = await this.dbService.db.select().from(treasuryAccounts).where(eq(treasuryAccounts.isActive, true));

    return rows.map((row) => {
      const balance = row.balanceMinor;
      let longShort: 'long' | 'short' | 'flat' = 'flat';
      if (balance > 0n) longShort = 'long';
      else if (balance < 0n) longShort = 'short';

      return {
        currency: row.currency,
        balanceMinor: balance.toString(),
        longShort,
      };
    });
  }

  async settleDeal(
    operatorId: number,
    dealId: number,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const dealRows = await this.dbService.db.select().from(deals).where(eq(deals.id, dealId));
    if (!dealRows.length) {
      throw new Error(`Deal ${dealId} not found`);
    }

    const deal = dealRows[0];
    if (deal.status !== 'booked') {
      throw new Error(`Deal ${dealId} must be in 'booked' status to settle; current status: ${deal.status}`);
    }

    await this.dbService.db.transaction(async (tx) => {
      await tx
        .update(deals)
        .set({ status: 'settled', settledAt: new Date(), updatedAt: new Date() })
        .where(eq(deals.id, dealId));

      const sourceAccount = await tx
        .select()
        .from(treasuryAccounts)
        .where(eq(treasuryAccounts.currency, deal.sourceCurrency));
      const targetAccount = await tx
        .select()
        .from(treasuryAccounts)
        .where(eq(treasuryAccounts.currency, deal.targetCurrency));

      if (sourceAccount.length) {
        const currentBalance = sourceAccount[0].balanceMinor;
        await tx
          .update(treasuryAccounts)
          .set({
            balanceMinor: currentBalance - deal.sourceAmountMinor,
            updatedAt: new Date(),
          })
          .where(eq(treasuryAccounts.currency, deal.sourceCurrency));
      }

      if (targetAccount.length) {
        const currentBalance = targetAccount[0].balanceMinor;
        await tx
          .update(treasuryAccounts)
          .set({
            balanceMinor: currentBalance + deal.targetAmountMinor,
            updatedAt: new Date(),
          })
          .where(eq(treasuryAccounts.currency, deal.targetCurrency));
      }
    });

    await this.auditService.record({
      actorId: operatorId,
      action: 'deal_settled',
      entityType: 'deal',
      entityId: dealId,
      payload: { sourceCurrency: deal.sourceCurrency, targetCurrency: deal.targetCurrency },
      ipAddress,
      userAgent,
    });
  }

  async listDeals(params: CursorPaginationParams): Promise<PaginatedResult<typeof deals.$inferSelect>> {
    const limit = normalizeLimit(params.limit);
    const cursor = params.cursor ? decodeCursor(params.cursor) : null;
    const direction = params.direction ?? 'next';

    const conditions = [];
    if (cursor) {
      const [cursorDate, cursorId] = cursor.split(':');
      const date = new Date(cursorDate);
      const id = Number(cursorId);
      if (direction === 'next') {
        conditions.push(
          or(
            lt(deals.createdAt, date),
            and(eq(deals.createdAt, date), lt(deals.id, id)),
          ),
        );
      } else {
        conditions.push(
          or(
            gt(deals.createdAt, date),
            and(eq(deals.createdAt, date), gt(deals.id, id)),
          ),
        );
      }
    }

    const rows = await this.dbService.db
      .select()
      .from(deals)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(deals.createdAt), desc(deals.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && data.length > 0
      ? encodeCursor(`${data[data.length - 1].createdAt.toISOString()}:${data[data.length - 1].id}`)
      : null;
    const prevCursor = cursor ? encodeCursor(cursor) : null;

    return { data, nextCursor, prevCursor, hasMore };
  }
}
