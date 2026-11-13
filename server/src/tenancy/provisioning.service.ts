/**
 * Tenant provisioning automation (docs/specs/0010): org row + org_<slug>
 * schema from schema.sql's template section + verification + audit — all in
 * ONE transaction, so a failure at any step leaves nothing behind.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { loadTemplateDdl, validateSlug } from './template';

export interface ProvisionInput {
  slug: string;
  name: string;
  businessId?: string;
  eori?: string;
  author?: string;
}

export interface ProvisionResult {
  orgId: string;
  schema: string;
  tableCount: number;
}

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private schemaSqlPath(): string {
    const configured = this.config.get<string>('SCHEMA_SQL_PATH');
    return configured ? configured : '../schema.sql';
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    validateSlug(input.slug);
    const schema = `org_${input.slug}`;
    // Read + extract before touching the DB — a bad file aborts cleanly
    const templateDdl = loadTemplateDdl(this.schemaSqlPath());

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const inserted = await client.query(
        `INSERT INTO platform.organization
           (slug, name, business_id, eori, schema_name, author)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          input.slug,
          input.name,
          input.businessId ?? null,
          input.eori ?? null,
          schema,
          input.author ?? 'provisioning',
        ],
      );
      const orgId: string = inserted.rows[0].id;

      // No IF NOT EXISTS: an existing schema without an org row is a broken
      // state to inspect by hand, never to paper over
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path = ${schema}`);
      await client.query(templateDdl);

      // Verify against org_template inside the same transaction
      // ::text casts matter: information_schema identifiers aggregate to
      // name[], which node-pg returns unparsed
      const parity = await client.query(
        `SELECT
           (SELECT array_agg(table_name::text ORDER BY table_name)
              FROM information_schema.tables
             WHERE table_schema = $1 AND table_type = 'BASE TABLE') AS created,
           (SELECT array_agg(table_name::text ORDER BY table_name)
              FROM information_schema.tables
             WHERE table_schema = 'org_template' AND table_type = 'BASE TABLE') AS template`,
        [schema],
      );
      const created: string[] = parity.rows[0].created ?? [];
      const template: string[] = parity.rows[0].template ?? [];
      if (created.length === 0 || created.join(',') !== template.join(',')) {
        throw new Error(
          `Provisioned schema mismatch vs org_template (got ${created.length}, want ${template.length} tables)`,
        );
      }

      // Same transaction (invariant 5): no audit, no tenant
      await this.audit.content(
        {
          actorId: input.author ?? 'provisioning',
          entityType: 'organization',
          entityId: orgId,
          data: {
            action: 'provisioned',
            slug: input.slug,
            schema,
            tableCount: created.length,
          },
        },
        client,
      );

      await client.query('COMMIT');
      this.logger.log(`provisioned org '${input.slug}' (${created.length} tables)`);
      return { orgId, schema, tableCount: created.length };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
