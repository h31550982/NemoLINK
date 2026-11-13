/**
 * Spec 0061 — ship field lanes on the admin side: an edit of a field a
 * source has asserted becomes an override (or drops one when it agrees),
 * use-source re-resolves from the lane, rows expose lanes and overrides.
 */
import type { PoolClient } from 'pg';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import { ShipsService } from '../src/admin/ships.service';
import type { NemoClientService } from '../src/nemo-client/nemo-client.service';
import {
  applyCertSupersession,
  certExpiryKey,
  laneFieldsFromEnvelope,
  lastIngestOf,
  latestExternal,
  parseCertExpiryKey,
  withLane,
  withOverride,
} from '../src/canonical/ship-lanes';
import { envelopeSchema } from '../src/ingest/envelope.schema';

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@acmeship.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

const CERT_KEY = 'ram:MaritimeApplicableSpecifiedCertificate';

/** A ship opsDesk pushed: dwt 4100, operator Acmeship, LL expiry 2028-11-01. */
const LANED = {
  shipData: { dwt: 4100, operator_name: 'Acmeship' },
  [CERT_KEY]: [{ 'ram:TypeCode': 'LL', 'ram:ID': 'LL-1', 'ram:ExpiryDate': '2028-11-01' }],
  lanes: {
    opsdesk: {
      receivedAt: '2026-09-16T13:00:00Z',
      occurredAt: '2026-09-16T13:00:00Z',
      eventId: 'opsdesk-ship-1-v1',
      sourceRecordId: 'sr1',
      fields: {
        name: 'Aava VG',
        mmsi: '230719000',
        dwt: 4100,
        operatorName: 'Acmeship',
        'cert:LL:LL-1:expiryDate': '2028-11-01',
      },
    },
  },
};

function dbRow(data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    name: 'Aava VG',
    imo_number: '9179361',
    mmsi: '230719000',
    call_sign: null,
    is_active: true,
    created: new Date('2026-09-16T12:00:00Z'),
    updated: new Date('2026-09-16T13:00:00Z'),
    source: 'ingest:opsdesk',
    author_org: 'acmeship',
    data,
    ...extra,
  };
}

function makeService(query: jest.Mock) {
  const client = { query } as unknown as PoolClient;
  const content = jest.fn().mockResolvedValue('audit-1');
  const tenantDb = {
    schemaFor: jest.fn().mockResolvedValue('org_acmeship'),
    withOrg: jest.fn(async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client)),
  } as unknown as TenantDb;
  return { service: new ShipsService(tenantDb, { content } as unknown as AuditService, {} as unknown as NemoClientService), content };
}

/** The data the UPDATE wrote (second call; the first is the FOR UPDATE read). */
function written(query: jest.Mock, index = 1): Record<string, unknown> {
  const params = query.mock.calls[index][1] as unknown[];
  const json = params.find((p) => typeof p === 'string' && (p as string).startsWith('{'));
  return JSON.parse(json as string) as Record<string, unknown>;
}

