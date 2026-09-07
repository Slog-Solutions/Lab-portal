import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { EnvConfig } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: { origin: true, credentials: true } });
  const config = app.get(ConfigService<EnvConfig, true>);

  // Air-gapped LAN server behind Caddy TLS termination (design doc §2.8)
  // — helmet still matters for the handful of headers Caddy doesn't set,
  // and as defence-in-depth if Caddy is ever bypassed on the LAN.
  app.use(helmet());
  app.setGlobalPrefix('api');

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[lab-server] listening on 0.0.0.0:${port} (env=${config.get('NODE_ENV', { infer: true })})`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[lab-server] fatal bootstrap error:', err);
  process.exit(1);
});
