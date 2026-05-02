import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
  productionRequired: string[];
}

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const PRODUCTION_REQUIRED = [
  'ADMIN_JWT_SECRET',
  'ADMIN_REFRESH_SECRET',
  'ENCRYPTION_KEY',
  'RATE_LIMIT_SECRET',
];

const OPTIONAL_BUT_RECOMMENDED = [
  'SENTRY_DSN',
  'REDIS_URL',
  'KIMI_API_KEY',
  'SUMSUB_API_KEY',
];

export function validateEnvironment(configService: ConfigService): EnvValidationResult {
  const logger = new Logger('EnvValidation');
  const missing: string[] = [];
  const warnings: string[] = [];
  const isProd = configService.get<string>('NODE_ENV') === 'production';

  for (const key of REQUIRED_ENV_VARS) {
    if (!configService.get<string>(key)) {
      missing.push(key);
    }
  }

  if (isProd) {
    for (const key of PRODUCTION_REQUIRED) {
      if (!configService.get<string>(key)) {
        missing.push(`${key} (production required)`);
      }
    }
  } else {
    for (const key of PRODUCTION_REQUIRED) {
      if (!configService.get<string>(key)) {
        warnings.push(`${key} not set — using generated fallback (NOT SAFE FOR PROD)`);
      }
    }
  }

  for (const key of OPTIONAL_BUT_RECOMMENDED) {
    if (!configService.get<string>(key)) {
      warnings.push(`${key} not set — some features will be unavailable`);
    }
  }

  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      logger.warn(warning);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
    productionRequired: isProd ? PRODUCTION_REQUIRED : [],
  };
}
