/**
 * Per-source ingest credentials (docs/specs/0026): one row per pushing
 * system per org, resolved by the sha256 of the presented bearer token —
 * the token itself is printed once at creation and never stored. Constant
 * time by construction: the lookup compares hashes in an indexed equality,
 * and a miss returns the same 401 whatever failed.
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/** Attached to the request by the 'ingest-key' authz policy. */
export interface IngestContext {
  credentialId: string;
  orgSlug: string;
  sourceSystem: string;
  label: string | null;
  /** A `ship` envelope for an unknown IMO may create the ship (spec 0060). */
  mayCreateShips: boolean;
}

@Injectable()
export class IngestCredentialService {
  private readonly logger = new Logger(IngestCredentialService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  /** Active credential of an active org, or null — never says which failed. */
  async resolve(token: string): Promise<IngestContext | null> {
    if (!token) return null;
    const result = await this.pool.query(
      `SELECT ic.id, ic.source_system, ic.label, ic.may_create_ships, o.slug
         FROM platform.ingest_credential ic
         JOIN platform.organization o ON o.id = ic.org_id AND o.is_active
        WHERE ic.token_hash = $1 AND ic.is_active`,
      [IngestCredentialService.hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    // Freshness marker for admin visibility — best effort, never blocks a push
    void this.pool
      .query(`UPDATE platform.ingest_credential SET last_used = now() WHERE id = $1`, [row.id])
      .catch((error) =>
        this.logger.warn(
          `last_used update failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    return {
      credentialId: row.id,
      orgSlug: row.slug,
      sourceSystem: row.source_system,
      label: row.label,
      mayCreateShips: row.may_create_ships === true,
    };
  }
}
