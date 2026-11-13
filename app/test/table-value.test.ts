import test from 'node:test';
import assert from 'node:assert/strict';
import { tableValueProblem } from '../src/lib/table-value.ts';

test('inline entries and the table dialog accept supported date formats and reject impossible dates', () => {
  for (const date of ['2028-02-29', '29.2.2028', '2026-11-12', '12.11.2026']) {
    assert.equal(tableValueProblem('date', date), '');
  }
  for (const date of ['2026-02-29', '31.4.2026', '2026-13-01', 'November']) {
    assert.notEqual(tableValueProblem('date', date), '');
  }
});

test('inline numbers and ports use the table entry validation', () => {
  for (const value of ['0', '12,5', '1 000.5']) assert.equal(tableValueProblem('number', value), '');
  for (const value of ['-1', 'many', 'Infinity']) assert.notEqual(tableValueProblem('number', value), '');
  for (const value of ['FIRAU', 'fihel']) assert.equal(tableValueProblem('locode', value), '');
  for (const value of ['Helsinki', 'FIH1L']) assert.notEqual(tableValueProblem('locode', value), '');
});
