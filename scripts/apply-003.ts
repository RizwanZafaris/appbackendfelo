import 'dotenv/config';
import * as fs from 'node:fs';
import postgres from 'postgres';
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: 'require' });
  try {
    const ddl = fs.readFileSync('db/supabase/003_sprint4_hardening.sql', 'utf-8');
    const r = await sql.unsafe(ddl);
    console.log('Applied:', JSON.stringify(r.slice(-1)));
  } finally { await sql.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
