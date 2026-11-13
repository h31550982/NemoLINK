/**
 * The SEC's last calls start from the chartering system's previous ports
 * (user 2026-11-13): with no security form they are the rows, the facility
 * and the level left for the ship; with a form, the form's calls take the
 * plan's dates only where the form left them empty.
 */
import type { CodeBook } from '../src/ingest/documents/form-codes';
import type { ParsedForm } from '../src/ingest/documents/form-parser';
import { buildTables, type Rotation, type SourceDoc } from '../src/ingest/documents/form-tables';
import { buildSecPayload } from '../src/canonical/pre-arrival-formalities';

const book: CodeBook = { lists: new Map(), aliases: new Map() };
const ROTATION: Rotation = {
  origin: 'opsdesk voyage plan',
  prev: [
    { portLocode: 'SEGOT', arrival: '2026-11-08T06:00:00Z', departure: '2026-11-09T18:00:00Z' },
    { portLocode: 'DEHAM', arrival: '2026-11-04T10:00:00Z', departure: '2026-11-05T22:00:00Z' },
  ],
};

function securityDoc(rows: Record<string, string>[]): SourceDoc {
  const form: ParsedForm = {
    formType: 'nsw-security', formName: 'NSW security', context: 'arrival', fields: {}, rows,
    rowsLabel: 'port facility calls', rowsTruncated: false, warnings: [],
  };
  return { id: 'sec-1', fileName: 'security.xlsx', created: '2026-11-10T00:00:00Z', form, annotations: {} };
}

describe('SEC last calls from the chartering system (user 2026-11-13)', () => {
  it('no security form: the plan’s calls are the rows, facility and level missing', () => {
    const sec = buildTables([], book, [], ROTATION).find((t) => t.key === 'security')!;
    expect(sec.origins).toEqual(['opsdesk voyage plan']);
    expect(sec.sources).toEqual([]);
    expect(sec.rows.map((r) => [r.cells.port.value, r.cells.start.value, r.cells.end.value])).toEqual([
      ['SEGOT', '2026-11-08', '2026-11-09'],
      ['DEHAM', '2026-11-04', '2026-11-05'],
    ]);
    expect(sec.rows[0].cells.port.origin).toBe('opsdesk voyage plan');
    expect(sec.rows[0].cells.facility.flag).toBe('missing');
    expect(sec.rows[0].cells.level.flag).toBe('missing');
    const built = buildSecPayload(sec, 'FIRAU-0001');
    expect('missing' in built && built.missing).toContain('previous call 1: port facility, security level');
  });

  it('a typed facility and level complete a planned call', () => {
    const typed = (column: string, value: string) => ({ table: 'security' as const, rowKey: '1', column, value, author: 't', at: '2026-11-10T00:00:00Z' });
    const sec = buildTables([], book, [typed('facility', 'SEGOT-0012'), typed('level', 'SL1')], ROTATION).find((t) => t.key === 'security')!;
    expect(sec.rows[0].cells.facility).toMatchObject({ value: 'SEGOT-0012', entered: { author: 't' } });
    expect(sec.rows[0].cells.level.flag).toBeUndefined();
  });

  it('a security form leads: the plan fills only its empty dates, by port', () => {
    const doc = securityDoc([
      { portLocode: 'SEGOT', facilityGisis: '0012', securityLevel: 'SL1' },
      { portLocode: 'DEHAM', arrival: '2026-11-03', departure: '2026-11-05', facilityGisis: '0001', securityLevel: 'SL1' },
    ]);
    const sec = buildTables([doc], book, [], ROTATION).find((t) => t.key === 'security')!;
    expect(sec.rows).toHaveLength(2);
    expect(sec.rows[0].cells.start).toMatchObject({ value: '2026-11-08', origin: 'opsdesk voyage plan' });
    expect(sec.rows[1].cells.start).toMatchObject({ value: '2026-11-03', source: { fileName: 'security.xlsx' } });
    expect(sec.origins).toEqual(['opsdesk voyage plan']);
  });

  it('no previous ports: no security table without a form, as before', () => {
    expect(buildTables([], book, [], null).some((t) => t.key === 'security')).toBe(false);
    expect(buildTables([], book, [], { origin: 'x', prev: [] }).some((t) => t.key === 'security')).toBe(false);
  });
});
