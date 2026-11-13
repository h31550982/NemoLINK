import {
  buildCwaPayload,
  buildEffPayload,
  buildSecPayload,
  buildStaPayload,
  buildWasPayload,
  type Built,
  type TableLike,
} from '../src/canonical/pre-arrival-formalities';
import { buildMaiEnvelope } from '../src/nemo-client/mai-envelope';
import { MigValidator } from '../src/nemo-client/mig-validator';

const validator = new MigValidator();
const check = (type: string, built: Built) => {
  if (!('payload' in built)) throw new Error(`not built: ${built.missing.join('; ')}`);
  return validator.validate(
    type,
    buildMaiEnvelope({
      formalityType: type,
      declarant: { id: 'FI1234567-8', roleCode: 'AG', name: 'Test Agency Oy' },
      visitId: 'FI20261006-037-7',
      payload: built.payload,
    }),
  );
};
const cells = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
const table = (rows: Record<string, string>[], header: Record<string, string> = {}): TableLike => ({
  header: cells(header),
  rows: rows.map((r, i) => ({ key: String(i + 1), cells: cells(r) })),
});

// Dummy people only (STG is shared; the probe's set, 2026-10-06)
const crewRow = {
  familyName: 'Dummyson', givenName: 'Testi', dateOfBirth: '1970-01-01', gender: '1', nationality: 'FIN', rank: '10100',
};

