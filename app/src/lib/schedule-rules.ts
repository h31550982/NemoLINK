/**
 * The port call's times, checked while they are filled (user 2026-11-13).
 * The same rules as the server's (server/src/canonical/schedule-rules.ts),
 * which checks them again on every save and every send — so a notice never
 * goes with a missing ETA or ETD, nor with times that cannot be right.
 *
 * Values are the forms' local 'YYYY-MM-DDTHH:mm' strings; they compare
 * chronologically as text.
 */

/** A port stay longer than this is almost certainly a mistyped date. */
export const MAX_STAY_DAYS = 90;
/** An ETA further ahead than this is almost certainly a mistyped year. */
export const MAX_AHEAD_DAYS = 365;

const DAY = 24 * 60 * 60 * 1000;

export interface ScheduleDraft {
  eta: string;
  etd: string;
  ata?: string;
  atd?: string;
}

export interface ScheduleCheck {
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** A local 'YYYY-MM-DDTHH:mm' for a moment. */
export function localInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/**
 * What is wrong with the times, field by field (null = fine).
 * `required` names the times that must be there; `originalEta` is the ETA
 * as loaded — the past-ETA rule applies only to an ETA the user changed,
 * so a historical call's other fields stay editable.
 */
export function checkSchedule(
  t: ScheduleDraft,
  opts: { required?: readonly ('eta' | 'etd')[]; originalEta?: string; now?: number } = {},
): ScheduleCheck {
  const now = opts.now ?? Date.now();
  const today = `${localInput(now).slice(0, 10)}T00:00`;
  const out: ScheduleCheck = { eta: null, etd: null, ata: null, atd: null };
  const required = opts.required ?? [];

  if (!t.eta) {
    if (required.includes('eta')) out.eta = 'Set the ETA — NEMO requires it';
  } else if (t.eta !== (opts.originalEta ?? '') && t.eta < today) {
    out.eta = 'ETA cannot be in the past';
  } else if (t.eta > localInput(now + MAX_AHEAD_DAYS * DAY)) {
    out.eta = 'The ETA is more than a year ahead — check the year';
  }

  if (!t.etd) {
    if (required.includes('etd')) out.etd = 'Set the ETD — NEMO requires it';
  } else if (t.eta && t.etd <= t.eta) {
    // The rule that was already here: a departure never before the arrival
    out.etd = 'ETD must be after the ETA';
  } else if (t.eta && Date.parse(t.etd) - Date.parse(t.eta) > MAX_STAY_DAYS * DAY) {
    out.etd = `The ETD is more than ${MAX_STAY_DAYS} days after the ETA — check the dates`;
  }

  if (t.ata && t.atd && t.atd <= t.ata) out.atd = 'ATD must be after the ATA';
  return out;
}
