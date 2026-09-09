import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import express, { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import type { EnvConfig } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: { origin: true, credentials: true } });
  const config = app.get(ConfigService<EnvConfig, true>);

  // Air-gapped LAN server behind Caddy TLS termination (design doc §2.8)
  // — helmet still matters for the handful of headers Caddy doesn't set,
  // and as defence-in-depth if Caddy is ever bypassed on the LAN.
  app.use(helmet());
  // Express's own default JSON body limit is 100kb — Phase 3's word-list
  // paste and bulk item-bank imports go over plain JSON (uploads go
  // through multer instead, which isn't bounded by this), and that
  // default would 413 on anything but a handful of items.
  const jsonLimit = `${config.get('MAX_JSON_BODY_KB', { infer: true })}kb`;
  app.use(json({ limit: jsonLimit }));
  app.use(urlencoded({ extended: true, limit: jsonLimit }));
  app.setGlobalPrefix('api');

  // Phase 5 finding: WEB_DIST_PATH has been declared in env.validation.ts
  // since Phase 0 but nothing ever actually served it — dev mode's
  // separate Vite dev server (proxying /api to this port) masked the gap
  // completely, so a "production" boot of this server alone never served
  // the SPA at all. `express.static` middleware sits outside
  // setGlobalPrefix('api') (that only wraps Nest-routed controllers), so
  // the two can't collide. No SPA-fallback rewrite is needed:
  // apps/web's router is createHashRouter (design doc §1.4, ProtectedRoute's
  // own comment) — every route after the very first request lives in the
  // URL fragment, which the browser never sends to the server at all.
  app.use(express.static(path.resolve(config.get('WEB_DIST_PATH', { infer: true }))));
  // electron-updater's generic provider (electron-builder.yml's `publish`
  // block: url ".../updates/win/") polls exactly this path shape for
  // latest.yml + the installer. The mount path itself supplies the
  // "/win" URL segment — `latest.yml` and the installer .exe from
  // `electron-builder --win`'s release/ output go DIRECTLY into
  // UPDATES_DIR, not into a "win" subfolder underneath it (verified live
  // this pass: a file at UPDATES_DIR/win/x was unreachable at
  // /updates/win/x — only UPDATES_DIR/x is, since express.static strips
  // the mount prefix before resolving against the static root).
  app.use('/updates/win', express.static(path.resolve(config.get('UPDATES_DIR', { infer: true }))));

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
