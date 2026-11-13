/**
 * Presentation for the two flows of a port call (docs/specs/0048): the
 * NEMO port-call status and the reporting obligations. The states
 * themselves come from the server (`canonical/obligations.ts`) — this file
 * only decides how they read and which tint they wear.
 */
import type {
  DueState,
  NemoStatus,
  Obligation,
  ObligationGroup,
  ObligationState,
  PortCall,
} from '../auth/auth';
import type { PillTone } from '../components/StatusPill.vue';
import { fmtStamp } from './time';

/**
 * The report colours (user decision 2026-10-06), one meaning each, shown in
 * the legend (ReportLegend): purple = in NEMO (NEMO's own violet), green =
 * ready to send, yellow = data missing, red = NEMO refused it, grey = not
 * started or waiting for the VID.
 */
export const OBLIGATION_TONES: Record<ObligationState, PillTone> = {
  sent: 'violet',
  rejected: 'red',
  ready: 'green',
  missing: 'amber',
  notStarted: 'gray',
};

/** The legend's lines, in the order a report moves through them. */
export const LEGEND: { tone: PillTone; icon?: string; words: string; hint: string }[] = [
  { tone: 'gray', words: 'Not started', hint: 'No data yet, or waiting for the VID' },
  { tone: 'amber', words: 'Needs you', hint: 'Data missing (the count says how many fields), or the port call still to create in NEMO (VID)' },
  { tone: 'green', words: 'Ready to send', hint: 'All data in, not sent yet' },
  { tone: 'violet', icon: 'check', words: 'In NEMO', hint: 'Sent and accepted by NEMO' },
  { tone: 'red', icon: 'warning', words: 'Refused', hint: "NEMO refused it — open it for NEMO's reasons" },
];

/**
 * The NEMO status vocabulary (vendored declarant enum) with the Finnish
 * names NEMO itself shows — the help text spells out what each means.
 */
export const NEMO_STATUS_TONES: Record<NemoStatus, PillTone> = {
  Unconfirmed: 'gray',
  Arriving: 'blue',
  Moored: 'slate',
  Departed: 'green',
  Cancelled: 'red',
};

/** The call block's left edge (spec 0072): the list group's colour — an
    unconfirmed call is still at sea, so its edge is blue like Arriving. */
export const NEMO_STATUS_EDGES: Record<NemoStatus, PillTone> = {
  ...NEMO_STATUS_TONES,
  Unconfirmed: 'blue',
};

export const NEMO_STATUS_FI: Record<NemoStatus, string> = {
  Unconfirmed: 'Vahvistamaton saapuminen',
  Arriving: 'Arvioitu saapuminen',
  Moored: 'Satamassa',
  Departed: 'Lähtenyt',
  Cancelled: 'Peruttu',
};

export const NEMO_STATUS_ICONS: Record<NemoStatus, string> = {
  Unconfirmed: 'help_outline',
  Arriving: 'schedule',
  Moored: 'anchor',
  Departed: 'sailing',
  Cancelled: 'block',
};

export const GROUP_TITLES: Record<ObligationGroup, string> = {
  call: 'Port call',
  prearrival: 'Pre-arrival',
  arrival: 'Arrival',
  predeparture: 'Pre-departure',
  departure: 'Departure',
  ship: 'Ship data',
};

/**
 * The chip's tone: the obligation state's (OBLIGATION_TONES), with one
 * special case — an unsent VID stays yellow until NEMO has it: until then the
 * call is not in NEMO at all, and creating it is the thing to do (user
 * decision 2026-10-06; green there read as "done"). A refusal is red even
 * when an earlier version is in NEMO, because it needs you.
 */
/**
 * Before the VID every other report waits: nothing reaches NEMO without the
 * visit id, so its chip stays grey whatever its checklist says (spec 0079
 * amendment 2026-09-26). `vidSent` defaults to true for callers without a call.
 */
function waitsForVid(o: Obligation, vidSent: boolean): boolean {
  return !vidSent && o.code !== 'VID' && o.state !== 'sent';
}

/** A NOA/NOD in NEMO without the customs confirmation (spec 0088): sent, but not done. */
export function unconfirmed(o: Obligation): boolean {
  return o.state === 'sent' && o.confirmed === false;
}

export function chipTone(o: Obligation, vidSent = true): PillTone {
  if (waitsForVid(o, vidSent)) return 'gray';
  if (o.rejected) return 'red';
  if (o.code === 'VID' && o.state !== 'sent') return 'amber';
  // An unconfirmed NOA/NOD is in NEMO: purple; the words say the confirmation follows
  return OBLIGATION_TONES[o.state];
}

