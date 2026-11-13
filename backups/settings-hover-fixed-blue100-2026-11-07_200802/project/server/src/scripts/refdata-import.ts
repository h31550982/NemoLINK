/**
 * Loads a saved NEMO reference-data response into the platform tables through
 * the normal sync path (docs/specs/0062 F10):
 *
 *   node dist/scripts/refdata-import.js hazmat <file.json>
 *
 * The file is the JSON array the service returned (hazmat: POST /hazmat with
 * an empty body). Same upsert, same sync_run row and audit event as a
 * scheduled run; `source` names the file. Exists because the dev PC reaches
 * STG only through a SOCKS tunnel Node cannot use and the host is not yet
 * whitelisted: the bridge until the sync can fetch for itself.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RefdataSyncService } from '../refdata/refdata-sync.service';

const ACTOR = 'refdata-import';

async function main(): Promise<void> {
  const [job, file] = process.argv.slice(2);
  if (job !== 'hazmat' || !file) {
    console.error('usage: node dist/scripts/refdata-import.js hazmat <file.json>');
    process.exit(2);
  }
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error(`${file}: expected a JSON array (the service response as saved)`);
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const sync = app.get(RefdataSyncService);
    const run = await sync.importHazmat(parsed, ACTOR, basename(file));
    console.log(
      `${run.job} ${run.status} run ${run.id}: ${JSON.stringify(run.stats)}` +
        (run.error ? ` error=${run.error}` : ''),
    );
    if (run.status !== 'ok') process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
