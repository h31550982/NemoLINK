import { formFactsOf, type ActiveForm } from '../src/canonical/form-facts';
import { noaLedger } from '../src/canonical/noa-ledger';
import { noaCallFacts } from '../src/canonical/noa-facts';
import type { ParsedForm } from '../src/ingest/documents/form-parser';
import { noaSnapshot } from './noa-fixture';

/** Dummy forms shaped like the parser's output (spec 0049) — no real crew. */
function form(formType: ParsedForm['formType'], rows: Record<string, string>[], fields: Record<string, string> = {}, context: ParsedForm['context'] = 'both'): ParsedForm {
  return { formType, formName: formType, context, fields, rows, rowsLabel: null, rowsTruncated: false, warnings: [] };
}
const at = (f: ParsedForm, fileName: string, uploadedAt = '2026-09-25T08:00:00Z'): ActiveForm => ({ form: f, fileName, uploadedAt });

const crew = form('nsw-crew', [
  { rank: 'Master', firstName: 'Jack', lastName: 'Sparrow' },
  { rank: 'Ch. Officer', firstName: 'Joshamee', lastName: 'Gibbs' },
  { rank: 'AB', firstName: 'Hector', lastName: 'Barbossa' },
]);
const security = form('nsw-security', [
  { arrival: '2026-10-02', departure: '2026-10-03', portLocode: 'FIHMN' },
  { arrival: '2026-09-23', departure: '2026-09-25', portLocode: 'FIKTK' },
  { arrival: '2026-09-17', departure: '2026-09-18', portLocode: 'BEANR' },
]);

describe('the facts the pre-arrival forms give (spec 0090)', () => {
  it('crew and master from the crew list; persons on board without a passenger list = crew', () => {
    const f = formFactsOf([at(crew, 'crew.xlsx')], '2026-09-27T10:00:00Z');
    expect(f.crew).toMatchObject({ value: 3, source: 'NSW crew list (crew.xlsx)' });
    expect(f.personsOnBoard?.value).toBe(3);
    expect(f.masterFamilyName?.value).toBe('Sparrow');
    expect(f.masterGivenNames?.value).toBe('Jack');
  });

  it('persons on board add the passenger list; a departure-only crew list is not the arrival', () => {
    const pax = form('nsw-pax', [{ lastName: 'Swann' }, { lastName: 'Turner' }]);
    expect(formFactsOf([at(crew, 'c.xlsx'), at(pax, 'p.xlsx')], null).personsOnBoard?.value).toBe(5);
    const leaving = form('nsw-crew', crew.rows!, {}, 'departure');
    expect(formFactsOf([at(leaving, 'c.xlsx')], null).crew).toBeUndefined();
  });

  it('the last port: the most recent facility call that ended before this ETA', () => {
    expect(formFactsOf([at(security, 's.xlsx')], '2026-09-27T10:00:00Z').lastPort?.value).toBe('FIKTK');
  });

  it('a FAL 1 count stands in when no crew list has rows', () => {
    const fal1 = form('fal1', [], { crewCount: '12', passengerCount: '0' });
    expect(formFactsOf([at(fal1, 'fal1.xls')], null)).toMatchObject({ crew: { value: 12 }, personsOnBoard: { value: 12 } });
  });
});

describe('the NOA facts and rows (spec 0090)', () => {
  const forms = formFactsOf([at(crew, 'crew.xlsx'), at(security, 's.xlsx')], '2026-09-27T10:00:00Z');

  it('entered wins; else the preferred source; sources that disagree are flagged', () => {
    const snap = noaSnapshot({ notice: { crew: 9 }, formFacts: forms, prevPorts: ['SEGOT'] });
    const f = noaCallFacts(snap);
    expect(f.crew).toMatchObject({ entered: 9, toNemo: 9 });
    expect(f.crew.externals[0]).toMatchObject({ value: 3 });
    expect(f.masterFamilyName.toNemo).toBe('Sparrow');
    expect(f.lastPort.toNemo).toBe('SEGOT');
    const rows = noaLedger(snap, null, { agentId: 'FI1', agencyName: 'A', mobile: '+358', email: 'a@b', businessId: '1234567-8', street: 'Satamatie 1', postcode: '26100', city: 'Rauma', countryCode: 'FI' });
    const last = rows.find((r) => r.key === 'call:lastPort')!;
    expect(last.externals.map((e) => e.value)).toEqual(['SEGOT', 'FIKTK']);
    expect(last.differs).toBe(true);
    expect(rows.find((r) => r.key === 'fixed:nextPort')!.toNemo).toBe('ZZUKN');
    expect(rows.find((r) => r.key === 'ship:flagState')!.editable).toBe(false);
  });

  it('a ship row shows External, the override and To NEMO', () => {
    const snap = noaSnapshot({ formFacts: forms });
    const rows = noaLedger(
      snap,
      {
        external: { flagState: { value: 'FI', source: 'master list', receivedAt: '2026-09-01T00:00:00Z' } },
        overrides: { flagState: { value: 'SE' } },
        particulars: { flagState: 'SE' },
      },
      { agentId: null, agencyName: null, mobile: null, email: null, businessId: null, street: null, postcode: null, city: null, countryCode: null },
    );
    expect(rows.find((r) => r.key === 'ship:flagState')).toMatchObject({ entered: 'SE', toNemo: 'SE', externals: [{ value: 'FI' }], ok: true });
    expect(rows.find((r) => r.key === 'org:agentId')).toMatchObject({ ok: false, editable: true });
    expect(rows.find((r) => r.key === 'fixed:duesLanguage')).toMatchObject({ toNemo: 'EN', ok: true, editable: false });
  });
});