describe('lane helpers', () => {
  it('keys certificates by type and id, and parses the expiry key back', () => {
    expect(certExpiryKey('LL', 'LL-1')).toBe('cert:LL:LL-1:expiryDate');
    expect(certExpiryKey('LL')).toBe('cert:LL::expiryDate');
    expect(parseCertExpiryKey('cert:LL:LL-1:expiryDate')).toEqual({ typeCode: 'LL', certificateId: 'LL-1' });
    expect(parseCertExpiryKey('cert:LL::expiryDate')).toEqual({ typeCode: 'LL', certificateId: null });
    expect(parseCertExpiryKey('dwt')).toBeNull();
  });

  it('latest external picks the newest occurredAt across sources; lastIngest the newest receivedAt', () => {
    let data: Record<string, unknown> = {};
    data = withLane(data, 'opsdesk', { dwt: 4100 }, {
      receivedAt: '2026-09-16T13:00:00Z', occurredAt: '2026-09-16T12:00:00Z', eventId: 'a', sourceRecordId: 'sr-a',
    });
    data = withLane(data, 'next', { dwt: 4150 }, {
      receivedAt: '2026-09-16T12:30:00Z', occurredAt: '2026-09-16T12:45:00Z', eventId: 'b', sourceRecordId: 'sr-b',
    });
    expect(latestExternal(data, 'dwt')).toEqual(
      expect.objectContaining({ source: 'next', value: 4150 }),
    );
    expect(latestExternal(data, 'length')).toBeNull();
    expect(lastIngestOf(data)).toEqual({ source: 'opsdesk', receivedAt: '2026-09-16T13:00:00Z' });
  });

  it('override set and clear keep the namespace tidy', () => {
    const on = withOverride({}, 'dwt', { value: 3900, author: 'a', at: 't' });
    expect(on['overrides']).toEqual({ dwt: { value: 3900, author: 'a', at: 't' } });
    const off = withOverride(on, 'dwt', null);
    expect(off['overrides']).toBeUndefined();
  });

  it('lane fields from an envelope cover identity, particulars and certificates', () => {
    const envelope = envelopeSchema.parse({
      sourceSystem: 'opsdesk',
      eventId: 'e1',
      occurredAt: '2026-09-16T13:00:00Z',
      payloadType: 'ship',
      ship: { imoNumber: '9179361', name: ' Aava VG ', mmsi: '230719000', callSign: 'OJVG' },
      payload: {
        dwt: 4100,
        iceClass: { code: 'FS1A' },
        certificates: [{ typeCode: 'LL', expiryDate: '2028-11-01' }],
      },
    });
    if (envelope.payloadType !== 'ship') throw new Error('not a ship envelope');
    expect(laneFieldsFromEnvelope(envelope)).toEqual({
      name: 'Aava VG',
      mmsi: '230719000',
      callSign: 'OJVG',
      dwt: 4100,
      iceClass: { code: 'FS1A' },
      'cert:LL:': { typeCode: 'LL', expiryDate: '2028-11-01' },
      'cert:LL::expiryDate': '2028-11-01',
    });
  });
});

describe('rule 6 — a newer external expiry supersedes the override (spec 0061 AC 7)', () => {
  const laned = (external: string, override: string, stored: string) => ({
    [CERT_KEY]: [{ 'ram:TypeCode': 'LL', 'ram:ID': 'LL-1', 'ram:ExpiryDate': stored }],
    lanes: {
      opsdesk: {
        receivedAt: '2026-09-16T13:00:00Z', occurredAt: '2026-09-16T13:00:00Z',
        eventId: 'e', sourceRecordId: 'sr', fields: { 'cert:LL:LL-1:expiryDate': external },
      },
    },
    overrides: { 'cert:LL:LL-1:expiryDate': { value: override, author: 'x', at: 't' } },
  });

  it('external later than the override: flagged, external date resolved', () => {
    const { data, superseded } = applyCertSupersession(laned('2029-06-01', '2029-01-01', '2029-01-01'));
    expect(superseded).toEqual(['cert:LL:LL-1:expiryDate']);
    expect((data[CERT_KEY] as Record<string, unknown>[])[0]!['ram:ExpiryDate']).toBe('2029-06-01');
    expect((data['overrides'] as Record<string, { superseded?: boolean }>)['cert:LL:LL-1:expiryDate']!.superseded).toBe(true);
  });

  it('override later than the external: stands, no flag', () => {
    const { data, superseded } = applyCertSupersession(laned('2028-11-01', '2029-01-01', '2029-01-01'));
    expect(superseded).toEqual([]);
    expect((data[CERT_KEY] as Record<string, unknown>[])[0]!['ram:ExpiryDate']).toBe('2029-01-01');
    expect((data['overrides'] as Record<string, { superseded?: boolean }>)['cert:LL:LL-1:expiryDate']!.superseded).toBeUndefined();
  });

  it('the flag clears once the override is the later date again', () => {
    const flagged = withOverride(laned('2028-11-01', '2029-01-01', '2029-01-01'), 'cert:LL:LL-1:expiryDate', {
      value: '2029-01-01', author: 'x', at: 't', superseded: true,
    });
    const { data } = applyCertSupersession(flagged);
    expect((data['overrides'] as Record<string, { superseded?: boolean }>)['cert:LL:LL-1:expiryDate']!.superseded).toBeUndefined();
  });

  it('an admin override older than the source is disregarded on save (rule 6 at read, spec 0068)', async () => {
    const h = fleetHarness(LANED);
    const row = await h.service.update(ADMIN, 'v1', {
      certificates: [{ typeCode: 'LL', certificateId: 'LL-1', expiryDate: '2027-01-01' }],
    });
    // the shared row keeps the source's date; the typed date is the org's override, flagged
    expect((h.state.master[CERT_KEY] as Record<string, unknown>[])[0]!['ram:ExpiryDate']).toBe('2028-11-01');
    const o = (h.state.fleet['overrides'] as Record<string, { value: unknown }>)['cert:LL:LL-1:expiryDate']!;
    expect(o.value).toBe('2027-01-01');
    expect(row.overrides['cert:LL:LL-1:expiryDate']?.superseded).toBe(true);
    expect(row.certificates[0]?.expiryDate).toBe('2028-11-01'); // To NEMO
  });
});

