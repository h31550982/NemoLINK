/**
 * Spec 0048 — the two flows of a port call: the NEMO port-call status and
 * the reporting obligations (what is done, what is missing, what is due).
 */

import {
  flowProgress,
  nextReport,
  ALWAYS_CODES,
  DUE_SOON_HOURS,
  NOA_LEAD_HOURS,
  SHIP_DATA_CODES,
  nemoStatus,
  obligationsOf,
  type Obligation,
  type ObligationSnapshot,
} from '../src/canonical/obligations';

const HOUR = 3600_000;
const NOW = Date.parse('2026-08-24T12:00:00Z');

/** A fully-known call: every checklist item NEMOLink can pre-fill is filled. */
function full(over: Partial<ObligationSnapshot> = {}): ObligationSnapshot {
  return {
    created: '2026-08-20T08:00:00Z',
    status: 'expected',
    eta: '2026-08-26T10:00:00Z',
    etd: '2026-08-27T18:00:00Z',
    ata: null,
    atd: null,
    portLocode: 'FIRAU',
    portAreaCode: 'FIRAU-BE',
    berth: 'FIRAU-BE-BE1',
    voyageNumber: 'ABC123',
    cargoDescription: null,
    cargoCount: 1,
    prevPortCount: 1,
    nextPortCount: 1,
    prevPorts: ['SEGOT'],
    nextPorts: ['FIHKO'],
    ship: {
      name: 'Carisma',
      imoNumber: '9990026',
      mmsi: '230123456',
      callSign: 'OJAB',
      typeCode: '821',
      flagState: 'FI',
      grossWeight: 2500,
      netWeight: 1200,
      length: 89.9,
      width: 12.5,
      certificates: ['TM', 'REG', 'CL', 'LL', 'ISPS'].map((typeCode) => ({
        typeCode,
        expiryDate: '2028-01-01',
      })),
      // What the SHP send carries (spec 0075: SHIP_FIELD_HOMES, sent)
      fields: {
        dwt: 3100,
        ownerName: 'Carisma Shipping Oy',
        operatorName: 'Acmeship Oy',
        iceClass: '1A',
        buildDate: '2005-03-01',
        keelLayingDate: '2004-06-01',
        inertGasSystem: false,
        mainEnginePower: 2000,
        openWaterSpeedMeasure: 12,
        registrationCountry: 'FI',
        registryCode: 'FI00',
        registryPort: 'FIHEL',
      },
      nemo: null,
    },
    org: {
      name: 'Acmeship Oy',
      businessId: '1979903-5',
      agentId: 'FI1979903-5',
      agentMobile: '+358401234567',
      agencyName: 'Acmeship Oy',
      agentEmail: 'ops@acmeship.example',
      agentPhone: '+358401234567',
      street: 'Satamakatu 1',
      postcode: '20100',
      city: 'Turku',
      countryCode: 'FI',
    },
    submitted: [],
    confirmed: [],
    // The NOA facts without a source yet (spec 0087), as a filled call would carry them
    notice: {
      maxDraught: 5.2,
      purposeOfCall: '1',
      crew: 9,
      personsOnBoard: 9,
      masterFamilyName: 'Sparrow',
      masterGivenNames: 'Jack',
    },
    now: NOW,
    ...over,
  };
}

function byCode(snap: ObligationSnapshot) {
  const map = new Map(obligationsOf(snap).map((o) => [o.code, o]));
  return (code: string) => {
    const o = map.get(code);
    if (!o) throw new Error(`no obligation ${code}`);
    return o;
  };
}

