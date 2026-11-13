/**
 * Spec 0092 — the DUE (sent with the NOA), the ATA (the arrival step), the
 * NOD and the ATD (the departure step):
 * each passes the vendored MIG schema and carries the shape NEMO accepted live
 * on 2026-09-24 (spec 0063).
 */
import { buildDuePayload } from '../src/canonical/due-formality';
import { buildAtaPayload } from '../src/canonical/ata-formality';
import { buildNodPayload, DEPARTURE_CONFIRMATION } from '../src/canonical/nod-formality';
import { buildAtdPayload } from '../src/canonical/atd-formality';
import { buildMaiEnvelope } from '../src/nemo-client/mai-envelope';
import { MigValidator } from '../src/nemo-client/mig-validator';
import { noaSnapshot as snap } from './noa-fixture';

const validator = new MigValidator();
const envelopeOf = (type: string, payload: Record<string, unknown>, declarationId?: string) =>
  buildMaiEnvelope({
    formalityType: type,
    declarant: { id: 'FI1234567-8', roleCode: 'AG', name: 'Test Agency Oy' },
    visitId: 'FI20260930-001',
    payload,
    ...(declarationId ? { declarationId } : {}),
  });

describe('the DUE payload (spec 0092)', () => {
  it('passes the MIG schema check with its LRN', () => {
    expect(validator.validate('DUE', envelopeOf('DUE', buildDuePayload(snap()), 'LRN-TEST-0001'))).toEqual([]);
  });

  it('names the agency as the liable party, alone, with its postal address', () => {
    const dues = (buildDuePayload(snap()) as any)['due:SpecifiedLogisticsTransportMovement']['ram:CallTransportEvent'][
      'ram:ApplicableSpecifiedFairwayPortDues'
    ];
    expect(dues['ram:PartyJointLiabilityIndicator']).toBe(0);
    expect(dues['ram:LiableTradeParty']).toEqual({
      'ram:ID': '1234567-8',
      'ram:Name': 'Test Agency Oy',
      'ram:EmailURIUniversalCommunication': { 'ram:URIID': 'ops@example.com' },
      'ram:PostalTradeAddress': {
        'ram:StreetName': 'Satamatie 1',
        'ram:PostcodeCode': { $: '26100', '@listAgencyID': '5' },
        'ram:CityName': { $: 'Rauma', '@languageID': 'FI' },
        'ram:CountryID': 'FI',
      },
    });
  });

  it('leaves out an address the organisation has not given', () => {
    const s = snap();
    s.org = { ...s.org, street: null, postcode: null, city: null, countryCode: null };
    const party = (buildDuePayload(s) as any)['due:SpecifiedLogisticsTransportMovement']['ram:CallTransportEvent'][
      'ram:ApplicableSpecifiedFairwayPortDues'
    ]['ram:LiableTradeParty'];
    expect(party['ram:PostalTradeAddress']).toBeUndefined();
  });
});

describe('the ATA payload (spec 0092)', () => {
  it('passes the MIG schema check', () => {
    expect(validator.validate('ATA', envelopeOf('ATA', buildAtaPayload('2026-09-30T08:05:00.000Z')))).toEqual([]);
  });

  it('carries the arrival time and no anchorage, as accepted live', () => {
    expect(buildAtaPayload('2026-09-30T08:05:00.000Z')).toEqual({
      'ata:SpecifiedLogisticsTransportMovement': {
        'ram:CallTransportEvent': {
          'ram:MaritimeAnchorageIndicator': 0,
          'ram:ActualArrivalRelatedDateTime': '2026-09-30T08:05:00.000Z',
        },
      },
    });
  });
});

describe('the NOD payload (spec 0092)', () => {
  it('passes the MIG schema check, unconfirmed and confirmed', () => {
    expect(validator.validate('NOD', envelopeOf('NOD', buildNodPayload(snap(), false)))).toEqual([]);
    expect(validator.validate('NOD', envelopeOf('NOD', buildNodPayload(snap(), true)))).toEqual([]);
  });

  it('carries what NEMO accepted live (0063 ND2): ETD, next port, crew, persons on board', () => {
    const m = (buildNodPayload(snap(), false) as any)['nod:SpecifiedLogisticsTransportMovement'];
    expect(m['ram:CallTransportEvent']).toEqual({ 'ram:EstimatedTransportMeansDepartureOccurrenceDateTime': snap().etd });
    expect(m['ram:CrewQuantity']).toBe(9);
    expect(m['ram:OnboardPersonQuantity']).toBe(9);
    expect(m['ram:ItineraryTransportRoute']['ram:ItineraryStopTransportEvent']).toEqual([
      { 'ram:SequenceNumeric': 1, 'ram:OccurrenceLogisticsLocation': { 'ram:ID': 'ZZUKN' } },
    ]);
  });

  it('names the next port of the call when it has one, and confirms only when asked', () => {
    const s = { ...snap(), nextPorts: ['SEGOT'] };
    const m = (buildNodPayload(s, false) as any)['nod:SpecifiedLogisticsTransportMovement'];
    expect(m['ram:ItineraryTransportRoute']['ram:ItineraryStopTransportEvent'][0]['ram:OccurrenceLogisticsLocation']).toEqual({ 'ram:ID': 'SEGOT' });
    expect((buildNodPayload(snap(), false) as any)['nod:ExchangedDeclaration']).toBeUndefined();
    expect((buildNodPayload(snap(), true) as any)['nod:ExchangedDeclaration']).toEqual({ 'ram:StatementTypeCode': DEPARTURE_CONFIRMATION });
  });
});

describe('the ATD payload (spec 0092)', () => {
  it('passes the MIG schema check and carries the departure time', () => {
    const payload = buildAtdPayload('2026-09-30T18:05:00.000Z');
    expect(validator.validate('ATD', envelopeOf('ATD', payload))).toEqual([]);
    expect(payload).toEqual({
      'atd:SpecifiedLogisticsTransportMovement': { 'ram:CallTransportEvent': { 'ram:ActualDepartureRelatedDateTime': '2026-09-30T18:05:00.000Z' } },
    });
  });
});

