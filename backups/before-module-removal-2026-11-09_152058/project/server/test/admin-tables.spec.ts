/**
 * Spec 0019 — admin tables: role change, user metadata, audit search.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import type { NotifyService } from '../src/notify/notify.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import { AuditLogService } from '../src/admin/audit-log.service';
import { UserApprovalService } from '../src/auth/user-approval.service';

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@acmeship.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

function makeApproval(poolQuery: jest.Mock) {
  const content = jest.fn().mockResolvedValue('audit-1');
  const service = new UserApprovalService(
    { query: poolQuery } as unknown as Pool,
    { get: jest.fn() } as unknown as ConfigService,
    { content } as unknown as AuditService,
    { emailEnabled: false } as unknown as NotifyService,
    { withOrg: jest.fn() } as unknown as TenantDb,
  );
  return { service, content };
}

describe('changeRole (spec 0019 AC 3)', () => {
  it('404 for unknown or cross-org users', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const { service } = makeApproval(query);
    await expect(service.changeRole(ADMIN, 'ghost', 'editor')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('400 when an admin tries to change their own role', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ id: ADMIN.id, role: 'admin', status: 'active' }],
    });
    const { service, content } = makeApproval(query);
    await expect(service.changeRole(ADMIN, ADMIN.id, 'viewer')).rejects.toThrow(
      BadRequestException,
    );
    expect(content).not.toHaveBeenCalled();
  });

  it('400 for non-active users', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ id: 'u2', role: null, status: 'pending' }],
    });
    const { service } = makeApproval(query);
    await expect(service.changeRole(ADMIN, 'u2', 'editor')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('updates the role and audits role_changed with from/to', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'u2', role: 'viewer', status: 'active' }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ username: 'crew@x.fi' }] });
    const { service, content } = makeApproval(query);
    await service.changeRole(ADMIN, 'u2', 'editor');
    expect(query.mock.calls[1][1]).toEqual(['u2', 'editor']);
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN.username,
        entityType: 'user_account',
        entityId: 'u2',
        data: expect.objectContaining({
          action: 'role_changed',
          from: 'viewer',
          to: 'editor',
        }),
      }),
    );
  });

  it('same role again is a silent no-op (no update, no audit)', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ id: 'u2', role: 'editor', status: 'active' }],
    });
    const { service, content } = makeApproval(query);
    await service.changeRole(ADMIN, 'u2', 'editor');
    expect(query).toHaveBeenCalledTimes(1);
    expect(content).not.toHaveBeenCalled();
  });

  it('rejects invalid role values', async () => {
    const query = jest.fn();
    const { service } = makeApproval(query);
    await expect(service.changeRole(ADMIN, 'u2', 'root')).rejects.toThrow(
      /Invalid role/,
    );
    expect(query).not.toHaveBeenCalled();
  });
});

describe('listOrgUsers metadata (spec 0019 AC 2)', () => {
  it('maps lockedUntil and lastSeen, null when absent', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: 'u1',
          username: 'locked@x.fi',
          email: 'locked@x.fi',
          display_name: 'Locked User',
          role: 'viewer',
          auth_type: 'local',
          status: 'active',
          created: new Date('2026-08-01T08:00:00Z'),
          locked_until: new Date('2026-08-22T12:15:00Z'),
          last_seen: new Date('2026-08-22T11:59:00Z'),
          welcome_status: null,
          welcome_updated: null,
        },
        {
          id: 'u2',
          username: 'fresh@x.fi',
          email: null,
          display_name: null,
          role: null,
          auth_type: 'oidc',
          status: 'pending',
          created: new Date('2026-08-22T09:00:00Z'),
          locked_until: null,
          last_seen: null,
          welcome_status: null,
          welcome_updated: null,
        },
      ],
    });
    const { service } = makeApproval(query);
    const users = await service.listOrgUsers(ADMIN);
    expect(users[0]).toMatchObject({
      lockedUntil: '2026-08-22T12:15:00.000Z',
      lastSeen: '2026-08-22T11:59:00.000Z',
    });
    expect(users[1]).toMatchObject({ lockedUntil: null, lastSeen: null });
  });
});

describe('audit search (spec 0019 AC 1)', () => {
  function makeAuditLog() {
    const poolQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'org-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }); // ship events (spec 0067)
    const orgQuery = jest.fn().mockResolvedValue({ rows: [] });
    const tenantDb = {
      withOrg: jest.fn(
        async (_slug: string, fn: (c: unknown) => Promise<unknown>) =>
          fn({ query: orgQuery }),
      ),
    } as unknown as TenantDb;
    const service = new AuditLogService(
      { query: poolQuery } as unknown as Pool,
      tenantDb,
    );
    return { service, poolQuery, orgQuery };
  }

  it('threads the ILIKE pattern into BOTH chains, wildcards escaped', async () => {
    const { service, poolQuery, orgQuery } = makeAuditLog();
    await service.list(ADMIN, null, 30, 'ad%_\\');

    const expected = '%ad\\%\\_\\\\%';
    expect(orgQuery.mock.calls[0][0]).toContain('ILIKE $3');
    expect(orgQuery.mock.calls[0][1][2]).toBe(expected);
    const platformCall = poolQuery.mock.calls[1];
    expect(platformCall[0]).toContain('ILIKE $4');
    expect(platformCall[1][3]).toBe(expected);
    // the org-scoping filter is untouched — q only narrows
    expect(platformCall[0]).toContain('u.org_id = $1');
    expect(platformCall[1][0]).toBe('org-uuid-1');
    // the ship-event query (spec 0067) narrows on the same pattern
    const shipCall = poolQuery.mock.calls[2];
    expect(shipCall[0]).toContain('ILIKE $4');
    expect(shipCall[1][3]).toBe(expected);
  });

  it('without q both chains receive null (no filtering)', async () => {
    const { service, poolQuery, orgQuery } = makeAuditLog();
    await service.list(ADMIN, null, 30);
    expect(orgQuery.mock.calls[0][1][2]).toBeNull();
    expect(poolQuery.mock.calls[1][1][3]).toBeNull();
    expect(poolQuery.mock.calls[2][1][3]).toBeNull();
  });
});
