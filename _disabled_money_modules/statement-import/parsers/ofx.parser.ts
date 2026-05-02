import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

import {
  ParseOutcome,
  ParsedRow,
  ParsingError,
  StatementParser,
} from './statement-parser';

/**
 * Tiny OFX 2.x parser. Pulls <STMTTRN> blocks out of the SGML/XML body
 * — does not require a full XML parser. Robust to either OFX 1.x SGML
 * or 2.x XML headers because we only look at element bodies.
 */
@Injectable()
export class OfxStatementParser implements StatementParser {
  readonly format = 'ofx' as const;

  async parse(content: Buffer | string, currency: string): Promise<ParseOutcome> {
    const text = typeof content === 'string' ? content : content.toString('utf8');
    const txnBlocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map(
      (m) => m[1],
    );
    const rows: ParsedRow[] = [];
    const errors: ParsingError[] = [];

    txnBlocks.forEach((block, i) => {
      try {
        const date = pickTag(block, 'DTPOSTED');
        const amt = pickTag(block, 'TRNAMT');
        const name = pickTag(block, 'NAME') ?? pickTag(block, 'MEMO') ?? '';
        if (!date || !amt) {
          errors.push({ row: i + 1, reason: 'Missing DTPOSTED or TRNAMT' });
          return;
        }
        const bookedAt = parseOfxDate(date);
        if (!bookedAt) {
          errors.push({ row: i + 1, reason: `Unparseable date: ${date}` });
          return;
        }
        const num = parseFloat(amt);
        if (!Number.isFinite(num)) {
          errors.push({ row: i + 1, reason: `Unparseable amount: ${amt}` });
          return;
        }
        const direction = num < 0 ? 'debit' : 'credit';
        const amountMinor = Math.round(Math.abs(num) * 100);
        const merchant = name.replace(/\s+/g, ' ').trim() || 'Unknown';
        const hash = crypto
          .createHash('sha1')
          .update(
            `${bookedAt.toISOString().slice(0, 10)}|${amountMinor}|${merchant.toLowerCase()}`,
          )
          .digest('hex');
        rows.push({
          hash,
          bookedAt,
          merchant,
          amountMinor,
          currency: currency.toUpperCase(),
          direction,
        });
      } catch (err) {
        errors.push({
          row: i + 1,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return { rows, errors };
  }
}

function pickTag(block: string, tag: string): string | null {
  // OFX 1.x has unclosed tags; OFX 2.x has both opening and closing.
  // Match either form.
  const closed = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(block);
  if (closed) return closed[1].trim();
  const unclosed = new RegExp(`<${tag}>([^<\\n]*)`, 'i').exec(block);
  return unclosed ? unclosed[1].trim() : null;
}

function parseOfxDate(raw: string): Date | null {
  // OFX format: YYYYMMDDHHMMSS[.XXX][TZ]
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const date = new Date(
    Date.UTC(
      parseInt(y, 10),
      parseInt(mo, 10) - 1,
      parseInt(d, 10),
      parseInt(h, 10),
      parseInt(mi, 10),
      parseInt(s, 10),
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
