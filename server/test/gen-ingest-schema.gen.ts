/**
 * Regenerates docs/integration/ingest-envelope.schema.json from the builder
 * (docs/specs/0052). Run with `npm run gen:ingest-schema` — jest is only the
 * TypeScript runner here; the .gen.ts name keeps it outside the *.spec.ts
 * test match, so `npm test` never executes it. Refuses to write when the
 * content changed but INGEST_SCHEMA_VERSION did not (assertVersionBumped).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  assertVersionBumped,
  buildIngestEnvelopeJsonSchema,
  INGEST_SCHEMA_VERSION,
} from '../src/ingest/envelope-json-schema';

const ARTIFACT_PATH = join(
  __dirname,
  '..',
  '..',
  'docs',
  'integration',
  'ingest-envelope.schema.json',
);

test('regenerate the committed ingest schema artifact', () => {
  const built = buildIngestEnvelopeJsonSchema();
  if (existsSync(ARTIFACT_PATH)) {
    const committed = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as Record<
      string,
      unknown
    >;
    assertVersionBumped(committed, built);
  }
  mkdirSync(dirname(ARTIFACT_PATH), { recursive: true });
  writeFileSync(ARTIFACT_PATH, JSON.stringify(built, null, 2) + '\n');
  console.log(`wrote docs/integration/ingest-envelope.schema.json (v${INGEST_SCHEMA_VERSION})`);
});
