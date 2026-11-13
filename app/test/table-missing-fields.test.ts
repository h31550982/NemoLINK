import test from 'node:test';
import assert from 'node:assert/strict';
import type { NemoTable } from '../src/auth/auth.ts';
import { missingReportFields } from '../src/lib/mobile-report-fields.ts';

/* Desktop has no separate Missing fields list any more (user 2026-11-13):
   missing values are typed right in the standard table's cells. The phone
   keeps its Fill all missing fields list, covered here. */

test('the phone list names cargo by its goods description, never the optional bill-of-lading code', () => {
  const table: NemoTable = {
    key: 'cargo', label: 'Cargo', sheet: 'Cargo', rowNoun: 'cargo items', sources: [], fields: [], header: {},
    columns: ['description', 'grossWeight'].map(key => ({ key, de: null, label: key, kind: 'text' as const })),
    rows: [
      { key: 'cargo-a', label: 'OPTIONAL-BL-001', cells: { description: { value: 'Steel coils' }, grossWeight: { value: null, flag: 'missing' } } },
      { key: 'cargo-b', label: 'OPTIONAL-BL-001', cells: { description: { value: 'Timber' }, grossWeight: { value: null, flag: 'missing' } } },
      { key: 'cargo-c', label: 'OPTIONAL-BL-003', cells: { description: { value: null, flag: 'missing' } } },
      { key: 'cargo-d', label: 'OPTIONAL-BL-004', cells: { description: { value: '   ', flag: 'missing' } } },
    ],
    counts: { missing: 4, error: 0, warning: 0, conflict: 0 },
  };
  assert.deepEqual(missingReportFields(table).map(entry => entry.rowLabel), ['Steel coils', 'Timber', 'Cargo item 3', 'Cargo item 4']);
});
