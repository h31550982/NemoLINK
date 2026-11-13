/**
 * Spec 0064 — the "In NEMO" column for ships: the NSD record read back into
 * data.nemo, mapped to our wire keys, audited, never touching lanes or
 * overrides. The record is the one STG returned for the dummy ship CARISMA
 * on 2026-09-24 (spec 0063 session), verbatim.
 */
import type { PoolClient } from 'pg';
import { ServiceUnavailableException } from '@nestjs/common';
import type { AuditService } from '../src/audit/audit.service';
import type { SessionUser } from '../src/auth/session.service';
import type { TenantDb } from '../src/tenancy/tenant-db';
import { ShipsService } from '../src/admin/ships.service';
import {
  manualOnboardingWords,
  nemoFieldsFromRecord,
  nemoSnapshotOf,
  shipIssuesOf,
  snapshotFromRecord,
  withNemoSnapshot,
} from '../src/canonical/ship-nemo';
import {
  NemoApiError,
  type NemoClientService,
  type NemoShipRecord,
} from '../src/nemo-client/nemo-client.service';

const ADMIN: SessionUser = {
  id: 'admin-1',
  username: 'admin@fleetco.example',
  displayName: 'Admin',
  role: 'admin',
  orgSlug: 'fleetco',
  orgName: 'Fleetco Oy',
};

/** GET /nsd/api/v2/ships/b3f97113-… on STG, 2026-09-24 10:41Z (after the NOA had landed). */
const CARISMA: NemoShipRecord = {
  shipId: {
    id: 'b3f97113-a3a8-4c6f-9cb3-474565548da7',
    name: 'CARISMA',
    callsignid: 'ABCD',
    mmsiid: '230666669',
    imoid: '9990026',
    eniid: null,
    cfrid: null,
    otherid: null,
    esdid: null,
  },
  shipData: {
    id: 'b3f97113-a3a8-4c6f-9cb3-474565548da7',
    flagstate: 'FI',
    registrationcountry: 'FI00',
    length: 89.9,
    width: 13.4,
    grossweight: 2999.0,
    netweight: 1500.0,
    dwt: 4500.0,
    typeCode: 150,
    related_transport_mode: null,
    external_marking_text: null,
    ice_class_code: 'FSIII',
    main_engine_availability_indicator: null,
    summer_draught: null,
    open_water_speed_measure: 10.0,
    navigation_type_code: null,
    operator_name: 'nauticAi test operator (dummy)',
    owner_name: 'nauticAi test owner (dummy)',
    owner_registered_id: null,
    customs_checked: null,
    summerdeadweight: null,
  },
  iceClass: {
    status: 'UNCONFIRMED',
    code: 'FSIII',
    entryDate: null,
    validTo: null,
    dateOfIssue: null,
    requestedAt: null,
    updatedAt: null,
  },
  shipCertificates: [],
};

const LANED = {
  shipData: { dwt: 4100, operator_name: 'Acmeship' },
  lanes: {
    opsdesk: {
      receivedAt: '2026-09-16T13:00:00Z',
      occurredAt: '2026-09-16T13:00:00Z',
      eventId: 'e1',
      sourceRecordId: 'sr1',
      fields: { name: 'Carisma', dwt: 4100, operatorName: 'Acmeship' },
    },
  },
  overrides: { iceClass: { value: { code: 'FS1A' }, author: 'admin', at: '2026-09-17T08:00:00Z' } },
};

function dbRow(data: Record<string, unknown>) {
  return {
    id: 'v1',
    name: 'Carisma',
    imo_number: '9990026',
    mmsi: '230666669',
    call_sign: 'ABCD',
    is_active: true,
    created: new Date('2026-09-16T12:00:00Z'),
    updated: new Date('2026-09-16T13:00:00Z'),
    source: 'ingest:opsdesk',
    author_org: 'fleetco',
    data,
  };
}

function makeService(query: jest.Mock, nemo: Partial<NemoClientService>) {
  const client = { query } as unknown as PoolClient;
  const content = jest.fn().mockResolvedValue('audit-1');
  const tenantDb = {
    schemaFor: jest.fn().mockResolvedValue('org_fleetco'),
    withOrg: jest.fn(async (_slug: string, fn: (c: PoolClient) => Promise<unknown>) => fn(client)),
  } as unknown as TenantDb;
  const service = new ShipsService(
    tenantDb,
    { content } as unknown as AuditService,
    nemo as NemoClientService,
  );
  return { service, content };
}

/** The data the UPDATE wrote. */
function written(query: jest.Mock, index: number): Record<string, unknown> {
  const params = query.mock.calls[index][1] as unknown[];
  const json = params.find((p) => typeof p === 'string' && (p as string).startsWith('{'));
  return JSON.parse(json as string) as Record<string, unknown>;
}

