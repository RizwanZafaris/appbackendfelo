import { Global, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@db/schema';

import { DatabaseService } from '../database.service';
import { DRIZZLE } from './drizzle.token';

export { DRIZZLE } from './drizzle.token';
export type { Drizzle } from './drizzle.token';

const drizzleProvider: Provider = {
  provide: DRIZZLE,
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => {
    const url = cfg.get<string>('DATABASE_URL');
    if (!url) {
      throw new Error('DATABASE_URL must be set');
    }
    // Single pool for the app. `postgres-js` uses prepared statements and
    // multiplexes — works great with Supabase pgbouncer in transaction mode
    // when prepare:false is set.
    const client = postgres(url, {
      max: 10,
      prepare: false,
      ssl: cfg.get<string>('NODE_ENV') === 'production' ? 'require' : false,
    });
    return drizzle(client, { schema });
  },
};

// DbModule is @Global so DRIZZLE + DatabaseService resolve in any module
// (sanctions, launch-readiness, compliance, ledger, etc.) without each
// having to import this module manually.
@Global()
@Module({
  providers: [drizzleProvider, DatabaseService],
  exports: [DRIZZLE, DatabaseService],
})
export class DbModule {}
