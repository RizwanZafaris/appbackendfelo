import postgres from 'postgres';

// All Supabase regions per their docs as of 2025/2026, tried in likely order
const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ca-central-1', 'ca-west-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3',
  'eu-central-1', 'eu-central-2',
  'eu-north-1', 'eu-south-1', 'eu-south-2',
  'ap-south-1', 'ap-south-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-east-1',
  'me-south-1', 'me-central-1',
  'af-south-1',
  'sa-east-1',
];

// Newer Supabase projects use aws-1, older use aws-0
const PREFIXES = ['aws-1', 'aws-0'];

const REF = 'xetosbkkjowlspfxffoj';
const PW = 'rizniP-jymvek-vicho8';

async function probe(prefix: string, region: string) {
  const host = `${prefix}-${region}.pooler.supabase.com`;
  const url = `postgresql://postgres.${REF}:${PW}@${host}:6543/postgres`;
  const sql = postgres(url, { max: 1, prepare: false, ssl: 'require', connect_timeout: 4 });
  try {
    const rows = await sql`SELECT current_database() AS db, version() AS v`;
    await sql.end();
    return { prefix, region, ok: true, db: rows[0].db as string };
  } catch (err) {
    await sql.end({ timeout: 0 }).catch(() => {});
    const msg = err instanceof Error ? err.message : 'unknown';
    return { prefix, region, ok: false, err: msg };
  }
}

(async () => {
  for (const prefix of PREFIXES) {
    console.log(`\n=== Trying ${prefix}-* ===`);
    for (const r of REGIONS) {
      const res = await probe(prefix, r);
      if (res.ok) {
        console.log(`✅ FOUND: ${prefix}-${r}  (db=${res.db})`);
        console.log(`   Connection: postgresql://postgres.${REF}:<password>@${prefix}-${r}.pooler.supabase.com:6543/postgres`);
        process.exit(0);
      }
      // Only print resolution failures, not auth failures (less noise)
      if (res.err.includes('ENOTFOUND') || res.err.includes('Tenant')) {
        // skip — too noisy
      } else {
        console.log(`   ${r.padEnd(18)} — ${res.err.slice(0, 80)}`);
      }
    }
  }
  console.log('\n❌ no region matched any prefix');
  process.exit(1);
})();
