/**
 * Pluggable parser interface for bank statement file formats.
 *
 * Each parser turns the raw file bytes into a list of `ParsedRow`
 * structs. `ParsingError` collects per-row failures so partial imports
 * can succeed and the user sees which rows need manual review.
 */
export interface ParsedRow {
  /** Hash of date+amount+description for dedupe. */
  hash: string;
  bookedAt: Date;
  merchant: string;
  amountMinor: number;
  currency: string;
  direction: 'debit' | 'credit';
  category?: string;
  raw?: Record<string, unknown>;
}

export interface ParsingError {
  row: number;
  reason: string;
  raw?: string;
}

export interface ParseOutcome {
  rows: ParsedRow[];
  errors: ParsingError[];
}

export interface StatementParser {
  readonly format: 'csv' | 'ofx' | 'qif' | 'pdf' | 'xlsx';
  parse(content: Buffer | string, currency: string): Promise<ParseOutcome>;
}
