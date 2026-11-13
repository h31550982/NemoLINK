/**
 * Entra OIDC (docs/specs/0011): authorization code + PKCE via openid-client
 * v6 (certified; ESM-only, hence the dynamic import). Multi-tenant: every
 * user authenticates in their OWN tenant, and the token's `tid` selects the
 * org via organization.auth_config->>'entraTenantId'.
 *
 * Default-deny, in this order: the tid must map to an org, Azure assignment
 * authenticates, and our user table authorizes — the claim email must match
 * an active `oidc` user OF THAT ORG. First login binds issuer+subject; later
 * logins must match the binding.
 */

import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { SessionService, SessionUser } from './session.service';
import { UserApprovalService } from './user-approval.service';

/** Transient flow state, round-tripped in a short-lived httpOnly cookie. */
export interface OidcTransient {
  state: string;
  nonce: string;
  verifier: string;
}

/**
 * Sign-in resolution: a session, "recorded — awaiting admin approval", or
 * "access revoked". pending/revoked are only ever returned for a VALIDATED
 * token — the user proved who they are, so showing their own status is not
 * an oracle. Every other denial stays a generic UnauthorizedException.
 */
export type OidcLoginResult =
  | { outcome: 'session'; token: string; user: SessionUser }
  | { outcome: 'pending' }
  | { outcome: 'revoked' };

/**
 * Structural view of the openid-client v6 surface we use. The real module is
 * ESM-only; typing it directly from CJS needs resolution-mode attributes, so
 * we keep a minimal local contract instead (checked at the drill, not by tsc).
 */