/**
 * The chip's name: the NEMO code, except the two notices, which name their
 * stage (user 2026-10-06) — a pre-arrival is more than the NOA (dues, cargo,
 * crew, stores…), likewise a pre-departure. A count rides along while
 * something is missing.
 */
const CHIP_NAMES: Record<string, string> = { NOA: 'Pre-arr', NOD: 'Pre-dep' };

/** How far a part is from done: the worst part names the stage chip's state. */
const STATE_RANK: Record<ObligationState, number> = { rejected: 4, missing: 3, notStarted: 2, ready: 1, sent: 0 };

/**
 * A stage chip (user 2026-10-06): the notice with the reports that travel in
 * its wizard (the NOA with the DUE). It is in NEMO only when every part is;
 * otherwise it wears the worst part's state, its missing items add up, and a
 * refusal of any part shows. The code stays the notice's, so it opens its wizard.
 */
export function stageOf(main: Obligation, parts: Obligation[]): Obligation {
  if (parts.length === 0) return main;
  const all = [main, ...parts];
  const worst = all.reduce((a, b) => (STATE_RANK[b.state] > STATE_RANK[a.state] ? b : a));
  const rejected = all.map((o) => o.rejected).find((r) => !!r) ?? null;
  return {
    ...main,
    title: `${main.title} (${all.map((o) => o.code).join(' + ')})`,
    state: worst.state,
    missing: all.flatMap((o) => o.missing),
    filled: all.reduce((n, o) => n + o.filled, 0),
    total: all.reduce((n, o) => n + o.total, 0),
    rejected,
  };
}
export function chipLabel(o: Obligation): string {
  const name = CHIP_NAMES[o.code] ?? o.code;
  return o.state === 'missing' ? `${name} ${o.missing.length}` : name;
}

/** The opened card's chips are single formalities (user 2026-10-06): the NEMO code itself, NOA not Pre-arr. */
export function codeLabel(o: Obligation): string {
  return o.state === 'missing' ? `${o.code} ${o.missing.length}` : o.code;
}

export function chipIcon(o: Obligation, vidSent = true): string | undefined {
  // NEMO refused the latest send — also an update of one it holds (2026-10-06)
  if (o.rejected) return 'warning';
  if (o.state === 'sent') return 'check';
  if (waitsForVid(o, vidSent)) return undefined;
  if (o.dueState === 'overdue') return 'priority_high';
  return undefined;
}

/** What the chip's colour means, in words (docs/07 law 3). */
export function stateWords(o: Obligation, vidSent = true): string {
  if (waitsForVid(o, vidSent)) {
    const now = stateWords(o);
    return `Waits for the VID — ${now.charAt(0).toLowerCase()}${now.slice(1)}`;
  }
  switch (o.state) {
    case 'sent':
      if (o.rejected) return `Sent to NEMO — NEMO refused the update of ${fmtStamp(o.rejected.at)}; open it for NEMO's reasons`;
      return unconfirmed(o)
        ? `In NEMO — the ${o.code === 'NOD' ? 'departure' : 'arrival'} is confirmed with the ${o.code === 'NOD' ? 'ATD' : 'ATA'}`
        : 'In NEMO';
    case 'rejected':
      return `NEMO refused it ${o.rejected ? fmtStamp(o.rejected.at) : ''} — open it for NEMO's reasons, fix and send again`;
    case 'ready':
      return o.code === 'VID'
        ? 'Not in NEMO yet — ready to create'
        : `Ready to send — all ${o.total} known items filled`;
    case 'missing':
      return `${o.missing.length} missing of ${o.total}`;
    default:
      return 'Not started';
  }
}

/** "Sent to NEMO 27.09.2026 10:15 by Henrik" — the panel's status line once sent (spec 0087). */
export function sentWords(o: Obligation, vidSent = true): string {
  if (o.state !== 'sent' || !o.sent) return stateWords(o, vidSent);
  const line = `Sent to NEMO ${fmtStamp(o.sent.at)}${o.sent.by ? ` by ${o.sent.by}` : ''}`;
  return unconfirmed(o) ? `${line} · arrival not confirmed` : line;
}

/**
 * Fintraffic's guide to each report (emsw.fi): what NEMO requires, field by
 * field (spec 0087). The VID is created with the port call.
 */
