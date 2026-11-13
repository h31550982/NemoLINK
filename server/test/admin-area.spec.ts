/**
 * Spec 0017 — ships master data + org-scoped audit log.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseError } from 'pg';
import type { Pool, PoolClient } from 'pg';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import { AuditLogService } from '../src/admin/audit-log.service';
import { shipCreateSchema, shipUpdateSchema } from '../src/admin/ship.schema';
import { ShipsService } from '../src/admin/ships.service';
import type { NemoClientService } from '../src/nemo-client/nemo-client.service';

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@acmeship.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

const SHIP_DB_ROW = {
  id: 'v1',
  name: 'MS Test',
  imo_number: '1234567',
  mmsi: null,
  call_sign: null,
  is_active: true,
  created: new Date('2026-08-22T10:00:00Z'),
  updated: new Date('2026-08-22T10:00:00Z'),
  author_org: 'acmeship',
  data: {},
  // in the org's fleet (spec 0068)
  fleet_id: 'f1',
  fleet_since: new Date('2026-08-22T10:00:00Z'),
  fleet_author: 'admin@acmeship.example',
  fleet_source: 'admin-ui',
  fleet_data: {},
};

function uniqueViolation(): DatabaseError {
  const error = new DatabaseError('duplicate key value', 100, 'error');
  error.code = '23505';
  return error;
}

describe('ship schemas (spec 0017 AC 1)', () => {
  it('accepts a valid create', () => {
    expect(
      shipCreateSchema.safeParse({ name: 'MS Test', imoNumber: '1234567', mmsi: '230123456' })
        .success,
    ).toBe(true);
  });

  it('rejects bad IMO / MMSI / unknown keys / empty name', () => {
    expect(shipCreateSchema.safeParse({ name: 'X', imoNumber: '123' }).success).toBe(false);
    expect(shipCreateSchema.safeParse({ name: 'X', mmsi: '12345678' }).success).toBe(false);
    expect(shipCreateSchema.safeParse({ name: 'X', extra: 1 }).success).toBe(false);
    expect(shipCreateSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('update allows clearing fields with null but not bad values', () => {
    expect(shipUpdateSchema.safeParse({ imoNumber: null }).success).toBe(true);
    expect(shipUpdateSchema.safeParse({ imoNumber: 'abc1234' }).success).toBe(false);
  });
});

describe('ShipsService (spec 0017 AC 1)', () => {
  function makeService(clientQuery: jest.Mock) {
    const client = { query: clientQuery } as unknown as PoolClient;
    const content = jest.fn().mockResolvedValue('audit-1');
    const tenantDb = {
      schemaFor: jest.fn().mockResolvedValue('org_acmeship'),
      withOrg: jest.fn(
        async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client),
      ),
    } as unknown as TenantDb;
    const service = new ShipsService(tenantDb, { content } as unknown as AuditService, {} as unknown as NemoClientService);
    return { service, content, client };
  }

  it('create audits on the platform chain with the tx client and the actor\'s org (spec 0067 AC 2)', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [SHIP_DB_ROW] });
    const { service, content, client } = makeService(query);
    const row = await service.create(ADMIN, { name: 'MS Test', imoNumber: '1234567' });
    expect(row.imoNumber).toBe('1234567');
    expect(query.mock.calls[0][0]).toContain('INSERT INTO platform.ship');
    expect(query.mock.calls[0][1]).toContain('acmeship'); // author_org
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ship',
        actorId: ADMIN.username,
        data: expect.objectContaining({ action: 'created', actorOrg: 'acmeship' }),
      }),
      client,
    );
    expect((content.mock.calls[0][0] as { schema?: string }).schema).toBeUndefined();
  });

  it('duplicate IMO maps to 409', async () => {
    const query = jest.fn().mockRejectedValue(uniqueViolation());
    const { service } = makeService(query);
    await expect(service.create(ADMIN, { name: 'X', imoNumber: '1234567' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('update of an unknown ship -> 404, no audit', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const { service, content } = makeService(query);
    await expect(
      service.update(ADMIN, '00000000-0000-0000-0000-000000000001', { name: 'Y' }),
    ).rejects.toThrow(NotFoundException);
    expect(content).not.toHaveBeenCalled();
  });
});

describe('update audit diffs (spec 0032)', () => {
  const CERT_KEY = 'ram:MaritimeApplicableSpecifiedCertificate';

  function makeService(clientQuery: jest.Mock) {
    const client = { query: clientQuery } as unknown as PoolClient;
    const content = jest.fn().mockResolvedValue('audit-1');
    const tenantDb = {
      schemaFor: jest.fn().mockResolvedValue('org_acmeship'),
      withOrg: jest.fn(
        async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client),
      ),
    } as unknown as TenantDb;
    const service = new ShipsService(tenantDb, { content } as unknown as AuditService, {} as unknown as NemoClientService);
    return { service, content };
  }

  it('records only the changed fields with from/to values (AC 1)', async () => {
    const after = { ...SHIP_DB_ROW, imo_number: '7654321' };
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [SHIP_DB_ROW] }) // FOR UPDATE read
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // the UPDATE
      .mockResolvedValueOnce({ rowCount: 1, rows: [after] }); // read back
    const { service, content } = makeService(query);
    await service.update(ADMIN, 'v1', { imoNumber: '7654321' });
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(content.mock.calls[0][0].data).toEqual({
      action: 'updated',
      actorOrg: 'acmeship',
      changes: { imoNumber: { from: '1234567', to: '7654321' } },
    });
  });

  it('certificate replacement diffs as a count change (AC 2)', async () => {
    const after = { ...SHIP_DB_ROW, data: { [CERT_KEY]: [{ 'ram:TypeCode': 'BWM' }] } };
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [SHIP_DB_ROW] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [after] });
    const { service, content } = makeService(query);
    await service.update(ADMIN, 'v1', { certificates: [{ typeCode: 'BWM' }] });
    expect(content.mock.calls[0][0].data.changes).toEqual({
      certificates: { from: 0, to: 1 },
    });
  });

  it('a save that changes nothing audits empty changes (AC 3)', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [SHIP_DB_ROW] });
    const { service, content } = makeService(query);
    await service.update(ADMIN, 'v1', { name: 'MS Test', imoNumber: '1234567' });
    // nothing differs from the master: no override, nothing on the shared row (spec 0086)
    expect(content.mock.calls[0][0].data).toEqual({ action: 'overrides_updated', shipId: 'v1', changes: {} });
  });

  it('create records the initial values (AC 4)', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [SHIP_DB_ROW] });
    const { service, content } = makeService(query);
    await service.create(ADMIN, { name: 'MS Test', imoNumber: '1234567' });
    expect(content.mock.calls[0][0].data).toEqual({
      action: 'created',
      actorOrg: 'acmeship',
      name: 'MS Test',
      imoNumber: '1234567',
      mmsi: null,
      callSign: null,
      certificateCount: 0,
    });
  });
});

describe('AuditLogService org scoping (spec 0017 AC 1)', () => {
  const ORG_ID = 'org-uuid-1';

  function dbRow(seq: number, createdIso: string, entityType = 'user_account') {
    return {
      seq,
      category: 'content',
      actor_id: 'someone',
      entity_type: entityType,
      entity_id: 'e1',
      data: { action: 'approved' },
      created: new Date(createdIso),
    };
  }

  it('filters the platform query by org id and merges newest-first', async () => {
    const poolQuery = jest
      .fn()
      // org lookup
      .mockResolvedValueOnce({ rows: [{ id: ORG_ID }] })
      // platform events
      .mockResolvedValueOnce({
        rows: [dbRow(10, '2026-08-22T10:02:00Z')],
      })
      // ship events (spec 0067)
      .mockResolvedValueOnce({ rows: [] });
    const orgChainRows = [
      dbRow(3, '2026-08-22T10:03:00Z', 'ship'),
      dbRow(2, '2026-08-22T10:01:00Z', 'ship'),
    ];
    const tenantDb = {
      withOrg: jest.fn(async () => orgChainRows),
    } as unknown as TenantDb;
    const service = new AuditLogService({ query: poolQuery } as unknown as Pool, tenantDb);

    const result = await service.list(ADMIN, null, 30);

    // the platform query received the org id as its filter parameter
    const platformCall = poolQuery.mock.calls[1];
    expect(platformCall[1][0]).toBe(ORG_ID);
    expect(platformCall[0]).toContain(`u.org_id = $1`);
    // tenant-neutral refdata events are visible to every org admin (spec 0025)
    expect(platformCall[0]).toContain(`e.entity_type = 'refdata_sync'`);

    expect(result.events.map((e) => `${e.chain}:${e.seq}`)).toEqual([
      'org:3',
      'platform:10',
      'org:2',
    ]);
    expect(result.nextBefore).toBeNull();
  });

  it('caps at limit and hands back a cursor', async () => {
    const poolQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: ORG_ID }] })
      .mockResolvedValueOnce({ rows: [dbRow(10, '2026-08-22T10:02:00Z')] })
      .mockResolvedValueOnce({ rows: [] });
    const tenantDb = {
      withOrg: jest.fn(async () => [dbRow(3, '2026-08-22T10:03:00Z', 'ship')]),
    } as unknown as TenantDb;
    const service = new AuditLogService({ query: poolQuery } as unknown as Pool, tenantDb);

    const result = await service.list(ADMIN, null, 1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.chain).toBe('org');
    expect(result.nextBefore).toBe('2026-08-22T10:03:00.000Z');
  });

  // Ships are platform data (spec 0067 AC 3): every org sees that a ship
  // changed, but who did it stays inside the org that did it.
  describe('ship events across organisations (spec 0067 AC 3)', () => {
    function shipEvent(seq: number, actorOrg: string, actor: string) {
      return {
        seq,
        category: 'content',
        actor_id: actor,
        entity_type: 'ship',
        entity_id: 'ship-1',
        data: {
          action: 'updated',
          actorOrg,
          changes: { name: { from: 'A', to: 'B' } },
          request: { ip: '10.0.0.1', userAgent: 'x' },
          envelope: { sourceSystem: 'opsdesk' },
        },
        created: new Date('2026-09-24T10:00:00Z'),
      };
    }
    function make(rows: unknown[]) {
      const poolQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: ORG_ID }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows });
      const tenantDb = { withOrg: jest.fn(async () => []) } as unknown as TenantDb;
      return { poolQuery, service: new AuditLogService({ query: poolQuery } as unknown as Pool, tenantDb) };
    }

    it('another org\'s event is "Other organisation" with action and changes only', async () => {
      const { service } = make([shipEvent(20, 'globex', 'ops@globex.example')]);
      const { events } = await service.list(ADMIN, null, 30);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        chain: 'platform',
        actorId: 'Other organisation',
        masked: true,
        data: { action: 'updated', changes: { name: { from: 'A', to: 'B' } } },
      });
      expect(JSON.stringify(events[0])).not.toContain('globex');
      expect(JSON.stringify(events[0])).not.toContain('10.0.0.1');
      expect(JSON.stringify(events[0])).not.toContain('opsdesk');
    });

    it('the viewer\'s own event and a platform admin\'s view are unmasked', async () => {
      const own = make([shipEvent(21, 'acmeship', 'admin@acmeship.example')]);
      const mine = await own.service.list(ADMIN, null, 30);
      expect(mine.events[0]?.actorId).toBe('admin@acmeship.example');
      expect(mine.events[0]?.masked).toBeUndefined();
      expect(mine.events[0]?.data['request']).toBeDefined();

      const platform = make([shipEvent(22, 'globex', 'ops@globex.example')]);
      const all = await platform.service.list({ ...ADMIN, platformAdmin: true }, null, 30);
      expect(all.events[0]?.actorId).toBe('ops@globex.example');
      expect(all.events[0]?.masked).toBeUndefined();
    });

    it('the ship query takes the org, the search pattern and the mask words as parameters', async () => {
      const { service, poolQuery } = make([]);
      await service.list(ADMIN, null, 30, 'globex');
      const shipCall = poolQuery.mock.calls[2];
      expect(shipCall[0]).toContain("e.entity_type = 'ship'");
      expect(shipCall[0]).toContain("e.data->>'actorOrg' = $1");
      expect(shipCall[1]).toEqual(['acmeship', null, 30, '%globex%', false, 'Other organisation', false]);
    });
  });
});
