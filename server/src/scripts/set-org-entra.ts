/**
 * Bind an org to its Entra tenant (docs/specs/0012) — unknown SSO users from
 * that tenant become pending users of the org:
 *
 *   node dist/scripts/set-org-entra.js <org-slug> <entra-tenant-id>
 */

import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';

async function main(): Promise<void> {
  const [slug, tenantId] = process.argv.slice(2);
  if (!slug || !tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    console.error('usage: node dist/scripts/set-org-entra.js <org-slug> <entra-tenant-id (guid)>');
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const pool = app.get<Pool>(PG_POOL);
    const audit = app.get(AuditService);
    const result = await pool.query(
      `UPDATE platform.organization
          SET auth_config = coalesce(auth_config, '{}'::jsonb)
                || jsonb_build_object('entraTenantId', $2::text),
              updated = now()
        WHERE slug = $1 AND is_active
        RETURNING id`,
      [slug, tenantId],
    );
    if (result.rowCount === 0) {
      console.error(`unknown org '${slug}'`);
      process.exit(1);
    }
    await audit.content({
      actorId: 'set-org-entra-cli',
      entityType: 'organization',
      entityId: result.rows[0].id,
      data: { action: 'entra_tenant_bound', slug, entraTenantId: tenantId },
    });
    console.log(JSON.stringify({ org: slug, entraTenantId: tenantId }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
