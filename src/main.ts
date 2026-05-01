import * as bodyParser from 'body-parser';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
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
              imgSrc: ["'self'", 'data:', 'https:'],
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

  // Body-size cap — block large payload DoS. File-upload endpoints use
  // multer per-controller and override this.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(bodyParser.json({ limit: '1mb' }));
  expressApp.use(bodyParser.urlencoded({ limit: '1mb', extended: true }));

  // Trust proxy — only trust loopback in production. Never trust arbitrary
  // proxies without an explicit whitelist, as X-Forwarded-For spoofing
  // can bypass IP-based rate limits.
  if (isProd) {
    expressApp.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
  } else {
    expressApp.set('trust proxy', false);
  }

  const apiPrefix = config.get<string>('API_PREFIX', 'v1');
  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  // CORS — only enable for whitelisted origins. In prod, never enable
  // when CORS_ORIGINS is empty.
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

  // OpenAPI — only mount in non-prod.
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
