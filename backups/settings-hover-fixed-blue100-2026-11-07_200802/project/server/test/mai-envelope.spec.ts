import { buildMaiEnvelope } from '../src/nemo-client/mai-envelope';

const input = {
  formalityType: 'NOA',
  declarant: { id: 'FI1234567-8', roleCode: 'AG' },
  visitId: 'FI20260213-003',
  payload: { probe: true },
};

type Envelope = Record<string, any>;

describe('buildMaiEnvelope (spec 0006 AC 2)', () => {
  it('sends no @xmlns:* declarations — only env:Envelope (NEMO STG INTERNAL_ERROR, 2026-10-06)', () => {
    const envelope = buildMaiEnvelope(input) as Envelope;
    expect(Object.keys(envelope)).toEqual(['env:Envelope']);
  });

  it('places the required MAI fields', () => {
    const mai = (buildMaiEnvelope(input) as Envelope)['env:Envelope']['mai:MAI'];
    const doc = mai['mai:ExchangedDocument'];
    expect(doc['ram:TypeCode']).toBe('NOA');
    expect(doc['ram:PurposeCode']).toBe('9');
    expect(doc['ram:VersionID']).toBe('2.0');
    expect(doc['ram:ID']).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      doc['ram:FirstSignatoryDocumentAuthentication']['ram:FormattedActualDateTime'],
    ).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(
      mai['mai:ExchangedDeclaration']['ram:DeclarantTradeParty']['ram:ID'],
    ).toBe('FI1234567-8');
    expect(
      mai['mai:SpecifiedLogisticsTransportMovement']['ram:CallTransportEvent']['ram:ID'],
    ).toBe('FI20260213-003');
  });

  it('generates a fresh message uuid per call', () => {
    const id = (e: unknown): string =>
      (e as Envelope)['env:Envelope']['mai:MAI']['mai:ExchangedDocument']['ram:ID'];
    expect(id(buildMaiEnvelope(input))).not.toBe(id(buildMaiEnvelope(input)));
  });

  it('omits optional fields entirely instead of sending null/empty', () => {
    const mai = (buildMaiEnvelope(input) as Envelope)['env:Envelope']['mai:MAI'];
    expect(mai['mai:ExchangedDeclaration']).not.toHaveProperty('ram:ID');
    expect(mai['mai:ExchangedDeclaration']['ram:DeclarantTradeParty']).not.toHaveProperty(
      'ram:Name',
    );
  });

  it('places the payload under <type-lowercase>:<TYPE>', () => {
    const envelope = buildMaiEnvelope(input) as Envelope;
    expect(envelope['env:Envelope']['noa:NOA']).toEqual({ probe: true });
  });

  it('throws on an unknown formality type', () => {
    expect(() =>
      buildMaiEnvelope({ ...input, formalityType: 'NOPE' }),
    ).toThrow(/Unknown formality type/);
  });
});
