/**
 * The port call's times, checked the same way wherever they are saved or
 * sent (user 2026-11-13): a notice never goes with a missing ETA or ETD, nor
 * with times that cannot be right. The app mirrors these rules in
 * app/src/lib/schedule-rules.ts so the gap shows while the form is filled.
 */

/** A port stay longer than this is almost certainly a mistyped date. */
export const MAX_STAY_DAYS = 90;
/** An ETA further ahead than this is almost certainly a mistyped year. */
export const MAX_AHEAD_DAYS = 365;

const DAY = 24 * 60 * 60 * 1000;

export interface ScheduleTimes {
  eta?: string | null;
  etd?: string | null;
  ata?: string | null;
  atd?: string | null;
}

export interface ScheduleProblems {
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
}

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
};

/**
 * What is wrong with the times, field by field (null = fine or empty).
 * Emptiness is not judged here: whether a time is required depends on the
 * report, so the checklists decide that.
 */
export function scheduleProblems(t: ScheduleTimes, now: number = Date.now()): ScheduleProblems {
  const eta = ms(t.eta);
  const etd = ms(t.etd);
  const ata = ms(t.ata);
  const atd = ms(t.atd);
  const out: ScheduleProblems = { eta: null, etd: null, ata: null, atd: null };
  if (Number.isNaN(eta)) out.eta = 'The ETA is not a valid time';
  else if (eta !== null && eta > now + MAX_AHEAD_DAYS * DAY) out.eta = 'The ETA is more than a year ahead — check the year';
  if (Number.isNaN(etd)) out.etd = 'The ETD is not a valid time';
  else if (etd !== null && eta !== null && !Number.isNaN(eta)) {
    if (etd <= eta) out.etd = 'ETD must be after the ETA';
    else if (etd - eta > MAX_STAY_DAYS * DAY) out.etd = `The ETD is more than ${MAX_STAY_DAYS} days after the ETA — check the dates`;
  }
  if (Number.isNaN(ata)) out.ata = 'The ATA is not a valid time';
  if (Number.isNaN(atd)) out.atd = 'The ATD is not a valid time';
  else if (atd !== null && ata !== null && !Number.isNaN(ata) && atd <= ata) out.atd = 'ATD must be after the ATA';
  return out;
}

/** The first problem in words, or null. */
export function firstScheduleProblem(t: ScheduleTimes, now?: number): string | null {
  const p = scheduleProblems(t, now);
  return p.eta ?? p.etd ?? p.ata ?? p.atd;
}
