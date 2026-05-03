import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '@db/schema';

/**
 * Drizzle injection token + type, factored into a leaf file so that
 * `database.service.ts` and `db.module.ts` can both import it without
 * forming a circular dependency.
 */
export const DRIZZLE = Symbol('DRIZZLE');
export type Drizzle = PostgresJsDatabase<typeof schema>;