describe('NSD record → wire keys (spec 0064 AC 1)', () => {
  it('maps identity, particulars and ice class; skips nulls; ship type becomes a string', () => {
    const fields = nemoFieldsFromRecord(CARISMA);
    expect(fields).toEqual({
      name: 'CARISMA',
      mmsi: '230666669',
      callSign: 'ABCD',
      flagState: 'FI',
      registrationCountry: 'FI00',
      operatorName: 'nauticAi test operator (dummy)',
      ownerName: 'nauticAi test owner (dummy)',
      length: 89.9,
      width: 13.4,
      grossWeight: 2999,
      netWeight: 1500,
      dwt: 4500,
      openWaterSpeedMeasure: 10,
      typeCode: '150',
      iceClass: { code: 'FSIII', status: 'UNCONFIRMED' },
    });
  });

  it('maps NSD certificates by type with the expiry as a date (spec 0065 AC 4)', () => {
    const record: NemoShipRecord = {
      ...CARISMA,
      shipCertificates: [
        { certificateTypeCode: 'CL', certificateDateOfExpiry: '2027-03-31T00:00:00Z', certificateIssuerName: 'DNV' },
        { certificateTypeCode: 'LL', certificateDateOfExpiry: null },
        { certificateDateOfExpiry: '2027-01-01' },
      ],
    };
    const snap = snapshotFromRecord(record, '2026-09-24T10:41:27Z');
    expect(snap.certificates).toEqual([
      { typeCode: 'CL', expiryDate: '2027-03-31' },
      { typeCode: 'LL', expiryDate: null },
    ]);
    expect(nemoSnapshotOf(withNemoSnapshot({}, snap))?.certificates).toEqual(snap.certificates);
  });

  it('snapshot helpers round-trip and leave the other namespaces alone', () => {
    const snap = snapshotFromRecord(CARISMA, '2026-09-24T10:41:27Z');
    expect(snap.shipId).toBe('b3f97113-a3a8-4c6f-9cb3-474565548da7');
    expect(snap.source).toBe('nsd');
    const data = withNemoSnapshot(LANED, snap);
    expect(nemoSnapshotOf(data)).toEqual(snap);
    expect(data['lanes']).toBe(LANED.lanes);
    expect(data['overrides']).toBe(LANED.overrides);
    expect(nemoSnapshotOf(LANED)).toBeNull();
    expect(snapshotFromRecord(null, '2026-09-24T10:41:27Z')).toEqual({
      shipId: null,
      at: '2026-09-24T10:41:27Z',
      source: 'nsd',
      fields: {},
      certificates: [],
    });
  });
});

