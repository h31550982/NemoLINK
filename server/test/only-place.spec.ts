/**
 * The place in the port when there is nothing to choose (user 2026-11-13):
 * one area is taken, one berth in the area is taken; a set value stands.
 */
import { onlyPlace } from '../src/canonical/only-place';

const ONE = [{ code: 'FIUKI-1', berths: [{ code: 'FIUKI-1-A' }] }];
const TWO = [
  { code: 'FIRAU-BB', berths: [{ code: 'FIRAU-BB-1' }, { code: 'FIRAU-BB-2' }] },
  { code: 'FIRAU-BE', berths: [{ code: 'FIRAU-BE-1' }] },
];
const none = { portAreaCode: null, berth: null };

describe('the only place (user 2026-11-13)', () => {
  it('one area with one berth: both are taken', () => {
    expect(onlyPlace(ONE, none)).toEqual({ portAreaCode: 'FIUKI-1', berth: 'FIUKI-1-A' });
  });

  it('several areas: nothing is guessed', () => {
    expect(onlyPlace(TWO, none)).toEqual(none);
  });

  it('a picked area with one berth brings the berth; with several, none', () => {
    expect(onlyPlace(TWO, { portAreaCode: 'FIRAU-BE', berth: null })).toEqual({ portAreaCode: 'FIRAU-BE', berth: 'FIRAU-BE-1' });
    expect(onlyPlace(TWO, { portAreaCode: 'FIRAU-BB', berth: null })).toEqual({ portAreaCode: 'FIRAU-BB', berth: null });
  });

  it('a berth names its area; a set value always stands', () => {
    expect(onlyPlace(TWO, { portAreaCode: null, berth: 'FIRAU-BB-2' })).toEqual({ portAreaCode: 'FIRAU-BB', berth: 'FIRAU-BB-2' });
    expect(onlyPlace(ONE, { portAreaCode: 'FIUKI-9', berth: null })).toEqual({ portAreaCode: 'FIUKI-9', berth: null });
  });

  it('a port with no published areas stays empty', () => {
    expect(onlyPlace([], none)).toEqual(none);
  });
});
