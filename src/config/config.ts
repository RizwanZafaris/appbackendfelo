/**
 * App configuration loader. Reads env, validates required fields at startup,
 * exposes typed accessors via NestJS ConfigService.
 *
 * Path A: Supabase Auth — no Firebase, no JWT minting on the backend.
 * The backend only verifies Supabase-issued JWTs against the project's
 * public JWKS.
 *
 * Strict guardrails:
 *   - Production boot fails closed if any launch-critical env is missing.
 *   - Production boot fails closed if FELO_LAUNCH_READY!=1.
 *   - Production rejects DATABASE_URL on Supabase pooler port 6543, since
 *     RLS session-local app.user_id requires the session pool (5432).
 *   - Production rejects placeholder values that match obvious patterns.
 */

const PLACEHOLDER_PATTERNS = [
  /<.*>/,
  /YOUR[_-]?[A-Z_]+/i,
  /REPLACE[_-]?WITH/i,
  /^changeme$/i,
  /^stub$/i,
];

const isPlaceholder = (v: string): boolean =>
  !!v && PLACEHOLDER_PATTERNS.some((p) => p.test(v));

export const configFactory = () => {
  const cfg = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: parseInt(process.env.PORT ?? '3000', 10),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    API_PREFIX: process.env.API_PREFIX ?? 'v1',

    DATABASE_URL: process.env.DATABASE_URL ?? '',

    SUPABASE_URL: process.env.SUPABASE_URL ?? '',
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? '',
    SUPABASE_JWKS_URL: process.env.SUPABASE_JWKS_URL ?? '',
    SUPABASE_LEGACY_JWT_SECRET: process.env.SUPABASE_LEGACY_JWT_SECRET ?? '',

    CORS_ORIGINS: process.env.CORS_ORIGINS ?? '',
    TRUST_PROXY_CIDRS: process.env.TRUST_PROXY_CIDRS ?? '',

    SENTRY_DSN: process.env.SENTRY_DSN ?? '',
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY ?? '',
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',

    SECRET_CIPHER_KEY: process.env.SECRET_CIPHER_KEY ?? '',
    KMS_KEY_ARN: process.env.KMS_KEY_ARN ?? '',

    SANCTIONS_PROVIDER: process.env.SANCTIONS_PROVIDER ?? 'stub',
    SANCTIONS_API_KEY: process.env.SANCTIONS_API_KEY ?? '',
    SANCTIONS_API_URL: process.env.SANCTIONS_API_URL ?? '',

    KYC_PROVIDER: process.env.KYC_PROVIDER ?? 'stub',
    KYC_API_KEY: process.env.KYC_API_KEY ?? '',

    SMS_PROVIDER: process.env.SMS_PROVIDER ?? 'stub',

    FCM_SERVER_KEY: process.env.FCM_SERVER_KEY ?? '',

    FELO_LAUNCH_READY: process.env.FELO_LAUNCH_READY ?? '0',
  };

  if (cfg.NODE_ENV === 'production') {
    const required: Array<keyof typeof cfg> = [
      'DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_SECRET_KEY',
      'SUPABASE_JWKS_URL',
      'SENTRY_DSN',
      'SECRET_CIPHER_KEY',
      'CORS_ORIGINS',
    ];
    const missing = required.filter((k) => !cfg[k]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required env vars in production: ${missing.join(', ')}.\n` +
          `See OPS_CONFIG.md for the source of each value.`,
      );
    }

    const placeholders = required.filter((k) => isPlaceholder(String(cfg[k])));
    if (placeholders.length > 0) {
      throw new Error(
        `Placeholder values detected in production env: ${placeholders.join(', ')}.\n` +
          `Replace with real values from the secret store before launch.`,
      );
    }

    // Pooler-port check: 6543 (transaction pool) breaks RLS session GUC.
    if (/:6543\//.test(cfg.DATABASE_URL)) {
      throw new Error(
        'DATABASE_URL uses Supabase transaction-pool port 6543, which breaks ' +
          'RLS session-local app.user_id. Use the session pool (port 5432).',
      );
    }

    // CORS sanity — never allow wildcard.
    if (cfg.CORS_ORIGINS.includes('*')) {
      throw new Error('CORS_ORIGINS must not contain a wildcard in production.');
    }

    // Master launch gate — must be flipped explicitly by deployer once
    // OPS_CONFIG.md checklist is done.
    if (cfg.FELO_LAUNCH_READY !== '1') {
      throw new Error(
        'FELO_LAUNCH_READY != 1 — refusing to boot in production.\n' +
          'Set FELO_LAUNCH_READY=1 only after OPS_CONFIG.md is fully populated and signed off.',
      );
    }
  }

  return cfg;
};

export type AppConfig = ReturnType<typeof configFactory>;
