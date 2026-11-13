import type { NemoStatus, PortCall } from '../auth/auth';
import type { PillTone } from '../components/StatusPill.vue';

/**
 * The home list (spec 0072): port calls split by the ship movement —
 * Upcoming, then Moored, then Departed — each group newest on top. Upcoming
 * holds every call ahead, however far off (user 2026-11-01), and every
 * Upcoming call whatever its dates (user 2026-11-04). Spec 0074: any other
 * call whose times are all past with nothing sent to NEMO is not shown.
 */

export type CallGroupKey = 'upcoming' | 'moored' | 'departed';

export interface CallGroup {
  key: CallGroupKey;
  title: string;
  tone: PillTone;
  icon: string;
  calls: PortCall[];
}

const GROUP_OF: Record<NemoStatus, CallGroupKey> = {
  Unconfirmed: 'upcoming',
  Arriving: 'upcoming',
  Moored: 'moored',
  Departed: 'departed',
  // The list leaves cancelled calls out; a COA-cancelled one has ended
  Cancelled: 'departed',
};

const GROUPS: Omit<CallGroup, 'calls'>[] = [
  { key: 'upcoming', title: 'Upcoming', tone: 'blue', icon: 'schedule' },
  { key: 'moored', title: 'Moored', tone: 'slate', icon: 'anchor' },
  { key: 'departed', title: 'Departed', tone: 'green', icon: 'sailing' },
];

export type CallWindow = '2w' | '1m' | '1y' | 'all';

export const CALL_WINDOWS: { value: CallWindow; label: string }[] = [
  { value: '2w', label: '2 weeks' },
  { value: '1m', label: '1 month' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All' },
];

/** The window's lower edge, or null for All. Calendar steps, local time. */
export function windowStart(w: CallWindow, now: Date = new Date()): Date | null {
  const d = new Date(now);
  if (w === '2w') d.setDate(d.getDate() - 14);
  else if (w === '1m') d.setMonth(d.getMonth() - 1);
  else if (w === '1y') d.setFullYear(d.getFullYear() - 1);
  else return null;
  return d;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Something of the call reached NEMO: the visit id, or any report NEMO
    accepted (the server's `sent` state, spec 0070). */
export function reachedNemo(call: PortCall): boolean {
  return !!call.visitId || call.obligations.some((o) => o.state === 'sent');
}

/** Spec 0074: every time the call has (ETA, ETD and any actuals) is past
    and nothing reached NEMO — reporting it now would make no sense, so the
    list leaves it out. A call without any time is not stale. An Upcoming
    call is never left out, however far back its times lie (user 2026-11-04). */
export function isStale(call: PortCall, now: Date = new Date()): boolean {
  if (GROUP_OF[call.nemoStatus] === 'upcoming') return false;
  const times = [call.eta, call.etd, call.ata, call.atd]
    .map(ms)
    .filter((t): t is number => t !== null);
  if (times.length === 0) return false;
  return times.every((t) => t < now.getTime()) && !reachedNemo(call);
}

/** When the call left: the actual departure, else the estimate, else the
    last change. */
function departedAt(call: PortCall): number {
  return ms(call.atd) ?? ms(call.etd) ?? ms(call.updated) ?? 0;
}

/** The window reaches back into history only: what is ahead or in port is
    open work and always shows — a call still Moored weeks after its
    arrival is a missing departure, not history. */
export function inWindow(call: PortCall, w: CallWindow, now: Date = new Date()): boolean {
  if (GROUP_OF[call.nemoStatus] !== 'departed') return true;
  const start = windowStart(w, now);
  return start === null || departedAt(call) >= start.getTime();
}

/** The time a group sorts by: arrival for upcoming, arrival actual for
    moored, departure actual for departed. Unknown sorts on top — a call
    without a time is the newest thing we know nothing about yet. Upcoming
    puts the soonest arrival first (user 2026-11-07); Moored and Departed
    the latest first. Higher sorts higher. */
function sortTime(call: PortCall, key: CallGroupKey): number {
  if (key === 'upcoming') {
    const eta = ms(call.eta);
    return eta === null ? Infinity : -eta;
  }
  const t = key === 'moored' ? (ms(call.ata) ?? ms(call.eta)) : departedAt(call);
  return t ?? Infinity;
}

/** Upcoming → Moored → Departed; Upcoming soonest arrival on top, the others newest on top; all three
    come back, empty or not — the page decides which heads to show. */
export function groupCalls(calls: PortCall[]): CallGroup[] {
  return GROUPS.map((g) => ({
    ...g,
    calls: calls
      .filter((c) => GROUP_OF[c.nemoStatus] === g.key)
      .sort(
        (a, b) =>
          sortTime(b, g.key) - sortTime(a, g.key) ||
          (a.shipName ?? '').localeCompare(b.shipName ?? ''),
      ),
  }));
}
