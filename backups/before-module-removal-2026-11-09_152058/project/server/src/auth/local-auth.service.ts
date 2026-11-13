/**
 * Local username/password login (docs/specs/0011): argon2id verify, 5-failure
 * / 15-minute lockout, constant-shape flow (a dummy hash is verified even for
 * unknown users — no timing oracle on user existence), audited.
 */

import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { effectiveUser, SessionService, SessionUser } from './session.service';

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class LocalAuthService {
  private readonly logger = new Logger(LocalAuthService.name);
  private dummyHash: Promise<string> = argon2.hash(
    `dummy-${Math.random()}`,
    { type: argon2.argon2id },
  );

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  /** Success → session token + user. Failure → generic 401, always. */
  async login(
    username: string,
    password: string,
  ): Promise<{ token: string; user: SessionUser }> {
    const result = await this.pool.query(
      `SELECT u.id, u.username, u.display_name, u.role, u.password_hash,
              u.pec, u.ship_id,
              u.failed_attempts, u.locked_until, o.slug, o.name
         FROM platform.user_account u
         JOIN platform.organization o ON o.id = u.org_id
        WHERE lower(u.username) = lower($1)
          AND u.auth_type = 'local' AND u.is_active AND u.status = 'active'
          AND o.is_active`,
      [username],
    );
    const row = result.rows[0];

    const locked =
      row?.locked_until && new Date(row.locked_until).getTime() > Date.now();
    // Verify against a dummy hash when there is nothing real to verify —
    // unknown, locked and wrong-password all take the same argon2 time
    const hash: string = !locked && row?.password_hash
      ? row.password_hash
      : await this.dummyHash;
    const passwordOk = await argon2.verify(hash, password).catch(() => false);

    if (!row || locked || !passwordOk || !row.password_hash) {
      if (row && !locked) {
        await this.pool.query(
          `UPDATE platform.user_account
              SET failed_attempts = failed_attempts + 1,
                  locked_until = CASE WHEN failed_attempts + 1 >= $2
                    THEN now() + interval '${LOCK_MINUTES} minutes' END,
                  updated = now()
            WHERE id = $1`,
          [row.id, MAX_FAILURES],
        );
      }
      await this.auditLogin('login_failed', username, {
        known: !!row,
        locked: !!locked,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.pool.query(
      `UPDATE platform.user_account
          SET failed_attempts = 0, locked_until = NULL, updated = now()
        WHERE id = $1`,
      [row.id],
    );
    // Fail closed (spec 0007 rule): no audit, no session
    await this.audit.access({
      actorId: row.username,
      entityType: 'user_account',
      entityId: row.id,
      data: { action: 'login_success' },
    });
    const { token } = await this.sessions.create(row.id);
    // A fresh session never has an acting org — a superadmin lands on the
    // platform level and selects a customer from there (spec 0030).
    return { token, user: effectiveUser(row) };
  }

  /** Failure events are best-effort — the denial already happened. */
  private async auditLogin(
    action: string,
    username: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.access({
        actorId: username.toLowerCase(),
        entityType: 'user_account',
        data: { action, ...data },
      });
    } catch (error) {
      this.logger.error(
        `audit ${action} write failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
