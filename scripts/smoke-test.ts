/**
 * Felo backend ↔ Supabase smoke test.
 *
 * Run:  npx tsx scripts/smoke-test.ts
 *
 * Uses only SUPABASE_URL + SUPABASE_SECRET_KEY (no DB password needed).
 * Probes:
 *   1. REST API reachability + table list
 *   2. Each existing table — row count
 *   3. service_role can bypass RLS (insert + delete on a benign table)
 *   4. Auth admin reach (list users count)
 */
import 'dotenv/config';

const URL = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SECRET_KEY ?? '';

if (!URL || !KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

interface SmokeResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: SmokeResult[] = [];

async function run(name: string, fn: () => Promise<string>): Promise<void> {
  process.stdout.write(`  ${name.padEnd(48, '.')} `);
  try {
    const detail = await fn();
    console.log(`✅ ${detail}`);
    results.push({ name, ok: true, detail });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ ${msg}`);
    results.push({ name, ok: false, detail: msg });
  }
}

async function rowCount(table: string): Promise<number> {
  const res = await fetch(`${URL}/rest/v1/${table}?select=*`, {
    headers: { ...headers, Prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const range = res.headers.get('content-range') ?? '';
  const total = range.split('/')[1] ?? '?';
  return Number(total === '*' ? 0 : total);
}

async function main() {
  console.log('\nFelo ↔ Supabase smoke test');
  console.log('==========================');
  console.log(`Project: ${URL}`);

  console.log('\n[1] REST API reach');
  await run('OpenAPI introspection', async () => {
    const res = await fetch(`${URL}/rest/v1/`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { definitions?: Record<string, unknown> };
    const tables = Object.keys(body.definitions ?? {});
    return `${tables.length} tables visible`;
  });

  console.log('\n[2] Read existing tables (service_role bypasses RLS)');
  const tables = [
    'profiles',
    'transactions',
    'budgets',
    'goals',
    'recurring_bills',
    'subscriptions',
    'felo_scores',
    'coach_conversations',
    'coach_queries',
  ];
  for (const t of tables) {
    await run(`SELECT count(*) FROM ${t}`, async () => {
      const c = await rowCount(t);
      return `${c} rows`;
    });
  }

  console.log('\n[3] End-to-end write roundtrip (auth user → profile → query)');

  await run('Create auth user → profile → coach_query → tear down', async () => {
    const email = `smoke-${Date.now()}@felo.invalid`;

    // 1. Create auth.users entry via Admin API.
    const aRes = await fetch(`${URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password: 'smoke-test-pw-9183', email_confirm: true }),
    });
    if (!aRes.ok) {
      const err = await aRes.text();
      throw new Error(`auth user POST HTTP ${aRes.status}: ${err.slice(0, 120)}`);
    }
    const authUser = (await aRes.json()) as { id: string };
    const userId = authUser.id;

    // 2. Profile is auto-created by a Supabase trigger on auth.users.
    //    UPDATE it with smoke-test fields so we exercise the write path.
    const pRes = await fetch(`${URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        display_name: 'felo-smoke-test',
        currency: 'CAD',
        country: 'CA',
        corridor: 'canada',
      }),
    });
    if (!pRes.ok) {
      const err = await pRes.text();
      await fetch(`${URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers });
      throw new Error(`profile UPDATE HTTP ${pRes.status}: ${err.slice(0, 120)}`);
    }

    // 3. Insert coach_query referencing the profile.
    const qRes = await fetch(`${URL}/rest/v1/coach_queries`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        query_date: new Date().toISOString().slice(0, 10),
        query_count: 1,
      }),
    });
    const queryOk = qRes.ok;

    // 4. Tear down — order: child rows → profile → auth user.
    await fetch(`${URL}/rest/v1/coach_queries?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers,
    });
    await fetch(`${URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'DELETE',
      headers,
    });
    await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers,
    });

    if (!queryOk) {
      const err = await qRes.text();
      throw new Error(`query INSERT HTTP ${qRes.status}: ${err.slice(0, 120)}`);
    }
    return `auth user ${userId.slice(0, 8)}… + profile + query, all torn down`;
  });

  console.log('\n[4] Auth admin reach');
  await run('GET /auth/v1/admin/users (service_role only)', async () => {
    const res = await fetch(`${URL}/auth/v1/admin/users?per_page=1`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { users?: unknown[]; total?: number };
    return `total auth users: ${body.total ?? body.users?.length ?? '?'}`;
  });

  // Summary
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log('\n----');
  console.log(`Smoke test: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('🎉 Backend ↔ Supabase REST + Auth wiring is healthy.');
    console.log('   Next: provide DB password to enable direct Postgres queries.');
    process.exit(0);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
