import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { Drizzle, DRIZZLE } from '../db/db.module';
import { RequestContextService } from '../context/request-context';
import { RequestUser } from '../types/request-user';

/**
 * After SupabaseJwtGuard runs, this middleware:
 *
 *   1. Generates / propagates a `traceId` (X-Request-ID compatible).
 *   2. Pushes the request context (userId, traceId, IP, UA) into
 *      AsyncLocalStorage for the rest of the request hop.
 *   3. Best-effort sets the Postgres GUC `app.user_id` for any RLS policy
 *      that uses `current_user_id()`.
 *
 * IMPORTANT — RLS limitation:
 *   postgres-js connection pooling routes successive queries to different
 *   physical connections. Even `SET` (session scope, not LOCAL) does not
 *   guarantee the next query sees the GUC. So this is best-effort defence-
 *   in-depth, NOT the primary auth guarantee. The primary guarantee is
 *   application-level filtering (every service has user-id WHERE clauses,
 *   verifyAccountOwnership, etc.).
 *
 *   To make RLS load-bearing, future work should wrap each authenticated
 *   request in a `db.transaction()` and run all queries through it.
 *   Tracked in LAUNCH_READINESS.md as a P1 follow-up.
 */
@Injectable()
export class CurrentUserMiddleware implements NestMiddleware {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly ctx: RequestContextService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const r = req as Request & { user?: RequestUser };

    // Trace ID — accept upstream value if a trusted proxy supplied one,
    // otherwise mint a fresh UUID. Mirrored back on the response so
    // clients can quote it in bug reports / Sentry / Crashlytics.
    const incomingTrace = (req.headers['x-request-id'] as string | undefined) ?? '';
    const traceId =
      /^[a-zA-Z0-9-_]{8,128}$/.test(incomingTrace) ? incomingTrace : randomUUID();
    res.setHeader('X-Request-ID', traceId);

    const ctx = {
      userId: r.user?.id,
      email: r.user?.email,
      traceId,
      ipAddress: req.ip,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? undefined,
      startedAt: Date.now(),
    };

    // Best-effort GUC for RLS belt-and-suspenders.
    if (r.user?.id) {
      try {
        // SET (not SET LOCAL) so the value persists on the connection
        // beyond the implicit transaction Drizzle wraps execute() in.
        // Still racy under pool-switching; see class doc.
        await this.db.execute(sql`SELECT set_config('app.user_id', ${r.user.id}, false)`);
      } catch {
        // Never block the request on a session-var write failure.
      }
    }

    // Propagate the context for downstream services (audit log, error
    // handler, traceId logging).
    this.ctx.run(ctx, () => next());
  }
}
