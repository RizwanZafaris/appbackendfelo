import { Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

interface ParsedRow {
  date: string;
  amountMinor: number;
  currency: string;
  description: string;
  direction: 'debit' | 'credit';
}

/**
 * CSV statement parser.
 *
 * Handles common Canadian bank CSV formats (TD, RBC, Scotiabank).
 * Auto-detects column mapping from headers.
 */
@Injectable()
export class CsvParser {
  private readonly logger = new Logger(CsvParser.name);

  async parse(filePath: string): Promise<ParsedRow[]> {
    const rows: ParsedRow[] = [];
    const stream = createReadStream(filePath);
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let headers: string[] | null = null;
    let columnMap: Record<string, number> = {};

    for await (const line of rl) {
      const cols = this.splitCsvLine(line);
      if (!headers) {
        headers = cols.map((h) => h.toLowerCase().trim());
        columnMap = this.detectColumns(headers);
        if (Object.keys(columnMap).length === 0) {
          this.logger.warn('Could not detect CSV columns, using positional mapping');
          columnMap = { date: 0, description: 1, debit: 2, credit: 3 };
        }
        continue;
      }

      const dateStr = cols[columnMap.date]?.trim();
      const description = cols[columnMap.description]?.trim() ?? '';
      const debitStr = cols[columnMap.debit]?.trim() ?? '';
      const creditStr = cols[columnMap.credit]?.trim() ?? '';
      const amountStr = cols[columnMap.amount]?.trim() ?? '';

      if (!dateStr || (!debitStr && !creditStr && !amountStr)) continue;

      const date = this.normalizeDate(dateStr);
      if (!date) continue;

      let amountMinor: number;
      let direction: 'debit' | 'credit';

      if (amountStr) {
        const amount = parseFloat(amountStr.replace(/[,\s$]/g, ''));
        if (Number.isNaN(amount)) continue;
        amountMinor = Math.round(Math.abs(amount) * 100);
        direction = amount < 0 ? 'debit' : 'credit';
      } else if (debitStr) {
        const debit = parseFloat(debitStr.replace(/[,\s$]/g, ''));
        if (Number.isNaN(debit) || debit === 0) continue;
        amountMinor = Math.round(Math.abs(debit) * 100);
        direction = 'debit';
      } else if (creditStr) {
        const credit = parseFloat(creditStr.replace(/[,\s$]/g, ''));
        if (Number.isNaN(credit) || credit === 0) continue;
        amountMinor = Math.round(Math.abs(credit) * 100);
        direction = 'credit';
      } else {
        continue;
      }

      rows.push({
        date,
        amountMinor,
        currency: 'CAD',
        description,
        direction,
      });
    }

    return rows;
  }

  private splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  private detectColumns(headers: string[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (/date|transaction.date|posting.date/.test(h)) map.date = i;
      if (/description|transaction|name|merchant|payee|memo/.test(h)) map.description = i;
      if (/withdrawal|debit|out/.test(h)) map.debit = i;
      if (/deposit|credit|in/.test(h)) map.credit = i;
      if (/amount|\$/.test(h) && !map.debit && !map.credit) map.amount = i;
    }

    return map;
  }

  private normalizeDate(dateStr: string): string | null {
    // Try common formats: 2025-01-15, 01/15/2025, 15/01/2025, Jan 15 2025
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    const usMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usMatch) return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;

    const ukMatch = dateStr.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (ukMatch) return `${ukMatch[3]}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;

    return null;
  }
}