describe('NEMO port-call status (vendored declarant enum)', () => {
  const base = { status: 'expected', eta: null, ata: null, atd: null };

  it('walks Unconfirmed → Arriving → Moored → Departed', () => {
    expect(nemoStatus(base)).toBe('Unconfirmed');
    expect(nemoStatus({ ...base, eta: '2026-08-26T10:00:00Z' })).toBe('Arriving');
    expect(
      nemoStatus({ ...base, eta: '2026-08-26T10:00:00Z', ata: '2026-08-26T10:20:00Z' }),
    ).toBe('Moored');
    expect(
      nemoStatus({
        ...base,
        eta: '2026-08-26T10:00:00Z',
        ata: '2026-08-26T10:20:00Z',
        atd: '2026-08-27T18:30:00Z',
      }),
    ).toBe('Departed');
  });

  it('cancels on the local status or on a submitted COA', () => {
    expect(nemoStatus({ ...base, status: 'cancelled' })).toBe('Cancelled');
    expect(nemoStatus({ ...base, submitted: ['COA'] })).toBe('Cancelled');
  });

  it('reads submitted formalities when they exist (Phase 2 path)', () => {
    expect(nemoStatus({ ...base, submitted: ['VID', 'NOA'] })).toBe('Arriving');
    expect(nemoStatus({ ...base, submitted: ['VID', 'NOA', 'ATA'] })).toBe('Moored');
  });
});

