import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';
import { statementImports, transactions } from '@db/schema';

import {
  CommitStatementDto,
  StatementRowDto,
} from './dto/statement-import.dto';
import { CsvParser } from './parsers/csv.parser';
import { OfxParser } from './parsers/ofx.parser';
import { PdfParser } from './parsers/pdf.parser';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Parsed row ready for deduplication and insertion. */
interface ParsedRow {
  date: string; // ISO date
  amountMinor: number;
  currency: string;
  description: string;
  direction: 'debit' | 'credit';
}

@Injectable()
export class StatementImportService {
  private readonly logger = new Logger(StatementImportService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly csvParser: CsvParser,
    private readonly ofxParser: OfxParser,
    private readonly pdfParser: PdfParser,
  ) {}

  /** Record a statement upload. */
  async upload(userId: string, filePath: string, fileName: string, format: 'csv' | 'ofx' | 'pdf', accountId?: string) {
    const inserted = await this.db
      .insert(statementImports)
      .values({
        userId,
        accountId: accountId ?? null,
        filePath,
        fileName,
        format,
        status: 'uploaded',
      })
      .returning();
    return inserted[0];
  }

  /** Parse a statement file and store the parsed rows. */
  async parse(userId: string, importId: string) {
    const stmt = await this.db.query.statementImports.findFirst({
      where: and(eq(statementImports.id, importId), eq(statementImports.userId, userId)),
    });
    if (!stmt) throw new NotFoundException('Statement import not found');
    if (stmt.status !== 'uploaded') {
      throw new BadRequestException('Statement has already been parsed');
    }

    await this.db
      .update(statementImports)
      .set({ status: 'parsing', updatedAt: new Date() })
      .where(eq(statementImports.id, importId));

    try {
      const rows = await this.runParser(stmt.format, stmt.filePath);

      const updated = await this.db
        .update(statementImports)
        .set({
          status: 'parsed',
          rowCount: rows.length,
          parsedRows: rows as unknown as Record<string, unknown>[],
          updatedAt: new Date(),
        })
        .where(eq(statementImports.id, importId))
        .returning();

      return updated[0];
    } catch (err) {
      this.logger.error(`Parse failed for statement ${importId}: ${err instanceof Error ? err.message : String(err)}`);
      await this.db
        .update(statementImports)
        .set({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Parse failed',
          updatedAt: new Date(),
        })
        .where(eq(statementImports.id, importId));
      throw new BadRequestException('Failed to parse statement');
    }
  }

  /** Commit parsed rows to transactions, deduping by hash(date+amount+description). */
  async commit(userId: string, importId: string, dto: CommitStatementDto) {
    const stmt = await this.db.query.statementImports.findFirst({
      where: and(eq(statementImports.id, importId), eq(statementImports.userId, userId)),
    });
    if (!stmt) throw new NotFoundException('Statement import not found');
    if (stmt.status !== 'parsed') {
      throw new BadRequestException('Statement must be parsed before committing');
    }

    const parsedRows = (stmt.parsedRows ?? []) as unknown as ParsedRow[];
    if (parsedRows.length === 0) {
      throw new BadRequestException('No rows to commit');
    }

    let importedCount = 0;
    let duplicateCount = 0;

    for (const row of parsedRows) {
      // Skip rows not in the selected range
      if (dto.startDate && new Date(row.date) < new Date(dto.startDate)) continue;
      if (dto.endDate && new Date(row.date) > new Date(dto.endDate)) continue;

      const hash = this.computeHash(row.date, row.amountMinor, row.description);

      // Deduplication check
      const existing = await this.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.amountMinor, row.amountMinor),
            eq(transactions.bookedAt, new Date(row.date)),
            eq(transactions.source, 'import'),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        duplicateCount++;
        continue;
      }

      await this.db.insert(transactions).values({
        userId,
        accountId: stmt.accountId,
        merchant: row.description.substring(0, 255),
        currency: row.currency,
        amountMinor: row.amountMinor,
        direction: row.direction,
        source: 'import',
        bookedAt: new Date(row.date),
        metadata: { statementImportId: importId, dedupeHash: hash },
      });

      importedCount++;
    }

    const updated = await this.db
      .update(statementImports)
      .set({
        status: 'committed',
        importedCount,
        duplicateCount,
        updatedAt: new Date(),
      })
      .where(eq(statementImports.id, importId))
      .returning();

    return {
      statement: updated[0],
      importedCount,
      duplicateCount,
    };
  }

  /** List user statement imports. */
  async list(userId: string, opts: { cursor?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const where = [eq(statementImports.userId, userId)];

    const rows = await this.db
      .select()
      .from(statementImports)
      .where(and(...where))
      .orderBy(desc(statementImports.createdAt))
      .limit(limit);

    return {
      data: rows,
      nextCursor: rows.length === limit ? rows[rows.length - 1]?.createdAt.toISOString() : undefined,
    };
  }

  private async runParser(format: string, filePath: string): Promise<ParsedRow[]> {
    switch (format) {
      case 'csv':
        return this.csvParser.parse(filePath);
      case 'ofx':
        return this.ofxParser.parse(filePath);
      case 'pdf':
        return this.pdfParser.parse(filePath);
      default:
        throw new BadRequestException(`Unsupported format: ${format}`);
    }
  }

  private computeHash(date: string, amountMinor: number, description: string): string {
    // Simple hash for deduplication — could use SHA-256 in production
    const raw = `${date}|${amountMinor}|${description.trim().toLowerCase()}`;
    return Buffer.from(raw).toString('base64').slice(0, 32);
  }
}