const GUIDE_PATHS: Record<string, string> = {
  VID: 'port-calls',
  NOA: 'noa-notice-arrival',
  DUE: 'due-fairway-and-port-dues-declaration',
  ATA: 'ata-notification-actual-arrival',
  NOD: 'nod-notice-pre-departure',
  ATD: 'atd-ilmoitus-tosiasiallisesta-lahdosta',
  SID: 'sid-ship-identifiers-notification',
  SHP: 'shp-ship-information',
  CRT: 'crt-ship-certificates',
  CWA: 'cwa-crew-list-arrival',
  CWD: 'cwd-crew-list-departure',
  PXA: 'pxa-passenger-list-arrival',
  PXD: 'pxd-passenger-list-departure',
  CGA: 'cga-cargo-declaration-arrival',
  CGD: 'cgd-cargo-declaration-departure',
  HZA: 'hza-notification-hazardous-materials-and-polluting-goods-board-arrival',
  HZD: 'hzd-notification-hazardous-materials-and-polluting-goods-board-departure',
  SEC: 'sec-security-information-notification-arrival',
  MDH: 'mdh-maritime-declaration-health',
  WAS: 'was-advance-notification-waste-delivery-port-reception-facilities',
  WAR: 'war-waste-delivery-receipt',
  STA: 'sta-declaration-stores-board-arrival',
  STD: 'std-declaration-stores-board-departure',
  MTS: 'mts-maritime-transport-statistics',
};

export function guideUrl(code: string): string | null {
  const path = GUIDE_PATHS[code];
  return path ? `https://www.emsw.fi/en/${path}` : null;
}

/** '45 min' / '3 h' / '2 days' — one span, used both ways. */
function spanOf(ms: number): string {
  const abs = Math.abs(Math.round(ms / 60000));
  if (abs < 60) return `${abs} min`;
  if (abs < 48 * 60) return `${Math.round(abs / 60)} h`;
  return `${Math.round(abs / 1440)} days`;
}

/** 'in 8 h' / '3 h late' for a deadline. */
function distance(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  return ms >= 0 ? `in ${spanOf(ms)}` : `${spanOf(ms)} late`;
}

/**
 * The status chip says how far away the moment is (user rule
 * 2026-08-24): "Arriving in 3 h", "Moored 2 h ago", "Departed 1 day ago".
 * Without a time to measure against it stays the bare NEMO word.
 */
export function statusLabel(
  call: Pick<PortCall, 'nemoStatus' | 'eta' | 'ata' | 'atd'>,
): string {
  const now = Date.now();
  if (call.nemoStatus === 'Arriving' && call.eta) {
    const ahead = Date.parse(call.eta) - now;
    return ahead > 0 ? `Arriving in ${spanOf(ahead)}` : 'Arriving';
  }
  if (call.nemoStatus === 'Moored' && call.ata) {
    return `Moored ${spanOf(now - Date.parse(call.ata))} ago`;
  }
  if (call.nemoStatus === 'Departed' && call.atd) {
    return `Departed ${spanOf(now - Date.parse(call.atd))} ago`;
  }
  return call.nemoStatus;
}

/** The deadline line: absolute stamp plus how far away it is. */
/**
 * The status line over the vessel name (style guide p. 12): a dot and a word
 * for where the ship is in time — blue upcoming, green departed; in port and
 * cancelled have no guide colour of their own and take the secondary ink.
 */
export function timeStatus(
  call: Pick<PortCall, 'nemoStatus' | 'eta' | 'ata' | 'atd'>,
): { words: string; tone: 'blue' | 'green' | 'slate' } {
  const now = Date.now();
  switch (call.nemoStatus) {
    case 'Unconfirmed':
    case 'Arriving': {
      if (!call.eta) return { words: 'No ETA yet', tone: 'blue' };
      const ahead = Date.parse(call.eta) - now;
      return {
        words: ahead > 0 ? `Arrival in ${spanOf(ahead)}` : `ETA passed ${spanOf(ahead)} ago`,
        tone: 'blue',
      };
    }
    case 'Moored':
      return {
        words: call.ata ? `In port for ${spanOf(now - Date.parse(call.ata))}` : 'In port',
        tone: 'slate',
      };
    case 'Departed':
      return {
        words: call.atd ? `Departed ${spanOf(now - Date.parse(call.atd))} ago` : 'Departed',
        tone: 'green',
      };
    default:
      return { words: 'Cancelled', tone: 'slate' };
  }
}

