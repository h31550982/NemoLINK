/**
 * SSO self-signup + admin approval (docs/specs/0012). Pending users are
 * created only from a VALIDATED Entra token whose tid matches an org's
 * configured entraTenantId — nobody can enqueue themselves from outside.
 * All transitions are content-audited with the acting admin as actor.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { brandedEmail } from '../notify/email-template';
import { NotifyService } from '../notify/notify.service';
import { TenantDb } from '../tenancy/tenant-db';
import { PecInfo } from './pec';
import { SessionUser } from './session.service';

export interface OrgUserRow {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  role: string | null;
  authType: string;
  status: string;
  created: string;
  /** Set only while a local-account lockout is still running (spec 0019) */
  lockedUntil: string | null;
  /** Newest session.last_seen; null = never signed in (spec 0019) */
  lastSeen: string | null;
  /** Latest 'user-welcome' email for this user; null = never sent (spec 0014) */
  welcomeEmail: { status: string; updated: string } | null;
  /** Captain's assigned ship (spec 0049); null for everyone else. */
  shipId: string | null;
}

const ROLES = ['admin', 'editor', 'viewer', 'captain'];

@Injectable()
export class UserApprovalService {
  private readonly logger = new Logger(UserApprovalService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly tenantDb: TenantDb,
  ) {}

