import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';
import { AuthzGuard } from '../src/auth/authz.guard';
import { IngestCredentialService } from '../src/ingest/ingest-credential.service';
import { parseCookies, serializeCookie } from '../src/auth/cookies';
import { hashToken, SessionService } from '../src/auth/session.service';
import type { SessionUser } from '../src/auth/session.service';

const USER: SessionUser = {
  id: 'u1',
  username: 'tester',
  displayName: 'Tester',
  role: 'admin',
  orgSlug: 'fleetco',
  orgName: 'Fleetco',
};

function guardWithSessions(resolve: (token: string) => SessionUser | null): AuthzGuard {
  const reflector = { getAllAndOverride: () => 'session' } as unknown as Reflector;
  const config = { get: () => undefined } as unknown as ConfigService;
  const sessions = {
    resolve: async (token: string) => resolve(token),
  } as unknown as SessionService;
  const ingest = { resolve: async () => null } as unknown as IngestCredentialService;
  return new AuthzGuard(reflector, config, sessions, ingest);
}

function contextWithCookie(cookie?: string): {
  ctx: ExecutionContext;
  request: { user?: SessionUser };
} {
  const request: { headers: { cookie?: string }; user?: SessionUser } = {
    headers: { ...(cookie ? { cookie } : {}) },
  };
  const ctx = {
    getHandler: () => function handler() {},
    getClass: () => class Ctrl {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

const VALID = 'a'.repeat(64);

describe("AuthzGuard 'session' policy (spec 0011 AC 3/4)", () => {
  it('rejects without a cookie', async () => {
    const { ctx } = contextWithCookie();
    await expect(guardWithSessions(() => USER).canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when the session does not resolve', async () => {
    const { ctx } = contextWithCookie(`nemolink_session=${VALID}`);
    await expect(guardWithSessions(() => null).canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('passes a resolving session and attaches request.user', async () => {
    const { ctx, request } = contextWithCookie(
      `other=1; nemolink_session=${VALID}; more=2`,
    );
    const guard = guardWithSessions((token) => (token === VALID ? USER : null));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual(USER);
  });
});

describe('cookies (spec 0011)', () => {
  it('parses multiple cookies and decodes values', () => {
    expect(parseCookies('a=1; b=x%20y;c=z')).toEqual({ a: '1', b: 'x y', c: 'z' });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('serializes httpOnly Lax cookies with optional Secure and Max-Age', () => {
    expect(serializeCookie('s', 'v', { maxAge: 60, secure: true })).toBe(
      's=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure',
    );
    expect(serializeCookie('s', '', { maxAge: 0, secure: false })).toBe(
      's=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
  });
});

describe('session token hashing (spec 0011)', () => {
  it('is sha256 hex and deterministic', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});
