import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';

/**
 * Returns the entire DB-driven content payload that the Flutter app needs
 * to render every onboarding screen — per D-029.
 *
 * The Flutter `OnboardingConfigProvider` caches by `version`; a 24h TTL
 * + foreground refresh keep content fresh. Updating any reference table
 * bumps `journey_config_versions.current_version` (admin-managed via
 * SQL or future admin UI).
 */
export interface JourneyConfigPayload {
  version: string;
  regions: Array<{
    iso2: string;
    name: string;
    currency_iso: string;
    dial_code: string;
    is_primary_market: boolean;
    is_diaspora_corridor: boolean;
  }>;
  banks_by_region: Record<string, Array<{ slug: string; name: string }>>;
  wallets_by_region: Record<
    string,
    Array<{ slug: string; name: string; is_international: boolean }>
  >;
  earning_types: Array<{ slug: string }>;
  investment_types: Array<{ slug: string }>;
  family_remittance_options: Array<{
    slug: string;
    triggers_step2: boolean;
    is_mutually_exclusive: boolean;
  }>;
  goal_templates: Array<{
    slug: string;
    default_label: string;
    icon_key: string;
    is_custom: boolean;
  }>;
  budget_templates_by_key: Record<
    string,
    Array<{
      category_slug: string;
      default_pct: number;
      default_currency: string;
      semantic: 'inflow' | 'outflow';
    }>
  >;
  /**
   * D-019 absolute baseline anchors per currency. Product-owned numbers
   * the budget percentage templates multiply against. Major units.
   * Migration: `db/supabase/007_budget_baselines.sql`.
   */
  budget_baselines_by_currency: Record<
    string,
    { baseline_major: number; source_note: string | null }
  >;
  permission_cards: Array<{
    slug: string;
    title_key: string;
    body_key: string;
    visible_on_platforms: string[];
    is_optional: boolean;
  }>;
  phase7_status_templates: Array<{
    template_key: string;
    template_string_key: string;
    display_order: number;
    trigger_condition: string;
  }>;
  /** Flat key → value map (locale = 'en' for v1 per D-004). */
  strings: Record<string, string>;
}

@Injectable()
export class JourneyConfigService {
  private readonly logger = new Logger(JourneyConfigService.name);

  // 5-min in-memory LRU on the controller node. Combined with CDN edge
  // cache keyed by version, this keeps the round-trip cheap.
  private cached: { payload: JourneyConfigPayload; loadedAt: number } | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async getPayload(locale = 'en'): Promise<JourneyConfigPayload> {
    if (
      this.cached &&
      Date.now() - this.cached.loadedAt < this.CACHE_TTL_MS &&
      // Ensure cache wasn't built for a different locale (v1 only ships en
      // so this is a future-proofing branch)
      this.cached.payload.strings['__locale__'] === locale
    ) {
      return this.cached.payload;
    }

    // Read all reference tables in parallel — adds up to ~10 small queries.
    const [
      version,
      regions,
      banks,
      wallets,
      earningTypes,
      investmentTypes,
      familyOptions,
      goalTemplates,
      budgetTemplates,
      budgetBaselines,
      permissionCards,
      phase7Templates,
      strings,
    ] = await Promise.all([
      this.db.execute(sql`SELECT current_version FROM public.journey_config_versions WHERE id = 1`),
      this.db.execute(
        sql`SELECT iso2, name, currency_iso, dial_code, is_primary_market, is_diaspora_corridor
            FROM public.regions ORDER BY display_order`,
      ),
      this.db.execute(
        sql`SELECT region_iso2, slug, name FROM public.banks
            WHERE is_active ORDER BY region_iso2, display_order`,
      ),
      this.db.execute(
        sql`SELECT region_iso2, slug, name, is_international FROM public.wallets
            WHERE is_active ORDER BY region_iso2, display_order`,
      ),
      this.db.execute(
        sql`SELECT slug FROM public.earning_types_master
            WHERE is_active ORDER BY display_order`,
      ),
      this.db.execute(
        sql`SELECT slug FROM public.investment_types_master
            WHERE is_active ORDER BY display_order`,
      ),
      this.db.execute(
        sql`SELECT slug, triggers_step2, is_mutually_exclusive
            FROM public.family_remittance_options ORDER BY display_order`,
      ),
      this.db.execute(
        sql`SELECT slug, default_label, icon_key, is_custom FROM public.goal_templates
            WHERE is_active ORDER BY display_order`,
      ),
      this.db.execute(
        sql`SELECT region_iso2, earning_type, category_slug, default_pct,
                   default_currency, semantic, display_order
            FROM public.budget_templates ORDER BY region_iso2, earning_type, display_order`,
      ),
      this.db.execute(
        sql`SELECT currency_iso, baseline_major, source_note
            FROM public.budget_baselines`,
      ),
      this.db.execute(
        sql`SELECT slug, title_key, body_key, visible_on_platforms, is_optional
            FROM public.permission_cards ORDER BY display_order`,
      ),
      this.db.execute(
        sql`SELECT template_key, template_string_key, display_order, trigger_condition
            FROM public.phase7_status_templates ORDER BY display_order`,
      ),
      this.db.execute(sql`SELECT key, value FROM public.journey_strings WHERE locale = ${locale}`),
    ]);

    const versionRows = version as unknown as Array<{ current_version: string }>;
    const payload: JourneyConfigPayload = {
      version: versionRows[0]?.current_version ?? '1',
      regions: (
        regions as unknown as Array<{
          iso2: string;
          name: string;
          currency_iso: string;
          dial_code: string;
          is_primary_market: boolean;
          is_diaspora_corridor: boolean;
        }>
      ).map((r) => r),
      banks_by_region: this.groupBy(
        banks as unknown as Array<{
          region_iso2: string;
          slug: string;
          name: string;
        }>,
        'region_iso2',
        ({ slug, name }) => ({ slug, name }),
      ),
      wallets_by_region: this.groupBy(
        wallets as unknown as Array<{
          region_iso2: string;
          slug: string;
          name: string;
          is_international: boolean;
        }>,
        'region_iso2',
        ({ slug, name, is_international }) => ({
          slug,
          name,
          is_international,
        }),
      ),
      earning_types: (earningTypes as unknown as Array<{ slug: string }>).map((r) => ({
        slug: r.slug,
      })),
      investment_types: (investmentTypes as unknown as Array<{ slug: string }>).map((r) => ({
        slug: r.slug,
      })),
      family_remittance_options: (
        familyOptions as unknown as Array<{
          slug: string;
          triggers_step2: boolean;
          is_mutually_exclusive: boolean;
        }>
      ).map((r) => r),
      goal_templates: (
        goalTemplates as unknown as Array<{
          slug: string;
          default_label: string;
          icon_key: string;
          is_custom: boolean;
        }>
      ).map((r) => r),
      budget_templates_by_key: this.groupBudgetTemplates(
        budgetTemplates as unknown as Array<{
          region_iso2: string;
          earning_type: string;
          category_slug: string;
          default_pct: number;
          default_currency: string;
          semantic: 'inflow' | 'outflow';
        }>,
      ),
      budget_baselines_by_currency: this.indexBaselines(
        budgetBaselines as unknown as Array<{
          currency_iso: string;
          baseline_major: number;
          source_note: string | null;
        }>,
      ),
      permission_cards: (
        permissionCards as unknown as Array<{
          slug: string;
          title_key: string;
          body_key: string;
          visible_on_platforms: string[];
          is_optional: boolean;
        }>
      ).map((r) => r),
      phase7_status_templates: (
        phase7Templates as unknown as Array<{
          template_key: string;
          template_string_key: string;
          display_order: number;
          trigger_condition: string;
        }>
      ).map((r) => r),
      strings: this.flattenStrings(
        strings as unknown as Array<{ key: string; value: string }>,
        locale,
      ),
    };

    this.cached = { payload, loadedAt: Date.now() };
    this.logger.log(
      `journey-config built — version=${payload.version} regions=${payload.regions.length} banks=${Object.values(payload.banks_by_region).flat().length} strings=${Object.keys(payload.strings).length}`,
    );
    return payload;
  }

