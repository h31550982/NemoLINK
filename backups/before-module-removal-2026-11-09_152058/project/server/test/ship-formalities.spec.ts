/**
 * Ship data as SID and SHP (spec 0070): every field has a home traced to the
 * de-index, the FI-required set goes and nothing more, the envelopes pass
 * the vendored MIG schemas, NEMO's acknowledgements are read right.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PARTICULARS_WIRE_KEYS } from '../src/canonical/ship-master-data';
import {
  documentIdOf,
  nemoShipName,
  parseAck,
  planShipFormalities,
  FI_REQUIRED_SHIP_KEYS, SHIP_FIELD_HOMES,
  shipFieldIds,
} from '../src/canonical/ship-formalities';
import { buildMaiEnvelope } from '../src/nemo-client/mai-envelope';
import { MigValidator } from '../src/nemo-client/mig-validator';

const DECLARANT = { id: 'FI1471406-3', roleCode: 'AG', name: 'Agentuuri Port Oy' };

const vendored = (rel: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'vendor', 'nemo', 'hub', rel), 'utf8'));
const deIndex = vendored('de-index.json');
const fiRequired = vendored('fi-required.json');

/** Every DE id the de-index knows for the SID and SHP trees, by id. */
function deIdsOf(prefix: string): Set<string> {
  const ids = new Set<string>();
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v && typeof v === 'object' && 'id' in (v as object) && 'name' in (v as object)) {
        if (k.startsWith(prefix)) ids.add((v as { id: string }).id);
      } else walk(v);
    }
  };
  walk(deIndex);
  return ids;
}

describe('SHIP_FIELD_HOMES — every field has a vendored home (spec 0070 AC 1)', () => {
  it('covers every particulars wire key and the identity', () => {
    for (const key of [...PARTICULARS_WIRE_KEYS, 'name', 'imoNumber', 'mmsi', 'callSign']) {
      expect(SHIP_FIELD_HOMES[key]).toBeDefined();
    }
  });

  it('SID and SHP ids exist in the de-index under their formality; NOA ids under NOA', () => {
    const sid = deIdsOf('sid:SID');
    const shp = deIdsOf('shp:SHP');
    const noa = deIdsOf('noa:NOA');
    for (const [key, home] of Object.entries(SHIP_FIELD_HOMES)) {
      const set = home.formality === 'SID' ? sid : home.formality === 'SHP' ? shp : noa;
      expect({ key, de: home.de, known: set.has(home.de) }).toEqual({ key, de: home.de, known: true });
    }
  });

  it('every SHP element NEMOLink holds goes (spec 0083); the FI-required set is what the checklist counts', () => {
    const required = (fiRequired as { formalities: Array<{ code: string; elements: Array<{ de: string }> }> }).formalities;
    const shpRequired = required.find((f) => f.code === 'SHP')?.elements.map((e) => e.de) ?? [];
    const sentShp = Object.values(SHIP_FIELD_HOMES)
      .filter((h) => h.formality === 'SHP' && h.sent)
      .map((h) => h.de)
      .sort();
    // every SHP home is sent, and the FI-required ones are among them
    expect(Object.values(SHIP_FIELD_HOMES).filter((h) => h.formality === 'SHP' && !h.sent)).toEqual([]);
    for (const de of shpRequired) expect(sentShp).toContain(de);
    const fiShp = Object.entries(SHIP_FIELD_HOMES).filter(([k, h]) => h.formality === 'SHP' && FI_REQUIRED_SHIP_KEYS.has(k)).map(([, h]) => h.de).sort();
    expect(fiShp).toEqual([...new Set(shpRequired)].sort());
    const sentSid = Object.entries(SHIP_FIELD_HOMES)
      .filter(([, h]) => h.formality === 'SID' && h.sent)
      .map(([k]) => k)
      .sort();
    expect(sentSid).toEqual(['callSign', 'imoNumber', 'mmsi', 'name']);
  });

  it('shipFieldIds carries formality, id and the sent flag per key', () => {
    const ids = shipFieldIds();
    expect(ids['iceClass']).toEqual({ formality: 'SHP', de: 'DE-009-03', sent: true });
    expect(ids['summerDraught']).toEqual({ formality: 'SHP', de: 'DE-008-11', sent: true });
    expect(ids['grossWeight']).toEqual({ formality: 'NOA', de: 'DE-008-27', sent: false });
  });
});

