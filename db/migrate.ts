/**
 * Drizzle migration runner. Run via `npm run db:migrate`.
 * Reads DATABASE_URL from env, applies any pending migrations from db/migrations.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  // Single connection just for migrations.
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  console.log('Applying migrations...');
  await migrate(db, { migrationsFolder: './db/migrations' });
  console.log('Migrations applied.');

  await sql.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
