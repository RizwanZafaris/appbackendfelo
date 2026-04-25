import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  CanonicalEvent,
  DispatchResult,
} from './dto/event.dto';
import {
  ANALYTICS_SINKS,
  type AnalyticsSink,
} from './sinks/sink.interface';

/**
 * Multi-sink fan-out per D-030. Synchronous sinks (Postgres, GTM
 * formatter) block; async sinks (Meta CAPI, future TikTok/Snap) fire
 * and forget.
 *
 * Mechanism rule: sinks that are inactive (env vars unset) still
 * register but their `active` flag is false — `send()` returns
 * `{ ok: true, reason: 'stub_mode' }` and the dispatcher doesn't
 * count it as a failure. Drop in credentials → sink switches live,
 * no code change.
 */
@Injectable()
export class AnalyticsDispatcher {
  private readonly logger = new Logger(AnalyticsDispatcher.name);

  constructor(
    @Inject(ANALYTICS_SINKS) private readonly sinks: AnalyticsSink[],
  ) {
    const summary = sinks
      .map(
        (s) =>
          `${s.name}=${s.active ? 'active' : 'stub'}/${s.sync ? 'sync' : 'async'}`,
      )
      .join(' ');
    this.logger.log(`AnalyticsDispatcher initialized — ${summary}`);
  }

  async dispatch(event: CanonicalEvent): Promise<DispatchResult> {
    const sinkResults: Record<string, { ok: boolean; reason?: string }> = {};

    // 1. Synchronous sinks (block). Includes Postgres (always) and
    //    GTM (formatter-only — completes instantly).
    const syncSinks = this.sinks.filter((s) => s.sync);
    await Promise.all(
      syncSinks.map(async (s) => {
        sinkResults[s.name] = await this.safeSend(s, event);
      }),
    );

    // 2. Async sinks (fire-and-forget). Meta CAPI, future TikTok/Snap.
    //    We don't wait for these — let the request return.
    const asyncSinks = this.sinks.filter((s) => !s.sync);
    asyncSinks.forEach((s) => {
      // Mark optimistically; real outcome logged async.
      sinkResults[s.name] = { ok: true, reason: 'queued' };
      void this.safeSend(s, event).then((res) => {
        if (!res.ok) {
          this.logger.warn(
            `Async sink ${s.name} failed: ${res.reason ?? 'unknown'}`,
          );
        }
      });
    });

    // 3. GTM payload returned to client for dataLayer.push.
    const gtm = this.sinks.find((s) => s.name === 'gtm');
    const gtm_payload = gtm?.format?.(event);

    // Overall ok = Postgres OK (the source of truth). Other sink
    // failures don't block the request.
    const postgresOk = sinkResults.postgres?.ok ?? false;
    return { ok: postgresOk, gtm_payload, sinks: sinkResults };
  }

  private async safeSend(
    sink: AnalyticsSink,
    event: CanonicalEvent,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      return await sink.send(event);
    } catch (err) {
      this.logger.error(
        `Sink ${sink.name} threw — should never happen; sink contract violated.`,
        err,
      );
      return {
        ok: false,
        reason: `threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
