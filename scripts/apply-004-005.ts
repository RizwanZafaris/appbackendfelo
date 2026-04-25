import 'dotenv/config';
import * as fs from 'node:fs';
import postgres from 'postgres';

/**
 * Apply migrations 004 + 005 in sequence. Idempotent — both files use
 * `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` so re-runs are safe.
 */
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    ssl: 'require',
  });
  try {
    for (const file of [
      'db/supabase/004_accounts_metadata.sql',
      'db/supabase/005_profile_settings.sql',
    ]) {
      const ddl = fs.readFileSync(file, 'utf-8');
      const r = await sql.unsafe(ddl);
      console.log(`Applied ${file}:`, JSON.stringify(r.slice(-1)));
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
