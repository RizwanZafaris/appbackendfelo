import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

import type { CanonicalEvent } from '../dto/event.dto';
import type { AnalyticsSink } from './sink.interface';

/**
 * Meta Conversions API sink — server-side Facebook/Instagram event
 * forwarding for ad attribution. Bypasses iOS ATT restrictions (per
 * D-030 rationale).
 *
 * Mechanism rule: when env vars are missing, the sink stays *active in
 * the dispatcher list* but its `active` flag is false — `send()` is a
 * no-op that returns `{ ok: true, reason: 'stub_mode' }`. Drop in
 * credentials and the sink starts firing live, no code change.
 *
 * Required env vars to activate:
 *   META_CAPI_ACCESS_TOKEN  — long-lived system user token
 *   META_PIXEL_ID            — your Meta pixel id
 *   META_TEST_EVENT_CODE    — optional; for Meta Events Manager test view
 *
 * Async — never blocks the request.
 */
@Injectable()
export class MetaCapiSink implements AnalyticsSink {
  readonly name = 'meta_capi' as const;
  readonly sync = false;

  private readonly logger = new Logger(MetaCapiSink.name);
  private readonly accessToken: string | undefined;
  private readonly pixelId: string | undefined;
  private readonly testEventCode: string | undefined;

  constructor(cfg: ConfigService) {
    this.accessToken = cfg.get<string>('META_CAPI_ACCESS_TOKEN');
    this.pixelId = cfg.get<string>('META_PIXEL_ID');
    this.testEventCode = cfg.get<string>('META_TEST_EVENT_CODE');
    if (!this.active) {
      this.logger.log(
        'MetaCapiSink in stub mode — set META_CAPI_ACCESS_TOKEN + META_PIXEL_ID to activate.',
      );
    } else {
      this.logger.log(
        `MetaCapiSink active — pixel=${this.pixelId}${this.testEventCode ? ' (test mode)' : ''}`,
      );
    }
  }

  /** Active iff both required env vars are present. */
  get active(): boolean {
    return !!this.accessToken && !!this.pixelId;
  }

  /** Maps FELO event names to Meta Standard Events for ad attribution. */
  private static readonly STANDARD_EVENT_MAP: Record<string, string> = {
    signup_completed: 'CompleteRegistration',
    phase5_step2_completed: 'AddToWishlist',
    phase8_dashboard_viewed: 'Lead',
    onboarding_completed: 'Subscribe',
  };

  async send(event: CanonicalEvent): Promise<{ ok: boolean; reason?: string }> {
    if (!this.active) {
      // Stub mode: log + drop. Returning ok=true so dispatcher doesn't
      // count this as a failure — it's intentional inactivity.
      return { ok: true, reason: 'stub_mode' };
    }

    try {
      const standardEvent =
        MetaCapiSink.STANDARD_EVENT_MAP[event.event_name] ?? event.event_name;

      const body = {
        data: [
          {
            event_name: standardEvent,
            event_time: Math.floor(
              new Date(event.occurred_at).getTime() / 1000,
            ),
            event_id: `${event.session_id}-${event.event_name}-${Math.floor(
              Math.random() * 1e6,
            )}`,
            action_source: 'app',
            user_data: this.buildUserData(event),
            custom_data: {
              ...event.properties,
              frd_id: event.frd_id,
              step_id: event.step_id,
              phase: event.phase,
            },
          },
        ],
        access_token: this.accessToken,
        ...(this.testEventCode
          ? { test_event_code: this.testEventCode }
          : {}),
      };

      const url = `https://graph.facebook.com/v18.0/${this.pixelId}/events`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          ok: false,
          reason: `meta_capi_${res.status}: ${text.slice(0, 200)}`,
        };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Build the user_data block. Per Meta's CAPI matching rules, all PII
   * fields must be SHA-256 hashed (lowercase, trimmed). We don't have
   * email/phone in the event payload directly — those come from a
   * separate enrichment step at Phase 1 / Phase 7. For E0 we just send
   * what we have (user_id hashed as `external_id`, IP, UA).
   */
  private buildUserData(event: CanonicalEvent): Record<string, string> {
    const data: Record<string, string> = {};
    if (event.user_id) {
      data.external_id = MetaCapiSink.sha256(event.user_id);
    }
    // IP and UA are passed un-hashed per Meta's spec
    if (event.meta.user_agent) data.client_user_agent = event.meta.user_agent;
    // ip_country only (raw IP redacted before this sink) — Meta accepts
    // country-level for some match-quality scenarios; full IP is better
    // but our PII rules redact it before reaching this sink.
    return data;
  }

  private static sha256(value: string): string {
    return crypto
      .createHash('sha256')
      .update(value.trim().toLowerCase())
      .digest('hex');
  }
}
