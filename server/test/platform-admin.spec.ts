/**
 * Spec 0030 — platform admin: superadmin role, per-session acting-org
 * context, platform endpoints, org-scope protections.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Pool, PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import type { NotifyService } from '../src/notify/notify.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import {
  effectiveUser,
  SessionService,
  type SessionUser,
} from '../src/auth/session.service';
import { AuthzGuard } from '../src/auth/authz.guard';
import { IngestCredentialService } from '../src/ingest/ingest-credential.service';
import { UserApprovalService } from '../src/auth/user-approval.service';
import { PortCallService } from '../src/canonical/port-call.service';
import { PlatformService } from '../src/platform/platform.service';

const SUPER_ROW = {
  id: 'sa-1',
  username: 'nauticai.admin',
  display_name: 'Platform Admin',
  role: 'superadmin',
  slug: 'fleetco',
  name: 'nauticAi (Fleetco)',
};

describe('effective identity (spec 0030 AC 2)', () => {
  it('normal users carry no platform flags', () => {
    const user = effectiveUser({ ...SUPER_ROW, role: 'admin' });
    expect(user.role).toBe('admin');
    expect(user.platformAdmin).toBeUndefined();
    expect(user.acting).toBeUndefined();
  });

  it('unswitched superadmin keeps role superadmin + platform flag', () => {
    const user = effectiveUser({ ...SUPER_ROW, acting_slug: null, acting_name: null });
    expect(user).toMatchObject({
      role: 'superadmin',
      orgSlug: 'fleetco',
      platformAdmin: true,
      acting: false,
    });
  });

  it('acting superadmin becomes the customer org admin, flags kept', () => {
    const user = effectiveUser({
      ...SUPER_ROW,
      acting_slug: 'acmeship',
      acting_name: 'Acmeship Oy',
    });
    expect(user).toMatchObject({
      role: 'admin',
      orgSlug: 'acmeship',
      orgName: 'Acmeship Oy',
      username: 'nauticai.admin',
      platformAdmin: true,
      acting: true,
    });
  });
});

function guardFor(policy: string, user: SessionUser | null): AuthzGuard {
  const reflector = { getAllAndOverride: () => policy } as unknown as Reflector;
  const config = { get: () => undefined } as unknown as ConfigService;
  const sessions = { resolve: async () => user } as unknown as SessionService;
  const ingest = { resolve: async () => null } as unknown as IngestCredentialService;
  return new AuthzGuard(reflector, config, sessions, ingest);
}

function ctxWithCookie(): ExecutionContext {
  const request = { headers: { cookie: 'nemolink_session=' + 'a'.repeat(64) } };
  return {
    getHandler: () => function handler() {},
    getClass: () => class Ctrl {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const ORG_ADMIN: SessionUser = {
  id: 'u1',
  username: 'admin@acmeship.example',
  displayName: 'A',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

const UNSWITCHED: SessionUser = {
  id: 'sa-1',
  username: 'nauticai.admin',
  displayName: 'P',
  role: 'superadmin',
  orgSlug: 'fleetco',
  orgName: 'nauticAi',
  platformAdmin: true,
  acting: false,
};

describe('gates (spec 0030 AC 3)', () => {
  it('session:platform admits platform admins, 403s org admins', async () => {
    await expect(
      guardFor('session:platform', UNSWITCHED).canActivate(ctxWithCookie()),
    ).resolves.toBe(true);
    await expect(
      guardFor('session:platform', { ...UNSWITCHED, acting: true, role: 'admin' })
        .canActivate(ctxWithCookie()),
    ).resolves.toBe(true);
    await expect(
      guardFor('session:platform', ORG_ADMIN).canActivate(ctxWithCookie()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('session:admin 403s an unswitched superadmin (no org context)', async () => {
    await expect(
      guardFor('session:admin', UNSWITCHED).canActivate(ctxWithCookie()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('org reads 403 an unswitched superadmin', async () => {
    const service = new PortCallService({} as TenantDb, {} as AuditService);
    await expect(service.list(UNSWITCHED)).rejects.toThrow(ForbiddenException);
    await expect(service.fleet(UNSWITCHED)).rejects.toThrow(ForbiddenException);
  });
});

describe('acting-org switching (spec 0030 AC 4)', () => {
  function makePlatform(opts: { orgRow?: { id: string; name: string } | null }) {
    const poolQuery = jest.fn(async (sql: string) => {
      if (sql.includes('FROM platform.organization WHERE slug')) {
        return { rows: opts.orgRow ? [opts.orgRow] : [] };
      }
      return { rows: [] };
    });
    const access = jest.fn().mockResolvedValue('audit-1');
    const setActingOrg = jest.fn().mockResolvedValue(undefined);
    const resolve = jest
      .fn()
      .mockResolvedValue({ ...UNSWITCHED, role: 'admin', acting: true });
    const service = new PlatformService(
      { query: poolQuery } as unknown as Pool,
      { access } as unknown as AuditService,
      { setActingOrg, resolve } as unknown as SessionService,
    );
    return { service, access, setActingOrg, resolve };
  }

  it('selecting pins the session, audits, and returns the fresh identity', async () => {
    const { service, access, setActingOrg } = makePlatform({
      orgRow: { id: 'org-uuid', name: 'Acmeship Oy' },
    });
    const user = await service.setActingOrg(UNSWITCHED, 'token', 'acmeship');
    expect(setActingOrg).toHaveBeenCalledWith('token', 'org-uuid');
    expect(access).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'nauticai.admin',
        entityType: 'organization',
        entityId: 'acmeship',
        data: { action: 'acting_org_selected', orgSlug: 'acmeship' },
      }),
    );
    expect(user.acting).toBe(true);
  });

  it('clearing unpins and audits; unknown org -> 404, nothing touched', async () => {
    const { service, access, setActingOrg } = makePlatform({});
    await service.setActingOrg(UNSWITCHED, 'token', null);
    expect(setActingOrg).toHaveBeenCalledWith('token', null);
    expect(access).toHaveBeenCalledWith(
      expect.objectContaining({ data: { action: 'acting_org_cleared' } }),
    );

    const missing = makePlatform({ orgRow: null });
    await expect(
      missing.service.setActingOrg(UNSWITCHED, 'token', 'nope'),
    ).rejects.toThrow(NotFoundException);
    expect(missing.setActingOrg).not.toHaveBeenCalled();
    expect(missing.access).not.toHaveBeenCalled();
  });
});

describe('platform accounts are invisible to org admins (spec 0030 AC 6)', () => {
  function makeApproval(poolQuery: jest.Mock) {
    return new UserApprovalService(
      { query: poolQuery } as unknown as Pool,
      { get: () => undefined } as unknown as ConfigService,
      { content: jest.fn() } as unknown as AuditService,
      { sendTracked: jest.fn() } as unknown as NotifyService,
      { withOrg: jest.fn() } as unknown as TenantDb,
    );
  }

  it('list and role-change queries exclude superadmin rows', async () => {
    const poolQuery = jest.fn().mockResolvedValue({ rows: [] });
    const approval = makeApproval(poolQuery);
    await approval.listOrgUsers(ORG_ADMIN);
    expect(poolQuery.mock.calls[0][0]).toContain(`IS DISTINCT FROM 'superadmin'`);

    poolQuery.mockClear();
    await expect(
      approval.changeRole(ORG_ADMIN, '00000000-0000-0000-0000-000000000001', 'viewer'),
    ).rejects.toThrow();
    expect(poolQuery.mock.calls[0][0]).toContain(`IS DISTINCT FROM 'superadmin'`);
  });
});
