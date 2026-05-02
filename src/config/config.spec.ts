import { configFactory } from './config';

/**
 * Production launch-gate guards. Every developer should be able to read
 * these and predict what env config will fail-fast at boot.
 */
describe('configFactory production guardrails', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
  });

  const setProdBaseline = () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://u:p@db.example.supabase.co:5432/postgres';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_real';
    process.env.SUPABASE_JWKS_URL = 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
    process.env.SENTRY_DSN = 'https://xxx@sentry.io/1';
    process.env.SECRET_CIPHER_KEY = 'a'.repeat(64);
    process.env.CORS_ORIGINS = 'https://app.felo.com';
    process.env.FELO_LAUNCH_READY = '1';
  };

  it('boots with all required values set', () => {
    setProdBaseline();
    expect(() => configFactory()).not.toThrow();
  });

  it('fails when SENTRY_DSN missing', () => {
    setProdBaseline();
    delete process.env.SENTRY_DSN;
    expect(() => configFactory()).toThrow(/Missing required env/);
  });

  it('fails on Supabase pooler port 6543 (transaction mode breaks RLS GUC)', () => {
    setProdBaseline();
    process.env.DATABASE_URL = 'postgresql://u:p@db.example.supabase.co:6543/postgres';
    expect(() => configFactory()).toThrow(/transaction-pool port 6543/);
  });

  it('fails on placeholder values like <password>', () => {
    setProdBaseline();
    process.env.SUPABASE_SECRET_KEY = '<sb_secret_...>';
    expect(() => configFactory()).toThrow(/Placeholder values/);
  });

  it('fails on wildcard CORS_ORIGINS', () => {
    setProdBaseline();
    process.env.CORS_ORIGINS = '*';
    expect(() => configFactory()).toThrow(/CORS_ORIGINS must not contain a wildcard/);
  });

  it('refuses to boot when FELO_LAUNCH_READY!=1', () => {
    setProdBaseline();
    process.env.FELO_LAUNCH_READY = '0';
    expect(() => configFactory()).toThrow(/FELO_LAUNCH_READY/);
  });
});
