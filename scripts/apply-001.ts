import 'dotenv/config';
import * as fs from 'node:fs';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: 'require' });
  try {
    const ddl = fs.readFileSync('db/supabase/001_no_dep_features.sql', 'utf-8');
    // Apply as one statement — `unsafe` runs raw SQL.
    const result = await sql.unsafe(ddl);
    console.log('Applied:', JSON.stringify(result.slice(-1)));
  } finally { await sql.end(); }
}
main().catch(err => { console.error(err); process.exit(1); });
