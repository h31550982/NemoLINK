import { compareHeld, readBackOf } from '../src/nemo-client/read-back';
import { documentIdOf } from '../src/canonical/ship-formalities';

const sentNoa = {
  'env:Envelope': {
    'mai:MAI': { 'mai:ExchangedDocument': { 'ram:ID': 'doc-1' } },
    'noa:NOA': {
      'noa:SpecifiedLogisticsTransportMovement': {
        'ram:CrewQuantity': 9,
        'ram:CallTransportEvent': { 'ram:EstimatedTransportMeansArrivalOccurrenceDateTime': '2026-09-27T10:00:00Z' },
      },
    },
  },
};

describe('the read-back (spec 0089)', () => {
  it('additions on NEMO’s side are fine; a changed or missing value is a difference', () => {
    expect(compareHeld({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'x', d: 'added by NEMO' }, e: 2 })).toEqual([]);
    expect(compareHeld({ a: 1, b: { c: 'x' } }, { a: 2, b: {} })).toEqual([
      { path: 'a', sent: 1, held: 2 },
      { path: 'b/c', sent: 'x', held: null },
    ]);
  });

  it('the same instant and the same number in another spelling are the same', () => {
    expect(compareHeld({ t: '2026-09-27T10:00:00Z', n: 9 }, { t: '2026-09-27T10:00:00.000Z', n: '9' })).toEqual([]);
  });

  it('finds our formality by NEMO’s id or our document id and compares its data section', () => {
    const held = JSON.parse(JSON.stringify(sentNoa));
    const list = [{ formalityType: 'NOA', formalityId: 'outer-1', status: 'SUBMITTED', formality: held }];
    expect(readBackOf(list, 'NOA', sentNoa, { formalityId: 'outer-1', documentId: null }, documentIdOf).state).toBe('same');
    expect(readBackOf(list, 'NOA', sentNoa, { formalityId: null, documentId: 'doc-1' }, documentIdOf).state).toBe('same');
    held['env:Envelope']['noa:NOA']['noa:SpecifiedLogisticsTransportMovement']['ram:CrewQuantity'] = 8;
    const differs = readBackOf(list, 'NOA', sentNoa, { formalityId: 'outer-1', documentId: null }, documentIdOf);
    expect(differs.state).toBe('differs');
    expect(differs.differences).toEqual([
      { path: 'noa:SpecifiedLogisticsTransportMovement/ram:CrewQuantity', sent: 9, held: 8 },
    ]);
    expect(readBackOf([], 'NOA', sentNoa, { formalityId: 'outer-1', documentId: null }, documentIdOf).state).toBe('missing');
    expect(readBackOf(null, 'NOA', sentNoa, { formalityId: 'outer-1', documentId: null }, documentIdOf).state).toBe('unread');
  });
});
