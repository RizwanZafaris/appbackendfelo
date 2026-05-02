import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

import {
  ParseOutcome,
  ParsedRow,
  ParsingError,
  StatementParser,
} from './statement-parser';

/**
 * Best-effort CSV parser.
 *
 * Auto-detects the bank's column layout by header keywords:
 *   • date | transaction date | posted date  → bookedAt
 *   • description | merchant | name          → merchant
 *   • amount | total                         → amountMinor (signed)
 *   • debit / credit                         → split debit/credit columns
 *
 * If no header row matches, the parser falls back to positional
 * mapping (date, description, amount). Per-row failures are reported
 * via `errors[]`; valid rows are still returned.
 */
@Injectable()
export class CsvStatementParser implements StatementParser {
  readonly format = 'csv' as const;

  async parse(content: Buffer | string, currency: string): Promise<ParseOutcome> {
    const text = typeof content === 'string' ? content : content.toString('utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { rows: [], errors: [] };

    const headerCells = splitCsvRow(lines[0]).map((c) => c.toLowerCase().trim());
    const layout = detectLayout(headerCells);
    const startIdx = layout.headerPresent ? 1 : 0;

    const rows: ParsedRow[] = [];
    const errors: ParsingError[] = [];

    for (let i = startIdx; i < lines.length; i++) {
      const cells = splitCsvRow(lines[i]);
      try {
        const row = mapRow(cells, layout, currency);
        if (row) rows.push(row);
      } catch (err) {
        errors.push({
          row: i + 1,
          reason: err instanceof Error ? err.message : String(err),
          raw: lines[i].slice(0, 200),
        });
      }
    }

    return { rows, errors };
  }
}

function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

interface ColumnLayout {
  headerPresent: boolean;
  date: number;
  description: number;
  amount: number;
  debit?: number;
  credit?: number;
}

const DATE_KEYS = ['date', 'transaction date', 'posted date', 'booked at', 'posting date'];
const DESC_KEYS = ['description', 'merchant', 'name', 'narration', 'details'];
const AMOUNT_KEYS = ['amount', 'total', 'value'];
const DEBIT_KEYS = ['debit', 'withdrawal', 'spent', 'paid out'];
const CREDIT_KEYS = ['credit', 'deposit', 'received', 'paid in'];

function detectLayout(header: string[]): ColumnLayout {
  const find = (keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)));
  const date = find(DATE_KEYS);
  const description = find(DESC_KEYS);
  const amount = find(AMOUNT_KEYS);
  const debit = find(DEBIT_KEYS);
  const credit = find(CREDIT_KEYS);
  if (date >= 0 && description >= 0 && (amount >= 0 || debit >= 0 || credit >= 0)) {
    return {
      headerPresent: true,
      date,
      description,
      amount,
      debit: debit >= 0 ? debit : undefined,
      credit: credit >= 0 ? credit : undefined,
    };
  }
  // Fallback positional: date, description, amount
  return { headerPresent: false, date: 0, description: 1, amount: 2 };
}

function mapRow(cells: string[], layout: ColumnLayout, currency: string): ParsedRow | null {
  const dateStr = cells[layout.date];
  const description = cells[layout.description];
  if (!dateStr || !description) return null;

  const bookedAt = parseDate(dateStr);
  if (!bookedAt) throw new Error(`Unparseable date: ${dateStr}`);

  let amountMajor: number | null = null;
  let direction: 'debit' | 'credit' = 'debit';

  if (layout.debit !== undefined && layout.credit !== undefined) {
    const debit = parseAmount(cells[layout.debit] ?? '');
    const credit = parseAmount(cells[layout.credit] ?? '');
    if (debit && debit > 0) {
      amountMajor = debit;
      direction = 'debit';
    } else if (credit && credit > 0) {
      amountMajor = credit;
      direction = 'credit';
    }
  } else if (layout.amount >= 0) {
    const amt = parseAmount(cells[layout.amount] ?? '');
    if (amt !== null) {
      amountMajor = Math.abs(amt);
      direction = amt < 0 ? 'debit' : 'credit';
    }
  }

  if (amountMajor === null || amountMajor <= 0) {
    throw new Error('No valid amount found');
  }

  const amountMinor = Math.round(amountMajor * 100);
  const merchant = description.replace(/\s+/g, ' ').trim();
  const hash = crypto
    .createHash('sha1')
    .update(`${bookedAt.toISOString().slice(0, 10)}|${amountMinor}|${merchant.toLowerCase()}`)
    .digest('hex');

  return {
    hash,
    bookedAt,
    merchant,
    amountMinor,
    currency: currency.toUpperCase(),
    direction,
    raw: { cells },
  };
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, '');
  // Detect European format: rightmost separator is a comma with 1-2 trailing digits.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;
  if (lastComma > lastDot && /,\d{1,2}(?!\d)/.test(cleaned)) {
    // European: dots = thousands, comma = decimal.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // US/UK: commas = thousands.
    normalized = cleaned.replace(/,/g, '');
  }
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

function parseDate(raw: string): Date | null {
  // Try ISO first
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;
  // Try DD/MM/YYYY and MM/DD/YYYY
  const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(raw.trim());
  if (m) {
    let [, a, b, y] = m;
    let yy = parseInt(y, 10);
    if (yy < 100) yy += 2000;
    // Heuristic: if a > 12, it's day-first
    const aN = parseInt(a, 10);
    const bN = parseInt(b, 10);
    const day = aN > 12 ? aN : bN;
    const month = aN > 12 ? bN : aN;
    const d = new Date(Date.UTC(yy, month - 1, day));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}
