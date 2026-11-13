/**
 * Claim an org's SSO email domains (docs/specs/0057) — the login page uses
 * these to point an SSO user at the SSO button instead of letting them fail
 * a local sign-in:
 *
 *   node dist/scripts/set-org-sso-domains.js <org-slug> acmeship.example [more.example ...]
 *
 * The list REPLACES whatever the org had; pass none to clear it.
 */

import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

async function main(): Promise<void> {
  const [slug, ...rest] = process.argv.slice(2);
  const domains = [...new Set(rest.map((d) => d.trim().toLowerCase()))];
  if (!slug || domains.some((d) => !DOMAIN.test(d))) {
    console.error(
      'usage: node dist/scripts/set-org-sso-domains.js <org-slug> [domain ...]',
    );
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
                || jsonb_build_object('ssoDomains', $2::jsonb),
              updated = now()
        WHERE slug = $1 AND is_active
        RETURNING id`,
      [slug, JSON.stringify(domains)],
    );
    if (result.rowCount === 0) {
      console.error(`unknown org '${slug}'`);
      process.exit(1);
    }
    await audit.content({
      actorId: 'set-org-sso-domains-cli',
      entityType: 'organization',
      entityId: result.rows[0].id,
      data: { action: 'sso_domains_set', slug, ssoDomains: domains },
    });
    console.log(JSON.stringify({ org: slug, ssoDomains: domains }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
