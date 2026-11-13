/**
 * Spec 0068 — the master list as an external source, each org's fleet:
 * lane tiers, the NSD read landing as a lane, the Digitraffic feed, the
 * org's search / add / remove, and the platform page's unmasked list.
 */
import type { PoolClient } from 'pg';
import { NotFoundException } from '@nestjs/common';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import { ShipsService } from '../src/admin/ships.service';
import type { NemoClientService } from '../src/nemo-client/nemo-client.service';
import {
  DIGITRAFFIC_LANE,
  NSD_LANE,
  applyLaneToResolved,
  externalsOf,
  laneTier,
  lastIngestOf,
  latestExternal,
  withLane,
} from '../src/canonical/ship-lanes';
import { nsdReadIntoData } from '../src/canonical/ship-nemo';
import { parseDigitrafficVisits, upcomingImos } from '../src/refdata/digitraffic';

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@acmeship.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'acmeship',
  orgName: 'Acmeship Oy',
};

const T = {
  receivedAt: '2026-09-25T08:00:00Z',
  occurredAt: '2026-09-25T08:00:00Z',
  eventId: 'e',
  sourceRecordId: '',
};

function dbRow(data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    name: 'Pasila',
    imo_number: '9113018',
    mmsi: null,
    call_sign: null,
    is_active: true,
    created: new Date('2026-09-25T07:00:00Z'),
    updated: new Date('2026-09-25T07:30:00Z'),
    author: 'refdata-sync',
    author_org: null,
    source: 'digitraffic',
    data,
    ...extra,
  };
}

function makeService(query: jest.Mock, tenantExtra: Record<string, unknown> = {}) {
  const client = { query } as unknown as PoolClient;
  const content = jest.fn().mockResolvedValue('audit-1');
  const tenantDb = {
    schemaFor: jest.fn().mockResolvedValue('org_acmeship'),
    withOrg: jest.fn(async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client)),
    ...tenantExtra,
  } as unknown as TenantDb;
  const nemo = { findShips: jest.fn().mockRejectedValue(new Error('no NEMO in this test')) };
  const service = new ShipsService(
    tenantDb,
    { content } as unknown as AuditService,
    nemo as unknown as NemoClientService,
  );
  return { service, content, client };
}

describe('lane tiers (spec 0068 AC 2)', () => {
  it('a customer system outranks nsd, nsd outranks digitraffic, recency decides within a tier', () => {
    expect(laneTier('opsdesk')).toBe(1);
    expect(laneTier(NSD_LANE)).toBe(2);
    expect(laneTier(DIGITRAFFIC_LANE)).toBe(3);
    let data = withLane({}, DIGITRAFFIC_LANE, { name: 'PASILA' }, { ...T, occurredAt: '2026-09-25T09:00:00Z' });
    data = withLane(data, NSD_LANE, { name: 'PASILA', dwt: 4000 }, { ...T, occurredAt: '2026-09-25T09:30:00Z' });
    // the NSD read is newer than both, yet the older customer push wins the name
    data = withLane(data, 'opsdesk', { name: 'Pasila (opsDesk)' }, { ...T, occurredAt: '2026-09-01T00:00:00Z', org: 'acmeship' } as never);
    expect(latestExternal(data, 'name')).toEqual(expect.objectContaining({ source: 'opsdesk', value: 'Pasila (opsDesk)' }));
    expect(latestExternal(data, 'dwt')).toEqual(expect.objectContaining({ source: NSD_LANE, value: 4000 }));
    const cells = externalsOf(data);
    expect(Object.keys(cells).sort()).toEqual(['dwt', 'name']);
    // platform lanes are not "integrations": the last push is opsDesk's
    expect(lastIngestOf(data)).toEqual({ source: 'opsdesk', receivedAt: T.receivedAt });
  });

  it('a platform lane lands on the master values only where no customer system asserted the field', () => {
    let data = withLane({}, 'opsdesk', { name: 'Pasila (opsDesk)' }, { ...T, org: 'acmeship' } as never);
    data = withLane(data, NSD_LANE, { name: 'PASILA', mmsi: '230123456', dwt: 4000 }, T);
    const landed = applyLaneToResolved(data, NSD_LANE, { name: 'PASILA', mmsi: '230123456', dwt: 4000 });
    expect(landed.columns).toEqual({ mmsi: '230123456' }); // the name is opsDesk's
    expect((landed.data['shipData'] as Record<string, unknown>)['dwt']).toBe(4000);
  });

  it('one NSD read lands as the snapshot and, when found, as the nsd lane (spec 0068)', () => {
    const record = {
      shipId: { id: 'uuid-1', name: 'PASILA', imoid: '9113018', mmsiid: '230123456', callsignid: 'OJPA' },
    } as never;
    const found = nsdReadIntoData({}, record, '2026-09-25T10:00:00Z');
    expect(found.snapshot.shipId).toBe('uuid-1');
    expect(found.snapshot.at).toBe('2026-09-25T10:00:00Z');
    expect((found.data['lanes'] as Record<string, unknown>)[NSD_LANE]).toBeDefined();
    expect(found.columns).toEqual(expect.objectContaining({ name: 'PASILA', mmsi: '230123456', callSign: 'OJPA' }));
    const absent = nsdReadIntoData({}, null, '2026-09-25T10:00:00Z');
    expect(absent.snapshot.shipId).toBeNull();
    expect(absent.data['lanes']).toBeUndefined();
    expect(absent.columns).toEqual({});
  });
});

