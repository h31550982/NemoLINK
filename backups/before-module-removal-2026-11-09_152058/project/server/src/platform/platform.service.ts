/**
 * Platform level (docs/specs/0030): the nauticAi system-admin's view.
 * Org list for "Select customer", per-session acting-org switching (every
 * switch = platform-chain access audit event), and the platform audit
 * trail. Everything here sits behind the 'session:platform' policy.
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { SessionService, SessionUser } from '../auth/session.service';
import { PG_POOL } from '../db/db.module';

export interface PlatformOrg {
  slug: string;
  name: string;
  isActive: boolean;
  created: string;
}

export interface PlatformAuditEvent {
  seq: number;
  category: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  data: Record<string, unknown>;
  created: string;
}

/** Same escaping as the org audit search (spec 0019). */
function likePattern(q: string): string {
  return '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
}

const PAGE_SIZE = 30;

@Injectable()
export class PlatformService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async listOrgs(): Promise<PlatformOrg[]> {
    const result = await this.pool.query(
      `SELECT slug, name, is_active, created
         FROM platform.organization
        ORDER BY is_active DESC, name`,
    );
    return result.rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      isActive: r.is_active,
      created: r.created.toISOString(),
    }));
  }

  /**
   * Selects (or clears, slug = null) the customer this platform admin acts
   * in — session-scoped, audited on the platform chain, and the returned
   * user already carries the new effective identity.
   */
  async setActingOrg(
    user: SessionUser,
    token: string,
    orgSlug: string | null,
  ): Promise<SessionUser> {
    let orgId: string | null = null;
    if (orgSlug !== null) {
      const org = await this.pool.query(
        `SELECT id, name FROM platform.organization WHERE slug = $1 AND is_active`,
        [orgSlug],
      );
      if (!org.rows[0]) throw new NotFoundException('Unknown customer');
      orgId = org.rows[0].id;
    }
    await this.sessions.setActingOrg(token, orgId);
    await this.audit.access({
      actorId: user.username,
      entityType: 'organization',
      ...(orgSlug ? { entityId: orgSlug } : {}),
      data: orgSlug
        ? { action: 'acting_org_selected', orgSlug }
        : { action: 'acting_org_cleared' },
    });
    const refreshed = await this.sessions.resolve(token);
    if (!refreshed) throw new NotFoundException('Session ended');
    return refreshed;
  }

  /** Platform-chain audit trail, newest first, standard q + cursor. */
  async listAudit(
    before: string | null,
    q: string | null,
  ): Promise<{ events: PlatformAuditEvent[]; nextBefore: string | null }> {
    const pattern = q ? likePattern(q) : null;
    const result = await this.pool.query(
      `SELECT seq, category, actor_id, entity_type, entity_id, data, created
         FROM platform.audit_event
        WHERE ($1::timestamptz IS NULL OR created < $1)
          AND ($2::text IS NULL
               OR category ILIKE $2
               OR COALESCE(actor_id, '') ILIKE $2
               OR COALESCE(entity_type, '') ILIKE $2
               OR COALESCE(entity_id, '') ILIKE $2
               OR data::text ILIKE $2)
        ORDER BY created DESC, seq DESC
        LIMIT ${PAGE_SIZE + 1}`,
      [before, pattern],
    );
    const rows = result.rows.slice(0, PAGE_SIZE);
    const events = rows.map((r) => ({
      seq: Number(r.seq),
      category: r.category,
      actorId: r.actor_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      data: r.data,
      created: r.created.toISOString(),
    }));
    return {
      events,
      nextBefore:
        result.rows.length > PAGE_SIZE
          ? (events[events.length - 1]?.created ?? null)
          : null,
    };
  }
}
