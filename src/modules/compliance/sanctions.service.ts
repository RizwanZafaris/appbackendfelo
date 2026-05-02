import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DatabaseService } from '@/common/database.service';
import { sanctionsScreenings } from '@db/schema';

export type ScreeningOutcome = 'clear' | 'review' | 'block' | 'error';

export interface ScreeningRequest {
  userUuid: string;
  recipientHash: string;
  recipientCountry?: string;
}

export interface ScreeningResult {
  outcome: ScreeningOutcome;
  matchScore: number;
  listName: string;
  provider: string;
}

/**
 * Sanctions / PEP screening adapter.
 *
 * Hard requirement before any disbursement: every order must produce a
 * screening row. Outcome MUST be 'clear' to proceed; anything else
 * (review/block/error) blocks the disbursement and persists the result
 * for ops triage.
 *
 * Provider implementations live behind an env flag (SANCTIONS_PROVIDER):
 *   - `stub` (default in dev): blocks high-risk ISO-3166 countries from a
 *     hard-coded list, blocks recipientHashes matching a small synthetic
 *     test set, otherwise returns 'clear'. NEVER use in production —
 *     configFactory rejects 'stub' when NODE_ENV=production.
 *   - `complyadvantage`, `refinitiv`: real adapters wired by ops once the
 *     vendor account is provisioned. See OPS_CONFIG.md.
 *
 * The deny-default is enforced at the SanctionsService level: if the
 * provider call fails or times out, we return 'error' (blocking).
 */
@Injectable()
export class SanctionsService {
  private readonly logger = new Logger(SanctionsService.name);
  private readonly provider: string;

  // Synthetic test fixtures for the stub provider only — never reach prod.
  private static readonly STUB_HIGH_RISK_COUNTRIES = new Set([
    'IR', 'KP', 'SY', 'CU', 'RU', 'BY',
  ]);
  private static readonly STUB_BLOCK_HASHES = new Set([
    'sha256:test-block-recipient',
  ]);

  constructor(
    private readonly cfg: ConfigService,
    private readonly dbService: DatabaseService,
  ) {
    this.provider = (this.cfg.get<string>('SANCTIONS_PROVIDER') ?? 'stub').toLowerCase();
    if (this.cfg.get<string>('NODE_ENV') === 'production' && this.provider === 'stub') {
      throw new Error(
        'SANCTIONS_PROVIDER=stub is not permitted in production. ' +
          'Set SANCTIONS_PROVIDER and SANCTIONS_API_KEY (see OPS_CONFIG.md).',
      );
    }
  }

  async screen(req: ScreeningRequest): Promise<ScreeningResult> {
    let result: ScreeningResult;
    try {
      result = await this.dispatch(req);
    } catch (err) {
      this.logger.error(`Sanctions screening failed: ${(err as Error).message}`);
      result = {
        outcome: 'error',
        matchScore: 0,
        listName: 'unavailable',
        provider: this.provider,
      };
    }

    // Persist every screening — including 'clear' — for audit and metrics.
    await this.dbService.db.insert(sanctionsScreenings).values({
      userUuid: req.userUuid,
      recipientHash: req.recipientHash,
      listName: result.listName,
      matchScore: result.matchScore.toFixed(2),
      outcome: result.outcome,
      provider: result.provider,
      rawResponse: { request: { ...req }, response: result } as never,
    } as never);

    return result;
  }

  private async dispatch(req: ScreeningRequest): Promise<ScreeningResult> {
    switch (this.provider) {
      case 'stub':
        return this.stubScreen(req);
      // case 'complyadvantage': return this.complyAdvantageScreen(req);
      // case 'refinitiv': return this.refinitivScreen(req);
      default:
        throw new Error(`Unknown SANCTIONS_PROVIDER: ${this.provider}`);
    }
  }

  private stubScreen(req: ScreeningRequest): ScreeningResult {
    if (
      req.recipientCountry &&
      SanctionsService.STUB_HIGH_RISK_COUNTRIES.has(req.recipientCountry.toUpperCase())
    ) {
      return { outcome: 'block', matchScore: 100, listName: 'STUB_OFAC_COUNTRY', provider: 'stub' };
    }
    if (SanctionsService.STUB_BLOCK_HASHES.has(req.recipientHash)) {
      return { outcome: 'block', matchScore: 100, listName: 'STUB_OFAC_RECIPIENT', provider: 'stub' };
    }
    return { outcome: 'clear', matchScore: 0, listName: 'none', provider: 'stub' };
  }
}
