import { Global, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@db/schema';

export const DRIZZLE = Symbol('DRIZZLE');
export type Drizzle = PostgresJsDatabase<typeof schema>;

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

const dbStringProvider: Provider = {
  provide: 'DB',
  useExisting: DRIZZLE,
};

@Global()
@Module({
  providers: [drizzleProvider, dbStringProvider],
  exports: [DRIZZLE, 'DB'],
})
export class DbModule {}
