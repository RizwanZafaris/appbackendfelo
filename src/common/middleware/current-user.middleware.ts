import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { Inject } from '@nestjs/common';

import { Drizzle, DRIZZLE } from '../db/db.module';
import { sql } from 'drizzle-orm';

import { RequestUser } from '../types/request-user';

/**
 * After SupabaseJwtGuard runs, this middleware sets the Postgres
 * session-local `app.user_id` GUC so that RLS policies bound to
 * `current_user_id()` see the right user. Runs on every request — no-op if
 * `req.user` is absent (e.g. routes marked @Public).
 *
 * IMPORTANT: this only takes effect when the backend connects on a session
 * pool (Supabase port 5432). On port 6543 (transaction pool) the GUC is
 * scoped to the transaction, not the connection — so calls made outside the
 * Drizzle transaction that ran SET LOCAL will not see the user. The
 * configFactory enforces port 5432 in production for that reason.
 */
@Injectable()
export class CurrentUserMiddleware implements NestMiddleware {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const user = (req as Request & { user?: RequestUser }).user;
    if (user?.id) {
      // Set session var; ignored by Postgres if the connection is reused
      // across requests by pgbouncer in transaction mode — in that case the
      // RLS policy falls back to auth.uid() (Supabase) instead.
      try {
        await this.db.execute(sql`SELECT set_config('app.user_id', ${user.id}, true)`);
      } catch {
        // Don't block the request on a session-var failure.
      }
    }
    next();
  }
}
