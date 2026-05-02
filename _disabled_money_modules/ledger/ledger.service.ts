import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';

import { DatabaseService } from '@/common/database.service';
import {
  CursorPaginationParams,
  PaginatedResult,
  decodeCursor,
  encodeCursor,
  normalizeLimit,
} from '@/common/pagination';
import { AuditService } from '@/modules/audit/audit.service';
import { ledgerAccounts, ledgerEntries } from '@db/schema';

export interface LedgerLine {
  ledgerAccountId: number;
  debitMinor: bigint;
  creditMinor: bigint;
  currency: string;
}

export interface PostEntryParams {
  userId: number;
  transactionId: string;
  /** Idempotency key — distinct write retries return the original entry. */
  idempotencyKey: string;
  lines: LedgerLine[];
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Double-entry ledger.
 *
 * Invariants enforced here:
 *   1. Σ debits = Σ credits per write.
 *   2. Currency matches each account's column.
 *   3. Same idempotencyKey → no-op (returns cached entry id).
 *   4. Affected ledger_accounts rows are locked FOR UPDATE inside the
 *      transaction, so concurrent writes apply incremental deltas to the
 *      cached balance instead of racing on a full re-aggregation.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  async postEntry(params: PostEntryParams): Promise<{ entryIds: number[]; idempotent: boolean }> {
    const { userId, transactionId, idempotencyKey, lines, ipAddress, userAgent } = params;

    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new ConflictException('idempotencyKey required (min 8 chars)');
    }
    if (!lines || lines.length === 0) {
      throw new ConflictException('Ledger entry must contain at least one line');
    }

    const totalDebits = lines.reduce((s, l) => s + l.debitMinor, 0n);
    const totalCredits = lines.reduce((s, l) => s + l.creditMinor, 0n);
    if (totalDebits !== totalCredits) {
      throw new ConflictException(
        `Debits (${totalDebits}) must equal credits (${totalCredits})`,
      );
    }

