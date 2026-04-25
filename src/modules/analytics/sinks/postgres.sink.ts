import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { Drizzle, DRIZZLE } from '@/common/db/db.module';

import type { CanonicalEvent } from '../dto/event.dto';
import type { AnalyticsSink } from './sink.interface';

/**
 * Always-on Postgres sink. Internal source of truth for funnel queries
 * (per D-030). Inserts into `public.events` table from migration 006.
 *
 * Synchronous — the dispatcher waits for this before returning. If
 * Postgres is down, the whole event request fails (correctly — we want
 * to know about that).
 */
@Injectable()
export class PostgresSink implements AnalyticsSink {
  readonly name = 'postgres' as const;
  readonly sync = true;
  readonly active = true; // always-on; no env var to gate it

  private readonly logger = new Logger(PostgresSink.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async send(event: CanonicalEvent): Promise<{ ok: boolean; reason?: string }> {
    try {
      // Insert via raw SQL because the Drizzle schema doesn't yet model
      // `events` (it lives in 006_onboarding_v2.sql; Drizzle table will
      // be added in a follow-up to the schema definitions).
      await this.db.execute(sql`
        INSERT INTO public.events (
          user_id, session_id, event_name, frd_id, step_id, phase,
          properties, ip_country, user_agent, locale, occurred_at
        ) VALUES (
          ${event.user_id}::uuid,
          ${event.session_id}::uuid,
          ${event.event_name},
          ${event.frd_id},
          ${event.step_id},
          ${event.phase},
          ${JSON.stringify(event.properties)}::jsonb,
          ${event.meta.ip_country ?? null},
          ${event.meta.user_agent ?? null},
          ${event.meta.locale ?? null},
          ${event.occurred_at}::timestamptz
        )
      `);
      return { ok: true };
    } catch (err) {
      this.logger.error(
        `Postgres sink insert failed for event ${event.event_name}`,
        err,
      );
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
