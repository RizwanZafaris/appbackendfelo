import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';

/**
 * **E7 — Phase 7 personalization orchestrator.**
 *
 * On `POST /v1/onboarding/complete`, fans out the onboarding_state row
 * into the canonical product tables (FR-7.0.1..7.0.8):
 *
 *  1. `profiles` — primary_region, secondary_regions[], name, currency
 *  2. `budgets` + `budget_categories` — current month budget envelope
 *  3. `goals` — 2 goals with target_minor + target_date + currency
 *  4. `accounts` — pending account-link cards (deferred or seeded)
 *  5. `corridors` — sends_to / receives_from rows for remittance UX
 *  6. `dashboard_widgets` — per persona's Phase 8 contract (D-027)
 *  7. `onboarding_sessions` — mark `completed_at`
 *  8. fire `onboarding_completed` analytics event (D-030 dispatch)
 *
 * Idempotent: safe to retry on network failure. All writes inside a
 * transaction; partial failures roll back so Phase 7 can re-run.
 *
 * Loading-screen UX (D-025): the Flutter side polls/SSE-streams against
 * `personalization_steps` so it can show the cycling status messages
 * while this runs. For E7 we simply emit step rows synchronously inside
 * the transaction; the Flutter side can read them after `complete`
 * returns. (SSE streaming is a Stage 8 enhancement.)
 */

export interface CompleteResult {
  profile_id: string;
  budget_id: string | null;
  goal_ids: string[];
  account_card_ids: string[];
  corridor_ids: string[];
  dashboard_widgets: string[];
  steps: { key: string; status: 'ok' | 'skipped' | 'failed'; ms: number }[];
  completed_at: string;
}

interface RawState extends Record<string, unknown> {
  user_id: string;
  primary_region: string | null;
  secondary_regions: string[] | null;
  name: string | null;
  earning_types: string[] | null;
  earning_type_custom: string | null;
  invests: boolean | null;
  investment_types: string[] | null;
  budget_total_minor: number | null;
  budget_currency: string | null;
  budget_categories: Array<{
    key: string;
    label: string;
    amount_minor: number;
    direction: 'inflow' | 'outflow';
  }> | null;
  goals: Array<{
    template_key: string;
    label: string | null;
    target_minor: number;
    currency: string;
    target_date: string;
  }> | null;
  remittance_options: string[] | null;
  sends_to: string[] | null;
  receives_from: string[] | null;
  accounts:
    | Array<{ region: string; kind: string; slug: string; nickname?: string }>
    | null;
  accounts_deferred: boolean | null;
}

