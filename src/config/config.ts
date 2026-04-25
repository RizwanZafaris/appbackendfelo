/**
 * App configuration loader. Reads env, validates required fields at startup,
 * exposes typed accessors via NestJS ConfigService.
 *
 * Path A: Supabase Auth — no Firebase, no JWT minting on the backend.
 * The backend only verifies Supabase-issued JWTs against the project's
 * public JWKS.
 */

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
  };

  if (cfg.NODE_ENV === 'production') {
    const required: Array<keyof typeof cfg> = [
      'DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_SECRET_KEY',
      'SUPABASE_JWKS_URL',
    ];
    const missing = required.filter((k) => !cfg[k]);
    if (missing.length > 0) {
      throw new Error(`Missing required env vars in production: ${missing.join(', ')}`);
    }
  }

  return cfg;
};

export type AppConfig = ReturnType<typeof configFactory>;
