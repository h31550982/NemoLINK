/**
 * Opaque sessions (docs/specs/0011): 32-byte random token in an httpOnly
 * cookie, DB stores only its sha256. No JWT surface; revocation = row update.
 */

import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { PecInfo } from './pec';

export const SESSION_COOKIE = 'nemolink_session';
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  orgSlug: string;
  orgName: string;
  /**
   * Captain's PEC (specs 0043/0045): null = not answered yet,
   * {none: true} = no PEC for Finland, else the certificate details.
   */
  pec?: PecInfo | null;
  /** Captain's ship (docs/specs/0049) — scopes the port-call list and uploads. */
  shipId?: string | null;
  /** nauticAi platform admin (docs/specs/0030) — role 'superadmin' account. */
  platformAdmin?: boolean;
  /** Platform admin currently acting inside a selected customer org. */
  acting?: boolean;
}

interface IdentityRow {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  slug: string;
  name: string;
  pec?: PecInfo | null;
  ship_id?: string | null;
  acting_slug?: string | null;
  acting_name?: string | null;
}

/**
 * Effective identity (docs/specs/0030): a superadmin acting in a customer
 * org becomes that org's 'admin' for every existing gate and service —
 * with the platform flags so the UI shows the context and the switch trail
 * stays on the platform chain. Unswitched superadmins keep role
 * 'superadmin', which no org-scoped gate accepts: customer data is only
 * reachable through an org-member role.
 *
 * NOTE (spec 0030 amendment, 2026-08-23): acting grants org-admin powers
 * for preparation and review, but NEMO submission is an org-member act —
 * every submit path calls `assertMaySubmit` (invariant 4, spec 0076).
 */
export function effectiveUser(row: IdentityRow): SessionUser {
  const base: SessionUser = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    orgSlug: row.slug,
    orgName: row.name,
    pec: row.pec ?? null,
    shipId: row.ship_id ?? null,
  };
  if (row.role !== 'superadmin') return base;
  if (row.acting_slug && row.acting_name) {
    return {
      ...base,
      role: 'admin',
      orgSlug: row.acting_slug,
      orgName: row.acting_name,
      platformAdmin: true,
      acting: true,
    };
  }
  return { ...base, platformAdmin: true, acting: false };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class SessionService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  get ttlSeconds(): number {
    return SESSION_TTL_SECONDS;
  }

  async create(userId: string): Promise<{ token: string }> {
    const token = randomBytes(32).toString('hex');
    await this.pool.query(
      `INSERT INTO platform.session (token_hash, user_id, expires)
       VALUES ($1, $2, now() + interval '${SESSION_TTL_SECONDS} seconds')`,
      [hashToken(token), userId],
    );
    return { token };
  }

  /** Active, unexpired session of an active user — or null. Bumps last_seen. */
  async resolve(token: string): Promise<SessionUser | null> {
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const result = await this.pool.query(
      `UPDATE platform.session s
          SET last_seen = now()
         FROM platform.user_account u
         JOIN platform.organization o ON o.id = u.org_id
        WHERE s.token_hash = $1 AND s.is_active AND s.expires > now()
          AND u.id = s.user_id AND u.is_active AND u.status = 'active'
          AND o.is_active
        RETURNING u.id, u.username, u.display_name, u.role,
          u.pec, u.ship_id, o.slug, o.name,
          (SELECT a.slug FROM platform.organization a
            WHERE a.id = s.acting_org_id AND a.is_active) AS acting_slug,
          (SELECT a.name FROM platform.organization a
            WHERE a.id = s.acting_org_id AND a.is_active) AS acting_name`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    return effectiveUser(row);
  }

  /** Pins/clears a platform admin's acting org on the session (spec 0030). */
  async setActingOrg(token: string, orgId: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE platform.session SET acting_org_id = $2
        WHERE token_hash = $1 AND is_active`,
      [hashToken(token), orgId],
    );
  }

  async destroy(token: string): Promise<void> {
    await this.pool.query(
      `UPDATE platform.session SET is_active = false WHERE token_hash = $1`,
      [hashToken(token)],
    );
  }
}

/** Why an acting platform admin cannot send (invariant 4, spec 0076). */
export const PLATFORM_ADMIN_SUBMIT_WORDS =
  'Sending to NEMO is for the organisation’s own people — a platform admin ' +
  'acting here can prepare and review, but not send. Sign in with an account ' +
  'of the organisation to send.';

/**
 * Invariant 4 (spec 0030 amendment; enforced by spec 0076): NEMO submission
 * is an org-member act. Every path that sends to NEMO — the VID, SID + SHP,
 * and each report to come — calls this first, before anything is built or
 * read from NEMO; an acting platform admin gets a 403 with the words.
 */
export function assertMaySubmit(user: SessionUser): void {
  if (user.platformAdmin === true) throw new ForbiddenException(PLATFORM_ADMIN_SUBMIT_WORDS);
}