describe('planShipFormalities — the payloads (spec 0070 AC 2)', () => {
  const validator = new MigValidator();
  const carisma = {
    name: 'CARISMA',
    imoNumber: '9990026',
    mmsi: '230666669',
    callSign: 'ABCD',
    particulars: {
      ownerName: 'nauticAi test owner (dummy)',
      operatorName: 'nauticAi test operator (dummy)',
      iceClass: { code: 'FS1A', validTo: '2027-05-31' },
      buildDate: '2011-06-15',
      keelLayingDate: '2010-09-01',
      inertGasSystem: false,
      mainEnginePower: 2999,
      openWaterSpeedMeasure: 10,
      grossWeight: 2999,
      summerDraught: 6.9,
    },
  };

  it('builds SID and SHP that pass the vendored MIG schemas, in the spec 0062 shapes', () => {
    const plan = planShipFormalities(carisma);
    expect(plan.sidReason).toBeNull();
    expect(plan.shpReason).toBeNull();
    const means = (plan.sid as any)['sid:SpecifiedLogisticsTransportMovement']['ram:UsedLogisticsTransportMeans'];
    expect(means).toEqual({
      'ram:IMONumberIndicator': 1,
      'ram:Name': 'CARISMA',
      'ram:IMOID': '9990026',
      'ram:MMSIID': '230666669',
      'ram:CallSignID': 'ABCD',
    });
    const shp = (plan.shp as any)['shp:SpecifiedLogisticsTransportMovement']['ram:UsedLogisticsTransportMeans'];
    expect(shp['ram:ICEClassCode']).toBe('FS1A');
    expect(shp['ram:OwnerTradeParty']).toEqual({ 'ram:Name': 'nauticAi test owner (dummy)' });
    expect(shp['ram:OperatorTradeParty']).toEqual({ 'ram:Name': 'nauticAi test operator (dummy)' });
    expect(shp['ram:OpenWaterSpeedMeasure']).toEqual({ $: 10, '@unitCode': 'KNT' });
    expect(shp['ram:OnboardMainEngine']).toEqual([{ 'ram:PowerMeasure': { $: 2999, '@unitCode': 'KWT' } }]);
    expect(shp['ram:ConstructionSpecifiedTransportMeansCharacteristic']).toEqual({
      'ram:ConstructionVesselBuilding': { 'ram:ConstructionDate': '2011-06-15', 'ram:KeelLayingDate': '2010-09-01' },
      'ram:InertGasSystemIndicator': 0,
    });
    // the full set (spec 0083): the draught goes too; the tonnage goes with the NOA
    expect(shp['ram:SummerDraughtLevelMeasure']).toEqual({ $: 6.9, '@unitCode': 'MTR' });
    expect(JSON.stringify(shp)).not.toContain('2999.0');

    for (const [type, payload] of [['SID', plan.sid], ['SHP', plan.shp]] as const) {
      const envelope = buildMaiEnvelope({ formalityType: type, declarant: DECLARANT, visitId: 'FI20260925-013-0', payload: payload! });
      expect(validator.validate(type, envelope)).toEqual([]);
      expect(documentIdOf(envelope)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('lists every filled field with its home, sent ones first', () => {
    const plan = planShipFormalities(carisma);
    const keys = plan.fields.map((f) => f.key);
    expect(keys.slice(0, 12).every((k) => plan.fields.find((f) => f.key === k)!.sent)).toBe(true);
    expect(plan.fields.find((f) => f.key === 'grossWeight')).toEqual({
      key: 'grossWeight', formality: 'NOA', de: 'DE-008-27', value: 2999, sent: false,
    });
    expect(plan.fields.find((f) => f.key === 'summerDraught')).toMatchObject({ formality: 'SHP', sent: true });
  });

  it('the SID carries the ship name in upper case (NEMO ERR-027 on mixed case, STG 2026-10-06)', () => {
    const plan = planShipFormalities({ ...carisma, name: '  Black Pearl ' });
    const means = (plan.sid!['sid:SpecifiedLogisticsTransportMovement'] as Record<string, Record<string, unknown>>)['ram:UsedLogisticsTransportMeans']!;
    expect(means['ram:Name']).toBe('BLACK PEARL');
    expect(nemoShipName('Eeva VG 2')).toBe('EEVA VG 2');
  });

  it('no IMO: no SID, with the reason; no party name: no SHP, with the rule', () => {
    const noImo = planShipFormalities({ ...carisma, imoNumber: null });
    expect(noImo.sid).toBeNull();
    expect(noImo.sidReason).toMatch(/IMO number/);
    expect(noImo.fields.find((f) => f.key === 'name')?.sent).toBe(false);

    const noParty = planShipFormalities({
      ...carisma,
      particulars: { iceClass: { code: 'FSIII' }, openWaterSpeedMeasure: 10 },
    });
    expect(noParty.shp).toBeNull();
    expect(noParty.shpReason).toMatch(/NR-SHP-001/);

    const empty = planShipFormalities({ ...carisma, particulars: {} });
    expect(empty.shpReason).toMatch(/No ship particulars to send yet/);
  });
});

describe('parseAck — NEMO’s answers (spec 0063 reply anatomy)', () => {
  it('reads the FRM status and the reported errors, English first', () => {
    const ack = {
      'env:Envelope': {
        'frm:FRM': {
          'frm:AcknowledgementDocument': {
            'ram:StatusCode': '8',
            'ram:ReferencedReportedError': [
              {
                'ram:TypeCode': 'ERR-003',
                'ram:Description': [
                  { $: 'Vahvistus puuttuu', '@languageID': 'fi' },
                  { $: 'Confirmation missing from the NOA', '@languageID': 'en' },
                ],
                'ram:SpecifiedIdentifiedPointer': [{ 'ram:TagID': '$.env:Envelope.noa:NOA' }],
              },
            ],
          },
        },
      },
    };
    expect(parseAck(ack)).toEqual({
      status: '8',
      errors: [{ code: 'ERR-003', message: 'Confirmation missing from the NOA', path: '$.env:Envelope.noa:NOA' }],
      frmErrors: 1,
    });
    expect(parseAck({ 'env:Envelope': { 'frm:FRM': { 'frm:AcknowledgementDocument': { 'ram:StatusCode': '1', 'ram:ReferencedReportedError': [] } } } })).toEqual({ status: '1', errors: [], frmErrors: 0 });
  });

  it('reads the Declarant API JSON wrapper, and tolerates anything else', () => {
    expect(parseAck({ errorKey: 'VALIDATION_FAILED', message: 'x', fieldErrors: [{ field: 'eta', message: 'must be in the future' }] })).toEqual({
      status: null,
      errors: [{ code: 'VALIDATION_FAILED', message: 'must be in the future', path: 'eta' }],
      frmErrors: 0,
    });
    expect(parseAck({ errorKey: 'NOA_UPDATE_NOT_ALLOWED', message: 'locked' })).toEqual({
      status: null,
      errors: [{ code: 'NOA_UPDATE_NOT_ALLOWED', message: 'locked', path: null }],
      frmErrors: 0,
    });
    expect(parseAck('<html>')).toEqual({ status: null, errors: [], frmErrors: 0 });
    expect(parseAck(null)).toEqual({ status: null, errors: [], frmErrors: 0 });
  });
});

describe('parseAck — the live 400 shapes (spec 0078)', () => {
  const frm = (errors: unknown[]) => ({
    'env:Envelope': {
      'res:RES': { 'res:SpecifiedLogisticsTransportMovement': { 'ram:CallTransportEvent': { 'ram:ID': 'FI20260924-028-5' } } },
      'frm:FRM': {
        'frm:AcknowledgementDocument': { 'ram:StatusCode': '8', 'ram:ClearanceModelConditionCode': 'CLR-03', 'ram:ReferencedReportedError': errors },
      },
    },
  });

  it('a ship NEMO does not know: status 8 under frmResponse, nothing reported, the wrapper words', () => {
    // verbatim from staging, 2026-09-24 (the ship round trip, Carisma before NSD knew it)
    const body = {
      frmResponse: frm([]),
      errorKey: 'BAD_REQUEST',
      errorDescription: ['Virheellinen pyyntö.', 'Bad request.', 'Felaktig begäran.'],
    };
    expect(parseAck(body)).toEqual({
      status: '8',
      frmErrors: 0,
      errors: [{ code: 'BAD_REQUEST', message: 'Bad request.', path: null }],
    });
  });

  it('a validation failure: the FRM errors with fi/en/sv strings win over the mirrored fieldErrors', () => {
    const body = {
      frmResponse: frm([
        {
          'ram:TypeCode': 'ERR-029',
          'ram:Description': [
            'Aluksen nettovetoisuus (DE-008-28) on annettava.',
            'Ship net tonnage (DE-008-28) must be provided.',
            'Fartygets nettotonnage (DE-008-28) måste anges.',
          ],
          'ram:SequenceNumeric': 1,
          'ram:SpecifiedIdentifiedPointer': [{ 'ram:SequenceNumeric': 1, 'ram:TagID': '$.env:Envelope.noa:NOA.ram:NetTonnageMeasure.$' }],
        },
      ]),
      errorKey: 'VALIDATION_FAILED',
      errorMessage: 'Validation failed',
      globalErrors: null,
      fieldErrors: [{ type: 'rule', paths: ['$.env:Envelope.noa:NOA.ram:NetTonnageMeasure.$'], errorKey: 'ERR-029', errorMsg: 'net tonnage missing', frmErrorCode: null }],
    };
    expect(parseAck(body)).toEqual({
      status: '8',
      frmErrors: 1,
      errors: [{ code: 'ERR-029', message: 'Ship net tonnage (DE-008-28) must be provided.', path: '$.env:Envelope.noa:NOA.ram:NetTonnageMeasure.$' }],
    });
  });

  it('the vendored 400 example: the documented item shape, uppercase language id', () => {
    const spec = JSON.parse(readFileSync(join(__dirname, '..', '..', 'vendor', 'nemo', 'openapi', 'declarant.json'), 'utf8')) as {
      paths: Record<string, { post: { responses: Record<string, { content: Record<string, { examples: Record<string, { value: unknown }> }> }> } }>;
    };
    const example = spec.paths['/v1/portcalls']!.post.responses['400']!.content['application/json']!.examples['error_response']!.value;
    expect(parseAck(example)).toEqual({
      status: '8',
      frmErrors: 1,
      errors: [{ code: 'ERR-027', message: 'etd_before_eta', path: '/eta' }],
    });
  });

  it('a request-shape error has no frmResponse: the wrapper field errors with their paths', () => {
    // verbatim from staging, 2026-09-24: registeredOwnerName is required by the contract and refused by the API
    const body = {
      errorKey: 'VALIDATION_FAILED',
      errorMessage: 'Validation failed',
      fieldErrors: [{ type: 'request', paths: ['$.registeredOwnerName'], errorKey: 'unsupported_field', errorMsg: "Request body contains unsupported field 'registeredOwnerName'." }],
    };
    expect(parseAck(body)).toEqual({
      status: null,
      frmErrors: 0,
      errors: [{ code: 'unsupported_field', message: "Request body contains unsupported field 'registeredOwnerName'.", path: '$.registeredOwnerName' }],
    });
    expect(parseAck({ errorKey: 'EORI_DOES_NOT_MATCH', errorDescription: ['EORI ei täsmää.', 'EORI does not match.', 'EORI matchar inte.'] })).toEqual({
      status: null,
      frmErrors: 0,
      errors: [{ code: 'EORI_DOES_NOT_MATCH', message: 'EORI does not match.', path: null }],
    });
  });
});

describe('the full set (spec 0083)', () => {
  const FULL = {
    name: 'BLACK PEARL', imoNumber: '1236668', mmsi: '231666666', callSign: 'DEVIL',
    particulars: {
      ownerName: 'O', operatorName: 'L', iceClass: { code: 'FSIII' }, buildDate: '2001-01-01', keelLayingDate: '2000-01-01',
      inertGasSystem: true, mainEnginePower: 1000, openWaterSpeedMeasure: 12,
      summerDraught: 6.5, betweenPerpendicularsLength: 90, reducedGrossTonnage: 2000, summerDeadweight: 4000,
      bowThrusterPower: 300, sternThrusterPower: 200, navigationTypeCode: 'NAV-01', externalMarkingText: 'EXT',
      relatedTransportMode: '1', mainEngineAvailabilityIndicator: true, satelliteId: '123456789', satelliteProviderCode: 'INM',
      shipDriveTypeCode: 'DRV-01', ownerRegisteredId: '1234567', ownerStreet: 'S', ownerPostcode: '00100', ownerCity: 'C',
      ownerCountryCode: 'FI', pniClubName: 'P', chartererTypeCode: 'TIME', chartererName: 'CH', chartererStreet: 'S',
      chartererPostcode: '00100', chartererCity: 'C', chartererCountryCode: 'FI',
    },
  };

  it('every particular NEMOLink holds goes in the SHP, and the envelope passes the MIG schema', () => {
    const plan = planShipFormalities(FULL as never);
    const env = buildMaiEnvelope({ formalityType: 'SHP', declarant: { id: 'FI1471406-3', roleCode: 'AG' }, visitId: 'FI20260925-024-2', payload: plan.shp! });
    expect(new MigValidator().validate('SHP', env)).toEqual([]);
    const shpKeys = Object.entries(SHIP_FIELD_HOMES).filter(([, h]) => h.formality === 'SHP').map(([k]) => k);
    for (const key of shpKeys) expect(plan.fields.find((f) => f.key === key)).toMatchObject({ sent: true });
    const means = (plan.shp!['shp:SpecifiedLogisticsTransportMovement'] as Record<string, Record<string, unknown>>)['ram:UsedLogisticsTransportMeans']!;
    expect(means['ram:ReducedGrossTonnageMeasure']).toEqual({ $: 2000, '@unitCode': 'GT' });
    expect(means['ram:ChartererParty']).toMatchObject({ 'ram:TypeCode': 'TIME', 'ram:Name': 'CH' });
  });

  it('a satellite id without its provider (or the other way round) is left out, not sent broken', () => {
    const half = { ...FULL, particulars: { ...FULL.particulars, satelliteProviderCode: null } };
    const plan = planShipFormalities(half as never);
    const means = (plan.shp!['shp:SpecifiedLogisticsTransportMovement'] as Record<string, Record<string, unknown>>)['ram:UsedLogisticsTransportMeans']!;
    expect(means['ram:MobileSpecifiedSatelliteIdentification']).toBeUndefined();
    expect(plan.fields.find((f) => f.key === 'satelliteId')).toMatchObject({ sent: false });
  });
});