// ---- the org's edits on a fleet row (specs 0061, 0068) ----------------------
// A stateful DB double: SELECTs return the master row joined with the org's
// fleet row; UPDATEs land in that state, so what a call reads back is what
// it wrote. The registrar of the master row is acmeship (author_org).
function fleetHarness(
  master: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
  viewer: SessionUser = ADMIN,
) {
  const state = {
    master: { ...master } as Record<string, unknown>,
    columns: {
      name: 'Aava VG' as string | null,
      mmsi: '230719000' as string | null,
      call_sign: null as string | null,
      imo_number: '9179361' as string | null,
    },
    fleet: (Object.keys(overrides).length ? { overrides: { ...overrides } } : {}) as Record<string, unknown>,
  };
  const calls: { sql: string; params?: unknown[] }[] = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('UPDATE platform.ship')) {
      const p = params ?? [];
      // [id, nameFlag, name, mmsiFlag, mmsi, csFlag, cs, imoFlag, imo, data]
      if (p[1]) state.columns.name = p[2] as string | null;
      if (p[3]) state.columns.mmsi = p[4] as string | null;
      if (p[5]) state.columns.call_sign = p[6] as string | null;
      if (p[7]) state.columns.imo_number = p[8] as string | null;
      if (typeof p[9] === 'string') state.master = JSON.parse(p[9]) as Record<string, unknown>;
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('UPDATE fleet_ship SET data')) {
      state.fleet = JSON.parse(String((params ?? [])[1])) as Record<string, unknown>;
      return { rowCount: 1, rows: [] };
    }
    return {
      rowCount: 1,
      rows: [
        dbRow(state.master, {
          ...state.columns,
          fleet_id: 'f1',
          fleet_since: new Date('2026-09-20T09:00:00Z'),
          fleet_author: viewer.username,
          fleet_source: 'admin-ui',
          fleet_data: state.fleet,
        }),
      ],
    };
  });
  const content = jest.fn().mockResolvedValue('audit-1');
  const tenantDb = {
    schemaFor: jest.fn().mockResolvedValue('org_' + viewer.orgSlug),
    withOrg: jest.fn(async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) =>
      fn({ query } as unknown as PoolClient)),
  } as unknown as TenantDb;
  const service = new ShipsService(
    tenantDb,
    { content } as unknown as AuditService,
    {} as unknown as NemoClientService,
  );
  return { service, content, calls, state, query };
}

