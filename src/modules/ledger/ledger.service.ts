import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/common/database.service';
import { AuditService } from '@/modules/audit/audit.service';
import { ledgerAccounts, ledgerEntries } from '@db/schema';
import { eq, and, inArray, sql, desc, gt, lt } from 'drizzle-orm';
import { CursorPaginationParams, normalizeLimit, encodeCursor, decodeCursor, PaginatedResult } from '@/common/pagination';

export interface LedgerLine {
  ledgerAccountId: number;
  debitMinor: bigint;
  creditMinor: bigint;
  currency: string;
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  async postEntry(
    userId: number,
    transactionId: string,
    lines: LedgerLine[],
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    if (!lines || lines.length === 0) {
      throw new Error('Ledger entry must contain at least one line');
    }

    const totalDebits = lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const totalCredits = lines.reduce((sum, line) => sum + line.creditMinor, 0n);

    if (totalDebits !== totalCredits) {
      throw new Error(`Debits (${totalDebits}) must equal credits (${totalCredits})`);
    }

    const accountIds = [...new Set(lines.map((l) => l.ledgerAccountId))];
    const accounts = await this.dbService.db
      .select()
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, accountIds));

    if (accounts.length !== accountIds.length) {
      throw new Error('One or more ledger accounts do not exist');
    }

    for (const line of lines) {
      const account = accounts.find((a) => a.id === line.ledgerAccountId);
      if (!account) {
        throw new Error(`Account ${line.ledgerAccountId} not found`);
      }
      if (account.currency !== line.currency) {
        throw new Error(
          `Currency mismatch for account ${line.ledgerAccountId}: expected ${account.currency}, got ${line.currency}`,
        );
      }
    }

    await this.dbService.db.transaction(async (tx) => {
      for (const line of lines) {
        await tx.insert(ledgerEntries).values({
          transactionId,
          ledgerAccountId: line.ledgerAccountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          currency: line.currency,
          postedAt: new Date(),
        });
      }

      for (const accountId of accountIds) {
        const result = await tx
          .select({
            totalDebit: sql<bigint>`sum(${ledgerEntries.debitMinor})`.mapWith(BigInt),
            totalCredit: sql<bigint>`sum(${ledgerEntries.creditMinor})`.mapWith(BigInt),
          })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.ledgerAccountId, accountId));

        const totalDebit = result[0]?.totalDebit ?? 0n;
        const totalCredit = result[0]?.totalCredit ?? 0n;
        const newBalance = totalDebit - totalCredit;

        await tx
          .update(ledgerAccounts)
          .set({ balanceMinor: newBalance, updatedAt: new Date() })
          .where(eq(ledgerAccounts.id, accountId));
      }
    });

    await this.auditService.record({
      actorId: userId,
      action: 'ledger_entry_created',
      entityType: 'ledger_entry',
      entityId: undefined,
      payload: { transactionId, lineCount: lines.length, totalMinor: totalDebits.toString() },
      ipAddress,
      userAgent,
    });
  }

  async reverseEntry(
    userId: number,
    transactionId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const originals = await this.dbService.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, transactionId));

    if (originals.length === 0) {
      throw new Error(`No entries found for transaction ${transactionId}`);
    }

    // Prevent double-reversal
    const reversalTxnId = `REV-${transactionId}`;
    const existingReversal = await this.dbService.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, reversalTxnId));
    if (existingReversal.length > 0) {
      throw new Error(`Transaction ${transactionId} has already been reversed`);
    }

    await this.dbService.db.transaction(async (tx) => {
      for (const orig of originals) {
        await tx.insert(ledgerEntries).values({
          transactionId: reversalTxnId,
          ledgerAccountId: orig.ledgerAccountId,
          debitMinor: orig.creditMinor,
          creditMinor: orig.debitMinor,
          currency: orig.currency,
          postedAt: new Date(),
          reversalOf: orig.id,
        });
      }

      const accountIds = [...new Set(originals.map((o) => o.ledgerAccountId))];
      for (const accountId of accountIds) {
        const result = await tx
          .select({
            totalDebit: sql<bigint>`sum(${ledgerEntries.debitMinor})`.mapWith(BigInt),
            totalCredit: sql<bigint>`sum(${ledgerEntries.creditMinor})`.mapWith(BigInt),
          })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.ledgerAccountId, accountId));

        const totalDebit = result[0]?.totalDebit ?? 0n;
        const totalCredit = result[0]?.totalCredit ?? 0n;
        const newBalance = totalDebit - totalCredit;

        await tx
          .update(ledgerAccounts)
          .set({ balanceMinor: newBalance, updatedAt: new Date() })
          .where(eq(ledgerAccounts.id, accountId));
      }
    });

    await this.auditService.record({
      actorId: userId,
      action: 'ledger_entry_reversed',
      entityType: 'ledger_entry',
      entityId: undefined,
      payload: { originalTransactionId: transactionId, reversalTransactionId: reversalTxnId, lineCount: originals.length },
      ipAddress,
      userAgent,
    });
  }

  async getAccountBalance(accountId: number): Promise<bigint> {
    const result = await this.dbService.db
      .select({
        totalDebit: sql<bigint>`coalesce(sum(${ledgerEntries.debitMinor}), 0)`.mapWith(BigInt),
        totalCredit: sql<bigint>`coalesce(sum(${ledgerEntries.creditMinor}), 0)`.mapWith(BigInt),
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.ledgerAccountId, accountId));

    const totalDebit = result[0]?.totalDebit ?? 0n;
    const totalCredit = result[0]?.totalCredit ?? 0n;
    return totalDebit - totalCredit;
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
      if (direction === 'next') {
        conditions.push(gt(ledgerAccounts.id, cursor));
      } else {
        conditions.push(lt(ledgerAccounts.id, cursor));
      }
    }

    const rows = await this.dbService.db
      .select()
      .from(ledgerAccounts)
      .where(and(...conditions))
      .orderBy(desc(ledgerAccounts.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && data.length > 0 ? encodeCursor(data[data.length - 1].id) : null;
    const prevCursor = cursor ? encodeCursor(cursor) : null;

    return { data, nextCursor, prevCursor, hasMore };
  }

  async verifyAccountOwnership(accountId: number, userId: number): Promise<void> {
    const rows = await this.dbService.db
      .select({ actorId: ledgerAccounts.actorId })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, accountId));
    if (!rows.length || rows[0].actorId !== userId) {
      throw new Error('Account not found or access denied');
    }
  }

  async verifyTransactionOwnership(transactionId: string, userId: number): Promise<void> {
    const entries = await this.dbService.db
      .select({ ledgerAccountId: ledgerEntries.ledgerAccountId })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, transactionId));
    if (entries.length === 0) {
      throw new Error(`No entries found for transaction ${transactionId}`);
    }
    const accountIds = [...new Set(entries.map((e) => e.ledgerAccountId))];
    const accounts = await this.dbService.db
      .select({ actorId: ledgerAccounts.actorId })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, accountIds));
    const foreignAccount = accounts.find((a) => a.actorId !== userId);
    if (foreignAccount) {
      throw new Error('Transaction contains entries for accounts you do not own');
    }
  }
}