  /** Org whose configured Entra tenant matches the token's tid — or null. */
  async orgForEntraTenant(
    tenantId: string,
  ): Promise<{ id: string; slug: string; name: string } | null> {
    if (!tenantId) return null;
    const result = await this.pool.query(
      `SELECT id, slug, name FROM platform.organization
        WHERE auth_config->>'entraTenantId' = $1 AND is_active`,
      [tenantId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Create the pending user (audited) and notify the org's admins — email is
   * best-effort, the pending record is the source of truth.
   */
  async createPending(
    org: { id: string; slug: string; name: string },
    claims: { email: string; name?: string; issuer: string; subject: string },
  ): Promise<string> {
    const inserted = await this.pool.query(
      `INSERT INTO platform.user_account
         (org_id, username, email, display_name, auth_type, status,
          oidc_issuer, oidc_subject, author)
       VALUES ($1, lower($2), $2, $3, 'oidc', 'pending', $4, $5, 'sso-self-signup')
       RETURNING id`,
      [org.id, claims.email, claims.name ?? null, claims.issuer, claims.subject],
    );
    const userId: string = inserted.rows[0].id;
    await this.audit.content({
      actorId: claims.email.toLowerCase(),
      entityType: 'user_account',
      entityId: userId,
      data: { action: 'pending_created', org: org.slug, via: 'sso' },
    });
    await this.notifyAdmins(org, claims, userId);
    return userId;
  }

  private async notifyAdmins(
    org: { id: string; slug: string; name: string },
    claims: { email: string; name?: string },
    userId: string,
  ): Promise<void> {
    try {
      if (!this.notify.emailEnabled) {
        this.logger.warn(
          `pending user in ${org.slug}: email disabled, admins not notified`,
        );
        return;
      }
      const admins = await this.pool.query(
        `SELECT email FROM platform.user_account
          WHERE org_id = $1 AND role = 'admin' AND status = 'active'
            AND is_active AND email IS NOT NULL`,
        [org.id],
      );
      if (admins.rows.length === 0) {
        this.logger.warn(`pending user in ${org.slug}: no admin emails to notify`);
        return;
      }
      const base =
        this.config.get<string>('PUBLIC_BASE_URL') || 'https://nemolink.nauticai.net';
      const { htmlBody, textBody } = brandedEmail({
        title: 'New user awaiting approval',
        paragraphs: [
          'Someone from your organization signed in to NEMOLink with their company account for the first time. They cannot access anything until you approve them and assign a role.',
        ],
        facts: [
          { label: 'Name', value: claims.name ?? '—' },
          { label: 'Email', value: claims.email },
          { label: 'Organization', value: org.name },
        ],
        cta: { text: 'Review in NEMOLink', url: base },
      });
      for (const row of admins.rows) {
        await this.notify.sendTracked({
          to: row.email,
          subject: 'New user awaiting approval — NEMOLink',
          htmlBody,
          textBody,
          template: 'user-approval',
          relatedEntityType: 'user_account',
          relatedEntityId: userId,
          author: 'sso-self-signup',
        });
      }
    } catch (error) {
      this.logger.error(
        `admin notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** All users of the admin's own org, newest first. */
  async listOrgUsers(admin: SessionUser): Promise<OrgUserRow[]> {
    const result = await this.pool.query(
      `SELECT u.id, u.username, u.email, u.display_name, u.role, u.auth_type,
              u.status, u.created, u.ship_id,
              CASE WHEN u.locked_until > now() THEN u.locked_until END
                AS locked_until,
              ls.last_seen, w.status AS welcome_status,
              w.updated AS welcome_updated
         FROM platform.user_account u
         JOIN platform.organization o ON o.id = u.org_id
         LEFT JOIN LATERAL (
           SELECT max(s.last_seen) AS last_seen FROM platform.session s
            WHERE s.user_id = u.id
         ) ls ON true
         LEFT JOIN LATERAL (
           SELECT m.status, m.updated FROM platform.email_message m
            WHERE m.template = 'user-welcome'
              AND m.related_entity_type = 'user_account'
              AND m.related_entity_id = u.id::text
            ORDER BY m.created DESC LIMIT 1
         ) w ON true
        WHERE o.slug = $1 AND u.is_active
          -- Platform accounts are CLI-managed, invisible to org admins (spec 0030)
          AND u.role IS DISTINCT FROM 'superadmin'
        ORDER BY u.status = 'pending' DESC, u.created DESC`,
      [admin.orgSlug],
    );
    return result.rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      authType: r.auth_type,
      status: r.status,
      created: r.created.toISOString(),
      lockedUntil: r.locked_until ? r.locked_until.toISOString() : null,
      lastSeen: r.last_seen ? r.last_seen.toISOString() : null,
      welcomeEmail: r.welcome_status
        ? { status: r.welcome_status, updated: r.welcome_updated.toISOString() }
        : null,
      shipId: r.ship_id,
    }));
  }

  /** pending/rejected → active with role. 404 outside the admin's org. */
  async approve(admin: SessionUser, userId: string, role: string): Promise<void> {
    if (!ROLES.includes(role)) {
      throw new Error(`Invalid role '${role}'`);
    }
    const result = await this.pool.query(
      `UPDATE platform.user_account u
          SET status = 'active', role = $3, updated = now()
         FROM platform.organization o
        WHERE u.id = $2 AND u.org_id = o.id AND o.slug = $1
          AND u.is_active AND u.status IN ('pending', 'rejected')
        RETURNING u.id, u.username, u.email, u.auth_type`,
      [admin.orgSlug, userId, role],
    );
    if (result.rowCount === 0) throw new NotFoundException();
    await this.audit.content({
      actorId: admin.username,
      entityType: 'user_account',
      entityId: userId,
      data: { action: 'approved', role, username: result.rows[0].username },
    });
    // Welcome email (spec 0014) — best-effort like the admin notification:
    // approval never fails on email problems.
    try {
      await this.sendWelcome(admin, {
        id: userId,
        email: result.rows[0].email,
        authType: result.rows[0].auth_type,
        role,
      });
    } catch (error) {
      this.logger.warn(
        `welcome email skipped for ${result.rows[0].username}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Admin-triggered resend of the welcome email (spec 0014). Active users
   * with an email only; cross-org/unknown = 404 (no oracle).
   */
  async resendWelcome(admin: SessionUser, userId: string): Promise<string> {
    const result = await this.pool.query(
      `SELECT u.id, u.email, u.auth_type, u.role, u.status
         FROM platform.user_account u
         JOIN platform.organization o ON o.id = u.org_id
        WHERE u.id = $2 AND o.slug = $1 AND u.is_active
          AND u.role IS DISTINCT FROM 'superadmin'`,
      [admin.orgSlug, userId],
    );
    const user = result.rows[0];
    if (!user) throw new NotFoundException();
    if (user.status !== 'active') {
      throw new BadRequestException('Only active users get a welcome email');
    }
    if (!user.email) {
      throw new BadRequestException('User has no email address');
    }
    if (!this.notify.emailEnabled) {
      throw new ServiceUnavailableException('Email is not configured');
    }
    try {
      return await this.sendWelcome(admin, {
        id: user.id,
        email: user.email,
        authType: user.auth_type,
        role: user.role,
      });
    } catch (error) {
      // e.g. suppressed recipient — surface as a client error, not a 500
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Send failed',
      );
    }
  }

  /** Returns the notify status ('sent' | 'failed'); throws when it cannot send. */
  private async sendWelcome(
    admin: SessionUser,
    user: { id: string; email: string | null; authType: string; role: string },
  ): Promise<string> {
    if (!this.notify.emailEnabled) {
      throw new Error('email disabled');
    }
    if (!user.email) {
      throw new Error('no email address on the account');
    }
    const base =
      this.config.get<string>('PUBLIC_BASE_URL') || 'https://nemolink.nauticai.net';
    const { htmlBody, textBody } = brandedEmail({
      title: 'Your NEMOLink access is ready',
      paragraphs: [
        `An administrator of ${admin.orgName} approved your access to NEMOLink. ` +
          (user.authType === 'oidc'
            ? 'Sign in with your company account to get started.'
            : 'Sign in with your username to get started.'),
      ],
      facts: [
        { label: 'Organization', value: admin.orgName },
        { label: 'Role', value: user.role },
      ],
      cta: { text: 'Open NEMOLink', url: base },
    });
    const sent = await this.notify.sendTracked({
      to: user.email,
      subject: 'Your NEMOLink access is ready',
      htmlBody,
      textBody,
      template: 'user-welcome',
      relatedEntityType: 'user_account',
      relatedEntityId: user.id,
      author: admin.username,
    });
    return sent.status;
  }

  /**
   * Change an ACTIVE user's role (spec 0019). Self-change is blocked so an
   * org can never demote away its last admin by accident; the new role is
   * live on the user's next request (session validation re-reads the row).
   */
  async changeRole(admin: SessionUser, userId: string, role: string): Promise<void> {
    if (!ROLES.includes(role)) {
      throw new Error(`Invalid role '${role}'`);
    }
    const found = await this.pool.query(
      `SELECT u.id, u.role, u.status
         FROM platform.user_account u
         JOIN platform.organization o ON o.id = u.org_id
        WHERE u.id = $2 AND o.slug = $1 AND u.is_active
          AND u.role IS DISTINCT FROM 'superadmin'`,
      [admin.orgSlug, userId],
    );
    const user = found.rows[0];
    if (!user) throw new NotFoundException();
    if (user.id === admin.id) {
      throw new BadRequestException('You cannot change your own role');
    }
    if (user.status !== 'active') {
      throw new BadRequestException('Only active users have a role — approve them first');
    }
    if (user.role === role) return; // idempotent, no audit noise
    const updated = await this.pool.query(
      `UPDATE platform.user_account
          SET role = $2, updated = now()
        WHERE id = $1 AND status = 'active'
        RETURNING username`,
      [userId, role],
    );
    if (updated.rowCount === 0) throw new NotFoundException();
    await this.audit.content({
      actorId: admin.username,
      entityType: 'user_account',
      entityId: userId,
      data: {
        action: 'role_changed',
        from: user.role,
        to: role,
        username: updated.rows[0].username,
      },
    });
  }

  /**
   * Bind a captain to their ship (spec 0049) — the scope of their
   * port-call list and uploads. Live on the captain's next request, the
   * same way a role change is. null unbinds.
   */
  async assignShip(
    admin: SessionUser,
    userId: string,
    shipId: string | null,
  ): Promise<void> {
    const found = await this.pool.query(
      `SELECT u.id, u.role, u.status, u.ship_id
         FROM platform.user_account u
         JOIN platform.organization o ON o.id = u.org_id
        WHERE u.id = $2 AND o.slug = $1 AND u.is_active
          AND u.role IS DISTINCT FROM 'superadmin'`,
      [admin.orgSlug, userId],
    );
    const user = found.rows[0];
    if (!user) throw new NotFoundException();
    if (user.status !== 'active') {
      throw new BadRequestException('Only active users can be linked to a ship');
    }
    if (user.role !== 'captain') {
      throw new BadRequestException('Only captains are linked to a ship');
    }
    if (user.ship_id === shipId) return; // idempotent, no audit noise
    let shipName: string | null = null;
    if (shipId !== null) {
      shipName = await this.tenantDb.withOrg(admin.orgSlug, async (client) => {
        const ship = await client.query(
          `SELECT s.name FROM platform.ship s
             JOIN fleet_ship f ON f.ship_id = s.id AND f.is_active
            WHERE s.id = $1 AND s.is_active`,
          [shipId],
        );
        if (!ship.rows[0]) {
          throw new BadRequestException('No such ship in your fleet');
        }
        return ship.rows[0].name as string | null;
      });
    }
    const updated = await this.pool.query(
      `UPDATE platform.user_account
          SET ship_id = $2, updated = now()
        WHERE id = $1 AND status = 'active'
        RETURNING username`,
      [userId, shipId],
    );
    if (updated.rowCount === 0) throw new NotFoundException();
    await this.audit.content({
      actorId: admin.username,
      entityType: 'user_account',
      entityId: userId,
      data: {
        action: 'ship_assigned',
        from: user.ship_id,
        to: shipId,
        ...(shipName !== null ? { shipName } : {}),
        username: updated.rows[0].username,
      },
    });
  }

  /**
   * A captain's own PEC (specs 0043/0045) — self-service. null = back to
   * unanswered, {none: true} = declared no PEC for Finland, else the
   * validated certificate details (the controller runs pecInfoSchema).
   * The certificate content never goes into the audit payload.
   */
  async setOwnPec(user: SessionUser, pec: PecInfo | null): Promise<void> {
    if (user.role !== 'captain') {
      throw new ForbiddenException('Only captains carry a PEC');
    }
    const updated = await this.pool.query(
      `UPDATE platform.user_account
          SET pec = $2::jsonb, updated = now()
        WHERE id = $1 AND is_active AND status = 'active'
        RETURNING username`,
      [user.id, pec === null ? null : JSON.stringify(pec)],
    );
    if (updated.rowCount === 0) throw new NotFoundException();
    await this.audit.content({
      actorId: user.username,
      entityType: 'user_account',
      entityId: user.id,
      data: {
        action: 'pec_updated',
        username: updated.rows[0].username,
        set: pec !== null,
        none: pec !== null && 'none' in pec,
      },
    });
  }

  /** pending/active → rejected; login denied from then on. */
  async reject(admin: SessionUser, userId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE platform.user_account u
          SET status = 'rejected', updated = now()
         FROM platform.organization o
        WHERE u.id = $2 AND u.org_id = o.id AND o.slug = $1
          AND u.is_active AND u.status IN ('pending', 'active') AND u.id <> $3
          AND u.role IS DISTINCT FROM 'superadmin'
        RETURNING u.id, u.username`,
      [admin.orgSlug, userId, admin.id],
    );
    if (result.rowCount === 0) throw new NotFoundException();
    await this.audit.content({
      actorId: admin.username,
      entityType: 'user_account',
      entityId: userId,
      data: { action: 'rejected', username: result.rows[0].username },
    });
  }
}