describe('the Digitraffic visits feed (spec 0068 AC 6)', () => {
  it('parses visits, counts the ones without an IMO, and names the upcoming hulls', () => {
    const parsed = parseDigitrafficVisits(
      JSON.stringify([
        { visitId: 'A', vesselId: '9113018', vesselName: 'PASILA', portOfCall: 'FIKOK', eta: '2099-01-01T00:00:00Z', status: 'Expected to Arrive', updateTime: 't1' },
        { visitId: 'B', vesselId: '', portOfCall: 'FIKOK', eta: '2099-01-01T00:00:00Z', status: 'Cancelled', updateTime: 't2' },
        { visitId: 'C', vesselId: '9769104', vesselName: 'EEVA VG', eta: '2020-01-01T00:00:00Z', etd: '2020-01-02T00:00:00Z', status: 'Departed', updateTime: 't3' },
        { visitId: 'D', vesselId: '9179361', vesselName: 'AAVA VG', eta: '2099-02-01T00:00:00Z', status: 'Cancelled', updateTime: 't4' },
        { nothing: true },
      ]),
    );
    expect(parsed.received).toBe(5);
    expect(parsed.visits).toHaveLength(4);
    expect(parsed.withoutImo).toBe(1);
    expect(parsed.visits[0]).toEqual(expect.objectContaining({ imo: '9113018', name: 'PASILA', portOfCall: 'FIKOK' }));
    // a cancelled visit and a past one are not upcoming
    expect(upcomingImos(parsed.visits, Date.parse('2026-09-25T00:00:00Z'))).toEqual(['9113018']);
    expect(() => parseDigitrafficVisits('not json')).toThrow(/not JSON/);
    expect(() => parseDigitrafficVisits('{}')).toThrow(/array/);
  });
});

