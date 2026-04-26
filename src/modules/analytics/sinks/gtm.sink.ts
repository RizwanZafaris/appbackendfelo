import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CanonicalEvent } from '../dto/event.dto';
import type { AnalyticsSink } from './sink.interface';

/**
 * GTM dataLayer sink — formats the event into the camelCase shape that
 * GTM containers consume, then **returns the payload to the client** so
 * the Flutter app can `dataLayer.push(payload)` via its JS bridge / native
 * plugin.
 *
 * Server-side does no actual GTM POST — that's a client-side concern.
 * This sink's job is solely the format adaptation + active-flag gating.
 *
 * Required env var to activate:
 *   GTM_CONTAINER_ID — e.g. GTM-XXXXXX (from your GTM admin console)
 *
 * Without GTM_CONTAINER_ID set, `format()` still returns the canonical
 * payload but client-side code can detect `gtm_container_id == null`
 * and skip the dataLayer.push.
 */
@Injectable()
export class GtmSink implements AnalyticsSink {
  readonly name = 'gtm' as const;
  readonly sync = true; // synchronous because it returns to client

  private readonly containerId: string | undefined;
  private readonly logger = new Logger(GtmSink.name);

  constructor(cfg: ConfigService) {
    this.containerId = cfg.get<string>('GTM_CONTAINER_ID');
    if (this.active) {
      this.logger.log(`GtmSink active — container=${this.containerId}`);
    } else {
      this.logger.log(
        'GtmSink in formatter-only mode — set GTM_CONTAINER_ID to enable client dataLayer push.',
      );
    }
  }

  get active(): boolean {
    return !!this.containerId;
  }

  /** Sink contract: send() is a no-op for GTM (work happens client-side). */
  async send(_event: CanonicalEvent): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  /**
   * Format for client-side dataLayer.push. Convention:
   *   - `event` key holds the snake_case event name (GTM trigger key)
   *   - All other props stay snake_case for SQL parity
   *   - `gtm_container_id` lets the client detect inactive mode
   */
  format(event: CanonicalEvent): Record<string, unknown> {
    return {
      event: event.event_name,
      gtm_container_id: this.containerId ?? null,
      frd_id: event.frd_id,
      step_id: event.step_id,
      phase: event.phase,
      session_id: event.session_id,
      occurred_at: event.occurred_at,
      ...(event.properties ?? {}),
    };
  }
}