describe('obligation flow (spec 0048)', () => {
  it('covers the always-given reports plus ship data, in flow order', () => {
    expect(obligationsOf(full()).map((o) => o.code)).toEqual([
      ...ALWAYS_CODES,
      ...SHIP_DATA_CODES,
    ]);
  });

  it('a fully-known call is ready everywhere, nothing missing', () => {
    const at = byCode(full({ ata: '2026-08-26T10:20:00Z', atd: '2026-08-27T18:30:00Z' }));
    for (const code of ['VID', 'NOA', 'DUE', 'NOD', 'SID', 'SHP', 'CRT']) {
      expect([code, at(code).state]).toEqual([code, 'ready']);
      expect(at(code).missing).toEqual([]);
    }
  });

  it('the actuals wait for NEMO\'s order: notices sent and confirmed first (spec 0065 AC 6)', () => {
    const actuals = { ata: '2026-08-26T10:20:00Z', atd: '2026-08-27T18:30:00Z' };
    const at = byCode(full(actuals));
    expect(at('ATA').state).toBe('missing');
    expect(at('ATA').missing).toEqual([
      'NOA sent to NEMO',
      'DUE sent to NEMO',
      'Arrival confirmed to Customs in the NOA (ST-FI-01)',
    ]);
    expect(at('ATD').missing).toEqual([
      'NOD sent to NEMO',
      'ATA sent to NEMO',
      'Departure confirmed to Customs in the NOD (ST-FI-02)',
    ]);
    const later = byCode(
      full({ ...actuals, submitted: ['VID', 'NOA', 'DUE', 'NOD', 'ATA'], confirmed: ['NOA', 'NOD'] }),
    );
    expect(later('ATA').state).toBe('sent');
    expect(later('ATD').state).toBe('ready');
    expect(later('ATD').missing).toEqual([]);
    // a confirmation is not the same as a submission
    const unconfirmed = byCode(full({ ...actuals, submitted: ['VID', 'NOA', 'DUE'] }));
    expect(unconfirmed('ATA').missing).toEqual(['Arrival confirmed to Customs in the NOA (ST-FI-01)']);
  });

  it('an empty call has not started, and names what is missing', () => {
    const at = byCode(
      full({
        eta: null,
        etd: null,
        voyageNumber: null,
        cargoCount: 0,
        prevPortCount: 0,
        nextPortCount: 0,
        portLocode: null,
        ship: null,
        org: {
          name: null,
          businessId: null,
          agencyName: null,
          agentEmail: null,
          agentPhone: null,
        },
      }),
    );
    expect(at('VID').state).toBe('notStarted');
    expect(at('VID').missing).toHaveLength(at('VID').total);
    expect(at('NOA').missing).toContain('Estimated arrival (DE-022-02)');
    expect(at('NOA').missing).toContain('Agent email (DE-029-08)');
    expect(at('ATA').state).toBe('notStarted');
  });

  it('a partly-known call counts what is still missing', () => {
    const at = byCode(full({ prevPorts: [], prevPortCount: 0 }));
    const noa = at('NOA');
    expect(noa.state).toBe('missing');
    // Without the last port the type of voyage cannot be told either
    expect(noa.missing).toEqual([
      'Last port of call (DE-022-06)',
      'Type of voyage (DE-014-22)',
    ]);
    expect(noa.filled).toBe(noa.total - 2);
    // The pre-arrival notice carries ship particulars too (spec 0048 table)
    const thin = byCode(
      full({ ship: { ...full().ship!, typeCode: null, flagState: null } }),
    );
    expect(thin('NOA').missing).toEqual([
      'Ship type (DE-005-16)',
      'Flag state (DE-005-09)',
    ]);
    // SHP counts the elements its send carries (spec 0075), not the notice's
    expect(thin('SHP').state).toBe('ready');
    const noOwner = byCode(
      full({ ship: { ...full().ship!, fields: { ...full().ship!.fields, ownerName: null } } }),
    );
    expect(noOwner('SHP').state).toBe('missing');
    expect(noOwner('SHP').missing).toEqual(['Registered owner (DE-007-10)']);
  });

  it('every item carries its To NEMO value and where it comes from (spec 0075)', () => {
    const at = byCode(full());
    const noa = at('NOA');
    const eta = noa.items.find((i) => i.de === 'DE-022-02')!;
    expect(eta).toMatchObject({ label: 'Estimated arrival', value: '2026-08-26T10:00:00Z', kind: 'time', from: 'call', ok: true });
    // A ship field (the SHP's owner; the NOD no longer lists ship particulars, spec 0092)
    const owner = at('SHP').items.find((i) => i.de === 'DE-007-10')!;
    expect(owner).toMatchObject({ value: 'Carisma Shipping Oy', from: 'ship', shipKey: 'ownerName', inNemo: { state: 'notRead', value: null } });
    const agency = noa.items.find((i) => i.de === 'DE-029-02')!;
    expect(agency).toMatchObject({ value: 'Acmeship Oy', from: 'org' });
    expect(at('SID').items.map((i) => i.shipKey)).toEqual(['name', 'imoNumber', 'mmsi', 'callSign']);
    expect(at('ATA').items[0]).toMatchObject({ label: 'NOA sent to NEMO', de: null, from: 'nemo', ok: false });
  });

  it('a ship field compares with the NEMO ship database read-back (spec 0075)', () => {
    const ship = full().ship!;
    const read = byCode(
      full({
        ship: {
          ...ship,
          nemo: { shipId: 'nsd-uuid', fields: { ownerName: 'Carisma Shipping Oy', operatorName: 'Other Oy', name: 'CARISMA' } },
        },
      }),
    );
    const byKey = (key: string) => read('SHP').items.find((i) => i.shipKey === key)!.inNemo;
    expect(byKey('ownerName')).toEqual({ state: 'same', value: 'Carisma Shipping Oy' });
    expect(byKey('operatorName')).toEqual({ state: 'differs', value: 'Other Oy' });
    expect(byKey('iceClass')).toEqual({ state: 'notInNemo', value: null });
    // Names compare without case — NSD shouts
    expect(read('VID').items.find((i) => i.shipKey === 'name')!.inNemo).toEqual({ state: 'same', value: 'CARISMA' });
    const unknown = byCode(full({ ship: { ...ship, nemo: { shipId: null, fields: {} } } }));
    expect(unknown('SID').items[0]!.inNemo).toEqual({ state: 'notInNemo', value: null });
  });

  it('the NOA lists only what NEMO requires; the next port is ZZUKN (spec 0087)', () => {
    const noa = byCode(full())('NOA');
    expect(noa.items.find((i) => i.de === 'DE-022-08')!.value).toBe('ZZUKN');
    expect(noa.items.find((i) => i.de === 'DE-014-22')!.value).toBe('V-01');
    expect(noa.items.map((i) => i.de)).not.toContain('DE-014-02');
    const home = byCode(full({ prevPorts: ['FIHKO'] }))('NOA');
    expect(home.missing).toEqual(['Type of voyage (DE-014-22)']);
  });

  it('a report NEMO refused reads rejected, with when; an earlier accepted send stays sent (2026-10-06)', () => {
    const at = byCode(full({ submitted: ['VID'], rejected: { NOA: { at: '2026-10-06T11:38:00Z' } } }));
    expect(at('NOA').state).toBe('rejected');
    expect(at('NOA').rejected).toEqual({ at: '2026-10-06T11:38:00Z' });
    expect(at('DUE').rejected).toBeNull();
    const updateRefused = byCode(full({ submitted: ['VID', 'NOA'], rejected: { NOA: { at: '2026-10-06T11:38:00Z' } } }));
    expect(updateRefused('NOA').state).toBe('sent');
    expect(updateRefused('NOA').rejected).not.toBeNull();
  });

  it('the NOA asks for the tonnages, length and breadth unless NEMO already has them (ERR-029, 2026-10-06)', () => {
    const noa = byCode(full())('NOA');
    for (const de of ['DE-008-25', 'DE-008-13', 'DE-008-27', 'DE-008-28', 'DE-008-29']) {
      expect(noa.items.map((i) => i.de)).toContain(de);
    }
    const ship = full().ship!;
    const bare = { ...ship, grossWeight: null, fields: { ...ship.fields, dwt: null } };
    expect(byCode(full({ ship: bare }))('NOA').missing).toEqual(['Gross tonnage (DE-008-27)', 'Deadweight (t) (DE-008-29)']);
    const known = { ...bare, nemo: { shipId: 'nsd-1', fields: { grossWeight: 2500, dwt: 3100 } } };
    expect(byCode(full({ ship: known }))('NOA').missing).toEqual([]);
  });

  it('a sent report says when and by whom (spec 0087)', () => {
    const at = byCode(full({ submitted: ['VID'], sentBy: { VID: { at: '2026-09-27T07:15:00Z', by: 'Henrik' } } }));
    expect(at('VID').sent).toEqual({ at: '2026-09-27T07:15:00Z', by: 'Henrik' });
    expect(at('NOA').sent).toBeNull();
  });

  it('a coded value shows as its code, not as JSON — the ice class (spec 0079 amendment 2026-09-26)', () => {
    const ship = full().ship!;
    const at = byCode(full({ ship: { ...ship, fields: { ...ship.fields, iceClass: { code: 'FSII' } } } }));
    expect(at('SHP').items.find((i) => i.shipKey === 'iceClass')!.value).toBe('FSII');
  });

  it('a submitted formality is sent, and its clock stops', () => {
    const at = byCode(full({ submitted: ['VID', 'NOA'] }));
    expect(at('VID').state).toBe('sent');
    expect(at('NOA').state).toBe('sent');
    expect(at('NOA').dueState).toBe('none');
  });
});

