// Tenant schema parity (docs/specs/0022): every org_* schema must structurally
// match org_template — columns, constraints, indexes (schema-name-normalized).
// Library used by tools/db/run-migrations.js and tools/ci/schema-sync-check.js,
// plus a CLI:
//
//   PGURL=postgres://... node tenant-parity.js        (or DATABASE_URL from
//   server/.env when PGURL is unset)
//
// Exit 0 = all tenants match the template; 1 = drift (lines printed).
'use strict';
const fs = require('fs');
const path = require('path');
// tools/db has no node_modules of its own — fall back to the server's pg
// (always installed) so this works from any caller (CLI, run-migrations, CI).
let pg;
try {
  pg = require('pg');
} catch {
  pg = require(path.resolve(__dirname, '..', '..', 'server', 'node_modules', 'pg'));
}
const { Client } = pg;

/** Normalized structural fingerprint of one schema ("<S>" = the schema name). */
async function fingerprintSchema(client, schema) {
  const norm = (line) => line.split(schema).join('<S>');
  const lines = [];
  const push = (rows, tag) => {
    for (const r of rows) lines.push(norm(`${tag}\t${Object.values(r).join('\t')}`));
  };
  push(
    (
      await client.query(
        `SELECT table_name, column_name, data_type,
                coalesce(character_maximum_length::text, ''), is_nullable,
                coalesce(column_default, '')
           FROM information_schema.columns
          WHERE table_schema = $1
          ORDER BY table_name, column_name`,
        [schema],
      )
    ).rows,
    'column',
  );
  push(
    (
      await client.query(
        `SELECT t.relname, con.conname, pg_get_constraintdef(con.oid)
           FROM pg_constraint con
           JOIN pg_class t ON t.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1
          ORDER BY 1, 2`,
        [schema],
      )
    ).rows,
    'constraint',
  );
  push(
    (
      await client.query(
        `SELECT tablename, indexname, indexdef
           FROM pg_indexes
          WHERE schemaname = $1
          ORDER BY 1, 2`,
        [schema],
      )
    ).rows,
    'index',
  );
  return lines;
}

/**
 * Diffs every org_* schema (or the given list) against org_template.
 * Returns [{schema, onlySchema, onlyTemplate}] — empty array = full parity.
 */
async function diffAgainstTemplate(client, schemas = null) {
  const targets =
    schemas ??
    (
      await client.query(
        `SELECT nspname FROM pg_namespace
          WHERE nspname LIKE 'org\\_%' AND nspname <> 'org_template'
          ORDER BY nspname`,
      )
    ).rows.map((r) => r.nspname);
  const template = await fingerprintSchema(client, 'org_template');
  const templateSet = new Set(template);
  const drifted = [];
  for (const schema of targets) {
    const got = await fingerprintSchema(client, schema);
    const gotSet = new Set(got);
    const onlySchema = got.filter((l) => !templateSet.has(l));
    const onlyTemplate = template.filter((l) => !gotSet.has(l));
    if (onlySchema.length || onlyTemplate.length) {
      drifted.push({ schema, onlySchema, onlyTemplate });
    }
  }
  return { targets, drifted, templateFacts: template.length };
}

function reportDrift(drifted) {
  for (const d of drifted) {
    console.error(`TENANT DRIFT: ${d.schema} does not match org_template`);
    for (const l of d.onlyTemplate.slice(0, 15)) console.error(`  missing in ${d.schema}: ${l}`);
    for (const l of d.onlySchema.slice(0, 15)) console.error(`  extra in ${d.schema}:   ${l}`);
  }
}

function connectionUrl() {
  if (process.env.PGURL) return process.env.PGURL;
  const envFile = path.resolve(__dirname, '..', '..', 'server', '.env');
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
  const client = new Client({ connectionString: connectionUrl() });
  await client.connect();
  try {
    const { targets, drifted, templateFacts } = await diffAgainstTemplate(client);
    if (drifted.length) {
      reportDrift(drifted);
      process.exit(1);
    }
    console.log(
      `TENANT PARITY OK: ${targets.length} tenant schema(s) match org_template (${templateFacts} structural facts): ${targets.join(', ') || '(none)'}`,
    );
  } finally {
    await client.end();
  }
}

module.exports = { fingerprintSchema, diffAgainstTemplate, reportDrift };

if (require.main === module) {
  main().catch((e) => {
    console.error('PARITY CHECK FAILED:', e.message);
    process.exit(1);
  });
}
