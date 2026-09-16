// Must be the very first import: populates process.env from .env before any
// other module (notably realtime.gateway.ts, whose @WebSocketGateway CORS
// config is evaluated at decorator/import time, before Nest's own
// ConfigModule has a chance to run) reads env vars.
import 'dotenv/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * Refuse to start rather than run in a broken/insecure state — per security
 * checklist §3.1 — if any secret the app cannot function safely without is
 * missing. (SMTP/SMS/S3 vars are deliberately excluded: those degrade
 * gracefully — OTP delivery logs a stub, uploads fail per-request — rather
 * than blocking the whole app from booting in local dev.)
 */
function assertRequiredEnvVars() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'RECAPTCHA_SECRET_KEY'];
  const missing = required.filter((key) => !process.env[key] || process.env[key]!.includes('REPLACE_ME'));
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `❌ Refusing to start — missing/placeholder required env var(s): ${missing.join(', ')}. Check your .env file.`,
    );
    process.exit(1);
  }

  // Google's public test secret accepts ANY token, which would silently
  // disable captcha entirely. Fine for local dev, never in production.
  const RECAPTCHA_TEST_SECRET = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.RECAPTCHA_SECRET_KEY === RECAPTCHA_TEST_SECRET
  ) {
    // eslint-disable-next-line no-console
    console.error('❌ Refusing to start — the reCAPTCHA test key must not be used in production.');
    process.exit(1);
  }
}

async function bootstrap() {
  assertRequiredEnvVars();

  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  // No wildcard default: '*' combined with credentials: true is an invalid
  // combination browsers reject anyway, but relying on that is fragile — fail
  // closed (deny all cross-origin) instead if CORS_ORIGINS isn't set, rather
  // than silently opening up to every origin on a misconfigured deployment.
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : [];
  if (corsOrigins.length === 0) {
    Logger.warn(
      'CORS_ORIGINS is not set — cross-origin requests (e.g. from the web portal) will be rejected. The Android app is unaffected.',
      'Bootstrap',
    );
  }
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.setGlobalPrefix('api'); // -> e.g. /api/auth/login

    if (process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Rosal Safety OMS API')
      .setDescription('Backend contract for the Web Portal and Android App')
      .setVersion('1.1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 Rosal OMS backend running on http://localhost:${port}/api`);
}
bootstrap();




