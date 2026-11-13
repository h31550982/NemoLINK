/**
 * Specs 0047/0048 — what the port-call block is served: the port's display
 * name, the place inside the port (area + berth), and the two flows —
 * the NEMO status and the reporting obligations.
 */

import { ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PortCallService } from '../src/canonical/port-call.service';
import type { AuditService } from '../src/audit/audit.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import type { SessionUser } from '../src/auth/session.service';

const VIEWER: SessionUser = {
  id: 'u1',
  username: 'viewer@acmeship.example',
  displayName: 'V',
  role: 'viewer',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

const ADMIN: SessionUser = { ...VIEWER, username: 'admin@acmeship.example', role: 'admin' };

const ROW = {
  id: 'pc1',
  visit_id: null,
  port_locode: 'FIAJO',
  port_name: 'Ajos',
  port_area_code: 'FIAJO-AN',
  berth: 'FIAJO-AN-1',
  eta: new Date('2026-08-25T10:00:00Z'),
  etd: new Date('2026-08-27T17:00:00Z'),
  ata: null,
  atd: null,
  status: 'expected',
  voyage_number: 'ABC123',
  cargo_description: null,
  source: null,
  source_call_id: null,
  suggestions: null,
  itinerary: null,
  cargo: null,
  created: new Date('2026-08-20T09:00:00Z'),
  updated: new Date('2026-08-24T09:00:00Z'),
  ship_id: 'v1',
  ship_name: 'Carisma',
  mmsi: '230123456',
  call_sign: 'OJAB',
  ship_data: {},
  imo_number: '9990026',
};

function listHarness(row: Record<string, unknown> = ROW) {
  const sqls: string[] = [];
  const clientQuery = jest.fn(async (sql: string) => {
    sqls.push(sql);
    if (sql.includes('platform.organization')) {
      return { rows: [{ name: 'Acmeship Oy', business_id: '1979903-5', data: {} }] };
    }
    return { rows: [row], rowCount: 1 };
  });
  const tenantDb = {
    withOrg: jest.fn(async (_s: string, fn: (c: PoolClient) => Promise<unknown>) =>
      fn({ query: clientQuery } as unknown as PoolClient),
    ),
  } as unknown as TenantDb;
  const service = new PortCallService(tenantDb, {} as unknown as AuditService);
  return { service, sqls };
}

describe('port-call list (specs 0047/0048)', () => {
  it('joins platform.location and maps the port name and place', async () => {
    const { service, sqls } = listHarness();
    const rows = await service.list(VIEWER);
    expect(sqls[0]).toContain('LEFT JOIN platform.location loc');
    expect(sqls[0]).toContain('loc.locode = pc.port_locode AND loc.is_active');
    expect(rows[0]).toMatchObject({
      portLocode: 'FIAJO',
      portName: 'Ajos',
      portAreaCode: 'FIAJO-AN',
      berth: 'FIAJO-AN-1',
      shipName: 'Carisma',
      eta: '2026-08-25T10:00:00.000Z',
    });
  });

  it('leaves portName null when the LOCODE is not in the reference data', async () => {
    const { service } = listHarness({ ...ROW, port_name: null });
    const rows = await service.list(VIEWER);
    expect(rows[0]?.portName).toBeNull();
  });

  it('carries both flows: the NEMO status and the obligations', async () => {
    const { service, sqls } = listHarness();
    const rows = await service.list(VIEWER);
    // An ETA on file = the pre-arrival details are reported (interim rule)
    expect(rows[0]?.nemoStatus).toBe('Arriving');
    expect(rows[0]?.obligations.map((o) => o.code)).toEqual([
      'VID',
      'NOA',
      'DUE',
      'ATA',
      'NOD',
      'ATD',
      'SID',
      'SHP',
      'CRT',
    ]);
    const noa = rows[0]?.obligations.find((o) => o.code === 'NOA');
    expect(noa?.dueAt).toBe('2026-08-24T10:00:00.000Z'); // ETA − 24 h
    expect(noa?.missing).toContain('Ship type (DE-005-16)');
    // The declarant profile is read once per list, not per call
    expect(sqls.filter((s) => s.includes('platform.organization'))).toHaveLength(1);
  });

  it('moors on an actual arrival and departs on an actual departure', async () => {
    const moored = listHarness({ ...ROW, ata: new Date('2026-08-25T10:20:00Z') });
    expect((await moored.service.list(VIEWER))[0]?.nemoStatus).toBe('Moored');
    const gone = listHarness({
      ...ROW,
      ata: new Date('2026-08-25T10:20:00Z'),
      atd: new Date('2026-08-27T17:30:00Z'),
    });
    expect((await gone.service.list(VIEWER))[0]?.nemoStatus).toBe('Departed');
  });
});

describe('the place inside the port (spec 0048)', () => {
  function writeHarness() {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const locked = { id: 'pc1', ship_id: 'v1', status: 'expected', data: {} };
    const spine = {
      port_locode: 'FIAJO', port_area_code: null, berth: null,
      eta: null, etd: null, ata: null, atd: null,
      voyage_number: null, cargo_description: null, status: 'expected',
    };
    const clientQuery = jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('FROM platform.ship')) return { rows: [{ id: 'v1' }], rowCount: 1 };
      if (sql.includes('INSERT INTO port_call')) return { rows: [{ id: 'pc-new' }] };
      if (sql.includes('FOR UPDATE')) return { rows: [locked], rowCount: 1 };
      if (sql.includes('RETURNING port_locode')) {
        return {
          rows: [{ ...spine, port_area_code: 'FIRAU-BE', berth: 'FIRAU-BE-BE1' }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT port_locode')) return { rows: [spine] };
      return { rows: [], rowCount: 1 };
    });
    const content = jest.fn().mockResolvedValue('audit-1');
    const tenantDb = {
      schemaFor: jest.fn().mockResolvedValue('org_acmeship'),
      withOrg: jest.fn(async (_s: string, fn: (c: PoolClient) => Promise<unknown>) =>
        fn({ query: clientQuery } as unknown as PoolClient),
      ),
    } as unknown as TenantDb;
    const service = new PortCallService(tenantDb, { content } as unknown as AuditService);
    return { service, calls, content };
  }

  it('stores the area and berth on create', async () => {
    const { service, calls, content } = writeHarness();
    await service.createManual(ADMIN, {
      shipId: '00000000-0000-4000-8000-000000000001',
      portLocode: 'FIRAU',
      portAreaCode: 'FIRAU-BE',
      berth: 'FIRAU-BE-BE1',
    });
    const insert = calls.find((c) => c.sql.includes('INSERT INTO port_call'));
    expect(insert?.params?.[8]).toBe('FIRAU-BE');
    expect(insert?.params?.[9]).toBe('FIRAU-BE-BE1');
    expect(content.mock.calls[0][0].data).toMatchObject({
      portAreaCode: 'FIRAU-BE',
      berth: 'FIRAU-BE-BE1',
    });
  });

  it('updates them and names them in the audit diff', async () => {
    const { service, calls, content } = writeHarness();
    await service.updateManual(ADMIN, 'pc1', {
      portAreaCode: 'FIRAU-BE',
      berth: 'FIRAU-BE-BE1',
    });
    const update = calls.find((c) => c.sql.includes('RETURNING port_locode'));
    expect(update?.params?.[19]).toBe(true);
    expect(update?.params?.[20]).toBe('FIRAU-BE');
    expect(update?.params?.[21]).toBe(true);
    expect(update?.params?.[22]).toBe('FIRAU-BE-BE1');
    expect(content.mock.calls[0][0].data.changes).toEqual({
      portAreaCode: { from: null, to: 'FIRAU-BE' },
      berth: { from: null, to: 'FIRAU-BE-BE1' },
    });
  });

  it('serves the port areas with their berths; org members only', async () => {
    const query = jest.fn(async () => ({
      rows: [
        {
          areas: [
            {
              code: 'FIRAU-BE',
              portAreaName: 'Hakuni',
              isps: true,
              berths: [{ code: 'FIRAU-BE-BE1', name: 'BE1' }, { code: '' }],
            },
            { portAreaName: 'no code — dropped' },
          ],
        },
      ],
    }));
    const tenantDb = {
      withOrg: jest.fn(async (_s: string, fn: (c: PoolClient) => Promise<unknown>) =>
        fn({ query } as unknown as PoolClient),
      ),
    } as unknown as TenantDb;
    const service = new PortCallService(tenantDb, {} as unknown as AuditService);

    await expect(service.portAreas(VIEWER, 'FIRAU')).resolves.toEqual([
      {
        code: 'FIRAU-BE',
        name: 'Hakuni',
        isps: true,
        berths: [{ code: 'FIRAU-BE-BE1', name: 'BE1' }],
        // spec 0051: the area's own facility + anchorages ride along
        gisisCode: null,
        anchorages: [],
      },
    ]);
    await expect(
      service.portAreas({ ...VIEWER, role: 'superadmin' }, 'FIRAU'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns none for a port with no published areas', async () => {
    const query = jest.fn(async () => ({ rows: [{ areas: null }] }));
    const tenantDb = {
      withOrg: jest.fn(async (_s: string, fn: (c: PoolClient) => Promise<unknown>) =>
        fn({ query } as unknown as PoolClient),
      ),
    } as unknown as TenantDb;
    const service = new PortCallService(tenantDb, {} as unknown as AuditService);
    await expect(service.portAreas(VIEWER, 'FIAJO')).resolves.toEqual([]);
  });
});
