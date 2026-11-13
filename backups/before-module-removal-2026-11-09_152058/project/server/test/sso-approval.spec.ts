import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import { AuthzGuard } from '../src/auth/authz.guard';
import { IngestCredentialService } from '../src/ingest/ingest-credential.service';
import { OidcService } from '../src/auth/oidc.service';
import type { SessionService, SessionUser } from '../src/auth/session.service';
import type { UserApprovalService } from '../src/auth/user-approval.service';
import { brandedEmail } from '../src/notify/email-template';

const TOKEN = 'a'.repeat(64);

function makeUser(role: string): SessionUser {
  return {
    id: 'u1',
    username: 'x',
    displayName: null,
    role,
    orgSlug: 'acmeship',
    orgName: 'Acmeship Oy',
  };
}

function adminGuard(user: SessionUser | null): AuthzGuard {
  const reflector = { getAllAndOverride: () => 'session:admin' } as unknown as Reflector;
  const config = { get: () => undefined } as unknown as ConfigService;
  const sessions = { resolve: async () => user } as unknown as SessionService;
  const ingest = { resolve: async () => null } as unknown as IngestCredentialService;
  return new AuthzGuard(reflector, config, sessions, ingest);
}

function ctxWithCookie(cookie?: string): ExecutionContext {
  const request = { headers: { ...(cookie ? { cookie } : {}) } };
  return {
    getHandler: () => function handler() {},
    getClass: () => class Ctrl {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("AuthzGuard 'session:admin' policy (spec 0012 AC 1)", () => {
  it('rejects without a session (401)', async () => {
    await expect(adminGuard(makeUser('admin')).canActivate(ctxWithCookie())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a non-admin session (403)', async () => {
    for (const role of ['editor', 'viewer', 'captain']) {
      await expect(
        adminGuard(makeUser(role)).canActivate(ctxWithCookie(`nemolink_session=${TOKEN}`)),
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('passes an admin session', async () => {
    await expect(
      adminGuard(makeUser('admin')).canActivate(ctxWithCookie(`nemolink_session=${TOKEN}`)),
    ).resolves.toBe(true);
  });
});

describe('resolveLogin rejected user -> revoked outcome (spec 0012 amendment)', () => {
  const TID = '1713b9f0-6f52-4803-b874-3e92a36623ca';
  const ORG = { id: 'org-1', slug: 'acmeship', name: 'Acmeship Oy' };
  const CLAIMS = {
    email: 'revoked.user@acmeship.example',
    iss: `https://login.microsoftonline.com/${TID}/v2.0`,
    sub: 'subject-1',
    tid: TID,
  };

  /** `org` null = no org has claimed the token's tid. */
  function makeOidc(
    row: Record<string, unknown> | undefined,
    org: typeof ORG | null = ORG,
  ) {
    const query = jest.fn().mockResolvedValue({ rows: row ? [row] : [] });
    const access = jest.fn().mockResolvedValue(undefined);
    const createPending = jest.fn().mockResolvedValue('u-new');
    const service = new OidcService(
      { query } as unknown as Pool,
      { get: () => undefined } as unknown as ConfigService,
      { access } as unknown as AuditService,
      { create: jest.fn().mockResolvedValue({ token: TOKEN }) } as unknown as SessionService,
      {
        orgForEntraTenant: jest.fn().mockResolvedValue(org),
        createPending,
      } as unknown as UserApprovalService,
    );
    return { service, access, query, createPending };
  }

  it('returns revoked (not a throw) and audits reason=rejected', async () => {
    const { service, access } = makeOidc({
      id: 'u1',
      username: CLAIMS.email,
      status: 'rejected',
      oidc_issuer: CLAIMS.iss,
      oidc_subject: CLAIMS.sub,
    });
    await expect(service.resolveLogin({ ...CLAIMS })).resolves.toEqual({
      outcome: 'revoked',
    });
    expect(access).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { action: 'oidc_login_denied', reason: 'rejected' },
      }),
    );
  });

  it('unknown user of a mapped tenant becomes pending', async () => {
    const { service, createPending } = makeOidc(undefined);
    await expect(service.resolveLogin({ ...CLAIMS })).resolves.toEqual({
      outcome: 'pending',
    });
    expect(createPending).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ email: CLAIMS.email }),
    );
  });

  it('denies a token whose tid no org claims, without looking up the user', async () => {
    const { service, access, query } = makeOidc(undefined, null);
    await expect(service.resolveLogin({ ...CLAIMS, tid: 'nope' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(query).not.toHaveBeenCalled();
    expect(access).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { action: 'oidc_login_denied', reason: 'unknown_tenant' },
      }),
    );
  });

  it('scopes the user lookup to the org the tid resolved to (no cross-tenant email match)', async () => {
    const { service, query } = makeOidc({
      id: 'u1',
      username: CLAIMS.email,
      status: 'active',
      oidc_issuer: CLAIMS.iss,
      oidc_subject: CLAIMS.sub,
    });
    await expect(service.resolveLogin({ ...CLAIMS })).resolves.toMatchObject({
      outcome: 'session',
      user: expect.objectContaining({ orgSlug: ORG.slug, orgName: ORG.name }),
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('org_id = $2'),
      [CLAIMS.email, ORG.id],
    );
  });
});

describe('brandedEmail (spec 0012 AC 1)', () => {
  const rendered = brandedEmail({
    title: 'New user awaiting approval',
    paragraphs: ['Someone signed in <first> time.'],
    facts: [
      { label: 'Email', value: 'new.user@acmeship.example' },
      { label: 'Organization', value: 'Acmeship Oy' },
    ],
    cta: { text: 'Review in NEMOLink', url: 'https://nemolink.nauticai.net' },
  });

  it('renders single-column html with the expected pieces', () => {
    expect(rendered.htmlBody).toContain('NEMOLink');
    expect(rendered.htmlBody).toContain('New user awaiting approval');
    expect(rendered.htmlBody).toContain('new.user@acmeship.example');
    expect(rendered.htmlBody).toContain('max-width:560px');
    expect(rendered.htmlBody).toContain('https://nemolink.nauticai.net');
  });

  it('escapes html in user-supplied content', () => {
    expect(rendered.htmlBody).toContain('&lt;first&gt;');
    expect(rendered.htmlBody).not.toContain('<first>');
  });

  it('references no external resources', () => {
    // Inline styles only; the sole URLs are the CTA link target
    expect(rendered.htmlBody).not.toMatch(/<img|<link|@import|url\(/);
    expect(rendered.htmlBody).not.toMatch(/src=/);
  });

  it('produces a matching plain-text alternative', () => {
    expect(rendered.textBody).toContain('New user awaiting approval');
    expect(rendered.textBody).toContain('Email: new.user@acmeship.example');
    expect(rendered.textBody).toContain('Review in NEMOLink: https://nemolink.nauticai.net');
  });
});
