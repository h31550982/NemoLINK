// Standard migration apply path (docs/specs/0022): replays ALL migrations in
// filename order — every migration is idempotent (invariant 6), so replay-all
// converges any environment without a bookkeeping table — then verifies that
// every tenant schema still matches org_template.
//
//   node tools/db/run-migrations.js                 (DATABASE_URL from server/.env)
//   PGURL=postgres://... node tools/db/run-migrations.js
//
// Dev stage: the AI runs this against the shared dev DB as part of any spec
// that ships a migration (user decision 2026-08-23, docs/02). The manual
// owner-role run returns with the PRD least-privilege role split.
'use strict';
const fs = require('fs');
const path = require('path');
let pg;
try {
  pg = require('pg');
} catch {
  pg = require(path.resolve(__dirname, '..', '..', 'server', 'node_modules', 'pg'));
}
const { Client } = pg;
const { diffAgainstTemplate, reportDrift } = require('./tenant-parity');

const NEMOLINK = path.resolve(__dirname, '..', '..');

function connectionUrl() {
  if (process.env.PGURL) return process.env.PGURL;
  const envFile = path.join(NEMOLINK, 'server', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0 && line.slice(0, i).trim() === 'DATABASE_URL') return line.slice(i + 1).trim();
    }
  }
  console.error('Set PGURL or provide server/.env with DATABASE_URL');
  process.exit(2);
}

async function main() {
  const dir = path.join(NEMOLINK, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error('no migrations found');

  const client = new Client({ connectionString: connectionUrl() });
  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`applied  ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`FAILED   ${file}: ${e.message}`);
        process.exit(1);
      }
    }
    const { targets, drifted } = await diffAgainstTemplate(client);
    if (drifted.length) {
      reportDrift(drifted);
      console.error('MIGRATIONS APPLIED BUT TENANTS DRIFTED — fix before shipping');
      process.exit(1);
    }
    console.log(
      `MIGRATIONS OK: ${files.length} file(s) replayed; ${targets.length} tenant schema(s) match org_template`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('RUN FAILED:', e.message);
  process.exit(1);
});