describe('refresh from NEMO (spec 0064 AC 2–4)', () => {
  it('looks the ship up by IMO, stores the snapshot and audits nemo_snapshot', async () => {
    let stored: Record<string, unknown> = LANED;
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [dbRow(LANED)] }) // the ship as the org sees it
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ data: LANED }] }) // FOR UPDATE
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => {
        stored = JSON.parse(params[1] as string) as Record<string, unknown>;
        return { rowCount: 1, rows: [] };
      })
      .mockImplementationOnce(async () => ({ rowCount: 1, rows: [dbRow(stored)] })); // read back
    const findShips = jest.fn().mockResolvedValue([
      { id: 'other', name: 'CARISMA II', imoid: '9990027' },
      CARISMA.shipId,
    ]);
    const getShip = jest.fn().mockResolvedValue(CARISMA);
    const { service, content } = makeService(query, { findShips, getShip });

    const row = await service.refreshFromNemo(ADMIN, 'v1');

    expect(findShips).toHaveBeenCalledWith('fleetco', '9990026');
    expect(getShip).toHaveBeenCalledWith('fleetco', 'b3f97113-a3a8-4c6f-9cb3-474565548da7');
    const data = written(query, 2);
    const nemo = data['nemo'] as Record<string, unknown>;
    expect(nemo['shipId']).toBe('b3f97113-a3a8-4c6f-9cb3-474565548da7');
    expect(nemo['source']).toBe('nsd');
    expect(typeof nemo['at']).toBe('string');
    expect((nemo['fields'] as Record<string, unknown>)['ownerName']).toBe('nauticAi test owner (dummy)');
    // the customer lane stays as it was; the same read also lands as the nsd
    // lane of the master list (spec 0068), ranked below every customer system
    const customerLane = Object.keys(LANED.lanes)[0]!;
    expect((data['lanes'] as Record<string, unknown>)[customerLane]).toEqual(
      (LANED.lanes as Record<string, unknown>)[customerLane],
    );
    const nsd = (data['lanes'] as Record<string, { fields: Record<string, unknown> }>)['nsd']!;
    expect(nsd.fields['ownerName']).toBe('nauticAi test owner (dummy)');
    expect(row.nemo?.shipId).toBe('b3f97113-a3a8-4c6f-9cb3-474565548da7');
    expect(row.nemo?.fields['iceClass']).toEqual({ code: 'FSIII', status: 'UNCONFIRMED' });
    // what NEMO's screens show for CARISMA today (spec 0065 AC 4)
    expect(row.nemoIssues.map((i) => i.rule)).toEqual(['ship-certificates', 'ship-ice-class-status']);
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ship',
        entityId: 'v1',
        data: expect.objectContaining({
          action: 'nemo_snapshot',
          shipId: 'b3f97113-a3a8-4c6f-9cb3-474565548da7',
          found: true,
          fieldCount: 15,
        }),
      }),
      expect.anything(),
    );
  });

  it('records "not in NEMO" when NSD has no hit for the IMO', async () => {
    let stored: Record<string, unknown> = LANED;
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [dbRow(LANED)] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ data: LANED }] })
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => {
        stored = JSON.parse(params[1] as string) as Record<string, unknown>;
        return { rowCount: 1, rows: [] };
      })
      .mockImplementationOnce(async () => ({ rowCount: 1, rows: [dbRow(stored)] }));
    const findShips = jest.fn().mockResolvedValue([{ id: 'x', name: 'OTHER', imoid: '1234567' }]);
    const getShip = jest.fn();
    const { service, content } = makeService(query, { findShips, getShip });

    const row = await service.refreshFromNemo(ADMIN, 'v1');

    expect(getShip).not.toHaveBeenCalled();
    expect(row.nemo).toEqual(expect.objectContaining({ shipId: null, fields: {} }));
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'nemo_snapshot', shipId: null, found: false }),
      }),
      expect.anything(),
    );
  });

  it('answers 503 with the reason and writes nothing when NEMO cannot be reached', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [dbRow(LANED)] });
    const findShips = jest.fn().mockRejectedValue(new NemoApiError(404, 'not found'));
    const { service, content } = makeService(query, { findShips, getShip: jest.fn() });

    await expect(service.refreshFromNemo(ADMIN, 'v1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(content).not.toHaveBeenCalled();
  });

  it('a 403 says the ship database is closed to this API client (STG, 2026-09-25)', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rowCount: 1, rows: [dbRow(LANED)] });
    const findShips = jest.fn().mockRejectedValue(new NemoApiError(403, ''));
    const { service, content } = makeService(query, { findShips, getShip: jest.fn() });

    await expect(service.refreshFromNemo(ADMIN, 'v1')).rejects.toThrow(
      /ship-database read for this API client \(403\).*open question 35/,
    );
    expect(content).not.toHaveBeenCalled();
  });
});

// Creating the ship in NEMO — never twice, by hand when NEMO says so (spec 0067 AC 7)
describe('ship onboarding words (spec 0067 §5)', () => {
  it('a snapshot without an NSD uuid carries the not-in-NEMO issue with the UI link', () => {
    const issues = shipIssuesOf(snapshotFromRecord(null), Date.now(), 'https://nemo.example/');
    expect(issues).toEqual([
      expect.objectContaining({
        rule: 'ship-not-in-nemo',
        level: 'info',
        link: 'https://nemo.example/',
      }),
    ]);
    expect(issues[0]!.words).toContain('first VID');
    // no link on the mock target
    expect(shipIssuesOf(snapshotFromRecord(null), Date.now(), null)[0]!.link).toBeUndefined();
  });

  it('a ship NSD knows has no such issue', () => {
    const issues = shipIssuesOf(snapshotFromRecord(CARISMA), Date.now(), 'https://nemo.example/');
    expect(issues.some((i) => i.rule === 'ship-not-in-nemo')).toBe(false);
    // spec 0069 AC 3: the unconfirmed ice class links to NEMO, where the confirmation is requested
    expect(issues.find((i) => i.rule === 'ship-ice-class-status')?.link).toBe('https://nemo.example/');
    expect(
      shipIssuesOf(snapshotFromRecord(CARISMA), Date.now(), null).find((i) => i.rule === 'ship-ice-class-status')?.link,
    ).toBeUndefined();
  });

  it('the manual sentence is verbatim, with the link', () => {
    expect(manualOnboardingWords('https://nemo.example/')).toBe(
      'This ship needs to be created manually in NEMO by making its first VID report. ' +
        'Please log in to the NEMO user interface to do so at https://nemo.example/.',
    );
    expect(manualOnboardingWords(null)).toBe(
      'This ship needs to be created manually in NEMO by making its first VID report. ' +
        'Please log in to the NEMO user interface to do so.',
    );
  });
});