export function dueLine(o: Obligation): string {
  if (o.state === 'sent' || !o.dueAt) return '';
  if (o.asap) return 'Due as soon as possible — the voyage is shorter than 24 h';
  return `Due ${fmtStamp(o.dueAt)} · ${distance(o.dueAt)}`;
}

/** When each report falls due, in words — mirrors the server's deadlineFor. */
const DEADLINE_RULES: Record<string, string> = {
  NOA: 'NOA is due 24 h before the ETA',
  ATA: 'ATA is due at the ETA',
  NOD: 'NOD is due by the ETD',
  ATD: 'ATD is due at the ETD',
};

/**
 * The collapsed block's deadline note, explained (user request 2026-09-26):
 * why one call reads "due now" and another "14 h late" for the same ETA.
 */
export function dueTooltip(o: Obligation): string {
  const rule = DEADLINE_RULES[o.code] ?? `${o.code} has a deadline`;
  const stamp = o.dueAt ? ` (${fmtStamp(o.dueAt)})` : '';
  if (o.asap) {
    return (
      `${rule}${stamp}. This call was added after that moment had passed, ` +
      'so it could never be sent on time — send it as soon as possible.'
    );
  }
  if (o.dueState === 'overdue') {
    return `${rule}${stamp}. The deadline has passed and it is not in NEMO yet.`;
  }
  return `${rule}${stamp}. Not in NEMO yet — the deadline is close.`;
}

/** When each report falls due, said inside a sentence. */
const DUE_WHEN: Record<string, string> = {
  NOA: '24 h before the ETA',
  ATA: 'at the ETA',
  NOD: 'by the ETD',
  ATD: 'at the ETD',
};

/**
 * The deadline warning's text (style guide p. 4): one plain sentence under
 * the title — "Notice of Arrival should have been sent 24 h before the ETA."
 */
export function dueSentence(o: Obligation): string {
  const when = DUE_WHEN[o.code];
  if (o.asap) return `${o.title} is due as soon as possible — the voyage is shorter than 24 h.`;
  if (!when) return dueTooltip(o);
  return o.dueState === 'overdue'
    ? `${o.title} should have been sent ${when}.`
    : `${o.title} is due ${when}.`;
}

/** The one deadline worth putting in the collapsed block. */
export function urgentDue(obligations: Obligation[]): Obligation | null {
  const pressing = obligations
    .filter((o) => o.state !== 'sent' && (o.dueState === 'soon' || o.dueState === 'overdue'))
    .sort((a, b) => Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? ''));
  return pressing[0] ?? null;
}

export function dueTone(state: DueState): 'amber' | 'red' | null {
  if (state === 'overdue') return 'red';
  if (state === 'soon') return 'amber';
  return null;
}

/**
 * Reports given as the situation requires ("tilanteen mukaan annettavat
 * ilmoitukset", emsw.fi). Codes and titles mirror the vendored hub
 * matrices — the same source the server's list uses; which of them a call
 * actually owes is decided by the declaration work (Phase 2), so here
 * they are quiet placeholders.
 */
export const SITUATIONAL: { code: string; title: string }[] = [
  { code: 'CWA', title: 'Crew list, arrival' },
  { code: 'CWD', title: 'Crew list, departure' },
  { code: 'PXA', title: 'Passenger list, arrival' },
  { code: 'PXD', title: 'Passenger list, departure' },
  { code: 'CGA', title: 'Cargo declaration, arrival' },
  { code: 'CGD', title: 'Cargo declaration, departure' },
  { code: 'HZA', title: 'Dangerous goods, arrival' },
  { code: 'HZD', title: 'Dangerous goods, departure' },
  { code: 'SEC', title: 'Security notice' },
  { code: 'MDH', title: 'Declaration of health' },
  { code: 'WAS', title: 'Waste notice' },
  { code: 'WAR', title: 'Waste delivery receipt' },
  { code: 'STA', title: 'Ship stores, arrival' },
  { code: 'STD', title: 'Ship stores, departure' },
  { code: 'MTS', title: 'Transport statistics' },
];

/** Invariant 4 (spec 0076) — the server's words for an acting platform admin. */
export const PLATFORM_ADMIN_SEND_WORDS =
  'Sending to NEMO is for the organisation’s own people — a platform admin ' +
  'acting here can prepare and review, but not send. Sign in with an account ' +
  'of the organisation to send.';

/** A source of an actual in words (spec 0095): the logbook, or AIS. */
export function laneWords(lane: 'log' | 'ais' | undefined): string {
  return lane === 'ais' ? 'AIS' : 'Logbook';
}
