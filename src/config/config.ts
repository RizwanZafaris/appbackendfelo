/**
 * App configuration loader. Reads env, validates required fields at startup,
 * exposes typed accessors via NestJS ConfigService.
 */

export const configFactory = () => {
  const cfg = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: parseInt(process.env.PORT ?? '3000', 10),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    API_PREFIX: process.env.API_PREFIX ?? 'v1',
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    JWT_SECRET: process.env.JWT_SECRET ?? '',
    JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL ?? '15m',
    JWT_REFRESH_TTL: process.env.JWT_REFRESH_TTL ?? '30d',
    CORS_ORIGINS: process.env.CORS_ORIGINS ?? '',
    FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? '',
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  };

  // Hard-fail fast in production if critical secrets are missing.
  if (cfg.NODE_ENV === 'production') {
    const required: Array<keyof typeof cfg> = ['DATABASE_URL', 'JWT_SECRET'];
    const missing = required.filter((k) => !cfg[k]);
    if (missing.length > 0) {
      throw new Error(`Missing required env vars in production: ${missing.join(', ')}`);
    }
  }

  return cfg;
};

// ConfigModule.forRoot accepts a Joi schema, but we run a manual validation
// inside configFactory above to avoid the heavy Joi dependency.
export const configValidationSchema = undefined;

export type AppConfig = ReturnType<typeof configFactory>;
