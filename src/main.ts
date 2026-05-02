import * as bodyParser from 'body-parser';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

async function bootstrap() {
  // Sentry must be initialised before NestFactory so it captures bootstrap
  // errors. Skipped if SENTRY_DSN is empty (dev/test).
  if (process.env.SENTRY_DSN) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/node');
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV ?? 'development',
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
        release: process.env.GIT_SHA ?? 'unknown',
      });
    } catch {
      // @sentry/node not installed in this build — skip silently.
    }
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const isProd = config.get<string>('NODE_ENV') === 'production';

  app.useLogger(app.get(Logger));

  // ─── Hardening (security headers + body size cap) ──────────────────
  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
              upgradeInsecureRequests: [],
              formAction: ["'self'"],
              baseUri: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      hsts: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    }),
  );

  const expressApp = app.getHttpAdapter().getInstance();
  const apiPrefix = config.get<string>('API_PREFIX', 'v1');

  // Webhook routes need RAW bytes for HMAC verification — RemittanceWebhookGuard
  // reads (req as any).rawBody. Mount the raw parser ONLY on the webhook path
  // so every other route still receives parsed JSON.
  const webhookPath = `/${apiPrefix}/remittance/webhook`;
  expressApp.use(
    webhookPath,
    bodyParser.raw({
      type: '*/*',
      limit: '256kb',
      verify: (req: { rawBody?: Buffer }, _res: unknown, buf: Buffer) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );
  expressApp.use(bodyParser.json({ limit: '1mb' }));
  expressApp.use(bodyParser.urlencoded({ limit: '1mb', extended: true }));

  // Trust proxy: in prod use TRUST_PROXY_CIDRS allowlist if set, else
  // loopback only. Never trust arbitrary proxies — X-Forwarded-For
  // spoofing bypasses IP-based rate limits and audit IPs.
  if (isProd) {
    const cidrs = (config.get<string>('TRUST_PROXY_CIDRS') ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    expressApp.set('trust proxy', cidrs.length > 0 ? cidrs : ['loopback']);
  } else {
    expressApp.set('trust proxy', false);
  }

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // GlobalExceptionFilter is registered as APP_FILTER in app.module.ts so
  // DI works; no need to register it here.

  // CORS — only enable for whitelisted origins. In prod, never enable
  // when CORS_ORIGINS is empty (configFactory enforces this).
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '').split(',').filter(Boolean);
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
      maxAge: 600,
    });
  } else if (!isProd) {
    app.enableCors({ origin: true, credentials: true });
  }

  // OpenAPI — never mount in production.
  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Felo API')
      .setDescription('Felo backend')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: '/openapi.json' });
  }

  // Graceful shutdown for SIGTERM (Kubernetes/Fly).
  app.enableShutdownHooks();

  const port = Number(config.get<string>('PORT', '3000'));
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`Felo API listening on :${port}/${apiPrefix}${isProd ? '' : ' — docs at /docs'}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Bootstrap failed', err);
  process.exit(1);
});
