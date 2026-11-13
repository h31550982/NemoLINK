/**
 * Org-scoped audit log reads (docs/specs/0017). Three sources merged newest
 * first: the org's own chain (all of it is theirs), the platform chain
 * FILTERED to the org's entities — its user accounts, email messages
 * related to those users, the organization row itself, plus the
 * tenant-neutral refdata_sync events (spec 0025) — and, since spec 0067,
 * the platform chain's SHIP events: ships are shared by every organisation,
 * so every org sees that a ship changed, but names stay inside the org —
 * another org's event shows actor "Other organisation" and only its action
 * and field changes, and the search can only match what the mask shows.
 * Platform events of other orgs never leave the server. Cursor = created
 * timestamp.
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { SessionUser } from '../auth/session.service';
import { PG_POOL } from '../db/db.module';
import { TenantDb } from '../tenancy/tenant-db';

/** The words an org sees for another org's actor (spec 0067 §3). */
export const OTHER_ORG = 'Other organisation';

export interface AuditLogRow {
  chain: 'org' | 'platform';
  seq: number;
  category: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  action: string | null;
  data: Record<string, unknown>;
  created: string;
  /** Another org's ship event, reduced to what this org may see (spec 0067). */
  masked?: true;
}

interface DbRow {
  seq: string | number;
  category: string;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  data: Record<string, unknown>;
  created: Date;
}

function toRow(chain: 'org' | 'platform', r: DbRow): AuditLogRow {
  const action = r.data['action'];
  return {
    chain,
    seq: Number(r.seq),
    category: r.category,
    actorId: r.actor_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: typeof action === 'string' ? action : null,
    data: r.data,
    created: r.created.toISOString(),
  };
}

/**
 * Another org's ship event as this org may see it: who becomes "Other
 * organisation", what stays (the action and the field diff — the shared
 * record shows those values anyway), everything else goes (names, request
 * forensics, the pushed envelope, the source system).
 */
export function maskForeignShipEvent(row: AuditLogRow): AuditLogRow {
  const changes = row.data['changes'];
  return {
    ...row,
    actorId: OTHER_ORG,
    data: {
      ...(row.action ? { action: row.action } : {}),
      ...(changes !== undefined ? { changes } : {}),
    },
    masked: true,
  };
}

