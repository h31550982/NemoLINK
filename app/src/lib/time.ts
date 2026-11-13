/**
 * House time display (docs/specs/0044, docs/07 law 12): log-style views
 * show close-by times relatively ("12 min ago", "3 h ago") and switch to
 * the absolute house format beyond a day.
 */

/** '2026-08-24 14:18' — the house absolute date-time: ISO order, local time
    (user decision 2026-09-30, supersedes the Finnish order of spec 0047). */
export function fmtDateTime(iso: string | null | undefined): string {
  return fmtStamp(iso);
}

/** '2026-08-23 13:00' — the house stamp. */
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${fmtDay(iso)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** '2026-08-23' — the house date, ISO order. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** 'YYYY-MM-DD[THH:mm]' (the field model shape) → 'YYYY-MM-DD[ HH:mm]'. */
export function fmtFieldValue(value: string): string {
  return value.replace('T', ' ');
}

function p2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Relative under 24 h ('just now', 'N min ago', 'N h ago'), absolute beyond. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return fmtDateTime(iso); // future stamps stay absolute
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return fmtDateTime(iso);
}

// ---- the house date fields (spec 0071): validity and stepping ---------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** A complete 'YYYY-MM-DD' that is a real calendar date. */
export function isoDateValid(text: string): boolean {
  const m = ISO_DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** A complete 'YYYY-MM-DD HH:mm' that is a real date and a real time of day. */
export function isoDateTimeValid(text: string): boolean {
  const m = ISO_DATE_TIME.exec(text);
  if (!m) return false;
  const h = Number(m[4]);
  const mi = Number(m[5]);
  return isoDateValid(text.slice(0, 10)) && h >= 0 && h < 24 && mi >= 0 && mi < 60;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * Move one part of a date by `delta`: the year or month by that many
 * (the day clamped to the target month's length), the day by that many
 * days. An empty or unreadable base starts from today.
 */
export function stepIsoDate(base: string, part: 'year' | 'month' | 'day', delta: number): string {
  const start = isoDateValid(base) ? base : isoOf(new Date());
  const [y, mo, d] = start.split('-').map(Number) as [number, number, number];
  if (part === 'day') {
    const next = new Date(y, mo - 1, d + delta);
    return isoOf(next);
  }
  const months = y * 12 + (mo - 1) + (part === 'year' ? delta * 12 : delta);
  const ny = Math.floor(months / 12);
  const nm = months - ny * 12;
  const lastDay = new Date(ny, nm + 1, 0).getDate();
  return isoOf(new Date(ny, nm, Math.min(d, lastDay)));
}

/** Same for 'YYYY-MM-DD HH:mm', with the hour and the minute as parts too; empty starts from now. */
export function stepIsoDateTime(
  base: string,
  part: 'year' | 'month' | 'day' | 'hour' | 'minute',
  delta: number,
): string {
  const now = new Date();
  const start = isoDateTimeValid(base) ? base : `${isoOf(now)} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const date = start.slice(0, 10);
  const [h, mi] = start.slice(11).split(':').map(Number) as [number, number];
  if (part === 'hour' || part === 'minute') {
    const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
    const next = new Date(y, mo - 1, d, h + (part === 'hour' ? delta : 0), mi + (part === 'minute' ? delta : 0));
    return `${isoOf(next)} ${p2(next.getHours())}:${p2(next.getMinutes())}`;
  }
  return `${stepIsoDate(date, part, delta)} ${p2(h)}:${p2(mi)}`;
}

// ---- while typing: refuse a keystroke that can no longer become a real date ----

const DATE_SHAPE = 'YYYY-MM-DD';
const DATE_TIME_SHAPE = 'YYYY-MM-DD HH:mm';
/** The smallest value of every part — what the parts after the one being typed are tried with. */
const SMALLEST = '0000-01-01 00:00';
const isSep = (ch: string | undefined): boolean => ch === '-' || ch === ' ' || ch === ':';

/**
 * True when `prefix` — what the masked box holds so far — can still be
 * completed into a value `valid` accepts: the part being typed is tried
 * with every digit combination for what is missing, the parts after it at
 * their smallest. So '2026-3' (month 30–39), '2026-02-3' (February), '25'
 * as an hour and '23:6' as a minute are refused as they are typed.
 */
function canStillBecome(prefix: string, shape: string, valid: (s: string) => boolean): boolean {
  if (prefix.length > shape.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i] as string;
    if (isSep(shape[i]) ? c !== shape[i] : c < '0' || c > '9') return false;
  }
  if (prefix.length === shape.length) return valid(prefix);
  let partEnd = prefix.length;
  while (partEnd < shape.length && !isSep(shape[partEnd])) partEnd++;
  const missing = partEnd - prefix.length;
  const tail = SMALLEST.slice(partEnd, shape.length);
  const combos = 10 ** missing;
  for (let n = 0; n < combos; n++) {
    const fill = missing ? String(n).padStart(missing, '0') : '';
    if (valid(prefix + fill + tail)) return true;
  }
  return false;
}

/** A partial or complete 'YYYY-MM-DD' entry that can still be a real date; '' is fine. */
export function isoDatePrefixOk(prefix: string): boolean {
  return canStillBecome(prefix, DATE_SHAPE, isoDateValid);
}

/** A partial or complete 'YYYY-MM-DD HH:mm' entry that can still be a real date and time; '' is fine. */
export function isoDateTimePrefixOk(prefix: string): boolean {
  return canStillBecome(prefix, DATE_TIME_SHAPE, isoDateTimeValid);
}

// ---- typing over a filled entry (spec 0071 amendment 2): replace, don't insert ----

/**
 * A digit typed with the caret inside the entry replaces the digit there
 * (a separator under the caret is stepped over) instead of pushing the rest
 * along, so the caret after '202' in '2025-08-12' plus '6' gives
 * '2026-08-12'. When the plain replacement cannot be a real value, it is
 * mended where the intent is clear: a year or month change clamps the day to
 * the month's length (2026-01-31 → month 02 → 2026-02-28), and the first digit
 * of a two-digit part fills the second with its smallest fit (month 08 →
 * '1' → 10, hour 08 → '2' → 20). Null when nothing fits — the keystroke is
 * refused. `partDone` is true when the digit landed on the last place of its
 * part (the part is complete, so the field may apply it).
 */
export function typeOverIso(
  text: string,
  caret: number,
  digit: string,
  withTime: boolean,
): { text: string; caret: number; partDone: boolean } | null {
  const shape = withTime ? DATE_TIME_SHAPE : DATE_SHAPE;
  const valid = withTime ? isoDateTimeValid : isoDateValid;
  let pos = caret;
  while (pos < shape.length && isSep(shape[pos])) pos++;
  if (pos >= shape.length || !/^\d$/.test(digit)) return null;
  const typed =
    pos >= text.length
      ? text + shape.slice(text.length, pos) + digit
      : text.slice(0, pos) + digit + text.slice(pos + 1);
  let partStart = pos;
  while (partStart > 0 && !isSep(shape[partStart - 1])) partStart--;
  let partEnd = pos;
  while (partEnd < shape.length && !isSep(shape[partEnd])) partEnd++;

  const ok = (s: string): boolean => (s.length === shape.length ? valid(s) : canStillBecome(s, shape, valid));
  /** A year or month edit may leave the day past the month's end: clamp it. */
  const clampDay = (s: string): string => {
    if (pos >= 8 || s.length < 10) return s;
    const y = Number(s.slice(0, 4));
    const mo = Number(s.slice(5, 7));
    const d = Number(s.slice(8, 10));
    if (mo < 1 || mo > 12) return s;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return d > last ? `${s.slice(0, 8)}${p2(last)}${s.slice(10)}` : s;
  };

  const tries = [clampDay(typed)];
  if (pos === partStart && partEnd - partStart === 2 && pos + 1 < typed.length) {
    for (let n = 0; n < 10; n++) {
      tries.push(clampDay(typed.slice(0, pos + 1) + String(n) + typed.slice(pos + 2)));
    }
  }
  const next = tries.find(ok);
  if (next === undefined) return null;
  let after = pos + 1;
  while (after < next.length && isSep(shape[after])) after++;
  return { text: next, caret: Math.min(after, next.length), partDone: pos === partEnd - 1 };
}

/** Where Backspace (-1) or Delete (+1) moves the caret when typing over: past one digit, separators stepped over. */
export function typeOverCaret(caret: number, dir: -1 | 1, withTime: boolean): number {
  const shape = withTime ? DATE_TIME_SHAPE : DATE_SHAPE;
  let c = caret;
  if (dir < 0) {
    c = Math.max(0, c - 1);
    if (c > 0 && isSep(shape[c])) c--;
  } else {
    if (isSep(shape[c])) c++;
    c = Math.min(shape.length, c + 1);
  }
  return c;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'YYYY-MM-DDTHH:mm' (the field model shape) → 'Tue 10.11.2026 · 08:00',
    the schedule's ETA / ETD as the New port call card shows them (Figma
    440:6983). '' when empty or not a real date. */
export function fmtSchedule(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!m) return '';
  const [, y, mo, d, h, mi] = m;
  const day = new Date(Number(y), Number(mo) - 1, Number(d)).getDay();
  return `${WEEKDAYS[day]} ${d}.${mo}.${y} · ${h}:${mi}`;
}

// ---- typed schedule fields (user 2026-11-13): a day and a time typed in -----

const MONTH_WORDS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * A day as people type it → 'YYYY-MM-DD', or null when it is not a real
 * day. Takes 24.11.2026, 24.11.26, 24.11. and 24.11 (this year, from
 * `today`), 24/11/2026, 2026-11-24, 24 Nov 2026, 24 Nov and 24112026.
 */
export function parseTypedDay(text: string, today: string): string | null {
  const s = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  const thisYear = Number(today.slice(0, 4)) || new Date().getFullYear();
  let y: number;
  let mo: number;
  let d: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[./\- ](\d{1,2})(?:[./\- ](\d{2}|\d{4})?)?\.?$/.exec(s))) {
    [d, mo] = [Number(m[1]), Number(m[2])];
    y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : thisYear;
  } else if ((m = /^(\d{2})(\d{2})(\d{4})$/.exec(s))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})\.? ?([a-z]{3})[a-z]*\.?(?: (\d{4}))?$/.exec(s))) {
    d = Number(m[1]);
    mo = MONTH_WORDS.indexOf(m[2]!) + 1;
    y = m[3] ? Number(m[3]) : thisYear;
  } else {
    return null;
  }
  if (mo < 1 || mo > 12) return null;
  const iso = `${y}-${pad2(mo)}-${pad2(d)}`;
  return isoDateValid(iso) ? iso : null;
}

/** A time of day as people type it → 'HH:mm', or null: 14:30, 14.30, 1430, 930, 14. */
export function parseTypedTime(text: string): string | null {
  const s = text.trim().replace(/\s+/g, '');
  if (!s) return null;
  let m: RegExpExecArray | null;
  let h: number;
  let mi: number;
  if ((m = /^(\d{1,2})[:.](\d{2})$/.exec(s))) [h, mi] = [Number(m[1]), Number(m[2])];
  else if ((m = /^(\d{1,2})(\d{2})$/.exec(s))) [h, mi] = [Number(m[1]), Number(m[2])];
  else if ((m = /^(\d{1,2})$/.exec(s))) [h, mi] = [Number(m[1]), 0];
  else return null;
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

/** 'YYYY-MM-DD' → '24.11.2026', the day as the typed field shows it. */
export function fmtTypedDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}
