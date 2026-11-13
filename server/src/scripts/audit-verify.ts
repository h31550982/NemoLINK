/**
 * Audit chain verification (docs/specs/0007) — walks a schema's audit_event
 * chain in seq order, recomputes every hash, checks linkage:
 *
 *   node dist/scripts/audit-verify.js [schema]     (default: platform)
 *
 * Exits 0 on an intact chain, 1 on the first break (tamper or fork).
 */

import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { computeEventHash } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';

const SCHEMA_RE = /^[a-z][a-z0-9_]*$/;

async function main(): Promise<void> {
  const schema = process.argv[2] ?? 'platform';
  if (!SCHEMA_RE.test(schema)) {
    console.error(`invalid schema name`);
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const pool = app.get<Pool>(PG_POOL);
    const { rows } = await pool.query(
      `SELECT seq, category, actor_id, entity_type, entity_id, data,
              prev_hash, event_hash, created
         FROM ${schema}.audit_event ORDER BY seq ASC`,
    );

    let prevHash: string | null = null;
    for (const row of rows) {
      if (row.prev_hash !== prevHash) {
        console.error(
          `BROKEN at seq ${row.seq}: prev_hash does not match the previous event (fork or deletion)`,
        );
        process.exit(1);
      }
      const expected = computeEventHash({
        prevHash,
        category: row.category,
        actorId: row.actor_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        data: row.data,
        createdIso: (row.created as Date).toISOString(),
      });
      if (row.event_hash !== expected) {
        console.error(`BROKEN at seq ${row.seq}: event_hash mismatch (row content altered)`);
        process.exit(1);
      }
      prevHash = row.event_hash;
    }
    console.log(`audit chain OK: ${rows.length} event(s) in ${schema}.audit_event`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