  /** Bypass cache (admin endpoint or after a content update). */
  invalidate() {
    this.cached = null;
  }

  // ---------- helpers ----------

  private groupBy<TRow, TOut>(
    rows: TRow[],
    key: keyof TRow,
    project: (row: TRow) => TOut,
  ): Record<string, TOut[]> {
    const out: Record<string, TOut[]> = {};
    for (const row of rows) {
      const k = String(row[key]);
      if (!out[k]) out[k] = [];
      out[k].push(project(row));
    }
    return out;
  }

  private groupBudgetTemplates(
    rows: Array<{
      region_iso2: string;
      earning_type: string;
      category_slug: string;
      default_pct: number;
      default_currency: string;
      semantic: 'inflow' | 'outflow';
    }>,
  ): Record<
    string,
    Array<{
      category_slug: string;
      default_pct: number;
      default_currency: string;
      semantic: 'inflow' | 'outflow';
    }>
  > {
    const out: Record<
      string,
      Array<{
        category_slug: string;
        default_pct: number;
        default_currency: string;
        semantic: 'inflow' | 'outflow';
      }>
    > = {};
    for (const r of rows) {
      const k = `${r.region_iso2}:${r.earning_type}`;
      if (!out[k]) out[k] = [];
      out[k].push({
        category_slug: r.category_slug,
        default_pct: r.default_pct,
        default_currency: r.default_currency,
        semantic: r.semantic,
      });
    }
    return out;
  }

  /**
   * D-019 — index baseline rows by currency. Product-owned data; this
   * helper just shapes it for the wire payload.
   */
  private indexBaselines(
    rows: Array<{
      currency_iso: string;
      baseline_major: number;
      source_note: string | null;
    }>,
  ): Record<string, { baseline_major: number; source_note: string | null }> {
    const out: Record<string, { baseline_major: number; source_note: string | null }> = {};
    for (const r of rows) {
      out[r.currency_iso] = {
        baseline_major: r.baseline_major,
        source_note: r.source_note,
      };
    }
    return out;
  }

  private flattenStrings(
    rows: Array<{ key: string; value: string }>,
    locale: string,
  ): Record<string, string> {
    const out: Record<string, string> = { __locale__: locale };
    for (const row of rows) out[row.key] = row.value;
    return out;
  }
}
