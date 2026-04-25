/**
 * End-to-end test against the running backend + live Supabase.
 *
 * Flow:
 *   1. Create a test auth user via Supabase Admin API
 *   2. Sign in as that user to get a real JWT
 *   3. Hit our backend's GET /v1/auth/me with the JWT
 *   4. Hit /v1/profiles/me — the trigger should have auto-created a profile
 *   5. Hit /v1/budgets (empty array expected)
 *   6. Tear down the auth user (cascades to profile)
 *
 * Run while `npm run start` is alive in another terminal:
 *   npx tsx scripts/e2e-supabase.ts
 */
import 'dotenv/config';

const URL = process.env.SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY!;
const API = `http://localhost:${process.env.PORT ?? 3000}/${process.env.API_PREFIX ?? 'v1'}`;

const adminHeaders = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' };
const anonHeaders = { apikey: PUBLISHABLE, 'Content-Type': 'application/json' };

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}
const steps: Step[] = [];

async function step(name: string, fn: () => Promise<string>) {
  process.stdout.write(`  ${name.padEnd(50, '.')} `);
  try {
    const detail = await fn();
    console.log(`✅ ${detail}`);
    steps.push({ name, ok: true, detail });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ ${msg}`);
    steps.push({ name, ok: false, detail: msg });
  }
}

async function main() {
  console.log('\nFelo backend ↔ Supabase E2E');
  console.log('============================');

  let userId: string | null = null;
  let accessToken: string | null = null;
  const email = `e2e-${Date.now()}@felo.invalid`;
  const password = 'e2e-test-pw-Qb3xL!';

  await step('1. Create auth user via Admin API', async () => {
    const res = await fetch(`${URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: 'E2E Test',
          corridor: 'canada',
          country: 'CA',
          language_code: 'en',
        },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const body = (await res.json()) as { id: string };
    userId = body.id;
    return `id=${userId.slice(0, 8)}…`;
  });

  await step('2. Sign in to get a real Supabase JWT', async () => {
    const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: anonHeaders,
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const body = (await res.json()) as { access_token: string };
    accessToken = body.access_token;
    return `token len=${accessToken.length}`;
  });

  const bearer = () => ({ Authorization: `Bearer ${accessToken}` });

  await step('3. GET /v1/auth/me (JWKS verification)', async () => {
    const res = await fetch(`${API}/auth/me`, { headers: bearer() });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const body = (await res.json()) as { id: string; email: string };
    if (body.id !== userId) throw new Error(`id mismatch: ${body.id} vs ${userId}`);
    return `id=${body.id.slice(0, 8)}…  email=${body.email}`;
  });

  await step('4. GET /v1/profiles/me (auto-created via trigger)', async () => {
    const res = await fetch(`${API}/profiles/me`, { headers: bearer() });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const body = (await res.json()) as {
      displayName?: string;
      corridor?: string;
      country?: string;
    };
    return `displayName=${body.displayName} corridor=${body.corridor}`;
  });

  await step('5. PATCH /v1/profiles/me (update field)', async () => {
    const res = await fetch(`${API}/profiles/me`, {
      method: 'PATCH',
      headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'E2E Updated', onboardingComplete: true }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const body = (await res.json()) as { displayName: string };
    return `displayName=${body.displayName}`;
  });

  await step('6. GET /v1/budgets (empty list)', async () => {
    const res = await fetch(`${API}/budgets`, { headers: bearer() });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const body = (await res.json()) as unknown[];
    return `${body.length} rows`;
  });

  await step('7. POST /v1/budgets (create one)', async () => {
    const res = await fetch(`${API}/budgets`, {
      method: 'POST',
      headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'Groceries',
        currency: 'CAD',
        limitMinor: 90000,
        period: 'monthly',
        startsOn: '2026-04-01',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const body = (await res.json()) as { id: string; category: string };
    return `id=${body.id.slice(0, 8)}…  category=${body.category}`;
  });

  await step('8. Tear down — DELETE auth user (cascades)', async () => {
    if (!userId) throw new Error('no user to delete');
    const res = await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return 'OK';
  });

  console.log('\n----');
  const passed = steps.filter((s) => s.ok).length;
  const failed = steps.length - passed;
  console.log(`E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nE2E crashed:', err);
  process.exit(1);
});
