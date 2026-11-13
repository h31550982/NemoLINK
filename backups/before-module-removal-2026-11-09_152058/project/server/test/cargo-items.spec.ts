/**
 * Spec 0046 — official cargoes on a port call: data.cargo storage,
 * whole-list replace / null clears, audit diff as joined HS6 codes.
 */

import type { PoolClient } from 'pg';
import { PortCallService } from '../src/canonical/port-call.service';
import type { AuditService } from '../src/audit/audit.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import type { SessionUser } from '../src/auth/session.service';

const ADMIN: SessionUser = {
  id: 'u1',
  username: 'admin@acmeship.example',
  displayName: 'A',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

interface MockCall {
  sql: string;
  params?: unknown[] | undefined;
}

function makeHarness(lockedData: Record<string, unknown>) {
  const calls: MockCall[] = [];
  const locked = { id: 'pc1', ship_id: 'v1', status: 'expected', data: lockedData };
  const spine = {
    port_locode: 'FIRAU', eta: null, etd: null, ata: null, atd: null,
    voyage_number: null, cargo_description: null, status: 'expected',
  };
  const clientQuery = jest.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('FROM platform.ship')) return { rows: [{ id: 'v1' }], rowCount: 1 };
    if (sql.includes('INSERT INTO port_call')) return { rows: [{ id: 'pc-new' }] };
    if (sql.includes('FOR UPDATE')) return { rows: [locked], rowCount: 1 };
    if (sql.includes('RETURNING port_locode')) return { rows: [spine], rowCount: 1 };
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

describe('official cargoes on manual calls (spec 0046)', () => {
  it('create stores data.cargo and audits the items', async () => {
    const { service, calls, content } = makeHarness({});
    await service.createManual(ADMIN, {
      shipId: '00000000-0000-4000-8000-000000000001',
      portLocode: 'FIRAU',
      cargoItems: [{ hs6: '470200', name: 'Sellu' }],
    });
    const insert = calls.find((c) => c.sql.includes('INSERT INTO port_call'));
    expect(JSON.parse(insert?.params?.[6] as string)).toEqual({
      cargo: [{ hs6: '470200', name: 'Sellu' }],
    });
    expect(content.mock.calls[0][0].data).toMatchObject({
      cargoItems: [{ hs6: '470200', name: 'Sellu' }],
    });
  });

  it('update replaces the list, diff shows joined codes', async () => {
    const { service, calls, content } = makeHarness({
      cargo: [{ hs6: '470200', name: 'Sellu' }],
    });
    await service.updateManual(ADMIN, 'pc1', {
      cargoItems: [
        { hs6: '440710', name: 'Sahatavara' },
        { hs6: '470200', name: 'Sellu' },
      ],
    });
    const update = calls.find((c) => c.sql.includes('RETURNING port_locode'));
    expect(update?.params?.[17]).toBe(true);
    expect(JSON.parse(update?.params?.[18] as string)).toEqual([
      { hs6: '440710', name: 'Sahatavara' },
      { hs6: '470200', name: 'Sellu' },
    ]);
    expect(content.mock.calls[0][0].data.changes).toEqual({
      cargoItems: { from: '470200', to: '440710, 470200' },
    });
  });

  it('null clears; an untouched list stays put', async () => {
    const cleared = makeHarness({ cargo: [{ hs6: '470200', name: 'Sellu' }] });
    await cleared.service.updateManual(ADMIN, 'pc1', { cargoItems: null });
    const update = cleared.calls.find((c) => c.sql.includes('RETURNING port_locode'));
    expect(JSON.parse(update?.params?.[18] as string)).toEqual([]);
    expect(cleared.content.mock.calls[0][0].data.changes).toEqual({
      cargoItems: { from: '470200', to: null },
    });

    const untouched = makeHarness({ cargo: [{ hs6: '470200', name: 'Sellu' }] });
    await untouched.service.updateManual(ADMIN, 'pc1', { voyageNumber: 'V-9' });
    const upd = untouched.calls.find((c) => c.sql.includes('RETURNING port_locode'));
    expect(upd?.params?.[17]).toBe(false);
  });
});
