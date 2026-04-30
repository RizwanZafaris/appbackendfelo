import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';

interface ParsedRow {
  date: string;
  amountMinor: number;
  currency: string;
  description: string;
  direction: 'debit' | 'credit';
}

/**
 * PDF statement parser.
 *
 * Production implementation would use pdf-parse or a similar library.
 * This is a stub that extracts text heuristically for development.
 */
@Injectable()
export class PdfParser {
  private readonly logger = new Logger(PdfParser.name);

  parse(filePath: string): ParsedRow[] {
    this.logger.warn('PDF parsing uses text extraction heuristics — install pdf-parse for production');

    try {
      // Attempt to read as text (many PDFs have extractable text)
      const buffer = readFileSync(filePath);
      const text = buffer.toString('utf-8');

      // Try to extract transaction-like lines
      const rows = this.extractFromText(text);
      if (rows.length > 0) {
        return rows;
      }
    } catch {
      // Silent — will throw below
    }

    throw new BadRequestException(
      'PDF parsing requires the `pdf-parse` package. Install it and re-implement PdfParser.extractFromText()',
    );
  }

  private extractFromText(text: string): ParsedRow[] {
    const rows: ParsedRow[] = [];
    const lines = text.split(/\r?\n/);

    // Heuristic: lines with a date, description, and dollar amount
    const txnRegex = /(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+\$?([\d,]+\.\d{2})/;

    for (const line of lines) {
      const match = line.match(txnRegex);
      if (match) {
        const dateStr = match[1];
        const description = match[2].trim();
        const amountStr = match[3].replace(',', '');
        const amount = parseFloat(amountStr);

        if (Number.isNaN(amount)) continue;

        const date = this.normalizeDate(dateStr);
        if (!date) continue;

        // Heuristic: lines with "Payment", "Deposit", "Credit" are credits
        const isCredit = /payment|deposit|credit|refund/i.test(description);

        rows.push({
          date,
          amountMinor: Math.round(Math.abs(amount) * 100),
          currency: 'CAD',
          description,
          direction: isCredit ? 'credit' : 'debit',
        });
      }
    }

    return rows;
  }

  private normalizeDate(dateStr: string): string | null {
    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    const usMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usMatch) return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;

    return null;
  }
}
