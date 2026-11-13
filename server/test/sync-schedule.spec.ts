import { nextDailyShipsSlot, nextWeeklySlot } from '../src/refdata/sync-schedule';

describe('nextWeeklySlot (Monday 12:00 Europe/Helsinki)', () => {
  it('lands on the coming Monday noon, summer time (UTC+3)', () => {
    // Saturday 2026-09-26
    expect(nextWeeklySlot(new Date('2026-09-26T10:00:00Z')).toISOString()).toBe(
      '2026-09-28T09:00:00.000Z',
    );
  });

  it('on Monday morning it is today; just after noon it is next week', () => {
    expect(nextWeeklySlot(new Date('2026-09-28T08:59:00Z')).toISOString()).toBe(
      '2026-09-28T09:00:00.000Z',
    );
    expect(nextWeeklySlot(new Date('2026-09-28T09:00:00Z')).toISOString()).toBe(
      '2026-10-05T09:00:00.000Z',
    );
  });

  it('follows the clock across the DST change (winter time UTC+2)', () => {
    // Clocks go back Sunday 2026-10-25
    expect(nextWeeklySlot(new Date('2026-10-20T12:00:00Z')).toISOString()).toBe(
      '2026-10-26T10:00:00.000Z',
    );
    // ...and forward Sunday 2027-03-28
    expect(nextWeeklySlot(new Date('2027-03-23T12:00:00Z')).toISOString()).toBe(
      '2027-03-29T09:00:00.000Z',
    );
  });
});

describe('nextDailyShipsSlot (05:00 UTC)', () => {
  it('is today before five, tomorrow from five on', () => {
    expect(nextDailyShipsSlot(new Date('2026-09-26T04:59:00Z')).toISOString()).toBe(
      '2026-09-26T05:00:00.000Z',
    );
    expect(nextDailyShipsSlot(new Date('2026-09-26T05:00:00Z')).toISOString()).toBe(
      '2026-09-27T05:00:00.000Z',
    );
  });
});
