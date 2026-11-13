/**
 * Specs 0043/0045 — captain role + structured PEC: self-service set/clear,
 * captains only, audited without certificate content; schema validation
 * for the details / none / null shapes.
 */

import { ForbiddenException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { ConfigService } from '@nestjs/config';
import { UserApprovalService } from '../src/auth/user-approval.service';
import { normalizePec, PEC_REGIONS, pecInfoSchema, type PecInfo } from '../src/auth/pec';
import type { AuditService } from '../src/audit/audit.service';
import type { NotifyService } from '../src/notify/notify.service';
import type { SessionUser } from '../src/auth/session.service';
import type { TenantDb } from '../src/tenancy/tenant-db';

const CAPTAIN: SessionUser = {
  id: 'u9',
  username: 'captain@acmeship.example',
  displayName: 'C',
  role: 'captain',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

const DETAILS: Exclude<PecInfo, { none: true }> = {
  number: 'FI12345678',
  type: 'restricted',
  regions: ['bothnia', 'saimaa'],
  ports: ['FIRAU', 'FIPOR'],
  validUntil: '2027-06-30',
};

function makeService() {
  const query = jest.fn(async () => ({ rowCount: 1, rows: [{ username: CAPTAIN.username }] }));
  const content = jest.fn(async () => 'audit-1');
  const service = new UserApprovalService(
    { query } as unknown as Pool,
    {} as ConfigService,
    { content } as unknown as AuditService,
    {} as NotifyService,
    { withOrg: jest.fn() } as unknown as TenantDb,
  );
  return { service, query, content };
}

describe('PEC schema (spec 0045 AC 1)', () => {
  it('accepts full details, none, and minimal number-only', () => {
    expect(pecInfoSchema.safeParse(DETAILS).success).toBe(true);
    expect(pecInfoSchema.safeParse({ none: true }).success).toBe(true);
    expect(pecInfoSchema.safeParse({ number: '123' }).success).toBe(true);
  });

  it('rejects unknown regions, foreign ports, bad dates, oversize numbers', () => {
    expect(pecInfoSchema.safeParse({ ...DETAILS, regions: ['lappland'] }).success).toBe(false);
    expect(pecInfoSchema.safeParse({ ...DETAILS, ports: ['SESTO'] }).success).toBe(false);
    expect(pecInfoSchema.safeParse({ ...DETAILS, validUntil: '30.06.2027' }).success).toBe(false);
    expect(pecInfoSchema.safeParse({ number: '12345678901' }).success).toBe(false);
    expect(pecInfoSchema.safeParse({ none: false }).success).toBe(false);
    expect(PEC_REGIONS).toHaveLength(7);
  });

  it('normalizePec drops empty coverage and keeps set fields', () => {
    expect(normalizePec({ number: 'X1', regions: [], ports: [] })).toEqual({ number: 'X1' });
    expect(normalizePec(DETAILS)).toEqual(DETAILS);
    expect(normalizePec({ none: true })).toEqual({ none: true });
  });
});

describe('captain PEC self-service (specs 0043/0045 AC 2)', () => {
  it('stores the document and audits without certificate content', async () => {
    const { service, query, content } = makeService();
    await service.setOwnPec(CAPTAIN, DETAILS);

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('SET pec = $2::jsonb');
    expect(params).toEqual(['u9', JSON.stringify(DETAILS)]);

    const audited = (content.mock.calls[0] as unknown as [unknown])[0] as {
      entityType: string;
      data: Record<string, unknown>;
    };
    expect(audited.entityType).toBe('user_account');
    expect(audited.data).toEqual({
      action: 'pec_updated',
      username: CAPTAIN.username,
      set: true,
      none: false,
    });
  });

  it('records none, resets with null; non-captains rejected', async () => {
    const { service, query, content } = makeService();
    await service.setOwnPec(CAPTAIN, { none: true });
    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1])
      .toEqual(['u9', JSON.stringify({ none: true })]);
    const audited = (content.mock.calls[0] as unknown as [unknown])[0] as {
      data: Record<string, unknown>;
    };
    expect(audited.data.none).toBe(true);

    await service.setOwnPec(CAPTAIN, null);
    expect((query.mock.calls[1] as unknown as [string, unknown[]])[1]).toEqual(['u9', null]);

    await expect(
      service.setOwnPec({ ...CAPTAIN, role: 'admin' }, { none: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(query.mock.calls).toHaveLength(2);
  });
});
