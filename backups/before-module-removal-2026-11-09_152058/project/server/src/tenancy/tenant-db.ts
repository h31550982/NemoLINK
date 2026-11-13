/**
 * Tenant-scoped DB plumbing (docs/specs/0010) — the ONLY sanctioned way
 * feature code touches tenant data (invariant 1). withOrg pins the
 * transaction's search_path to the org's schema with SET LOCAL: platform
 * tables are off the path, the setting dies with the transaction, and the
 * pooled connection goes back clean. Feature repositories build on this;
 * they never construct schema names or touch the pool directly.
 */

import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { validateSlug } from './template';

@Injectable()
export class TenantDb {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Resolves an active org's schema name; throws before any tenant SQL runs. */
  async schemaFor(slug: string): Promise<string> {
    validateSlug(slug);
    const result = await this.pool.query(
      `SELECT schema_name FROM platform.organization
       WHERE slug = $1 AND is_active`,
      [slug],
    );
    const schema: string | undefined = result.rows[0]?.schema_name;
    if (!schema) {
      throw new Error(`Unknown or inactive org '${slug}'`);
    }
    return schema;
  }

  /** Active orgs with their schemas — for platform-level reads that span tenants (spec 0068). */
  async activeOrgs(): Promise<{ slug: string; schema: string }[]> {
    const result = await this.pool.query(
      `SELECT slug, schema_name FROM platform.organization WHERE is_active ORDER BY slug`,
    );
    return result.rows.map((r) => ({ slug: r.slug as string, schema: r.schema_name as string }));
  }

  /**
   * Runs fn inside a transaction on the platform tables (search_path
   * untouched, so every table name is qualified). For platform-admin work
   * on shared data (the master list, spec 0068) — never a way around withOrg
   * for tenant data.
   */
  async platform<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Runs fn inside a transaction scoped to the org's schema. Commit on
   * return, rollback on throw. fn's queries use unqualified table names.
   */
  async withOrg<T>(slug: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const schema = await this.schemaFor(slug);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // schema_name comes from our own provisioning insert (validated slug),
      // never from user input — safe in identifier position
      await client.query(`SET LOCAL search_path = ${schema}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
