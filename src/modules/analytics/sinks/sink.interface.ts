import type { CanonicalEvent } from '../dto/event.dto';

/**
 * Strategy interface for every analytics sink. Per D-030, the dispatcher
 * fans events out to every registered sink. Each sink is responsible for
 * its own format adaptation and failure handling.
 */
export interface AnalyticsSink {
  /** Stable name used in dispatch result + logs. */
  readonly name: 'postgres' | 'meta_capi' | 'gtm' | 'tiktok' | 'snap';

  /**
   * Whether this sink runs synchronously (Postgres) or async (Meta/TikTok).
   * Synchronous sinks block the request; async ones fire-and-forget.
   */
  readonly sync: boolean;

  /**
   * Whether this sink is currently active. Sinks self-disable when their
   * required env vars are missing — the mechanism the user asked for:
   * drop in credentials, sink switches from stub to live.
   */
  readonly active: boolean;

  /**
   * Send the event. Should never throw — return { ok: false, reason }
   * for handled failures. Throwing is treated as a sink bug.
   */
  send(event: CanonicalEvent): Promise<{ ok: boolean; reason?: string }>;

  /**
   * Format the event for return-to-client (used by the GTM sink so the
   * Flutter app can dataLayer.push the formatted payload). Optional —
   * only sinks that need client-side coupling implement it.
   */
  format?(event: CanonicalEvent): Record<string, unknown>;
}

/** DI token for the multi-sink array. */
export const ANALYTICS_SINKS = Symbol('ANALYTICS_SINKS');
