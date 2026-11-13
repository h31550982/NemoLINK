/** The port call's times, checked wherever they are saved or sent (user 2026-11-13). */

import { firstScheduleProblem, scheduleProblems } from '../src/canonical/schedule-rules';

const NOW = Date.parse('2026-11-13T12:00:00Z');

describe('scheduleProblems', () => {
  it('passes a sound call and leaves empty times to the checklists', () => {
    expect(firstScheduleProblem({ eta: '2026-11-20T06:00:00Z', etd: '2026-11-22T06:00:00Z' }, NOW)).toBeNull();
    expect(firstScheduleProblem({ eta: null, etd: null }, NOW)).toBeNull();
  });

  it('keeps the departure after the arrival', () => {
    expect(scheduleProblems({ eta: '2026-11-20T06:00:00Z', etd: '2026-11-20T06:00:00Z' }, NOW).etd).toBe('ETD must be after the ETA');
    expect(scheduleProblems({ ata: '2026-11-20T06:00:00Z', atd: '2026-11-19T06:00:00Z' }, NOW).atd).toBe('ATD must be after the ATA');
  });

  it('catches a mistyped year or a stay of months', () => {
    expect(scheduleProblems({ eta: '2028-11-20T06:00:00Z' }, NOW).eta).toMatch(/more than a year ahead/);
    expect(scheduleProblems({ eta: '2026-11-20T06:00:00Z', etd: '2027-03-20T06:00:00Z' }, NOW).etd).toMatch(/more than 90 days/);
  });

  it('names a time that is not a time', () => {
    expect(scheduleProblems({ eta: 'soon' }, NOW).eta).toBe('The ETA is not a valid time');
  });
});
