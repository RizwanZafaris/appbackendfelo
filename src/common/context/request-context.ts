import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

export interface RequestContext {
  userId?: string;
  email?: string;
  traceId: string;
  ipAddress?: string;
  userAgent?: string;
  startedAt: number;
}

/**
 * Per-request context carried through async hops via AsyncLocalStorage.
 *
 * Used by:
 *   - the global exception filter (so error responses include traceId)
 *   - the audit-log service (no need to pass actorId through every call)
 *   - the launch-readiness re-audit script (correlate logs by traceId)
 *
 * Set by `RequestContextMiddleware` immediately after auth.
 *
 * NOTE: This intentionally does NOT carry a Drizzle transaction handle.
 * Felo's primary defence-in-depth is application-level filtering
 * (verifyAccountOwnership, where(eq(.userId, …))) — not RLS — because
 * postgres-js connection pooling makes session-scope GUCs unreliable
 * under mixed traffic. RLS in 012_launch_readiness.sql is belt-and-
 * suspenders and assumes either (a) requests run inside a single
 * transaction that calls SET LOCAL, or (b) the Supabase client (with
 * end-user JWT) is used directly. Soft-launch v1 deliberately picks
 * application-level filtering as the primary guarantee.
 */
@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  run<T>(ctx: RequestContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  get(): RequestContext | undefined {
    return this.als.getStore();
  }

  getUserId(): string | undefined {
    return this.als.getStore()?.userId;
  }

  getTraceId(): string {
    return this.als.getStore()?.traceId ?? 'no-trace';
  }
}
