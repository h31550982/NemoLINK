/**
 * Audit backbone (docs/specs/0007): append-only, hash-chained audit_event
 * writes with one helper per category (invariant 5; docs/08 §Audit trail).
 *
 * v0 writes the platform chain; per-tenant chains activate when the tenancy
 * spec provides a schema context (the schema parameter exists now). Platform-
 * level DB plumbing — tenant-scoped repositories (invariant 1) do not apply.
 * Helpers log only category + entity refs, never data contents (invariant 3).
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import { canonicalJson } from './canonical-json';
import { currentRequestForensics } from './request-context';

export type AuditCategory = 'access' | 'content' | 'email';

export interface AuditEntry {
  actorId?: string;
  entityType: string;
  entityId?: string;
  data: Record<string, unknown>;
  /** Chain to write ('platform' until tenancy lands). */
  schema?: string;
}

/** Only schema names we generated ourselves ever reach SQL identifiers. */
const SCHEMA_RE = /^[a-z][a-z0-9_]*$/;

export function computeEventHash(input: {
  prevHash: string | null;
  category: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  data: unknown;
  createdIso: string;
}): string {
  const material = [
    input.prevHash ?? '',
    input.category,
    input.actorId ?? '',
    input.entityType ?? '',
    input.entityId ?? '',
    canonicalJson(input.data),
    input.createdIso,
  ].join('\n');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Content event — who changed what. Pass the caller's transaction client so
   * the event commits (or rolls back) atomically with the change itself
   * (invariant 5: no audit, no commit).
   */
  async content(entry: AuditEntry, client?: PoolClient): Promise<string> {
    return this.write('content', entry, client);
  }

  /** Access event — who viewed what. Own transaction, synchronous. */
  async access(entry: AuditEntry): Promise<string> {
    return this.write('access', entry);
  }

  /** Email event — outbound message lifecycle. Own transaction, synchronous. */
  async email(entry: AuditEntry): Promise<string> {
    return this.write('email', entry);
  }

  private async write(
    category: AuditCategory,
    entry: AuditEntry,
    client?: PoolClient,
  ): Promise<string> {
    const schema = entry.schema ?? 'platform';
    if (!SCHEMA_RE.test(schema)) {
      throw new Error(`Invalid audit schema name`);
    }
    if (client) {
      return this.insert(client, schema, category, entry);
    }
    const own = await this.pool.connect();
    try {
      await own.query('BEGIN');
      const id = await this.insert(own, schema, category, entry);
      await own.query('COMMIT');
      return id;
    } catch (error) {
      await own.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      own.release();
    }
  }

  private async insert(
    client: PoolClient,
    schema: string,
    category: AuditCategory,
    entry: AuditEntry,
  ): Promise<string> {
    // Request-scoped events carry forensics (docs/specs/0033): stamped
    // before hashing so the chain covers them; never overwrites a
    // caller-supplied request key; absent outside HTTP scope (worker, CLI).
    const forensics = currentRequestForensics();
    const data =
      forensics && !('request' in entry.data)
        ? { ...entry.data, request: forensics }
        : entry.data;
    // Serialize chain writers: the xact lock holds until this transaction
    // ends, so a concurrent writer can never read a head that later vanishes.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `audit:${schema}`,
    ]);
    const head = await client.query(
      `SELECT event_hash FROM ${schema}.audit_event ORDER BY seq DESC LIMIT 1`,
    );
    const prevHash: string | null = head.rows[0]?.event_hash ?? null;
    const createdIso = new Date().toISOString();
    const eventHash = computeEventHash({
      prevHash,
      category,
      actorId: entry.actorId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      data,
      createdIso,
    });
    const inserted = await client.query(
      `INSERT INTO ${schema}.audit_event
         (category, actor_id, entity_type, entity_id, data, prev_hash,
          event_hash, created)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz)
       RETURNING id`,
      [
        category,
        entry.actorId ?? null,
        entry.entityType,
        entry.entityId ?? null,
        JSON.stringify(data),
        prevHash,
        eventHash,
        createdIso,
      ],
    );
    this.logger.log(
      `audit ${category} ${entry.entityType}${entry.entityId ? `/${entry.entityId}` : ''}`,
    );
    return inserted.rows[0].id;
  }
}