describe('the org\'s way into the master list (spec 0068 AC 4)', () => {
  it('search matches name anywhere and IMO from the start, needs two characters, says in-fleet and in-NEMO', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        { id: 'v1', name: 'PASILA', imo_number: '9113018', mmsi: null, call_sign: null, nemo: { at: 't', shipId: 'u' }, in_fleet: true },
        { id: 'v2', name: 'PASSAT', imo_number: '9000001', mmsi: null, call_sign: null, nemo: null, in_fleet: false },
      ],
    });
    const { service } = makeService(query);
    expect(await service.search(ADMIN, 'p')).toEqual([]);
    expect(query).not.toHaveBeenCalled();

    const hits = await service.search(ADMIN, 'pa');
    expect(query.mock.calls[0][0]).toContain('s.is_active');
    expect(query.mock.calls[0][1]).toEqual(['%pa%', null]);
    expect(hits).toEqual([
      expect.objectContaining({ id: 'v1', inFleet: true, inNemo: 'yes' }),
      expect.objectContaining({ id: 'v2', inFleet: false, inNemo: 'unread' }),
    ]);

    await service.search(ADMIN, '911');
    expect(query.mock.calls[1][1]).toEqual(['%911%', '911%']);
    await service.search(ADMIN, '50%_x');
    expect(query.mock.calls[2][1][0]).toBe('%50\\%\\_x%');
  });

  it('add creates the fleet row, audits fleet_added on the org chain, and tries the NEMO prefill', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ nemo_at: null }] }) // the master ship, snapshot never read
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no fleet row yet
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'f-new' }] }) // INSERT fleet_ship
      .mockResolvedValue({ rowCount: 1, rows: [dbRow({}, { fleet_id: 'f-new', fleet_since: new Date('2026-09-25T08:00:00Z'), fleet_author: 'admin@acmeship.example', fleet_source: 'admin-ui', fleet_data: {} })] });
    const { service, content, client } = makeService(query);
    const row = await service.addToFleet(ADMIN, 'v1');
    expect(query.mock.calls[2][0]).toContain('INSERT INTO fleet_ship');
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'fleet_ship',
        entityId: 'f-new',
        schema: 'org_acmeship',
        data: { action: 'fleet_added', shipId: 'v1' },
      }),
      client,
    );
    // the prefill failed quietly (no NEMO in this test): the add still stands
    expect(row.fleet).toEqual(expect.objectContaining({ id: 'f-new', addedBy: 'admin@acmeship.example' }));
    expect(row.addedBy).toBe('Digitraffic');
  });

  it('add is idempotent for a ship already in the fleet and brings a left one back with its overrides', async () => {
    const active = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ nemo_at: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'f1', is_active: true }] })
      .mockResolvedValue({ rowCount: 1, rows: [dbRow({}, { fleet_id: 'f1', fleet_since: new Date(), fleet_author: 'x', fleet_source: 'admin-ui', fleet_data: {} })] });
    const a = makeService(active);
    await a.service.addToFleet(ADMIN, 'v1');
    expect(a.content).not.toHaveBeenCalled();
    expect(active.mock.calls.some((c) => String(c[0]).includes('INSERT INTO fleet_ship'))).toBe(false);

    const left = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ nemo_at: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'f1', is_active: false }] })
      .mockResolvedValue({ rowCount: 1, rows: [dbRow({}, { fleet_id: 'f1', fleet_since: new Date(), fleet_author: 'x', fleet_source: 'admin-ui', fleet_data: {} })] });
    const b = makeService(left);
    await b.service.addToFleet(ADMIN, 'v1');
    expect(left.mock.calls[2][0]).toContain('UPDATE fleet_ship SET is_active = true');
    expect(b.content.mock.calls[0][0].data).toEqual({ action: 'fleet_added', shipId: 'v1', rejoined: true });
  });

  it('remove deactivates the fleet row and audits fleet_removed; 404 when not in the fleet', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'f1' }] });
    const { service, content } = makeService(query);
    await service.removeFromFleet(ADMIN, 'v1');
    expect(query.mock.calls[0][0]).toContain('UPDATE fleet_ship SET is_active = false');
    expect(content.mock.calls[0][0]).toEqual(
      expect.objectContaining({ entityType: 'fleet_ship', entityId: 'f1', schema: 'org_acmeship', data: { action: 'fleet_removed', shipId: 'v1' } }),
    );
    const gone = makeService(jest.fn().mockResolvedValue({ rowCount: 0, rows: [] }));
    await expect(gone.service.removeFromFleet(ADMIN, 'v1')).rejects.toThrow(NotFoundException);
  });
});

describe('the platform page\'s master list (spec 0068 AC 7)', () => {
  it('lists every ship unmasked with the fleets it is in', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [dbRow({}, { author: 'admin@acmeship.example', author_org: 'acmeship', source: 'admin-ui' })] })
      .mockResolvedValueOnce({ rows: [{ ship_id: 'v1' }] }) // org_acmeship.fleet_ship
      .mockResolvedValueOnce({ rows: [] }); // org_prima.fleet_ship
    const client = { query } as unknown as PoolClient;
    const { service } = makeService(query, {
      activeOrgs: jest.fn().mockResolvedValue([
        { slug: 'acmeship', schema: 'org_acmeship' },
        { slug: 'globex', schema: 'org_prima' },
      ]),
      platform: jest.fn(async (fn: (c: PoolClient) => Promise<unknown>) => fn(client)),
    });
    const [row] = await service.listAll({ ...ADMIN, platformAdmin: true });
    expect(query.mock.calls[1][0]).toContain('org_acmeship.fleet_ship');
    expect(row!.fleets).toEqual(['acmeship']);
    expect(row!.addedBy).toBe('admin@acmeship.example (acmeship)');
    expect(row!.fleet).toBeNull();
  });
});