describe('admin edits become the org\'s overrides (spec 0061 AC 3, per fleet since 0068)', () => {
  it('a value that differs from the master becomes an override with author, org and time', async () => {
    const h = fleetHarness(LANED);
    const row = await h.service.update(ADMIN, 'v1', { particulars: { dwt: 3900 } });
    const overrides = h.state.fleet['overrides'] as Record<string, { value: unknown; author: string; org: string; at: string }>;
    expect(overrides['dwt']).toEqual(expect.objectContaining({ value: 3900, author: 'admin@acmeship.example', org: 'acmeship' }));
    expect(typeof overrides['dwt']!.at).toBe('string');
    // the shared row is untouched: To NEMO carries the override, External the master
    expect(h.calls.some((c) => c.sql.includes('UPDATE platform.ship'))).toBe(false);
    expect(row.particulars.dwt).toBe(3900);
    expect(row.external['dwt']).toEqual(expect.objectContaining({ value: 4100, source: 'opsdesk' }));
    // audited on the org's own chain
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'fleet_ship', schema: 'org_acmeship', data: expect.objectContaining({ action: 'overrides_updated' }) }),
      expect.anything(),
    );
  });

  it('a value equal to the master drops the override', async () => {
    const h = fleetHarness(LANED, { dwt: { value: 3900, author: 'x', at: 't' } });
    const row = await h.service.update(ADMIN, 'v1', { particulars: { dwt: 4100 } });
    expect(h.state.fleet['overrides']).toBeUndefined();
    expect(row.particulars.dwt).toBe(4100);
  });

  it('a field no source asserted edits the master row itself, no override', async () => {
    const h = fleetHarness(LANED);
    await h.service.update(ADMIN, 'v1', { particulars: { length: 89.7 } });
    expect((h.state.master['shipData'] as Record<string, unknown>)['length']).toBe(89.7);
    expect(h.state.fleet['overrides']).toBeUndefined();
    expect(h.calls.some((c) => c.sql.includes('UPDATE fleet_ship'))).toBe(false);
    expect(h.content).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'ship', data: expect.objectContaining({ action: 'updated', actorOrg: 'acmeship' }) }),
      expect.anything(),
    );
  });

  it('identity and certificate expiry follow the same rule', async () => {
    const h = fleetHarness(LANED);
    await h.service.update(ADMIN, 'v1', {
      name: 'Aava VG (Acmeship)',
      mmsi: '230719000',
      certificates: [{ typeCode: 'LL', certificateId: 'LL-1', expiryDate: '2029-01-01' }],
    });
    const overrides = h.state.fleet['overrides'] as Record<string, { value: unknown }>;
    expect(overrides['name']?.value).toBe('Aava VG (Acmeship)');
    expect(overrides['mmsi']).toBeUndefined(); // agrees with opsdesk
    expect(overrides['cert:LL:LL-1:expiryDate']?.value).toBe('2029-01-01');
    expect(h.state.columns.name).toBe('Aava VG'); // the master keeps opsdesk's name
  });

  it('the IMO number is the master list\'s identity: only the registrar changes it', async () => {
    const globex: SessionUser = { ...ADMIN, id: 'a2', username: 'ops@globex.example', orgSlug: 'globex', orgName: 'Globex' };
    const h = fleetHarness(LANED, {}, globex);
    await expect(h.service.update(globex, 'v1', { imoNumber: '7654321' })).rejects.toBeInstanceOf(BadRequestException);
    const own = fleetHarness(LANED);
    await own.service.update(ADMIN, 'v1', { imoNumber: '7654321' });
    expect(own.state.columns.imo_number).toBe('7654321');
  });
});

