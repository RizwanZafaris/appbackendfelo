import { Inject, Injectable } from '@nestjs/common';

import { Drizzle, DRIZZLE } from './db/drizzle.token';

/**
 * Thin facade kept for the Squad 2/3/4 modules that were authored against a
 * `dbService.db` accessor. Reuses the single shared `DRIZZLE` provider so
 * we don't open a second connection pool.
 */
@Injectable()
export class DatabaseService {
  constructor(@Inject(DRIZZLE) public readonly db: Drizzle) {}
}
