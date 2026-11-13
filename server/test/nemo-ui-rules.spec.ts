/**
 * Spec 0065 — NEMO UI-only rules reproduced in NEMOLink: the five expected
 * certificates, expiry and the 30-day window, the ice class status words;
 * and the same arithmetic driving the CRT checklist.
 */
import {
  FORMALITY_PREREQUISITES,
  NEMO_EXPECTED_CERTIFICATES,
  NEMO_UI_RULES,
  certificateChecklist,
  certificateGaps,
  prerequisiteChecklist,
  shipIssuesInNemo,
} from '../src/canonical/nemo-ui-rules';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const DAY = 86_400_000;
const valid = (type: string) => ({ typeCode: type, expiryDate: '2028-01-01' });
const ALL_VALID = NEMO_EXPECTED_CERTIFICATES.map(valid);

describe('certificate arithmetic (spec 0065 AC 1)', () => {
  it('five valid certificates: nothing missing, expired or expiring', () => {
    expect(certificateGaps(ALL_VALID, NOW)).toEqual({ missing: [], expired: [], expiringSoon: [] });
  });

  it('CARISMA on STG (no certificates at all): all five missing', () => {
    expect(certificateGaps([], NOW).missing).toEqual(['TM', 'REG', 'CL', 'LL', 'ISPS']);
  });

  it('a past expiry is expired, under 30 days is expiring soon, 30 days is not, no date is neither', () => {
    const certs = [
      { typeCode: 'TM', expiryDate: '2026-09-23' },
      { typeCode: 'REG', expiryDate: new Date(NOW + 29 * DAY).toISOString() },
      { typeCode: 'CL', expiryDate: new Date(NOW + 30 * DAY).toISOString() },
      { typeCode: 'LL', expiryDate: null },
      { typeCode: 'ISPS', expiryDate: 'not a date' },
    ];
    expect(certificateGaps(certs, NOW)).toEqual({
      missing: [],
      expired: ['TM'],
      expiringSoon: ['REG'],
    });
  });

  it('other certificate types neither count as expected nor hide a gap', () => {
    const gaps = certificateGaps([{ typeCode: 'IOPP', expiryDate: '2020-01-01' }], NOW);
    expect(gaps.missing).toHaveLength(5);
    expect(gaps.expired).toEqual(['IOPP']);
  });
});

describe('what NEMO shows for the ship (spec 0065 AC 2)', () => {
  it('a ship NSD does not know has no NEMO issues (the ledger says "not in NEMO")', () => {
    expect(shipIssuesInNemo({ shipId: null, certificates: [], iceClassStatus: 'UNCONFIRMED' }, NOW)).toEqual([]);
    expect(shipIssuesInNemo(null, NOW)).toEqual([]);
  });

  it('CARISMA: the certificate warning names the five types and the CRT; the ice class reads unconfirmed', () => {
    const issues = shipIssuesInNemo(
      { shipId: 'b3f97113-a3a8-4c6f-9cb3-474565548da7', certificates: [], iceClassStatus: 'UNCONFIRMED' },
      NOW,
    );
    expect(issues.map((i) => [i.rule, i.level])).toEqual([
      ['ship-certificates', 'warning'],
      ['ship-ice-class-status', 'info'],
    ]);
    expect(issues[0]!.words).toBe(
      'NEMO shows a ship certificate as missing or expired (missing TM, REG, CL, LL, ISPS) and asks for a CRT',
    );
    expect(issues[0]!.codes).toEqual(['TM', 'REG', 'CL', 'LL', 'ISPS']);
    expect(issues[1]!.words).toBe(
      'NEMO shows the ice class as not valid (unconfirmed) — Traficom confirms it once the' +
        ' classification certificate (CL) is sent in a CRT with the confirmation request;' +
        ' fairway dues follow the confirmed class',
    );
    // spec 0069: a pending class says Traficom is on it
    const pending = shipIssuesInNemo(
      { shipId: 'b3f97113-a3a8-4c6f-9cb3-474565548da7', certificates: [], iceClassStatus: 'PENDING' },
      NOW,
    ).find((i) => i.rule === 'ship-ice-class-status');
    expect(pending?.words).toBe('NEMO shows the ice class as pending confirmation — Traficom is checking it');
  });

  it('expired and expiring certificates are told apart; a confirmed ice class is quiet', () => {
    const issues = shipIssuesInNemo(
      {
        shipId: 'x',
        certificates: [
          ...ALL_VALID.filter((c) => c.typeCode !== 'CL' && c.typeCode !== 'LL'),
          { typeCode: 'CL', expiryDate: '2026-01-01' },
          { typeCode: 'LL', expiryDate: new Date(NOW + 10 * DAY).toISOString() },
        ],
        iceClassStatus: 'CONFIRMED',
      },
      NOW,
    );
    expect(issues.map((i) => i.rule)).toEqual(['ship-certificates', 'ship-certificate-expiring']);
    expect(issues[0]!.words).toContain('expired CL');
    expect(issues[1]!.words).toContain('(LL)');
  });

  it('every rule raised is in the catalogue with its source', () => {
    const ids = new Set(NEMO_UI_RULES.map((r) => r.id));
    for (const rule of ['ship-certificates', 'ship-certificate-expiring', 'ship-ice-class-status', 'formality-order', 'customs-confirmation']) {
      expect(ids.has(rule)).toBe(true);
    }
    for (const r of NEMO_UI_RULES) expect(r.source).toMatch(/NEMO UI bundle/);
  });
});

describe('the CRT checklist on our side (spec 0065 AC 3)', () => {
  it('one line per expected type, satisfied when on file and not expired', () => {
    const items = certificateChecklist(
      [...ALL_VALID.filter((c) => c.typeCode !== 'TM'), { typeCode: 'LL', expiryDate: '2026-01-01' }],
      NOW,
    );
    expect(items.map((i) => [i.label, i.ok])).toEqual([
      ['TM certificate on file and not expired', false],
      ['REG certificate on file and not expired', true],
      ['CL certificate on file and not expired', true],
      ['LL certificate on file and not expired', false],
      ['ISPS certificate on file and not expired', true],
    ]);
  });
});

describe('formality order and the customs confirmation (spec 0065 AC 6)', () => {
  it('knows what NEMO wants first', () => {
    expect(FORMALITY_PREREQUISITES).toEqual({ ATA: ['NOA', 'DUE'], ATD: ['NOD', 'ATA'], SEC: ['NOA'], SHP: ['SID'] });
  });

  it('ATA: the notices sent, the arrival confirmed in the NOA', () => {
    expect(prerequisiteChecklist('ATA', ['VID', 'NOA'], [])).toEqual([
      { label: 'NOA sent to NEMO', ok: true },
      { label: 'DUE sent to NEMO', ok: false },
      { label: 'Arrival confirmed to Customs in the NOA (ST-FI-01)', ok: false },
    ]);
    expect(prerequisiteChecklist('ATA', ['NOA', 'DUE'], ['NOA']).every((i) => i.ok)).toBe(true);
  });

  it('ATD: the NOD and the ATA sent, the departure confirmed in the NOD', () => {
    expect(prerequisiteChecklist('ATD', ['NOD'], ['NOA']).map((i) => [i.label, i.ok])).toEqual([
      ['NOD sent to NEMO', true],
      ['ATA sent to NEMO', false],
      ['Departure confirmed to Customs in the NOD (ST-FI-02)', false],
    ]);
  });

  it('formalities without an order owe nothing', () => {
    expect(prerequisiteChecklist('NOA', [], [])).toEqual([]);
    expect(prerequisiteChecklist('CRT', [], [])).toEqual([]);
  });
});