describe('deadlines (spec 0048)', () => {
  it('the pre-arrival notice is due 24 h before the ETA', () => {
    const noa = byCode(full())('NOA');
    expect(noa.dueAt).toBe('2026-08-25T10:00:00.000Z');
    expect(Date.parse(full().eta!) - Date.parse(noa.dueAt!)).toBe(NOA_LEAD_HOURS * HOUR);
    expect(noa.dueState).toBe('ok');
  });

  it('turns due soon inside the threshold and overdue past it', () => {
    const soon = byCode(full({ now: Date.parse('2026-08-25T10:00:00Z') - HOUR }))('NOA');
    expect(soon.dueState).toBe('soon');
    expect(DUE_SOON_HOURS).toBe(6);
    const late = byCode(full({ now: Date.parse('2026-08-25T11:00:00Z') }))('NOA');
    expect(late.dueState).toBe('overdue');
  });

  it('flags "as soon as possible" when the call appeared inside the window', () => {
    const at = byCode(full({ created: '2026-08-25T20:00:00Z' }));
    expect(at('NOA').asap).toBe(true);
    expect(at('NOA').dueState).toBe('overdue');
    expect(byCode(full())('NOA').asap).toBe(false);
  });

  it('hangs the actual-time reports on the times they confirm', () => {
    const at = byCode(full());
    expect(at('ATA').dueAt).toBe(full().eta);
    expect(at('ATD').dueAt).toBe(full().etd);
    expect(at('NOD').dueAt).toBe(full().etd);
    expect(at('VID').dueAt).toBeNull();
    expect(at('VID').dueState).toBe('none');
  });

  it('an arrival that never got reported goes overdue', () => {
    const at = byCode(full({ now: Date.parse('2026-08-26T12:00:00Z') }));
    expect(at('ATA').state).toBe('notStarted');
    expect(at('ATA').dueState).toBe('overdue');
  });
});