describe('the pre-arrival reports from the NEMO tables (spec 0098)', () => {
  it('CWA: the crew list passes the MIG check, with and without the identity document', () => {
    const crew = table([
      crewRow,
      {
        ...crewRow, familyName: 'Mockinen', givenName: 'Proba', gender: '2', rank: '10700', countryOfBirth: 'FIN',
        documentType: '39', documentNumber: 'X0000001', documentIssuer: 'FI', documentExpiry: '2030-01-01',
      },
    ]);
    const built = buildCwaPayload(crew);
    expect(check('CWA', built)).toEqual([]);
    const persons = (built as any).payload['cwa:SpecifiedLogisticsTransportMovement']['ram:OnboardTransportPerson'];
    expect(persons[0]['ram:RoleCode']).toBe('10100');
    expect(persons[0]['ram:TravelIdentityReferencedDocument']).toBeUndefined();
    expect(persons[1]['ram:TravelIdentityReferencedDocument']['ram:IssueLogisticsLocation']).toEqual({ 'ram:CountryID': 'FI' });
  });

  it('CWA: a missing rank names the row by number, never the name; a half document names its gaps', () => {
    const { rank: _rank, ...noRank } = crewRow;
    const built = buildCwaPayload(table([crewRow, noRank, { ...crewRow, documentNumber: 'X1' }]));
    expect(built).toEqual({
      missing: [
        'crew member 2: rank or rating',
        'crew member 3: identity document type, document issuing nation, document expiry date',
      ],
    });
    expect(JSON.stringify(built)).not.toContain('Dummyson');
  });

  it('CWA: no crew table asks for the upload', () => {
    expect(buildCwaPayload(null)).toEqual({ missing: ['the crew list (upload FAL 5 or the NSW crew list)'] });
  });

  it('EFF: only the members who declared effects, each with type, quantity and unit', () => {
    const crew: TableLike = {
      header: {},
      rows: [
        { key: 'a', cells: cells(crewRow), items: [cells({ effectsType: 'CRE-004', effectsQuantity: '200', effectsUnit: 'NAR', effectsDescription: 'Cigarettes' })] },
        { key: 'b', cells: cells({ ...crewRow, familyName: 'Mockinen' }), items: [] },
      ],
    };
    const built = buildEffPayload(crew);
    expect(check('EFF', built)).toEqual([]);
    const persons = (built as any).payload['eff:SpecifiedLogisticsTransportMovement']['ram:OnboardTransportPerson'];
    expect(persons).toHaveLength(1);
    expect(persons[0]['ram:DeclaredSpecifiedPersonalEffects'][0]['ram:OnboardMeasure']).toEqual({ $: 200, '@unitCode': 'NAR' });
    expect(buildEffPayload(table([crewRow]))).toEqual({ missing: ['crew effects (upload FAL 4)'] });
  });

  it('STA: the stores pass the MIG check; a row without a unit is named', () => {
    const built = buildStaPayload(table([
      { article: 'STO-002', quantity: '48', unit: 'LTR', articleName: 'Spirits' },
      { article: 'STO-015', quantity: '120', unit: 'TNE', location: 'Bunker tanks' },
    ]));
    expect(check('STA', built)).toEqual([]);
    expect(buildStaPayload(table([{ article: 'STO-002', quantity: '48' }]))).toEqual({ missing: ['article 1: unit'] });
  });

  it('STA: each stores type in a unit NEMO takes for it (ERR-027, STG 2026-10-06) — exact conversions made, the rest named', () => {
    const built = buildStaPayload(table([
      { article: 'STO-008', quantity: '400', unit: 'LTR' }, // lubricants in litres → m³
      { article: 'STO-006', quantity: '2', unit: 'TNE' }, // nicotine products in tonnes → kg
      { article: 'STO-001', quantity: '48', unit: 'LTR' }, // already fine
    ]));
    expect(check('STA', built)).toEqual([]);
    const items = (built as any).payload['sta:SpecifiedLogisticsTransportMovement']['ram:OnboardStoresItemInventory'];
    expect(items.map((x: any) => x['ram:OnboardMeasure'])).toEqual([
      { $: 0.4, '@unitCode': 'MTQ' },
      { $: 2000, '@unitCode': 'KGM' },
      { $: 48, '@unitCode': 'LTR' },
    ]);
    // cigarettes by weight cannot become a count
    expect(buildStaPayload(table([{ article: 'STO-004', quantity: '3', unit: 'KGM' }]))).toEqual({
      missing: ['article 1: unit KGM is not accepted for STO-004 — NEMO takes NAR'],
    });
  });

  it('WAS: the waste types with figures, with the last delivery; the rest of the 25 rows stay out', () => {
    const waste: TableLike = {
      header: cells({ lastDeliveryDate: '2026-09-20', lastDeliveryPort: 'SESTO', nextDeliveryPort: 'DEHAM' }),
      rows: [
        { key: '501', cells: cells({ toDeliver: '1', capacity: '5', retained: '0', generated: '0.5' }) },
        { key: '502', cells: {} },
      ],
    };
    const built = buildWasPayload(waste);
    expect(check('WAS', built)).toEqual([]);
    const m = (built as any).payload['was:SpecifiedLogisticsTransportMovement']['ram:ReportedTransportationWasteMaterial'];
    expect(m['ram:IncludedTransportationWasteMaterialComponent']).toHaveLength(1);
    expect(m['ram:IncludedTransportationWasteMaterialComponent'][0]['ram:RetainedMeasure']).toEqual({ $: 0, '@unitCode': 'MTQ' });
  });

  it('WAS: no last delivery date is named; a listed type with a gap is named', () => {
    const waste: TableLike = {
      header: cells({ lastDeliveryPort: 'SESTO' }),
      rows: [{ key: '501', cells: cells({ toDeliver: '1', capacity: '5' }) }],
    };
    expect(buildWasPayload(waste)).toEqual({
      missing: ['last waste delivery date', 'waste 501: retained, estimated generated'],
    });
  });

  const secHeader = {
    securityLevel: '1', validIssc: 'yes', isscType: 'FULL', isscExpiry: '2029-01-01',
    csoFamilyName: 'Officer (dummy)', csoGivenName: 'Security', csoEmail: 'dummy@example.invalid',
  };
  const lastCall = { port: 'SESTO', facility: 'SESTO-0001', start: '2026-10-01', end: '2026-10-02', level: '1' };

  it('SEC: the probe set passes the MIG check; the call facility is the given GISIS code', () => {
    const built = buildSecPayload(table([lastCall], secHeader), 'FIRAU-0004');
    expect(check('SEC', built)).toEqual([]);
    const m = (built as any).payload['sec:SpecifiedLogisticsTransportMovement'];
    expect(m['ram:CallTransportEvent']['ram:OccurrenceLogisticsLocation']).toEqual({ 'ram:FacilityReferencedLocation': { 'ram:ID': 'FIRAU-0004' } });
    expect(m['ram:ItineraryTransportRoute']['ram:ItineraryStopTransportEvent'][0]['ram:SequenceNumeric']).toBe(-1);
    expect(m['ram:UsedLogisticsTransportMeans']['ram:ApprovedSecurityPlanOnboardIndicator']).toBe(1);
  });

  it('SEC: without the port area GISIS code it names that, not a guess', () => {
    expect(buildSecPayload(table([lastCall], secHeader), null)).toEqual({
      missing: ['the port facility (GISIS code) of the NOA’s port area'],
    });
  });
});

