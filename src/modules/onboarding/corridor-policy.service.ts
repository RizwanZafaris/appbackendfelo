import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';

/**
 * **Corridor policy service.** Single source of truth for whether a
 * given country pair (`from_iso2 → to_iso2`) is allowed for remittance.
 *
 * Backed by `public.country_corridors` (008 migration). Compliance
 * owns the rows; engineering only reads.
 *
 * Cached for 5 min in-process — corridor policy doesn't churn.
 */
export type CorridorStatus = 'allowed' | 'blocked' | 'coming_soon' | 'sanctioned';

export interface CorridorDecision {
  allowed: boolean;
  status: CorridorStatus;
  reason: string | null;
}

@Injectable()
export class CorridorPolicyService {
  private readonly logger = new Logger(CorridorPolicyService.name);
  private cache: { rows: Map<string, CorridorDecision>; loadedAt: number } | null = null;
  private readonly TTL_MS = 5 * 60 * 1000;

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * Check whether `from → to` is allowed. Default = allowed for any
   * pair not in the table (positive list of *blocks*). Both ISO codes
   * are also looked up against `regions.country_status` so a
   * sanctioned country is always blocked regardless of pair.
   */
  async check(from: string, to: string): Promise<CorridorDecision> {
    const map = await this.load();
    const key = `${from.toUpperCase()}>${to.toUpperCase()}`;
    const pairDecision = map.get(key);
    if (pairDecision) return pairDecision;

    // Fall back to region-level status
    const regionStatuses = await this.regionStatuses([from, to]);
    for (const iso of [from, to]) {
      const s = regionStatuses[iso.toUpperCase()];
      if (s === 'sanctioned') {
        return {
          allowed: false,
          status: 'sanctioned',
          reason: `${iso} is on the sanctions list`,
        };
      }
      if (s === 'not_supported') {
        return {
          allowed: false,
          status: 'blocked',
          reason: `${iso} is not currently supported`,
        };
      }
      if (s === 'coming_soon') {
        return {
          allowed: false,
          status: 'coming_soon',
          reason: `${iso} support is coming soon`,
        };
      }
    }
    return { allowed: true, status: 'allowed', reason: null };
  }

  /**
   * Bulk filter — given a primary region, return only the secondary
   * regions that are allowed corridors. Used by Phase 6.2 corridor
   * picker so blocked countries never appear.
   */
  async allowedSecondaries(primary: string, candidates: string[]): Promise<string[]> {
    const decisions = await Promise.all(candidates.map((c) => this.check(primary, c)));
    return candidates.filter((_, i) => decisions[i].allowed);
  }

  /** Bulk dump of pair decisions, for the journey-config payload. */
  async listAll(): Promise<
    Array<{ from: string; to: string; status: CorridorStatus; reason: string | null }>
  > {
    const rows = await this.db.execute<{
      from_iso2: string;
      to_iso2: string;
      status: CorridorStatus;
      reason: string | null;
    }>(sql`SELECT from_iso2, to_iso2, status, reason FROM public.country_corridors`);
    return (
      rows as unknown as Array<{
        from_iso2: string;
        to_iso2: string;
        status: CorridorStatus;
        reason: string | null;
      }>
    ).map((r) => ({
      from: r.from_iso2,
      to: r.to_iso2,
      status: r.status,
      reason: r.reason,
    }));
  }

  invalidate() {
    this.cache = null;
  }

  // ───── private ─────

  private async load(): Promise<Map<string, CorridorDecision>> {
    if (this.cache && Date.now() - this.cache.loadedAt < this.TTL_MS) {
      return this.cache.rows;
    }
    const rows = await this.db.execute<{
      from_iso2: string;
      to_iso2: string;
      status: CorridorStatus;
      reason: string | null;
    }>(sql`SELECT from_iso2, to_iso2, status, reason FROM public.country_corridors`);
    const map = new Map<string, CorridorDecision>();
    for (const r of rows as unknown as Array<{
      from_iso2: string;
      to_iso2: string;
      status: CorridorStatus;
      reason: string | null;
    }>) {
      const key = `${r.from_iso2.toUpperCase()}>${r.to_iso2.toUpperCase()}`;
      map.set(key, {
        allowed: r.status === 'allowed',
        status: r.status,
        reason: r.reason,
      });
    }
    this.cache = { rows: map, loadedAt: Date.now() };
    this.logger.log(`corridor policy loaded — ${map.size} pair rules`);
    return map;
  }

  private async regionStatuses(isoList: string[]): Promise<Record<string, string>> {
    const rows = await this.db.execute<{ iso2: string; country_status: string }>(sql`
      SELECT iso2, country_status FROM public.regions
       WHERE iso2 = ANY(${isoList.map((i) => i.toUpperCase())})
    `);
    const out: Record<string, string> = {};
    for (const r of rows as unknown as Array<{ iso2: string; country_status: string }>) {
      out[r.iso2] = r.country_status;
    }
    return out;
  }
}
