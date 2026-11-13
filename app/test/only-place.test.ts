import test from 'node:test';
import assert from 'node:assert/strict';
import { onlyPlace } from '../src/lib/only-place.ts';

const ONE = [{ code: 'FIUKI-1', berths: [{ code: 'FIUKI-1-A' }] }];
const TWO = [
  { code: 'FIRAU-BB', berths: [{ code: 'FIRAU-BB-1' }, { code: 'FIRAU-BB-2' }] },
  { code: 'FIRAU-BE', berths: [{ code: 'FIRAU-BE-1' }] },
];

test('one area with one berth: both are picked (user 2026-11-13)', () => {
  assert.deepEqual(onlyPlace(ONE, { portAreaCode: null, berth: null }), { portAreaCode: 'FIUKI-1', berth: 'FIUKI-1-A' });
});

test('several areas: nothing is guessed; a picked area with one berth brings it', () => {
  assert.deepEqual(onlyPlace(TWO, { portAreaCode: null, berth: null }), { portAreaCode: null, berth: null });
  assert.equal(onlyPlace(TWO, { portAreaCode: 'FIRAU-BE', berth: null }).berth, 'FIRAU-BE-1');
  assert.equal(onlyPlace(TWO, { portAreaCode: 'FIRAU-BB', berth: null }).berth, null);
});
