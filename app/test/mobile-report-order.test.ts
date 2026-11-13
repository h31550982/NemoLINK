import test from 'node:test';
import assert from 'node:assert/strict';
import type { NemoColumn, NemoRow } from '../src/auth/auth.ts';
import { missingFirstRows } from '../src/lib/mobile-report-fields.ts';

const columns: NemoColumn[] = ['nationality', 'dateOfBirth', 'effectsUnit'].map(key => ({ key, de: null, label: key, kind: 'text' }));
const rows: NemoRow[] = [
  { key: 'ready-a', label: 'Ready A', cells: { nationality: { value: 'GBR' } } },
  { key: 'birth-missing', label: 'Missing birth', cells: { dateOfBirth: { value: null, flag: 'missing' } } },
  { key: 'warning', label: 'Warning', cells: { nationality: { value: 'GBR', flag: 'warning' } } },
  { key: 'nationality-missing', label: 'Missing nationality', cells: { nationality: { value: null, flag: 'missing' } } },
  { key: 'effects-missing', label: 'Missing effects unit', cells: {}, items: [{ effectsUnit: { value: null, flag: 'missing' } }] },
  { key: 'ready-b', label: 'Ready B', cells: { nationality: { value: 'FIN' } } },
];

test('mobile lists show missing rows first, with stable order and no changes to source rows', () => {
  const originalOrder = rows.map(row => row.key);
  assert.deepEqual(missingFirstRows(rows, columns).map(row => row.key), [
    'birth-missing', 'nationality-missing', 'effects-missing', 'ready-a', 'warning', 'ready-b',
  ]);
  assert.deepEqual(rows.map(row => row.key), originalOrder);
});

test('a selected category prioritizes missing values in that category', () => {
  assert.deepEqual(missingFirstRows(rows, [columns[0]!]).map(row => row.key), [
    'nationality-missing', 'ready-a', 'birth-missing', 'warning', 'effects-missing', 'ready-b',
  ]);
  assert.deepEqual(missingFirstRows(rows, [columns[2]!]).map(row => row.key), [
    'effects-missing', 'ready-a', 'birth-missing', 'warning', 'nationality-missing', 'ready-b',
  ]);
});

test('rows remain in the list after completion and lists with no missing fields keep their order', () => {
  const complete = rows.map(row => ({ ...row, cells: {}, items: [] }));
  assert.deepEqual(missingFirstRows(complete, columns).map(row => row.key), rows.map(row => row.key));
  assert.deepEqual(missingFirstRows([], columns), []);
});
