import * as XLSX from 'xlsx';
import { applyCorrections } from '../src/ingest/documents/form-checks';
import type { CodeBook } from '../src/ingest/documents/form-codes';
import { parseForm, refreshCargoForm, type ParsedForm } from '../src/ingest/documents/form-parser';
import { buildTables, columnOf, entryValue, type SourceDoc } from '../src/ingest/documents/form-tables';
import { nationalSpreadsheet } from '../src/ingest/documents/national-spreadsheet';

const book: CodeBook = { lists: new Map(), aliases: new Map() };
function fixture(): Buffer {
  const rows: (string | number | null)[][] = [];
  rows[1] = ['Cargo declaration (IMO FAL Form 2)'];
  rows[3] = ['Arrival', 'X', null, null, null, null, 'Departure'];
  rows[4] = ['1.1 Name of ship', null, '1.2 IMO number'];
  rows[5] = ['BLACK PEARL', null, '1236668'];
  rows[7] = ['2. Port of discharge'];
  rows[8] = ['FIHMN'];
  rows[14] = ['B/L', 'Marks and numbers', 'Number and kind of packages', 'Description of goods', 'HS code', 'Gross weight (kg)', 'Measurement (m³)', 'Port of loading', 'Port of discharge'];
  rows[15] = ['EX-001', 'ABC123', 'Bundles (BE)', 'Paper and pulp', '481190', 10000, null, 'SESTO', 'FIHMN'];
  rows[16] = ['EX-002', 'XYZ123 / CCC222', 'Bundles (BE)', 'Paperboard', '481160', 5000, null, 'SESTO', 'FIHMN'];
  rows[17] = ['EX-003', 'CBB111', 'Bundles (BE)', 'Plywood', '441210', 4000, null, 'SESTO', 'FIHMN'];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const addr of ['F16', 'F17', 'F18']) sheet[addr].z = '#,##0';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Cargo declaration');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
function doc(form = parseForm(fixture()).form!, id = 'cargo-file-1'): SourceDoc {
  return { id, fileName: 'cargo.xlsx', created: '2026-11-10T00:00:00Z', form, annotations: {} };
}

describe('cargo in Review ship forms', () => {
  it('reads all three goods items, HS codes and journey fields from the original FAL workbook', () => {
    const form = parseForm(fixture()).form!;
    expect(form).toMatchObject({ formType: 'fal2', context: 'arrival' });
    expect(form.rows).toHaveLength(3);
    expect(form.rows![0]).toMatchObject({ description: 'Paper and pulp', hsCode: '481190', loadingPort: 'SESTO', dischargePort: 'FIHMN' });
    expect(form.cells).toMatchObject({ 'rows.0.description': 'D16', 'rows.0.hsCode': 'E16' });
    const cargo = buildTables([doc(form)], book)[0];
    expect(cargo).toMatchObject({ key: 'cargo', label: 'Cargo', counts: { error: 0, warning: 0, missing: 0, conflict: 0 } });
    expect(cargo.rows.map(r => r.cells.grossWeight.value)).toEqual(['10000', '5000', '4000']);
    expect(cargo.rows.reduce((total, r) => total + Number(r.cells.grossWeight.value), 0)).toBe(19000);
    expect(cargo.rows[1].cells.marksAndNumbers.value).toBe('XYZ123 / CCC222');
    expect(cargo.rows[0].cells.hsCode.source?.path).toBe('rows.0.hsCode');
  });

  it('refreshes an older saved parse without replacing corrections or original cell references', () => {
    const bytes = fixture();
    const form = parseForm(bytes).form!;
    const old: ParsedForm = { ...form, rows: form.rows!.map(({ blNumber, marksAndNumbers, packages, grossWeight }) => ({ blNumber, marksAndNumbers, packages, grossWeight })) };
    const refreshed = refreshCargoForm(old, bytes)!;
    expect(old.rows![0].description).toBeUndefined();
    expect(refreshed.rows![0].description).toBe('Paper and pulp');
    const corrected = applyCorrections(refreshed, { 'rows.0.description': { value: 'Coated paper', author: 'tester', at: '2026-11-10T00:00:00Z' } });
    expect(buildTables([doc(corrected)], book)[0].rows[0].cells.description.value).toBe('Coated paper');
    expect(corrected.cells!['rows.0.description']).toBe('D16');
    expect(refreshCargoForm(null, bytes)).toBeNull();
  });

  it('keeps cargo from different documents separate even when they use the same row numbers', () => {
    const cargo = buildTables([doc(), doc(undefined, 'cargo-file-2')], book)[0];
    expect(cargo.rows).toHaveLength(6);
    expect(new Set(cargo.rows.map(r => r.key)).size).toBe(6);
  });

  it('uses stable row keys for manual values and marks missing and invalid cargo values', () => {
    const source = doc();
    source.form.rows![0].hsCode = '123';
    source.form.rows![0].grossWeight = '-1';
    delete source.form.rows![1].description;
    const cargo = buildTables([source], book, [{ table: 'cargo', rowKey: 'cargo-file-1 1', column: 'hsCode', value: '481190', author: 'tester', at: '2026-11-10T00:00:00Z' }])[0];
    expect(cargo.rows[0].cells.hsCode).toMatchObject({ value: '481190', entered: { author: 'tester' } });
    expect(cargo.rows[0].cells.grossWeight.flag).toBe('error');
    expect(cargo.rows[1].cells.description.flag).toBe('missing');
    expect(entryValue(columnOf('cargo', 'hsCode')!, '123', book)).toHaveProperty('problem');
    expect(entryValue(columnOf('cargo', 'grossWeight')!, '0', book)).toHaveProperty('problem');
  });

  it('does not produce an empty National Spreadsheet for a cargo-only call', () => {
    expect(() => nationalSpreadsheet(buildTables([doc()], book))).toThrow('individual files');
  });
});
