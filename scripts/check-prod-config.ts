/**
 * Pre-flight env validator. Run inside Railway (or locally with a
 * .env.production file) to catch misconfigurations before they crash
 * a real deploy.
 *
 * Exit code:
 *   0 — all required vars set, sane, and FELO_LAUNCH_READY=1.
 *   1 — at least one required var missing or malformed; deploy unsafe.
 *   2 — required vars OK but FELO_LAUNCH_READY != 1 (intentional gate).
 *
 * Usage:
 *   npx tsx scripts/check-prod-config.ts
 *   docker run --rm -e DATABASE_URL=... <image> node -e "require('./scripts/check-prod-config')"
 */

import 'dotenv/config';

interface Check {
  key: string;
  required: boolean;
  description: string;
  validate?: (v: string) => string | undefined; // returns error message or undefined
}

const PLACEHOLDER = /<.*>|YOUR_|REPLACE_WITH|^changeme$|^stub$/i;

const checks: Check[] = [
  {
    key: 'NODE_ENV',
    required: true,
    description: 'production',
    validate: (v) => (v === 'production' ? undefined : `expected 'production', got '${v}'`),
  },
  {
    key: 'DATABASE_URL',
    required: true,
    description: 'Supabase session pool (port 5432)',
    validate: (v) => {
      if (PLACEHOLDER.test(v)) return 'placeholder value';
      if (/:6543\//.test(v)) return 'uses transaction-pool port 6543; must be 5432';
      if (!/^postgresql:\/\//.test(v)) return 'must start with postgresql://';
      return undefined;
    },
  },
  { key: 'SUPABASE_URL', required: true, description: 'https://<ref>.supabase.co' },
  { key: 'SUPABASE_PUBLISHABLE_KEY', required: true, description: 'sb_publishable_...' },
  { key: 'SUPABASE_SECRET_KEY', required: true, description: 'sb_secret_...' },
  { key: 'SUPABASE_JWKS_URL', required: true, description: 'JWKS endpoint URL' },
  {
    key: 'CORS_ORIGINS',
    required: true,
    description: 'comma-separated origins, no wildcards',
    validate: (v) => (v.includes('*') ? "must not contain '*'" : undefined),
  },
  { key: 'SENTRY_DSN', required: true, description: 'Sentry ingestion DSN' },
  {
    key: 'SECRET_CIPHER_KEY',
    required: true,
    description: '32 bytes hex (or use KMS_KEY_ARN)',
    validate: (v) => {
      if (process.env.KMS_KEY_ARN && !v) return undefined; // KMS path
      if (v.length < 32) return 'too short; need ≥32 bytes';
      return undefined;
    },
  },
  { key: 'TRUST_PROXY_CIDRS', required: false, description: 'Railway / LB ingress CIDR' },
  {
    key: 'FELO_LAUNCH_READY',
    required: true,
    description: '"1" once OPS_CONFIG.md is fully provisioned',
  },
];

let hardFails = 0;
let launchGateBlocked = false;
const lines: string[] = [];

for (const c of checks) {
  const v = process.env[c.key] ?? '';
  if (!v) {
    if (c.required) {
      lines.push(`✗ ${c.key} — MISSING (${c.description})`);
      hardFails += 1;
    } else {
      lines.push(`· ${c.key} — not set (optional)`);
    }
    continue;
  }
  if (PLACEHOLDER.test(v)) {
    lines.push(`✗ ${c.key} — looks like a placeholder`);
    hardFails += 1;
    continue;
  }
  if (c.validate) {
    const err = c.validate(v);
    if (err) {
      lines.push(`✗ ${c.key} — ${err}`);
      hardFails += 1;
      continue;
    }
  }
  lines.push(`✓ ${c.key}`);
}

// FELO_LAUNCH_READY is checked separately so we can still be useful as
// "everything is set but gate is intentionally off" feedback.
if (process.env.FELO_LAUNCH_READY !== '1') {
  launchGateBlocked = true;
}

console.log(lines.join('\n'));
console.log('');

if (hardFails > 0) {
  console.error(`✗ ${hardFails} required variable(s) missing or malformed.`);
  console.error('  See OPS_CONFIG.md for the source of each value.');
  process.exit(1);
}
if (launchGateBlocked) {
  console.warn('⚠ FELO_LAUNCH_READY != 1 — boot will fail closed. Flip when ready.');
  process.exit(2);
}
console.log('✅ Production env config OK.');
process.exit(0);