/** Which events a viewer sees unmasked: their own org's, or all for a platform admin. */
export function seesShipEventInFull(row: AuditLogRow, viewer: SessionUser): boolean {
  return viewer.platformAdmin === true || row.data['actorOrg'] === viewer.orgSlug;
}

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tenantDb: TenantDb,
  ) {}

  async list(
    admin: SessionUser,
    before: string | null,
    limit: number,
    q: string | null = null,
    /** 'nemo' narrows to the NEMO log — every exchange with NEMO (spec 0078). */
    kind: 'nemo' | null = null,
  ): Promise<{ events: AuditLogRow[]; nextBefore: string | null }> {
    const nemoOnly = kind === 'nemo';
    // Free-text filter (spec 0019): ILIKE across the searchable columns and
    // the raw event data. Only NARROWS the org-scoped queries below — it can
    // never widen what an org sees. Wildcards in the input are literal.
    const pattern = q
      ? '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'
      : null;
    const org = (
      await this.pool.query(
        `SELECT id FROM platform.organization WHERE slug = $1 AND is_active`,
        [admin.orgSlug],
      )
    ).rows[0];
    if (!org) throw new NotFoundException();

    // Org chain — read inside the tenant scope (invariant 1)
    const orgRows = await this.tenantDb.withOrg(admin.orgSlug, async (client) => {
      const result = await client.query(
        `SELECT seq, category, actor_id, entity_type, entity_id, data, created
           FROM audit_event
          WHERE ($1::timestamptz IS NULL OR created < $1::timestamptz)
            AND ($3::text IS NULL
                 OR category ILIKE $3
                 OR COALESCE(actor_id, '') ILIKE $3
                 OR COALESCE(entity_type, '') ILIKE $3
                 OR COALESCE(entity_id, '') ILIKE $3
                 OR data::text ILIKE $3)
            AND (NOT $4::boolean OR data->>'action' LIKE 'nemo\\_%')
          ORDER BY created DESC LIMIT $2`,
        [before, limit, pattern, nemoOnly],
      );
      return result.rows as DbRow[];
    });

    // Platform chain, filtered to this org's entities only
    const platformRows = (
      await this.pool.query(
        `SELECT e.seq, e.category, e.actor_id, e.entity_type, e.entity_id,
                e.data, e.created
           FROM platform.audit_event e
          WHERE ($2::timestamptz IS NULL OR e.created < $2::timestamptz)
            AND (
              (e.entity_type = 'user_account' AND e.entity_id IN (
                 SELECT u.id::text FROM platform.user_account u
                  WHERE u.org_id = $1))
              OR (e.entity_type = 'email_message' AND e.entity_id IN (
                 SELECT m.id::text FROM platform.email_message m
                   JOIN platform.user_account u ON u.id::text = m.related_entity_id
                  WHERE m.related_entity_type = 'user_account'
                    AND u.org_id = $1))
              OR (e.entity_type = 'organization' AND e.entity_id = $1::text)
              -- Reference-data syncs incl. schema-watch results (spec 0025):
              -- tenant-neutral platform facts (one shared cache serves every
              -- org; events carry job/status/stats only) — visible to all
              -- org admins, leaks nothing across tenants.
              OR e.entity_type = 'refdata_sync'
            )
            AND ($4::text IS NULL
                 OR e.category ILIKE $4
                 OR COALESCE(e.actor_id, '') ILIKE $4
                 OR COALESCE(e.entity_type, '') ILIKE $4
                 OR COALESCE(e.entity_id, '') ILIKE $4
                 OR e.data::text ILIKE $4)
            AND (NOT $5::boolean OR e.data->>'action' LIKE 'nemo\\_%')
          ORDER BY e.created DESC LIMIT $3`,
        [org.id, before, limit, pattern, nemoOnly],
      )
    ).rows as DbRow[];

    // Ship events (spec 0067): the shared record's history, every org's. The
    // viewer's own events (data.actorOrg) search in full; another org's only
    // on what the mask will show — the search must never confirm a name.
    const unmasked = admin.platformAdmin === true;
    const shipRows = (
      await this.pool.query(
        `SELECT e.seq, e.category, e.actor_id, e.entity_type, e.entity_id,
                e.data, e.created
           FROM platform.audit_event e
          WHERE e.entity_type = 'ship'
            AND ($2::timestamptz IS NULL OR e.created < $2::timestamptz)
            AND ($4::text IS NULL
                 OR e.category ILIKE $4
                 OR 'ship' ILIKE $4
                 OR COALESCE(e.entity_id, '') ILIKE $4
                 OR COALESCE(e.data->>'action', '') ILIKE $4
                 OR COALESCE(e.data->'changes', '{}'::jsonb)::text ILIKE $4
                 OR (($5::boolean OR e.data->>'actorOrg' = $1)
                     AND (COALESCE(e.actor_id, '') ILIKE $4 OR e.data::text ILIKE $4))
                 OR (NOT $5::boolean AND e.data->>'actorOrg' IS DISTINCT FROM $1
                     AND $6::text ILIKE $4))
            AND (NOT $7::boolean OR e.data->>'action' LIKE 'nemo\\_%')
          ORDER BY e.created DESC LIMIT $3`,
        [admin.orgSlug, before, limit, pattern, unmasked, OTHER_ORG, nemoOnly],
      )
    ).rows as DbRow[];

    const merged = [
      ...orgRows.map((r) => toRow('org', r)),
      ...platformRows.map((r) => toRow('platform', r)),
      ...shipRows
        .map((r) => toRow('platform', r))
        .map((row) => (seesShipEventInFull(row, admin) ? row : maskForeignShipEvent(row))),
    ]
      .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0))
      .slice(0, limit);

    const more =
      orgRows.length + platformRows.length + shipRows.length > merged.length ||
      merged.length === limit;
    return {
      events: merged,
      nextBefore: more && merged.length > 0
        ? merged[merged.length - 1]!.created
        : null,
    };
  }
}
