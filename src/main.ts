import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { assertProductionConfig, corsOrigins } from './common/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Fail fast if a production deploy still carries dev secrets / open CORS.
  assertProductionConfig(config);

  app.setGlobalPrefix('api');

  // Restrict CORS to configured origins (any origin in dev via CORS_ORIGIN=*).
  app.enableCors({ origin: corsOrigins(config), credentials: true });

  // Behind a reverse proxy, trust X-Forwarded-* so req.ip (used by the rate
  // limiter) reflects the real client, not the proxy.
  if ((config.get<string>('TRUST_PROXY') ?? '').toLowerCase() === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = config.get<string>('PORT') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`EchoSight API listening on http://localhost:${port}/api`);
}

bootstrap();