@Injectable()
export class CompleteService {
  private readonly logger = new Logger(CompleteService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async complete(userId: string): Promise<CompleteResult> {
    const started = Date.now();
    const steps: CompleteResult['steps'] = [];
    const tick = (key: string, status: 'ok' | 'skipped' | 'failed', t0: number) =>
      steps.push({ key, status, ms: Date.now() - t0 });

    // Load the user's onboarding_state once; the orchestrator is read-once.
    const stateRow = await this.loadState(userId);
    if (!stateRow) {
      throw new Error('D-009: no onboarding_state for user; nothing to complete');
    }

    // Use a single transaction so partial completes roll back.
    return this.db.transaction(async (tx) => {
      // FR-7.0.1 — Profile
      const t1 = Date.now();
      const profileId = await this.upsertProfile(tx, stateRow);
      tick('profile', 'ok', t1);

      // FR-7.0.2 — Budget + categories
      const t2 = Date.now();
      const budgetId = stateRow.budget_total_minor
        ? await this.insertBudget(tx, userId, stateRow)
        : null;
      tick('budget', budgetId ? 'ok' : 'skipped', t2);

      // FR-7.0.3 — Goals
      const t3 = Date.now();
      const goalIds = stateRow.goals?.length
        ? await this.insertGoals(tx, userId, stateRow.goals)
        : [];
      tick('goals', goalIds.length ? 'ok' : 'skipped', t3);

      // FR-7.0.4 — Account link cards (pending; user wires up later)
      const t4 = Date.now();
      const accountCardIds = stateRow.accounts_deferred
        ? []
        : await this.seedAccountCards(tx, userId, stateRow.accounts ?? []);
      tick('accounts', accountCardIds.length ? 'ok' : 'skipped', t4);

      // FR-7.0.5 — Corridors
      const t5 = Date.now();
      const corridorIds = await this.insertCorridors(
        tx,
        userId,
        stateRow.sends_to ?? [],
        stateRow.receives_from ?? [],
      );
      tick('corridors', corridorIds.length ? 'ok' : 'skipped', t5);

      // FR-7.0.6 — Dashboard widgets per persona
      const t6 = Date.now();
      const widgets = await this.seedDashboardWidgets(tx, userId, stateRow);
      tick('dashboard', widgets.length ? 'ok' : 'skipped', t6);

      // FR-7.0.7 — Mark session completed
      const t7 = Date.now();
      await tx.execute(sql`
        UPDATE public.onboarding_sessions
           SET completed_at = NOW()
         WHERE user_id = ${userId}
           AND completed_at IS NULL
      `);
      tick('session_close', 'ok', t7);

      // FR-7.0.8 — Analytics fan-out (D-030). The actual GTM/Meta CAPI
      // dispatch lives in `analytics.service.ts`; here we just write the
      // canonical event row that the dispatcher reads.
      const t8 = Date.now();
      await tx.execute(sql`
        INSERT INTO public.analytics_events
          (user_id, event, payload, created_at)
        VALUES (
          ${userId},
          'onboarding_completed',
          ${JSON.stringify({
            duration_ms: Date.now() - started,
            primary_region: stateRow.primary_region,
            goal_count: goalIds.length,
            corridor_count: corridorIds.length,
          })}::jsonb,
          NOW()
        )
      `);
      tick('analytics', 'ok', t8);

      return {
        profile_id: profileId,
        budget_id: budgetId,
        goal_ids: goalIds,
        account_card_ids: accountCardIds,
        corridor_ids: corridorIds,
        dashboard_widgets: widgets,
        steps,
        completed_at: new Date().toISOString(),
      };
    });
  }

  // ---------- step implementations ----------

  private async loadState(userId: string): Promise<RawState | null> {
    const rows = await this.db.execute<RawState>(sql`
      SELECT user_id, primary_region, secondary_regions, name,
             earning_types, earning_type_custom, invests, investment_types,
             budget_total_minor, budget_currency, budget_categories,
             goals, remittance_options, sends_to, receives_from,
             accounts, accounts_deferred
        FROM public.onboarding_state
       WHERE user_id = ${userId}
       LIMIT 1
    `);
    return (rows as unknown as RawState[])[0] ?? null;
  }

  private async upsertProfile(
    tx: Drizzle,
    s: RawState,
  ): Promise<string> {
    const result = await tx.execute<{ id: string }>(sql`
      INSERT INTO public.profiles
        (user_id, name, primary_region, secondary_regions,
         currency, earning_types, invests, investment_types, updated_at)
      VALUES (
        ${s.user_id},
        ${s.name},
        ${s.primary_region},
        ${s.secondary_regions ?? []},
        ${s.budget_currency},
        ${s.earning_types ?? []},
        ${s.invests ?? false},
        ${s.investment_types ?? []},
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        name              = EXCLUDED.name,
        primary_region    = EXCLUDED.primary_region,
        secondary_regions = EXCLUDED.secondary_regions,
        currency          = EXCLUDED.currency,
        earning_types     = EXCLUDED.earning_types,
        invests           = EXCLUDED.invests,
        investment_types  = EXCLUDED.investment_types,
        updated_at        = NOW()
      RETURNING id
    `);
    const id = (result as unknown as { id: string }[])[0]?.id;
    if (!id) throw new Error('profile upsert returned no id');
    return id;
  }

  private async insertBudget(
    tx: Drizzle,
    userId: string,
    s: RawState,
  ): Promise<string> {
    const result = await tx.execute<{ id: string }>(sql`
      INSERT INTO public.budgets
        (user_id, total_minor, currency, period_start, period_end)
      VALUES (
        ${userId},
        ${s.budget_total_minor},
        ${s.budget_currency},
        date_trunc('month', NOW())::date,
        (date_trunc('month', NOW()) + INTERVAL '1 month - 1 day')::date
      )
      RETURNING id
    `);
    const budgetId = (result as unknown as { id: string }[])[0]?.id;
    if (!budgetId) throw new Error('budget insert returned no id');

    for (const cat of s.budget_categories ?? []) {
      await tx.execute(sql`
        INSERT INTO public.budget_categories
          (budget_id, key, label, amount_minor, direction)
        VALUES (
          ${budgetId},
          ${cat.key},
          ${cat.label},
          ${cat.amount_minor},
          ${cat.direction}
        )
      `);
    }
    return budgetId;
  }

  private async insertGoals(
    tx: Drizzle,
    userId: string,
    goals: NonNullable<RawState['goals']>,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const g of goals) {
      const result = await tx.execute<{ id: string }>(sql`
        INSERT INTO public.goals
          (user_id, template_key, label, target_minor,
           currency, target_date, status)
        VALUES (
          ${userId},
          ${g.template_key},
          ${g.label},
          ${g.target_minor},
          ${g.currency},
          ${g.target_date}::date,
          'active'
        )
        RETURNING id
      `);
      const id = (result as unknown as { id: string }[])[0]?.id;
      if (id) ids.push(id);
    }
    return ids;
  }