describe('use-source (spec 0061 AC 4, per fleet since 0068)', () => {
  it('drops the org\'s override and audits override_cleared on the org chain', async () => {
    const h = fleetHarness(LANED, { dwt: { value: 3900, author: 'x', at: 't' } });
    const row = await h.service.useSource(ADMIN, 'v1', 'dwt');
    expect(h.state.fleet['overrides']).toBeUndefined();
    expect(row.particulars.dwt).toBe(4100);
    expect(h.calls.some((c) => c.sql.includes('UPDATE platform.ship'))).toBe(false);
    expect(h.content.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        entityType: 'fleet_ship',
        schema: 'org_acmeship',
        data: expect.objectContaining({ action: 'override_cleared', field: 'dwt', source: 'opsdesk', value: 4100 }),
      }),
    );
  });

  it('404 when no source asserted the field, and when the org holds no override', async () => {
    const h = fleetHarness(LANED, { dwt: { value: 3900, author: 'x', at: 't' } });
    await expect(h.service.useSource(ADMIN, 'v1', 'length')).rejects.toThrow(NotFoundException);
    await expect(h.service.useSource(ADMIN, 'v1', 'name')).rejects.toThrow(NotFoundException);
  });
});

describe('rows expose lanes, overrides, the External column and lastIngest (spec 0061 AC 5, 0068)', () => {
  it('list carries them, To NEMO = override ?? master', async () => {
    const h = fleetHarness(LANED, { dwt: { value: 3900, author: 'admin@acmeship.example', org: 'acmeship', at: 't' } });
    const [row] = await h.service.list(ADMIN);
    expect(h.calls[0]!.sql).toContain('FROM fleet_ship f');
    expect(row!.lanes['opsdesk']!.fields['dwt']).toBe(4100);
    expect(row!.lanes['opsdesk']!.by).toBe('opsdesk');
    expect(row!.external['dwt']).toEqual(expect.objectContaining({ value: 4100, source: 'opsdesk' }));
    expect(row!.overrides['dwt']!.value).toBe(3900);
    expect(row!.particulars.dwt).toBe(3900);
    expect(row!.lastIngest).toEqual({ source: 'opsdesk', receivedAt: '2026-09-16T13:00:00Z' });
    expect(row!.fleet).toEqual(expect.objectContaining({ id: 'f1', addedBy: 'admin@acmeship.example' }));
  });
});

// Ships are platform data (spec 0067 AC 4): values are shared, names are not.
describe('the row as another organisation sees it (spec 0067 AC 4, 0068)', () => {
  const GLOBEX: SessionUser = { ...ADMIN, id: 'admin-2', username: 'ops@globex.example', orgSlug: 'globex', orgName: 'Globex' };

  it('masks who registered it and which system pushed — values intact, its own override named', async () => {
    const h = fleetHarness(LANED, { dwt: { value: 3900, author: 'ops@globex.example', org: 'globex', at: 't' } }, GLOBEX);
    const [row] = await h.service.list(GLOBEX);
    expect(row!.addedBy).toBe('Other organisation');
    expect(row!.own).toBe(false);
    expect(row!.lanes['opsdesk']!.by).toBe('Other organisation');
    expect(row!.external['dwt']!.source).toBe('Other organisation');
    expect(row!.lanes['opsdesk']!.fields['dwt']).toBe(4100);
    expect(row!.lastIngest?.source).toBe('Other organisation');
    expect(row!.overrides['dwt']!.author).toBe('ops@globex.example');
    expect(JSON.stringify(row)).not.toContain('acmeship');
  });

  it('the registering org and a platform admin see the names', async () => {
    const own = fleetHarness(LANED);
    const [mine] = await own.service.list(ADMIN);
    expect(mine!.addedBy).toBe('opsdesk');
    expect(mine!.own).toBe(true);
    expect(mine!.lanes['opsdesk']!.by).toBe('opsdesk');

    const seen = fleetHarness(LANED, {}, { ...GLOBEX, platformAdmin: true });
    const [all] = await seen.service.list({ ...GLOBEX, platformAdmin: true });
    expect(all!.addedBy).toBe('opsdesk (acmeship)');
    expect(all!.lanes['opsdesk']!.by).toBe('opsdesk');
  });
});
