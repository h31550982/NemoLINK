import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { requestForensicsMiddleware } from './audit/request-context';
import { runMigrationsOnBoot } from './db/migrations';

async function bootstrap(): Promise<void> {
  // Before anything is constructed, let alone served: a rebuilt container does
  // NOT re-run schema.sql (Postgres only reads initdb.d on an empty volume), so
  // without this a new image can start against an old schema and fail at the
  // first query touching a column that was never added (spec 0058).
  await runMigrationsOnBoot();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api/v1');
  // The container sees nginx through the docker bridge (a private hop), so
  // trust private ranges and let req.ip resolve the first public address in
  // X-Forwarded-For — spoofed client-sent entries are ignored (spec 0033).
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  // Every request runs in a forensics scope; AuditService stamps
  // request {ip, userAgent} onto events written while handling it.
  app.use(requestForensicsMiddleware);
  // AWS SNS posts its JSON with Content-Type text/plain — the default json
  // parser skips those, so this route also accepts a raw text body
  app.use('/api/v1/email-events/ses', express.text({ type: '*/*', limit: '1mb' }));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`nemolink-server listening on :${port} (prefix /api/v1)`);
}

void bootstrap().catch((error: unknown) => {
  // Serving on a schema we know is wrong is how half-written data happens, so
  // a migration failure crash-loops the container instead — visible, and
  // compose's restart policy retries the transient case on its own.
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
