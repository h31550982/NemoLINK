import { MigValidator } from '../src/nemo-client/mig-validator';
import { buildMaiEnvelope } from '../src/nemo-client/mai-envelope';

const minimalNoaPayload = {
  'noa:SpecifiedLogisticsTransportMovement': {
    'ram:CallPurposeCode': ['1'],
    'ram:ItineraryTransportRoute': {
      'ram:ItineraryStopTransportEvent': [
        {
          'ram:SequenceNumeric': 1,
          'ram:OccurrenceLogisticsLocation': { 'ram:ID': 'SESTO' },
        },
      ],
    },
    'ram:CallTransportEvent': {
      'ram:EstimatedTransportMeansArrivalOccurrenceDateTime': '2026-09-01T10:00:00Z',
      'ram:EstimatedTransportMeansDepartureOccurrenceDateTime': '2026-09-02T10:00:00Z',
    },
  },
};

describe('MigValidator (specs 0005/0006)', () => {
  const validator = new MigValidator();

  it('compiles all 30 vendored MIG 2.0.1.0 schemas at construction', () => {
    expect(validator.types).toHaveLength(30);
    expect(validator.version).toBe('2.0.1.0');
    for (const type of ['VID', 'NOA', 'NOD', 'ATA', 'ATD', 'CRT']) {
      expect(validator.types).toContain(type);
    }
  });

  it('accepts a well-formed NOA envelope', () => {
    const envelope = buildMaiEnvelope({
      formalityType: 'NOA',
      declarant: { id: 'FI1234567-8', roleCode: 'AG' },
      visitId: 'FI20260213-003',
      payload: minimalNoaPayload,
    });
    expect(validator.validate('NOA', envelope)).toEqual([]);
  });

  it('rejects a structurally broken envelope with JSON pointers', () => {
    const errors = validator.validate('NOA', {
      'env:Envelope': { 'mai:MAI': {} },
    });
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(error).toHaveProperty('pointer');
      expect(error).toHaveProperty('message');
    }
    expect(errors.some((e) => e.pointer.includes('mai:MAI'))).toBe(true);
  });

  it('throws on an unknown formality type', () => {
    expect(() => validator.validate('XXX', {})).toThrow(/Unknown formality type/);
  });
});
