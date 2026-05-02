import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { safeFetch } from '@/common/net/safe-fetch';
import { profiles, statementImports, transactions } from '@db/schema';

import { CsvStatementParser } from './parsers/csv.parser';
import { OfxStatementParser } from './parsers/ofx.parser';
import { ParseOutcome, ParsedRow, StatementParser } from './parsers/statement-parser';

/**
 * Allowlist for statement-import URL fetches. Only Supabase Storage signed
 * URLs are accepted — no arbitrary user-supplied URLs (which would allow
 * SSRF against AWS metadata, internal services, etc.).
 */
const STATEMENT_IMPORT_HOST_ALLOWLIST = (
  process.env.STATEMENT_IMPORT_HOSTS ?? 'supabase.co,supabase.in'
)
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);
const STATEMENT_IMPORT_MAX_BYTES = 25 * 1024 * 1024;

@Injectable()
export class StatementImportService {
  private readonly logger = new Logger(StatementImportService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly csv: CsvStatementParser,
    private readonly ofx: OfxStatementParser,
  ) {}

  private parserFor(format: string): StatementParser {
    if (format === 'csv') return this.csv;
    if (format === 'ofx') return this.ofx;
    throw new NotFoundException(
      `Format '${format}' parser not yet implemented (csv + ofx supported now; pdf/xlsx/qif planned)`,
    );
  }

  /** Step 1: register the upload. The mobile/portal client uploads the file
   * to Supabase Storage first and POSTs the public URL here. */
  async upload(
    userId: string,
    fileUrl: string,
    format: 'csv' | 'ofx' | 'qif' | 'pdf' | 'xlsx',
  ) {
    const [row] = await this.db
      .insert(statementImports)
      .values({ userId, fileUrl, format, status: 'pending' })
      .returning();
    return row;
  }

  /** Step 2: download + parse + save preview (top 100 rows + counts). */
  async parse(userId: string, importId: string) {
    const [row] = await this.db
      .select()
      .from(statementImports)
      .where(and(eq(statementImports.id, importId), eq(statementImports.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('Import not found');
    if (row.status === 'parsed') return row;

    await this.db
      .update(statementImports)
      .set({ status: 'parsing' })
      .where(eq(statementImports.id, importId));

    try {
      const fileRes = await safeFetch(row.fileUrl, {
        hostAllowlist: STATEMENT_IMPORT_HOST_ALLOWLIST,
        maxBytes: STATEMENT_IMPORT_MAX_BYTES,
      });
      if (fileRes.status < 200 || fileRes.status >= 300) {
        throw new Error(`File fetch ${fileRes.status}`);
      }
      const buf = fileRes.body;

      const parser = this.parserFor(row.format);
      const currency = await this.userCurrency(userId);
      const outcome: ParseOutcome = await parser.parse(buf, currency);

      const [updated] = await this.db
        .update(statementImports)
        .set({
          status: 'parsed',
          rowsTotal: outcome.rows.length + outcome.errors.length,
          parsedRowsPreview: outcome.rows.slice(0, 100),
          parsingErrors: outcome.errors.slice(0, 100),
        })
        .where(eq(statementImports.id, importId))
        .returning();
      return updated;
    } catch (err) {
      this.logger.warn(
        `Statement parse failed import=${importId}: ${err instanceof Error ? err.message : err}`,
      );
      const [failed] = await this.db
        .update(statementImports)
        .set({
          status: 'failed',
          errors: [{ reason: err instanceof Error ? err.message : String(err) }],
        })
        .where(eq(statementImports.id, importId))
        .returning();
      return failed;
    }
  }

  /** Step 3: bulk-insert as transactions with hash-based dedupe. */
  async commit(userId: string, importId: string, excludeHashes: string[] = []) {
    const [row] = await this.db
      .select()
      .from(statementImports)
      .where(and(eq(statementImports.id, importId), eq(statementImports.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('Import not found');
    if (row.status !== 'parsed') {
      throw new NotFoundException(`Import is in '${row.status}' state — parse it first`);
    }

    // Re-parse the file to get the full row set (preview is capped at 100).
    const fileRes = await safeFetch(row.fileUrl, {
      hostAllowlist: STATEMENT_IMPORT_HOST_ALLOWLIST,
      maxBytes: STATEMENT_IMPORT_MAX_BYTES,
    });
    if (fileRes.status < 200 || fileRes.status >= 300) {
      throw new Error(`File fetch ${fileRes.status}`);
    }
    const buf = fileRes.body;
    const parser = this.parserFor(row.format);
    const currency = await this.userCurrency(userId);
    const outcome = await parser.parse(buf, currency);

    const excludedSet = new Set(excludeHashes);
    const candidates = outcome.rows.filter((r) => !excludedSet.has(r.hash));
    const inserted = await this.bulkInsertWithDedupe(userId, candidates);

    const [updated] = await this.db
      .update(statementImports)
      .set({ rowsImported: inserted, errors: outcome.errors })
      .where(eq(statementImports.id, importId))
      .returning();
    return { import: updated, insertedCount: inserted, skippedDuplicates: candidates.length - inserted };
  }

  private async bulkInsertWithDedupe(userId: string, rows: ParsedRow[]) {
    if (rows.length === 0) return 0;

    // Dedupe inside this batch first.
    const byHash = new Map<string, ParsedRow>();
    for (const r of rows) byHash.set(r.hash, r);
    const unique = [...byHash.values()];

    let inserted = 0;
    // Chunk to keep parameter count under PG limits.
    for (let i = 0; i < unique.length; i += 200) {
      const slice = unique.slice(i, i + 200);
      try {
        const result = await this.db
          .insert(transactions)
          .values(
            slice.map((r) => ({
              userId,
              merchant: r.merchant,
              amountMinor: r.amountMinor,
              currency: r.currency,
              direction: r.direction,
              source: 'import',
              bookedAt: r.bookedAt,
              category: r.category ?? 'Uncategorized',
            } as never)),
          )
          .onConflictDoNothing()
          .returning({ id: transactions.id });
        inserted += result.length;
      } catch (err) {
        this.logger.warn(
          `Bulk insert failed for batch starting at ${i}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return inserted;
  }

  private async userCurrency(userId: string): Promise<string> {
    const [p] = await this.db
      .select({ currency: profiles.currency })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return p?.currency ?? 'USD';
  }

  async list(userId: string, cursor?: string, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    if (cursor) {
      return this.db
        .select()
        .from(statementImports)
        .where(
          and(
            eq(statementImports.userId, userId),
            sql`${statementImports.createdAt} < ${new Date(cursor)}`,
          ),
        )
        .orderBy(desc(statementImports.createdAt))
        .limit(safeLimit);
    }
    return this.db
      .select()
      .from(statementImports)
      .where(eq(statementImports.userId, userId))
      .orderBy(desc(statementImports.createdAt))
      .limit(safeLimit);
  }

  async get(userId: string, importId: string) {
    const [row] = await this.db
      .select()
      .from(statementImports)
      .where(and(eq(statementImports.id, importId), eq(statementImports.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('Import not found');
    return row;
  }
}
