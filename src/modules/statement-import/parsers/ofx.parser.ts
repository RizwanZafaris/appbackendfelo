import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';

interface ParsedRow {
  date: string;
  amountMinor: number;
  currency: string;
  description: string;
  direction: 'debit' | 'credit';
}

/**
 * OFX/QFX statement parser.
 *
 * Parses Open Financial Exchange files — common export format from
 * Canadian and US banks (Quicken / QuickBooks compatible).
 */
@Injectable()
export class OfxParser {
  private readonly logger = new Logger(OfxParser.name);

  parse(filePath: string): ParsedRow[] {
    const content = readFileSync(filePath, 'utf-8');
    const rows: ParsedRow[] = [];

    // OFX files have <STMTTRN> blocks containing individual transactions
    const transactionBlocks = this.extractBlocks(content, 'STMTTRN');

    for (const block of transactionBlocks) {
      const trnType = this.extractTag(block, 'TRNTYPE');
      const datePosted = this.extractTag(block, 'DTPOSTED');
      const amountStr = this.extractTag(block, 'TRNAMT');
      const name = this.extractTag(block, 'NAME') ?? this.extractTag(block, 'MEMO') ?? '';
      const fitId = this.extractTag(block, 'FITID');

      if (!datePosted || !amountStr) continue;

      const amount = parseFloat(amountStr);
      if (Number.isNaN(amount)) continue;

      const date = this.normalizeOfxDate(datePosted);
      if (!date) continue;

      const amountMinor = Math.round(Math.abs(amount) * 100);
      const direction: 'debit' | 'credit' =
        trnType === 'CREDIT' || amount > 0 ? 'credit' : 'debit';

      rows.push({
        date,
        amountMinor,
        currency: 'CAD', // OFX doesn't always include currency per transaction
        description: name || `Transaction ${fitId ?? ''}`,
        direction,
      });
    }

    this.logger.log(`Parsed ${rows.length} transactions from OFX file`);
    return rows;
  }

  private extractBlocks(content: string, tagName: string): string[] {
    const blocks: string[] = [];
    const openTag = `<${tagName}>`;
    const closeTag = `</${tagName}>`;

    let start = 0;
    while (true) {
      const openIdx = content.indexOf(openTag, start);
      if (openIdx === -1) break;
      const closeIdx = content.indexOf(closeTag, openIdx);
      if (closeIdx === -1) break;

      blocks.push(content.slice(openIdx + openTag.length, closeIdx));
      start = closeIdx + closeTag.length;
    }

    return blocks;
  }

  private extractTag(block: string, tagName: string): string | null {
    const match = block.match(new RegExp(`<${tagName}>([^<\r\n]+)`));
    return match?.[1]?.trim() ?? null;
  }

  private normalizeOfxDate(ofxDate: string): string | null {
    // OFX date format: 20250115143000 or 20250115
    const match = ofxDate.match(/(\d{4})(\d{2})(\d{2})/);
    if (!match) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
}
