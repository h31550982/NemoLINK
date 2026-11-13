import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref } from 'vue';
import type { NemoTable } from '../src/auth/auth.ts';
import { useTableMissingFields } from '../src/composables/useTableMissingFields.ts';
import { missingReportFields } from '../src/lib/mobile-report-fields.ts';

function fixture(): NemoTable {
  return {
    key: 'crew', label: 'Crew', sheet: 'Crew', rowNoun: 'crew members', sources: [],
    fields: [{ key: 'contact', de: null, label: 'Contact', kind: 'text' }],
    header: { contact: { value: null, flag: 'missing' } },
    columns: ['nationality', 'dateOfBirth', 'effectsUnit'].map(key => ({ key, de: null, label: key, kind: 'text' })),
    rows: [
      { key: 'jack', label: 'Jack', cells: { nationality: { value: null, flag: 'missing' }, dateOfBirth: { value: '1970-06-09' } } },
      { key: 'ana', label: 'Ana', cells: { nationality: { value: 'GBR' }, dateOfBirth: { value: null, flag: 'missing' } } },
      { key: 'ready', label: 'Ready', cells: { nationality: { value: 'GBR' }, dateOfBirth: { value: '1970-06-09' } } },
    ],
    counts: { missing: 3, error: 0, warning: 0, conflict: 0 },
  };
}

function setup(t: TestContext) {
  const table = ref<NemoTable | null>(fixture());
  const desktop = ref(true);
  const scope = effectScope();
  const state = scope.run(() => useTableMissingFields(() => table.value, () => desktop.value))!;
  t.after(() => scope.stop());
  const update = (change: (value: NemoTable) => void) => {
    const next = JSON.parse(JSON.stringify(table.value)) as NemoTable;
    change(next);
    table.value = next;
  };
  return { table, desktop, state, update };
}

test('defaults to all missing columns and rows across groups, including header facts', t => {
  const { state } = setup(t);
  assert.equal(state.active, true);
  assert.equal(state.count, 3);
  assert.deepEqual([...state.rows], ['jack', 'ana']);
  assert.deepEqual([...state.columns], ['nationality', 'dateOfBirth']);
  assert.deepEqual([...state.fields], ['contact']);
  assert.deepEqual(state.entries.map(entry => [entry.rowKey, entry.column.key, entry.rowLabel]), [
    ['_', 'contact', ''], ['jack', 'nationality', 'Jack'], ['ana', 'dateOfBirth', 'Ana'],
  ]);
});

test('completed rows, columns and facts stay until the completed visit is left', t => {
  const { state, update } = setup(t);
  update(table => { table.rows[0]!.cells.nationality = { value: 'GBR' }; });
  const completed = state.entries.find(entry => entry.rowKey === 'jack')!;
  assert.equal(completed.cell.value, 'GBR');
  assert.equal(completed.cell.flag, undefined);
  assert.equal(state.count, 2);
  assert.deepEqual([...state.rows], ['jack', 'ana']);
  state.leaveCompleted();
  assert.equal(state.active, true);
  update(table => {
    table.header.contact = { value: 'Captain' };
    table.rows[1]!.cells.dateOfBirth = { value: '1970-06-09' };
  });
  assert.equal(state.count, 0);
  assert.equal(state.offered, true);
  assert.equal(state.active, true);
  assert.deepEqual([...state.rows], ['jack', 'ana']);
  assert.deepEqual([...state.columns], ['nationality', 'dateOfBirth']);
  assert.deepEqual([...state.fields], ['contact']);
  state.leaveCompleted();
  assert.equal(state.offered, false);
  assert.equal(state.active, false);
});

test('switching tabs starts a fresh Missing visit and respects the selected tab on refresh', t => {
  const { state, update } = setup(t);
  update(table => { table.rows[0]!.cells.nationality = { value: 'GBR' }; });
  state.choose(false);
  update(table => { table.header.contact = { value: 'Captain' }; });
  assert.equal(state.active, false);
  state.choose(true);
  assert.deepEqual([...state.rows], ['ana']);
  assert.deepEqual([...state.columns], ['dateOfBirth']);
  assert.equal(state.fields.size, 0);
});

test('nested crew effects remain visible after completion and removed rows are discarded', t => {
  const { state, update } = setup(t);
  update(table => { table.rows[2]!.items = [{ effectsUnit: { value: null, flag: 'missing' } }]; });
  assert.equal(state.columns.has('effectsUnit'), true);
  update(table => { table.rows[2]!.items![0]!.effectsUnit = { value: 'PCE' }; });
  assert.equal(state.rows.has('ready'), true);
  assert.equal(state.columns.has('effectsUnit'), true);
  update(table => { table.rows.splice(2, 1); });
  assert.equal(state.rows.has('ready'), false);
  assert.equal(state.columns.has('effectsUnit'), false);
});

test('section changes reset the default and mobile does not use the Missing filter', t => {
  const { table, desktop, state, update } = setup(t);
  state.choose(false);
  update(table => { table.key = 'passengers'; });
  assert.equal(state.active, true);
  desktop.value = false;
  assert.equal(state.active, false);
  table.value = null;
  table.value = { ...fixture(), key: 'cargo' };
  desktop.value = true;
  assert.equal(state.active, true);
  table.value = { ...fixture(), key: 'health', header: {}, rows: [], counts: { missing: 0, error: 0, warning: 0, conflict: 0 } };
  assert.equal(state.active, false);
  assert.equal(state.offered, false);
});

test('removing all missing data falls back to the normal columns', t => {
  const { state, update } = setup(t);
  update(table => {
    table.header = {};
    table.rows = table.rows.filter(row => row.key === 'ready');
  });
  assert.equal(state.active, false);
  assert.equal(state.offered, false);
});

test('cargo Missing views identify goods by description, never the optional bill-of-lading code', t => {
  const { table, state, update } = setup(t);
  table.value = {
    ...fixture(), key: 'cargo', fields: [], header: {},
    columns: ['description', 'grossWeight'].map(key => ({ key, de: null, label: key, kind: 'text' })),
    rows: [
      { key: 'cargo-a', label: 'OPTIONAL-BL-001', cells: { description: { value: 'Steel coils' }, grossWeight: { value: null, flag: 'missing' } } },
      { key: 'cargo-b', label: 'OPTIONAL-BL-001', cells: { description: { value: 'Timber' }, grossWeight: { value: null, flag: 'missing' } } },
      { key: 'cargo-c', label: 'OPTIONAL-BL-003', cells: { description: { value: null, flag: 'missing' } } },
      { key: 'cargo-d', label: 'OPTIONAL-BL-004', cells: { description: { value: '   ', flag: 'missing' } } },
    ],
  };
  const labels = ['Steel coils', 'Timber', 'Cargo item 3', 'Cargo item 4'];
  assert.deepEqual(state.entries.map(entry => entry.rowLabel), labels);
  assert.deepEqual(missingReportFields(table.value).map(entry => entry.rowLabel), labels);
  const retainedId = state.entries[2]!.id;
  update(table => { table.rows[2]!.cells.description = { value: 'Paper rolls' }; });
  assert.equal(state.entries.find(entry => entry.id === retainedId)?.rowLabel, 'Paper rolls');
  assert.equal(state.entries.find(entry => entry.id === retainedId)?.cell.value, 'Paper rolls');
});
