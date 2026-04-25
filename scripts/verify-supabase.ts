/**
 * Verify the backend can reach the configured Supabase project.
 *
 * Run:  npx tsx scripts/verify-supabase.ts
 *
 * This script uses two paths to confirm connectivity:
 *   1. REST API via the secret key (proves SUPABASE_URL + SUPABASE_SECRET_KEY work)
 *   2. Direct Postgres via DATABASE_URL (proves the DB pooler URI is reachable)
 *
 * If step 2 fails it prints the exact missing env var or auth issue.
 */
import 'dotenv/config';
import postgres from 'postgres';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;
const DB_URL = process.env.DATABASE_URL;

async function checkRest() {
  console.log('\n[1/2] Verifying REST API reach...');
  if (!SB_URL || !SB_KEY) {
    console.error('   ❌ Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    return false;
  }
  try {
    const res = await fetch(`${SB_URL}/rest/v1/`, {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
      },
    });
    if (!res.ok) {
      console.error(`   ❌ REST returned ${res.status}: ${res.statusText}`);
      return false;
    }
    const body = (await res.json()) as { definitions?: Record<string, unknown> };
    const tableCount = Object.keys(body.definitions ?? {}).length;
    console.log(`   ✅ REST reachable — ${tableCount} tables visible`);
    return true;
  } catch (err) {
    console.error('   ❌ REST request failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

async function checkPostgres() {
  console.log('\n[2/2] Verifying direct Postgres connection...');
  if (!DB_URL || DB_URL.includes('[REPLACE-')) {
    console.error('   ❌ DATABASE_URL is not set or still has placeholder values');
    console.error('       Fill .env from .env.supabase.template');
    return false;
  }
  const sql = postgres(DB_URL, { max: 1, prepare: false, ssl: 'require' });
  try {
    const rows = await sql<{ now: Date }[]>`SELECT now() AS now`;
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    console.log(`   ✅ Connected — server time ${rows[0].now.toISOString()}`);
    console.log(`   ✅ ${tables.length} tables in public schema:`);
    for (const t of tables) console.log(`      • ${t.tablename}`);
    return true;
  } catch (err) {
    console.error('   ❌ Postgres connection failed:', err instanceof Error ? err.message : err);
    return false;
  } finally {
    await sql.end();
  }
}

async function main() {
  console.log('Felo backend ↔ Supabase connection check');
  console.log('========================================');

  const ok1 = await checkRest();
  const ok2 = await checkPostgres();

  console.log('\n----');
  if (ok1 && ok2) {
    console.log('🎉 All checks passed. Backend can talk to Supabase.');
    process.exit(0);
  }
  console.log('⚠️  One or more checks failed — see above.');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