    // Idempotency replay — return cached ids.
    const replay = await this.dbService.db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, idempotencyKey));
    if (replay.length > 0) {
      return { entryIds: replay.map((r) => r.id), idempotent: true };
    }

    const accountIds = [...new Set(lines.map((l) => l.ledgerAccountId))];

    const entryIds = await this.dbService.db.transaction(async (tx) => {
      // Lock the affected accounts so concurrent posts can't read the
      // same balance and both miss each other's delta.
      const locked = await tx.execute(
        sql`SELECT id, currency, balance_minor FROM ledger_accounts
            WHERE id = ANY(${sql.raw('ARRAY[' + accountIds.join(',') + ']::int[]')})
            FOR UPDATE`,
      );
      const lockedRows = (locked as unknown as Array<{ id: number; currency: string }>).map(
        (r) => ({ id: Number(r.id), currency: r.currency }),
      );
      if (lockedRows.length !== accountIds.length) {
        throw new NotFoundException('One or more ledger accounts do not exist');
      }
      for (const line of lines) {
        const acct = lockedRows.find((a) => a.id === line.ledgerAccountId);
        if (!acct) throw new NotFoundException(`Account ${line.ledgerAccountId} not found`);
        if (acct.currency !== line.currency) {
          throw new ConflictException(
            `Currency mismatch for account ${line.ledgerAccountId}: expected ${acct.currency}, got ${line.currency}`,
          );
        }
      }

      // Insert entries — first line owns the idempotency key (UNIQUE),
      // remaining lines NULL it. Partial UNIQUE in the migration permits
      // multiple NULLs.
      const insertedIds: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const inserted = await tx
          .insert(ledgerEntries)
          .values({
            transactionId,
            ledgerAccountId: line.ledgerAccountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            currency: line.currency,
            postedAt: new Date(),
            idempotencyKey: i === 0 ? idempotencyKey : null,
          } as never)
          .returning({ id: ledgerEntries.id });
        insertedIds.push(inserted[0].id as number);
      }

      // Apply incremental delta to cached balance — never re-aggregate.
      // Net delta per account = Σ debit - Σ credit for that account.
      const deltaByAccount = new Map<number, bigint>();
      for (const line of lines) {
        const cur = deltaByAccount.get(line.ledgerAccountId) ?? 0n;
        deltaByAccount.set(
          line.ledgerAccountId,
          cur + line.debitMinor - line.creditMinor,
        );
      }
      for (const [accountId, delta] of deltaByAccount.entries()) {
        await tx
          .update(ledgerAccounts)
          .set({
            balanceMinor: sql`${ledgerAccounts.balanceMinor} + ${delta.toString()}::bigint`,
            updatedAt: new Date(),
          })
          .where(eq(ledgerAccounts.id, accountId));
      }

      return insertedIds;
    });

    await this.auditService.record({
      actorId: userId,
      action: 'ledger_entry_created',
      entityType: 'ledger_entry',
      entityId: undefined,
      payload: {
        transactionId,
        idempotencyKey,
        lineCount: lines.length,
        totalMinor: totalDebits.toString(),
      },
      ipAddress,
      userAgent,
    });

    return { entryIds, idempotent: false };
  }

  async reverseEntry(
    userId: number,
    transactionId: string,
    idempotencyKey: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new ConflictException('idempotencyKey required (min 8 chars) for reversal');
    }

    const reversalTxnId = `REV-${transactionId}`;

    await this.dbService.db.transaction(async (tx) => {
      const originals = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, transactionId));
      if (originals.length === 0) {
        throw new NotFoundException(`No entries found for transaction ${transactionId}`);
      }

      // Lock affected accounts before any work — same protection as postEntry.
      const accountIds = [...new Set(originals.map((o) => o.ledgerAccountId as number))];
      await tx.execute(
        sql`SELECT id FROM ledger_accounts
            WHERE id = ANY(${sql.raw('ARRAY[' + accountIds.join(',') + ']::int[]')})
            FOR UPDATE`,
      );

      // Insert reversal lines. The idempotency_key UNIQUE prevents the
      // same reversal being applied twice across retries.
      let firstLine = true;
      for (const orig of originals) {
        await tx.insert(ledgerEntries).values({
          transactionId: reversalTxnId,
          ledgerAccountId: orig.ledgerAccountId,
          debitMinor: orig.creditMinor,
          creditMinor: orig.debitMinor,
          currency: orig.currency,
          postedAt: new Date(),
          reversalOf: orig.id,
          idempotencyKey: firstLine ? idempotencyKey : null,
        } as never);
        firstLine = false;
      }

      // Incremental delta — reversal amounts are the negation of the original.
      const deltaByAccount = new Map<number, bigint>();
      for (const orig of originals) {
        const cur = deltaByAccount.get(orig.ledgerAccountId as number) ?? 0n;
        deltaByAccount.set(
          orig.ledgerAccountId as number,
          cur + (orig.creditMinor as bigint) - (orig.debitMinor as bigint),
        );
      }
      for (const [accountId, delta] of deltaByAccount.entries()) {
        await tx
          .update(ledgerAccounts)
          .set({
            balanceMinor: sql`${ledgerAccounts.balanceMinor} + ${delta.toString()}::bigint`,
            updatedAt: new Date(),
          })
          .where(eq(ledgerAccounts.id, accountId));
      }
    });

    await this.auditService.record({
      actorId: userId,
      action: 'ledger_entry_reversed',
      entityType: 'ledger_entry',
      entityId: undefined,
      payload: { originalTransactionId: transactionId, reversalTransactionId: reversalTxnId, idempotencyKey },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Authoritative balance — recomputed from entries, ignores the cached
   * column. Use this for reconciliation jobs and for unit tests that
   * verify the cache invariant.
   */
  async getAccountBalance(accountId: number): Promise<bigint> {
    const result = await this.dbService.db
      .select({
        totalDebit: sql<bigint>`coalesce(sum(${ledgerEntries.debitMinor}), 0)`.mapWith(BigInt),
        totalCredit: sql<bigint>`coalesce(sum(${ledgerEntries.creditMinor}), 0)`.mapWith(BigInt),
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.ledgerAccountId, accountId));
    return (result[0]?.totalDebit ?? 0n) - (result[0]?.totalCredit ?? 0n);
  }

  async getUserChartOfAccounts(
    userId: number,
    params: CursorPaginationParams,
  ): Promise<PaginatedResult<typeof ledgerAccounts.$inferSelect>> {
    const limit = normalizeLimit(params.limit);
    const cursor = params.cursor ? Number(decodeCursor(params.cursor)) : null;
    const direction = params.direction ?? 'next';

    const conditions = [eq(ledgerAccounts.actorId, userId)];
    if (cursor) {
      conditions.push(direction === 'next' ? gt(ledgerAccounts.id, cursor) : lt(ledgerAccounts.id, cursor));
    }

    const rows = await this.dbService.db
      .select()
      .from(ledgerAccounts)
      .where(and(...conditions))
      .orderBy(desc(ledgerAccounts.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null;
    const prevCursor = cursor ? encodeCursor(cursor) : null;
    return { data, nextCursor, prevCursor, hasMore };
  }

  async verifyAccountOwnership(accountId: number, userId: number): Promise<void> {
    const rows = await this.dbService.db
      .select({ actorId: ledgerAccounts.actorId })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, accountId));
    if (!rows.length || rows[0].actorId !== userId) {
      throw new NotFoundException('Account not found or access denied');
    }
  }

  async verifyTransactionOwnership(transactionId: string, userId: number): Promise<void> {
    const entries = await this.dbService.db
      .select({ ledgerAccountId: ledgerEntries.ledgerAccountId })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, transactionId));
    if (entries.length === 0) {
      throw new NotFoundException(`No entries found for transaction ${transactionId}`);
    }
    const accountIds = [...new Set(entries.map((e) => e.ledgerAccountId as number))];
    const accounts = await this.dbService.db
      .select({ actorId: ledgerAccounts.actorId })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, accountIds));
    const foreign = accounts.find((a) => a.actorId !== userId);
    if (foreign) {
      throw new NotFoundException('Transaction contains entries you do not own');
    }
  }
}
