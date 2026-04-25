import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';

import type { PatchOnboardingStateDto } from './dto/onboarding-state.dto';

/**
 * Owns writes to `public.onboarding_state` and `public.onboarding_sessions`
 * (per D-009 — write-on-Continue, resume-from-last-completed-step).
 *
 * Business rules:
 * - PATCH is delta-merge: only fields present in the DTO are updated
 * - `secondary_regions[]` cap = 3 enforced server-side per D-013
 * - `goals.length === 2` enforced per D-008 when goals present in delta
 *
 * The Drizzle schema definitions for these tables are in
 * `db/supabase/006_onboarding_v2.sql` (applied to live Supabase). For
 * E11 implementation we use `db.execute(sql\`...\`)` against raw SQL —
 * Drizzle table definitions are a follow-up cleanup.
 */
@Injectable()
export class OnboardingStateService {
  private readonly logger = new Logger(OnboardingStateService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * Upsert per-user onboarding state. New users (first PATCH) get a row
   * inserted; subsequent calls merge deltas via COALESCE.
   *
   * `auth.uid()` from the JWT is the row owner. The controller passes
   * `userId` after extracting it.
   */
  async upsertState(
    userId: string,
    delta: PatchOnboardingStateDto,
  ): Promise<{ ok: true; updated_at: string }> {
    // D-008 hard limit at the server boundary
    if (delta.goals !== undefined && delta.goals.length !== 2) {
      throw new Error(
        `D-008: goals[] must contain exactly 2 entries; got ${delta.goals.length}`,
      );
    }

    // D-013 cap on secondary regions
    if (
      delta.secondary_regions !== undefined &&
      delta.secondary_regions.length > 3
    ) {
      throw new Error(
        `D-013: secondary_regions[] cap is 3; got ${delta.secondary_regions.length}`,
      );
    }

    // Upsert top-level fields. We persist primitive columns directly;
    // collection deltas (accounts/budget_categories/goals/etc.) flow into
    // their own tables and are handled by `complete()` in Stage 7 E7.
    // For E11, we save the primitive fields + last_completed_step here;
    // the multi-row collection deltas are persisted into
    // `onboarding_sessions.payload` JSONB (resume-state), then later
    // expanded into proper tables when `complete()` fires.
    const payloadJson = this.collectionDeltaJson(delta);

    await this.db.execute(sql`
      INSERT INTO public.onboarding_state (
        user_id, primary_region, secondary_regions, name, ip_country,
        accounts_deferred, invests, last_completed_step, updated_at
      ) VALUES (
        ${userId}::uuid,
        ${delta.primary_region ?? null},
        ${delta.secondary_regions ?? null}::text[],
        ${delta.name ?? null},
        ${delta.ip_country ?? null},
        ${delta.accounts_deferred ?? null},
        ${delta.invests ?? null},
        ${delta.last_completed_step ?? null},
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        primary_region      = COALESCE(EXCLUDED.primary_region, public.onboarding_state.primary_region),
        secondary_regions   = COALESCE(EXCLUDED.secondary_regions, public.onboarding_state.secondary_regions),
        name                = COALESCE(EXCLUDED.name, public.onboarding_state.name),
        ip_country          = COALESCE(EXCLUDED.ip_country, public.onboarding_state.ip_country),
        accounts_deferred   = COALESCE(EXCLUDED.accounts_deferred, public.onboarding_state.accounts_deferred),
        invests             = COALESCE(EXCLUDED.invests, public.onboarding_state.invests),
        last_completed_step = COALESCE(EXCLUDED.last_completed_step, public.onboarding_state.last_completed_step),
        updated_at          = NOW()
    `);

    // Persist phase 3-6 collection deltas + permissions into the
    // session's resume-payload. Atomic UPDATE — if no session exists
    // yet (caller didn't hit POST /sessions first) we INSERT one.
    if (Object.keys(payloadJson).length > 0) {
      await this.db.execute(sql`
        INSERT INTO public.onboarding_sessions (
          user_id, current_step, last_activity_at, payload
        )
        VALUES (
          ${userId}::uuid,
          ${delta.last_completed_step ?? 'unknown'},
          NOW(),
          ${JSON.stringify(payloadJson)}::jsonb
        )
        ON CONFLICT DO NOTHING
      `);
      // Merge with any existing session payload via JSONB ||
      await this.db.execute(sql`
        UPDATE public.onboarding_sessions
           SET payload = payload || ${JSON.stringify(payloadJson)}::jsonb,
               last_activity_at = NOW(),
               current_step = COALESCE(${delta.last_completed_step ?? null}, current_step)
         WHERE user_id = ${userId}::uuid
           AND completed_at IS NULL
      `);
    }

    return { ok: true, updated_at: new Date().toISOString() };
  }

  /**
   * Resume payload for the cold-start path. Returns null if no session.
   */
  async getResumeState(userId: string): Promise<{
    state: Record<string, unknown> | null;
    session: Record<string, unknown> | null;
  }> {
    const stateRows: Array<Record<string, unknown>> = (await this.db.execute(
      sql`SELECT * FROM public.onboarding_state WHERE user_id = ${userId}::uuid LIMIT 1`,
    )) as unknown as Array<Record<string, unknown>>;

    const sessionRows: Array<Record<string, unknown>> =
      (await this.db.execute(
        sql`SELECT * FROM public.onboarding_sessions
            WHERE user_id = ${userId}::uuid AND completed_at IS NULL
            ORDER BY last_activity_at DESC LIMIT 1`,
      )) as unknown as Array<Record<string, unknown>>;

    return {
      state: stateRows[0] ?? null,
      session: sessionRows[0] ?? null,
    };
  }

  /**
   * Start a new session. Anonymous OK — session insert with user_id NULL
   * + device_id. Promoted to a user_id-bound session on first auth event.
   */
  async startSession(
    deviceId: string,
    userId: string | null,
    clientStartedAt?: string,
  ): Promise<{ session_id: string; started_at: string }> {
    const result = (await this.db.execute(sql`
      INSERT INTO public.onboarding_sessions (
        user_id, device_id, started_at, last_activity_at, current_phase, current_step
      ) VALUES (
        ${userId}::uuid,
        ${deviceId},
        ${clientStartedAt ?? null}::timestamptz,
        NOW(),
        0,
        'welcome'
      )
      RETURNING id, started_at
    `)) as unknown as Array<{ id: string; started_at: string }>;

    if (!result[0]) {
      throw new Error('Failed to insert onboarding session');
    }
    return {
      session_id: result[0].id,
      started_at: result[0].started_at,
    };
  }

  private collectionDeltaJson(
    delta: PatchOnboardingStateDto,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (delta.sms_granted !== undefined)
      out.sms_granted = delta.sms_granted;
    if (delta.notifications_granted !== undefined)
      out.notifications_granted = delta.notifications_granted;
    if (delta.location_granted !== undefined)
      out.location_granted = delta.location_granted;
    if (delta.contacts_ack !== undefined)
      out.contacts_ack = delta.contacts_ack;
    if (delta.earning_types !== undefined)
      out.earning_types = delta.earning_types;
    if (delta.earning_type_custom !== undefined)
      out.earning_type_custom = delta.earning_type_custom;
    if (delta.accounts !== undefined) out.accounts = delta.accounts;
    if (delta.investment_types !== undefined)
      out.investment_types = delta.investment_types;
    if (delta.budget_total_minor !== undefined)
      out.budget_total_minor = delta.budget_total_minor;
    if (delta.budget_currency !== undefined)
      out.budget_currency = delta.budget_currency;
    if (delta.budget_categories !== undefined)
      out.budget_categories = delta.budget_categories;
    if (delta.goals !== undefined) out.goals = delta.goals;
    if (delta.remittance_options !== undefined)
      out.remittance_options = delta.remittance_options;
    if (delta.sends_to !== undefined) out.sends_to = delta.sends_to;
    if (delta.receives_from !== undefined)
      out.receives_from = delta.receives_from;
    return out;
  }
}
