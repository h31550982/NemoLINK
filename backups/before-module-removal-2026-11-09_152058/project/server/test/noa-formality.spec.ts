import { buildNoaPayload, ARRIVAL_CONFIRMATION } from '../src/canonical/noa-formality';
import type { ObligationSnapshot } from '../src/canonical/obligations';
import { noaSnapshot as snap } from './noa-fixture';
import { buildMaiEnvelope } from '../src/nemo-client/mai-envelope';
import { MigValidator } from '../src/nemo-client/mig-validator';

const validator = new MigValidator();
const envelopeOf = (payload: Record<string, unknown>) =>
  buildMaiEnvelope({
    formalityType: 'NOA',
    declarant: { id: 'FI1234567-8', roleCode: 'AG', name: 'Test Agency Oy' },
    visitId: 'FI20260927-001',
    payload,
  });

describe('the NOA payload (spec 0088)', () => {
  it('passes the MIG schema check, unconfirmed and confirmed', () => {
    expect(validator.validate('NOA', envelopeOf(buildNoaPayload(snap(), false)))).toEqual([]);
    expect(validator.validate('NOA', envelopeOf(buildNoaPayload(snap(), true)))).toEqual([]);
  });

  it('carries the set NEMO accepted live (spec 0063) and the next port as ZZUKN', () => {
    const m = buildNoaPayload(snap(), false)['noa:SpecifiedLogisticsTransportMovement'] as Record<string, any>;
    expect(m['ram:CallPurposeCode']).toEqual(['1']);
    expect(m['ram:VoyageTypeServiceCode']).toBe('V-01');
    expect(m['ram:CrewQuantity']).toBe(9);
    expect(m['ram:OnboardPersonQuantity']).toBe(9);
    expect(m['ram:CallTransportEvent']['ram:ExpectedArrivalPortAreaRelatedLogisticsLocation']).toEqual({ 'ram:Name': 'FIRAU-BB' });
    expect(m['ram:ArrivalTransportEvent']['ram:OccurrenceLogisticsLocation']['ram:SubordinateLocation']).toEqual({ 'ram:Name': 'FIRAU-BB-BB1' });
    expect(m['ram:ItineraryTransportRoute']['ram:ItineraryStopTransportEvent']).toEqual([
      { 'ram:SequenceNumeric': -1, 'ram:OccurrenceLogisticsLocation': { 'ram:ID': 'SEGOT' } },
      { 'ram:SequenceNumeric': 1, 'ram:OccurrenceLogisticsLocation': { 'ram:ID': 'ZZUKN' } },
    ]);
    const means = m['ram:UsedLogisticsTransportMeans'];
    expect(means['ram:RegistrationTransportEvent']).toEqual({
      'ram:CertifyingTradeParty': { 'ram:ID': 'FI00' },
      'ram:OccurrenceLogisticsLocation': { 'ram:ID': 'FIHEL' },
    });
    expect(means['ram:ActualMaximumDraughtLevelMeasure']).toEqual({ $: 5.2, '@unitCode': 'MTR' });
    // NEMO refuses the NOA without these while its ship database lacks them (ERR-029, 2026-10-06)
    expect(means['ram:OverallLengthMeasure']).toEqual({ $: 89.9, '@unitCode': 'MTR' });
    expect(means['ram:WidthMeasure']).toEqual({ $: 13.2, '@unitCode': 'MTR' });
    expect(means['ram:GrossTonnageMeasure']).toEqual({ $: 2999, '@unitCode': 'GT' });
    expect(means['ram:NetTonnageMeasure']).toEqual({ $: 1200, '@unitCode': 'NT' });
    expect(means['ram:DeadWeightMeasure']).toEqual({ $: 4500, '@unitCode': 'TNE' });
    expect(m['ram:CarrierAgentTradeParty'][0]['ram:DefinedTradeContact']['ram:MobileTelephoneUniversalCommunication']).toEqual({ 'ram:CompleteNumber': '+358401234567' });
  });

  it('adds the arrival confirmation only when asked', () => {
    expect(buildNoaPayload(snap(), false)['noa:ExchangedDeclaration']).toBeUndefined();
    expect(buildNoaPayload(snap(), true)['noa:ExchangedDeclaration']).toEqual({ 'ram:StatementTypeCode': ARRIVAL_CONFIRMATION });
  });

  it('after a Finnish port the voyage type is the one the user chose', () => {
    const m = (s: Partial<ObligationSnapshot>) =>
      buildNoaPayload(snap(s), false)['noa:SpecifiedLogisticsTransportMovement'] as Record<string, unknown>;
    expect(m({ prevPorts: ['FIHKO'] })['ram:VoyageTypeServiceCode']).toBeUndefined();
    expect(m({ prevPorts: ['FIHKO'], notice: { ...snap().notice, voyageType: 'V-02' } })['ram:VoyageTypeServiceCode']).toBe('V-02');
  });

  it('takes the purposes a source pushed (opsDesk, spec 0090); one entered here wins', () => {
    const pushed = { value: ['17', '16'], source: 'opsdesk', receivedAt: '2026-09-27T08:00:00Z' };
    const m = (s: Partial<ObligationSnapshot>) =>
      buildNoaPayload(snap(s), false)['noa:SpecifiedLogisticsTransportMovement'] as Record<string, unknown>;
    expect(m({ notice: { ...snap().notice, purposeOfCall: null }, callPurposes: pushed })['ram:CallPurposeCode']).toEqual(['17', '16']);
    expect(m({ callPurposes: pushed })['ram:CallPurposeCode']).toEqual(['1']);
  });
});