import { preArrivalChoices, fingerprintOf, type PreArrivalInput } from '../src/canonical/pre-arrival';

describe('what goes with the NOA (spec 0098)', () => {
  const none: PreArrivalInput = { tables: {}, stored: {}, sent: {}, facility: null, cargo: { count: 0, description: null } };
  const on = (input: PreArrivalInput) => Object.fromEntries(preArrivalChoices(input).choices.map((c) => [c.code, c.on]));

  it('a call without forms: crew, effects, stores, waste and security ticked, the rest not', () => {
    expect(on(none)).toEqual({ CWA: true, EFF: true, STA: true, WAS: true, SEC: true, PXA: false, CGA: false, HZA: false, MDH: false });
    const cwa = preArrivalChoices(none).choices.find((c) => c.code === 'CWA')!;
    expect(cwa.why).toBe('Usually sent');
    expect(cwa.data).toMatch(/^Missing: the crew list/);
    expect(preArrivalChoices(none).choices.find((c) => c.code === 'WAS')!.why).toBe('Compulsory for most ships');
  });

  it('evidence says why a sometimes-report applies; one NEMOLink does not build is never ticked', () => {
    const input: PreArrivalInput = {
      ...none,
      tables: { passengers: { header: {}, rows: [1, 2, 3].map((n) => ({ key: String(n), cells: {} })) } },
      cargo: { count: 2, description: null },
    };
    const choices = preArrivalChoices(input).choices;
    const pxa = choices.find((c) => c.code === 'PXA')!;
    expect(pxa).toMatchObject({ on: false, decidedBy: 'evidence', why: 'Applies: 3 passengers in the uploaded list', data: 'Not in NEMOLink yet — send it in NEMO' });
    expect(choices.find((c) => c.code === 'CGA')!.why).toBe('Applies: the call carries 2 cargoes');
  });

  it('the user’s untick wins; a report NEMO has stays ticked and is current while its data is unchanged', () => {
    const stores = table([{ article: 'STO-002', quantity: '48', unit: 'LTR' }]);
    const built = buildStaPayload(stores) as { payload: Record<string, unknown> };
    const input: PreArrivalInput = {
      ...none,
      tables: { stores },
      stored: { CWA: { on: false, by: 'Henrik', at: '2026-10-06T10:00:00Z' } },
      sent: { STA: { accepted: true, sentAt: '2026-10-06T09:00:00Z', version: 1, fingerprint: fingerprintOf(built.payload) } },
    };
    const choices = preArrivalChoices(input).choices;
    expect(choices.find((c) => c.code === 'CWA')).toMatchObject({ on: false, decidedBy: 'user', why: 'Left out by you' });
    expect(choices.find((c) => c.code === 'STA')).toMatchObject({ on: true, inNemo: true, current: true, data: '1 article' });
    const changed = { ...input, tables: { stores: table([{ article: 'STO-002', quantity: '50', unit: 'LTR' }]) } };
    expect(preArrivalChoices(changed).choices.find((c) => c.code === 'STA')!.current).toBe(false);
  });
});