interface OpenIdClient {
  discovery(url: URL, clientId: string, clientSecret: string): Promise<object>;
  randomPKCECodeVerifier(): string;
  calculatePKCECodeChallenge(verifier: string): Promise<string>;
  randomState(): string;
  randomNonce(): string;
  buildAuthorizationUrl(config: object, params: Record<string, string>): URL;
  authorizationCodeGrant(
    config: object,
    currentUrl: URL,
    checks: { pkceCodeVerifier: string; expectedState: string; expectedNonce: string },
  ): Promise<{ claims(): Record<string, unknown> | undefined }>;
}

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private configPromise: Promise<object> | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly approval: UserApprovalService,
  ) {}

  private str(key: string): string | undefined {
    const value = this.config.get<string>(key);
    return value ? value : undefined;
  }

  get enabled(): boolean {
    return !!(
      this.str('ENTRA_TENANT_ID') &&
      this.str('ENTRA_CLIENT_ID') &&
      this.str('ENTRA_CLIENT_SECRET')
    );
  }

  redirectUri(): string {
    const base = this.str('PUBLIC_BASE_URL') ?? 'https://nemolink.nauticai.net';
    return `${base.replace(/\/$/, '')}/api/v1/auth/oidc/callback`;
  }

  private async oc(): Promise<OpenIdClient> {
    return (await import('openid-client')) as unknown as OpenIdClient;
  }

  private async discovered(): Promise<object> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('SSO not configured');
    }
    this.configPromise ??= (async () => {
      const oc = await this.oc();
      // The MULTI-TENANT authority. A tenant-specific one (…/<our tenant>/v2.0)
      // sends every customer's user to nauticAi's directory, where they do not
      // exist — Entra answers AADSTS16003 and the only cure would be inviting
      // each of them as a guest. `/organizations` = work accounts, any tenant.
      //
      // ENTRA_TENANT_ID is therefore NOT the authority; it stays in `enabled`
      // as the marker of a configured deployment (and is what binds nauticAi's
      // own org via set-org-entra).
      //
      // openid-client recognises the login.microsoftonline.com issuer template
      // and validates `iss` as issuer.replace('{tenantid}', tid) — i.e. from
      // the token's own tid, so it pins NO tenant. The tid -> org lookup in
      // resolveLogin is the check that actually restricts who may sign in.
      return oc.discovery(
        new URL('https://login.microsoftonline.com/organizations/v2.0'),
        this.str('ENTRA_CLIENT_ID')!,
        this.str('ENTRA_CLIENT_SECRET')!,
      );
    })().catch((error) => {
      this.configPromise = null; // discovery failure is retryable
      throw error;
    });
    return this.configPromise;
  }

  async start(): Promise<{ url: string; transient: OidcTransient }> {
    const [oc, discovered] = [await this.oc(), await this.discovered()];
    const verifier = oc.randomPKCECodeVerifier();
    const transient: OidcTransient = {
      state: oc.randomState(),
      nonce: oc.randomNonce(),
      verifier,
    };
    const url = oc.buildAuthorizationUrl(discovered, {
      redirect_uri: this.redirectUri(),
      scope: 'openid profile email',
      code_challenge: await oc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state: transient.state,
      nonce: transient.nonce,
    }).href;
    return { url, transient };
  }

  async callback(
    callbackUrl: URL,
    transient: OidcTransient,
  ): Promise<OidcLoginResult> {
    const [oc, discovered] = [await this.oc(), await this.discovered()];
    let claims: Record<string, unknown>;
    try {
      const tokens = await oc.authorizationCodeGrant(discovered, callbackUrl, {
        pkceCodeVerifier: transient.verifier,
        expectedState: transient.state,
        expectedNonce: transient.nonce,
      });
      const got = tokens.claims();
      if (!got) throw new Error('no ID token claims');
      claims = got;
    } catch (error) {
      // Protocol failures are logged (no tokens in the message), never echoed
      this.logger.warn(
        `OIDC exchange failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.auditDenied('exchange_failed', undefined);
      throw new UnauthorizedException('Sign-in failed');
    }
    return this.resolveLogin(claims);
  }

  /**
   * Post-validation resolution (docs/specs/0012) — public so the approval
   * flow is drillable with synthetic claims; callers must only pass claims
   * from a VALIDATED token. The token's tid must map to an active org before
   * anything else is considered; an unknown user of a mapped tenant becomes a
   * pending record (+ one-time admin notification) instead of a bare denial.
   */
  async resolveLogin(claims: Record<string, unknown>): Promise<OidcLoginResult> {
    const email =
      (typeof claims.email === 'string' && claims.email) ||
      (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
      '';
    const issuer = String(claims.iss ?? '');
    const subject = String(claims.sub ?? '');
    if (!email || !issuer || !subject) {
      await this.auditDenied('missing_claims', undefined);
      throw new UnauthorizedException('Sign-in failed');
    }

    // Tenant first, user second. Under the multi-tenant authority ANY Entra
    // tenant can mint a token for this client, and `email` is only ever as
    // trustworthy as the tenant that issued it — a stranger's tenant can hold
    // a guest carrying one of our users' addresses. So the tid picks the org,
    // and the user must be a member of that same org. Matching on email alone
    // (as v1 did, when only our own directory could issue) would let any
    // tenant impersonate any user by their address.
    const tenantId = typeof claims.tid === 'string' ? claims.tid : '';
    const org = await this.approval.orgForEntraTenant(tenantId);
    if (!org) {
      // Authenticated in Azure, no active org claims this tenant — default-deny
      await this.auditDenied('unknown_tenant', email);
      throw new UnauthorizedException('Sign-in failed');
    }

    const result = await this.pool.query(
      `SELECT id, username, display_name, role, status, oidc_issuer, oidc_subject
         FROM platform.user_account
        WHERE lower(email) = lower($1)
          AND org_id = $2
          AND auth_type = 'oidc' AND is_active`,
      [email, org.id],
    );
    const row = result.rows[0];

    if (!row) {
      await this.approval.createPending(org, {
        email,
        ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
        issuer,
        subject,
      });
      return { outcome: 'pending' };
    }

    if (row.status === 'rejected') {
      await this.auditDenied('rejected', email);
      return { outcome: 'revoked' };
    }
    if (row.oidc_subject && (row.oidc_issuer !== issuer || row.oidc_subject !== subject)) {
      await this.auditDenied('subject_mismatch', email);
      throw new UnauthorizedException('Sign-in failed');
    }
    if (row.status === 'pending') {
      // Repeat attempt while awaiting approval — no new record, no new email
      await this.auditPending(email);
      return { outcome: 'pending' };
    }
    if (!row.oidc_subject) {
      await this.pool.query(
        `UPDATE platform.user_account
            SET oidc_issuer = $2, oidc_subject = $3, updated = now()
          WHERE id = $1`,
        [row.id, issuer, subject],
      );
    }

    // Fail closed: no audit, no session
    await this.audit.access({
      actorId: row.username,
      entityType: 'user_account',
      entityId: row.id,
      data: { action: 'oidc_login_success' },
    });
    const { token } = await this.sessions.create(row.id);
    return {
      outcome: 'session',
      token,
      user: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        orgSlug: org.slug,
        orgName: org.name,
      },
    };
  }

  private async auditPending(email: string): Promise<void> {
    try {
      await this.audit.access({
        actorId: email.toLowerCase(),
        entityType: 'user_account',
        data: { action: 'oidc_login_pending' },
      });
    } catch (error) {
      this.logger.error(
        `audit oidc_login_pending write failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async auditDenied(reason: string, email: string | undefined): Promise<void> {
    try {
      await this.audit.access({
        ...(email ? { actorId: email.toLowerCase() } : {}),
        entityType: 'user_account',
        data: { action: 'oidc_login_denied', reason },
      });
    } catch (error) {
      this.logger.error(
        `audit oidc_login_denied write failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
