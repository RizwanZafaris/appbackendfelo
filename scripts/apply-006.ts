import 'dotenv/config';
import * as fs from 'node:fs';
import postgres from 'postgres';

/**
 * Apply migration 006_onboarding_v2.sql.
 *
 * Idempotent — file uses IF NOT EXISTS / ON CONFLICT throughout, so
 * re-runs are safe.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set in environment');
  }
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: 'require',
  });
  try {
    const file = 'db/supabase/006_onboarding_v2.sql';
    const ddl = fs.readFileSync(file, 'utf-8');
    const r = await sql.unsafe(ddl);
    console.log(`Applied ${file}.`);
    console.log(`Result: ${JSON.stringify(r.slice(-1))}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