describe('the next report (spec 0092)', () => {
  const ob = (code: string, state: Obligation['state']) => ({ code, state }) as Obligation;
  const flow = (sent: string[]) =>
    ['VID', 'NOA', 'DUE', 'ATA', 'NOD', 'ATD', 'SID', 'SHP', 'CRT'].map((c) => ob(c, sent.includes(c) ? 'sent' : 'missing'));

  it('follows VID → NOA → DUE → ATA → NOD → ATD', () => {
    expect(nextReport(flow([]))).toBe('VID');
    expect(nextReport(flow(['VID']))).toBe('NOA');
    expect(nextReport(flow(['VID', 'NOA']))).toBe('DUE');
    expect(nextReport(flow(['VID', 'NOA', 'DUE']))).toBe('ATA');
    expect(nextReport(flow(['VID', 'NOA', 'DUE', 'ATA', 'NOD']))).toBe('ATD');
  });

  it('counts the flow sent, of all six, leaving the ship data out', () => {
    expect(flowProgress(flow([]))).toEqual({ sent: 0, total: 6 });
    expect(flowProgress(flow(['VID', 'NOA', 'SID', 'SHP']))).toEqual({ sent: 2, total: 6 });
  });

  it('is null once the departure is in, whatever the ship data says', () => {
    expect(nextReport(flow(['VID', 'NOA', 'DUE', 'ATA', 'NOD', 'ATD']))).toBeNull();
  });
});

describe('the NOD lists what NEMO checks (spec 0063 ND2, spec 0092)', () => {
  it('ETD, next port, crew and persons on board; ZZUKN when the call has no next port', () => {
    const nod = byCode(full())('NOD');
    expect(nod.items.map((i) => i.de)).toEqual(['DE-022-05', 'DE-022-08', 'DE-034-03', 'DE-034-01']);
    expect(byCode(full({ nextPorts: [] }))('NOD').items[1]!.value).toBe('ZZUKN');
    expect(byCode(full({ nextPorts: ['SEGOT'] }))('NOD').items[1]!.value).toBe('SEGOT');
  });
});

describe('the reports sent with the NOA (spec 0098)', () => {
  it('appear once sent — a refused STA in the pre-arrival group, refused; one never sent stays out', () => {
    const { obligationsOf } = jest.requireActual('../src/canonical/obligations') as typeof import('../src/canonical/obligations');
    const { noaSnapshot } = jest.requireActual('./noa-fixture') as typeof import('./noa-fixture');
    const obs = obligationsOf(noaSnapshot({ submitted: ['VID', 'NOA', 'CWA'], rejected: { STA: { at: '2026-10-06T13:00:00Z' } } }));
    expect(obs.find((o) => o.code === 'STA')).toMatchObject({ group: 'prearrival', state: 'rejected' });
    expect(obs.find((o) => o.code === 'CWA')).toMatchObject({ group: 'prearrival', state: 'sent' });
    expect(obs.find((o) => o.code === 'WAS')).toBeUndefined();
  });
});

// User 2026-11-13: a notice never goes without its times, nor with times
// that cannot be right — the VID too needs both, and an ETD before the ETA
// is a gap with its reason.
describe('the times every notice carries', () => {
  it('the VID needs the ETD as well as the ETA', () => {
    const vid = byCode(full({ etd: null }))('VID');
    expect(vid.state).toBe('missing');
    expect(vid.missing).toEqual(['Estimated departure (DE-022-05)']);
  });

  it('an ETD before the ETA stops the VID, the NOA and the NOD, and says why', () => {
    const at = byCode(full({ etd: '2026-08-26T09:00:00Z' }));
    for (const code of ['VID', 'NOA', 'NOD']) {
      const o = at(code);
      expect(o.state).not.toBe('ready');
      expect(o.missing).toContain('Estimated departure (DE-022-05) — ETD must be after the ETA');
      expect(o.items.find((i) => i.de === 'DE-022-05')?.problem).toBe('ETD must be after the ETA');
    }
  });

  it('a mistyped year is caught', () => {
    const noa = byCode(full({ eta: '2062-08-26T10:00:00Z', etd: '2062-08-27T18:00:00Z' }))('NOA');
    expect(noa.missing).toContain('Estimated arrival (DE-022-02) — The ETA is more than a year ahead — check the year');
  });
});