  private async seedAccountCards(
    tx: Drizzle,
    userId: string,
    accounts: NonNullable<RawState['accounts']>,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const a of accounts) {
      const result = await tx.execute<{ id: string }>(sql`
        INSERT INTO public.account_link_cards
          (user_id, region, kind, slug, nickname, status)
        VALUES (
          ${userId},
          ${a.region},
          ${a.kind},
          ${a.slug},
          ${a.nickname ?? null},
          'pending_link'
        )
        ON CONFLICT (user_id, region, kind, slug)
          DO UPDATE SET nickname = EXCLUDED.nickname
        RETURNING id
      `);
      const id = (result as unknown as { id: string }[])[0]?.id;
      if (id) ids.push(id);
    }
    return ids;
  }

  private async insertCorridors(
    tx: Drizzle,
    userId: string,
    sendsTo: string[],
    receivesFrom: string[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const region of sendsTo) {
      const result = await tx.execute<{ id: string }>(sql`
        INSERT INTO public.corridors
          (user_id, direction, region)
        VALUES (${userId}, 'send', ${region})
        ON CONFLICT (user_id, direction, region) DO NOTHING
        RETURNING id
      `);
      const id = (result as unknown as { id: string }[])[0]?.id;
      if (id) ids.push(id);
    }
    for (const region of receivesFrom) {
      const result = await tx.execute<{ id: string }>(sql`
        INSERT INTO public.corridors
          (user_id, direction, region)
        VALUES (${userId}, 'receive', ${region})
        ON CONFLICT (user_id, direction, region) DO NOTHING
        RETURNING id
      `);
      const id = (result as unknown as { id: string }[])[0]?.id;
      if (id) ids.push(id);
    }
    return ids;
  }

  /**
   * D-027 — dashboard widget contract per persona profile.
   *
   * Heuristic (out-of-scope for full persona engine; lightweight here):
   * - Always: balances, budget_progress
   * - +goals if any
   * - +remittance_corridors if sends_to or receives_from non-empty
   * - +investments_overview if invests
   * - +sms_paste_inbox if accounts_deferred (so user can paste later)
   */
  private async seedDashboardWidgets(
    tx: Drizzle,
    userId: string,
    s: RawState,
  ): Promise<string[]> {
    const widgets: string[] = ['balances', 'budget_progress'];
    if ((s.goals ?? []).length > 0) widgets.push('goals_progress');
    if ((s.sends_to?.length ?? 0) + (s.receives_from?.length ?? 0) > 0) {
      widgets.push('remittance_corridors');
    }
    if (s.invests) widgets.push('investments_overview');
    if (s.accounts_deferred) widgets.push('sms_paste_inbox');

    let order = 0;
    for (const w of widgets) {
      await tx.execute(sql`
        INSERT INTO public.dashboard_widgets
          (user_id, widget_key, sort_order, visible)
        VALUES (${userId}, ${w}, ${order}, TRUE)
        ON CONFLICT (user_id, widget_key)
          DO UPDATE SET sort_order = EXCLUDED.sort_order, visible = TRUE
      `);
      order += 1;
    }
    return widgets;
  }
}
