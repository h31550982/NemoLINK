/**
 * Ingest-credential CLI (docs/specs/0026, flag from 0060) — dev PC or
 * docker exec on host:
 *
 *   node dist/scripts/ingest-credential.js create <org-slug> <source-system> [label] [--may-create-ships]
 *   node dist/scripts/ingest-credential.js list
 *   node dist/scripts/ingest-credential.js revoke <credential-id>
 *   node dist/scripts/ingest-credential.js may-create-ships <credential-id> on|off
 *
 * create prints the bearer token ONCE — only its sha256 is stored. create,
 * revoke and the flag change all land on the platform audit chain.
 *
 * may-create-ships: a `ship` envelope for an IMO the org does not know
 * creates the ship instead of answering 422 unknown_ship (spec 0060). Plan
 * and log-event envelopes never create one. Default off.
 */

import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { IngestCredentialService } from '../ingest/ingest-credential.service';

const ACTOR = 'ingest-credential-cli';
const MAY_CREATE_FLAG = '--may-create-ships';

function usage(): never {
  console.error(
    `usage: ingest-credential.js create <org-slug> <source-system> [label] [${MAY_CREATE_FLAG}]\n` +
      '       ingest-credential.js list\n' +
      '       ingest-credential.js revoke <credential-id>\n' +
      '       ingest-credential.js may-create-ships <credential-id> on|off',
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !['create', 'list', 'revoke', 'may-create-ships'].includes(command)) {
    usage();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const pool = app.get<Pool>(PG_POOL);
    const audit = app.get(AuditService);

    if (command === 'list') {
      const rows = await pool.query(
        `SELECT ic.id, o.slug AS org, ic.source_system, ic.label, ic.may_create_ships,
                ic.last_used, ic.created, ic.is_active
           FROM platform.ingest_credential ic
           JOIN platform.organization o ON o.id = ic.org_id
          ORDER BY o.slug, ic.source_system, ic.created`,
      );
      console.log(JSON.stringify(rows.rows, null, 2));
      return;
    }

    if (command === 'revoke') {
      const [id] = args;
      if (!id) usage();
      const updated = await pool.query(
        `UPDATE platform.ingest_credential
            SET is_active = false, updated = now()
          WHERE id = $1 AND is_active
          RETURNING id, source_system`,
        [id],
      );
      if (!updated.rows[0]) {
        console.error('no active credential with that id');
        process.exit(1);
      }
      await audit.content({
        actorId: ACTOR,
        entityType: 'ingest_credential',
        entityId: id,
        data: { action: 'revoked', sourceSystem: updated.rows[0].source_system },
      });
      console.log(JSON.stringify({ revoked: id }));
      return;
    }

    if (command === 'may-create-ships') {
      const [id, value] = args;
      if (!id || !['on', 'off'].includes(value ?? '')) usage();
      const mayCreateShips = value === 'on';
      const updated = await pool.query(
        `UPDATE platform.ingest_credential
            SET may_create_ships = $2, updated = now()
          WHERE id = $1 AND is_active
          RETURNING id, source_system`,
        [id, mayCreateShips],
      );
      if (!updated.rows[0]) {
        console.error('no active credential with that id');
        process.exit(1);
      }
      await audit.content({
        actorId: ACTOR,
        entityType: 'ingest_credential',
        entityId: id,
        data: {
          action: 'may_create_ships',
          sourceSystem: updated.rows[0].source_system,
          mayCreateShips,
        },
      });
      console.log(JSON.stringify({ credentialId: id, mayCreateShips }));
      return;
    }

    const mayCreateShips = args.includes(MAY_CREATE_FLAG);
    const [orgSlug, sourceSystem, label] = args.filter((a) => a !== MAY_CREATE_FLAG);
    if (!orgSlug || !sourceSystem || !/^[a-z][a-z0-9_-]*$/.test(sourceSystem)) usage();
    const org = await pool.query(
      `SELECT id FROM platform.organization WHERE slug = $1 AND is_active`,
      [orgSlug],
    );
    if (!org.rows[0]) {
      console.error(`unknown org '${orgSlug}'`);
      process.exit(1);
    }
    const token = `nlki_${randomBytes(24).toString('hex')}`;
    const inserted = await pool.query(
      `INSERT INTO platform.ingest_credential
         (org_id, source_system, label, token_hash, author, may_create_ships)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        org.rows[0].id,
        sourceSystem,
        label ?? null,
        IngestCredentialService.hashToken(token),
        ACTOR,
        mayCreateShips,
      ],
    );
    const id: string = inserted.rows[0].id;
    await audit.content({
      actorId: ACTOR,
      entityType: 'ingest_credential',
      entityId: id,
      data: {
        action: 'created',
        org: orgSlug,
        sourceSystem,
        label: label ?? null,
        mayCreateShips,
      },
    });
    console.log(
      JSON.stringify(
        {
          credentialId: id,
          org: orgSlug,
          sourceSystem,
          mayCreateShips,
          token,
          note: 'Store this token now — it is shown only once and never kept.',
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
