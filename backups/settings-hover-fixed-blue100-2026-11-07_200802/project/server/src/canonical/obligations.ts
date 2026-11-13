/**
 * The reporting-obligation flow of a port call (docs/specs/0048).
 *
 * Two flows run side by side on every call: the ship's movement (the NEMO
 * port-call status) and the reports that must reach NEMO. This module is
 * the second one, and it is pure — the service feeds it a snapshot, it
 * returns what is done, what is missing and what is due when.
 *
 * Nothing here is invented: the formality codes and their titles come from
 * the vendored hub matrices (`vendor/nemo/hub/config.json`), the required
 * elements from the published FI profile (`hub/fi-required.json`, DE ids
 * quoted per item), the status vocabulary from the vendored declarant API.
 * The checklists cover exactly what NEMOLink can pre-fill today; they grow
 * as the declaration forms land (Phase 2) — the UI says so.
 */

import { CertificateFact, certificateChecklist, prerequisiteChecklist } from './nemo-ui-rules';
import { FI_REQUIRED_SHIP_KEYS, SHIP_FIELD_HOMES } from './ship-formalities';
import { sameValue } from './ship-lanes';
import type { FormFacts } from './form-facts';
import { noaCallFacts, type NoaCallFactKey } from './noa-facts';

/** Vendored declarant API, `portCallStatuses`: the NEMO port-call status. */
export type NemoStatus =
  | 'Unconfirmed'
  | 'Arriving'
  | 'Moored'
  | 'Departed'
  | 'Cancelled';

export type ObligationState = 'sent' | 'rejected' | 'ready' | 'missing' | 'notStarted';
export type DueState = 'none' | 'ok' | 'soon' | 'overdue';

export type ObligationGroup =
  | 'call'
  | 'prearrival'
  | 'arrival'
  | 'predeparture'
  | 'departure'
  | 'ship';

export interface Obligation {
  /** The NEMO formality code — the chip label (VID, NOA, DUE, …). */
  code: string;
  /** Plain words for the row/tooltip (docs/07 law 2). */
  title: string;
  group: ObligationGroup;
  state: ObligationState;
  filled: number;
  total: number;
  /** Plain-words labels of what is still empty, DE id in parentheses. */
  missing: string[];
  /** Every item counted, with the value it would carry (spec 0075). */
  items: ObligationItem[];
  dueAt: string | null;
  dueState: DueState;
  /** True when the call appeared later than its own 24 h NOA window. */
  asap: boolean;
  /** When the report reached NEMO and who sent it (spec 0087); null until sent. */
  sent: SentBy | null;
  /** NEMO refused the latest send (2026-10-06): when — the state is 'rejected' unless an earlier send is in. */
  rejected: { at: string } | null;
  /** NOA/NOD: sent with the customs confirmation (ST-FI-01/02); false = sent unconfirmed (spec 0088). */
  confirmed?: boolean;
}

/** The last accepted send of a report: when, and by whom (display name). */
export interface SentBy {
  at: string;
  by: string | null;
}

/**
 * The notice facts NEMOLink has no source for yet (spec 0087): the NOA
 * asks for them, so the checklist lists them — empty until the port call
 * form or an integration fills them.
 */
export interface NoticeFacts {
  /** DE-014-10, UN/EDIFACT 8025 code (1 = cargo operations). */
  purposeOfCall?: string | null;
  /** DE-017-03, metres. */
  maxDraught?: number | null;
  crew?: number | null;
  personsOnBoard?: number | null;
  masterFamilyName?: string | null;
  masterGivenNames?: string | null;
  /** DE-014-22 when the last port does not decide it: V-01 or V-02. */
  voyageType?: string | null;
  /** DE-022-06 entered here, when the rotation and the forms do not say or say wrong (spec 0090). */
  lastPort?: string | null;
}

/** Where an item's value comes from (spec 0075). */
export type ItemSource = 'call' | 'ship' | 'org' | 'nemo';
/** A ship field against NEMO's ship database read-back (spec 0064 words). */
export type InNemoState = 'same' | 'differs' | 'notInNemo' | 'notRead';

/**
 * One checklist line as the formality panel shows it (spec 0075): the value
 * NEMOLink would send (To NEMO), where it comes from, and — for ship fields
 * — how it compares with what NEMO's ship database holds.
 */
export interface ObligationItem {
  label: string;
  /** DE / statement id from the FI profile, or null for a NEMO UI rule. */
  de: string | null;
  /** To NEMO: text, a number, or an ISO time/date (see `kind`); null = empty. */
  value: string | number | null;
  kind: 'text' | 'time' | 'date';
  from: ItemSource;
  ok: boolean;
  /** The ship wire key for ship fields — the UI names codes and links the ledger. */
  shipKey?: string;
  inNemo?: { state: InNemoState; value: string | number | null };
}

export interface ObligationSnapshot {
  created: string;
  status: string | null;
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
  portLocode: string | null;
  portAreaCode: string | null;
  berth: string | null;
  voyageNumber: string | null;
  cargoDescription: string | null;
  cargoCount: number;
  prevPortCount: number;
  nextPortCount: number;
  /** The route and cargo as they would be sent (spec 0075) — shown, not counted. */
  prevPorts?: string[];
  nextPorts?: string[];
  cargoNames?: string[];
  ship: {
    name: string | null;
    imoNumber: string | null;
    mmsi: string | null;
    callSign: string | null;
    typeCode: unknown;
    flagState: unknown;
    grossWeight: unknown;
    netWeight: unknown;
    length: unknown;
    width: unknown;
    /** Our certificates as they would go to NEMO: type and expiry (spec 0065). */
    certificates: CertificateFact[];
    /** Every other ship field, To NEMO (override ?? master), by wire key (spec 0075). */
    fields?: Record<string, unknown>;
    /** NEMO's ship database read-back (spec 0064): null = never read. */
    nemo?: { shipId: string | null; fields: Record<string, unknown> } | null;
  } | null;
  org: {
    name: string | null;
    businessId: string | null;
    /** DE-029-01, the agent's identification (EORI). */
    agentId?: string | null;
    /** DE-029-07: the NOA wants the mobile, not the landline. */
    agentMobile?: string | null;
    agencyName: string | null;
    agentEmail: string | null;
    agentPhone: string | null;
    /** The agency's postal address — the DUE's liable party (DE-077-15/18/19/20, spec 0092). */
    street?: string | null;
    postcode?: string | null;
    city?: string | null;
    countryCode?: string | null;
  };
  /** Formality codes already accepted by NEMO — empty until Phase 2. */
  submitted: string[];
  /** Per code, the last accepted send: when and by whom (spec 0087). */
  sentBy?: Record<string, SentBy>;
  /** Per code, the latest send when NEMO refused it: when (2026-10-06). */
  rejected?: Record<string, { at: string }>;
  /** The NOA facts without a source yet (spec 0087). */
  notice?: NoticeFacts;
  /** What the master's uploaded forms say (spec 0090): crew, persons on board, master, last port. */
  formFacts?: FormFacts | null;
  /** The purposes of call a source pushed, in NEMO's codes (spec 0090). */
  callPurposes?: { value: string[]; source: string; receivedAt: string } | null;
  /** Notices carrying their customs confirmation statement (NOA ST-FI-01, NOD ST-FI-02) — empty until Phase 2 (spec 0065). */
  confirmed: string[];
  /** Injected so the deadline arithmetic is testable. */
  now: number;
}

/** Reports every Finnish port call needs ("aina annettavat", emsw.fi). */
export const ALWAYS_CODES = ['VID', 'NOA', 'DUE', 'ATA', 'NOD', 'ATD'] as const;

/** Ship data reaches NEMO once per ship, not per call (SID/SHP/CRT). */
export const SHIP_DATA_CODES = ['SID', 'SHP', 'CRT'] as const;

/**
 * Reports given as the situation requires ("tilanteen mukaan annettavat"):
 * crew, passengers, cargo, dangerous goods, security, health, waste,
 * stores, statistics. Which of them apply is a per-call judgement the
 * declaration work will make — they stay quiet here.
 */
export const SITUATIONAL_CODES = [
  'CWA',
  'CWD',
  'PXA',
  'PXD',
  'CGA',
  'CGD',
  'HZA',
  'HZD',
  'SEC',
  'MDH',
  'WAS',
  'WAR',
  'STA',
  'STD',
  'MTS',
] as const;

/** Titles as the vendored hub matrices name them, trimmed to plain words. */
export const FORMALITY_TITLES: Record<string, string> = {
  VID: 'Port call created (Visit ID)',
  NOA: 'Pre-arrival notice',
  DUE: 'Fairway and port dues',
  ATA: 'Actual arrival',
  NOD: 'Pre-departure notice',
  ATD: 'Actual departure',
  SID: 'Ship identifiers',
  SHP: 'Ship information',
  CRT: 'Ship certificates',
  CWA: 'Crew list, arrival',
  EFF: 'Crew effects',
  CWD: 'Crew list, departure',
  PXA: 'Passenger list, arrival',
  PXD: 'Passenger list, departure',
  CGA: 'Cargo declaration, arrival',
  CGD: 'Cargo declaration, departure',
  HZA: 'Dangerous goods, arrival',
  HZD: 'Dangerous goods, departure',
  SEC: 'Security notice',
  MDH: 'Declaration of health',
  WAS: 'Waste notice',
  WAR: 'Waste delivery receipt',
  STA: 'Ship stores, arrival',
  STD: 'Ship stores, departure',
  MTS: 'Transport statistics',
  COA: 'Port call cancellation',
};

/** Pre-arrival notices are due 24 h before the ETA (EU MSW / emsw.fi). */
export const NOA_LEAD_HOURS = 24;
/** Our own "due soon" threshold — NEMO counts them, the hours are ours. */
export const DUE_SOON_HOURS = 6;

const HOUR = 3600_000;

/**
 * The NEMO port-call status (vendored enum). Cancelled → Peruttu (a COA
 * once the call has been submitted), Departed → Lähtenyt, Moored →
 * Satamassa, Arriving → Arvioitu saapuminen (the pre-arrival details are
 * reported), Unconfirmed → Vahvistamaton saapuminen (the call exists).
 *
 * Interim rule: until submissions exist, an ETA on file stands for
 * "pre-arrival details reported" and our own actuals for the arrival and
 * departure reports. Phase 2 replaces each test with the accepted
 * formality (and NEMO's own `status` field on its port-call list).
 */
export function nemoStatus(call: {
  status: string | null;
  eta: string | null;
  ata: string | null;
  atd: string | null;
  submitted?: string[];
}): NemoStatus {
  const sent = new Set(call.submitted ?? []);
  if (call.status === 'cancelled' || sent.has('COA')) return 'Cancelled';
  if (call.atd || sent.has('ATD')) return 'Departed';
  if (call.ata || sent.has('ATA')) return 'Moored';
  if (call.eta || sent.has('NOA')) return 'Arriving';
  return 'Unconfirmed';
}

type Item = ObligationItem;

function has(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** A value as the panel shows it: scalars as they are, lists joined, a coded value (ice class) as its code, anything else as JSON. */
function shown(v: unknown): string | number | null {
  if (!has(v)) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.join(', ');
  const code = (v as { code?: unknown }).code;
  if (typeof code === 'string' && code.trim() !== '') return code;
  return JSON.stringify(v);
}

function item(
  label: string,
  de: string | null,
  value: unknown,
  from: ItemSource,
  kind: Item['kind'] = 'text',
): Item {
  return { label, de, value: shown(value), kind, from, ok: has(value) };
}

/** A call field. */
const onCall = (label: string, de: string, value: unknown, kind: Item['kind'] = 'text'): Item =>
  item(label, de, value, 'call', kind);
/** An organisation (declarant profile) field. */
const onOrg = (label: string, de: string | null, value: unknown): Item => item(label, de, value, 'org');

/** The next port the NOA names (spec 0087): unknown, ZZUKN. */
export const NEXT_PORT_UNKNOWN = 'ZZUKN';

/** The fairway dues decision language: always English (user decision 2026-09-30, spec 0092 D3). */
export const DUES_LANGUAGE = 'EN';

/**
 * Type of voyage (DE-014-22) from the last port, since the next is ZZUKN:
 * a foreign last port makes it international; after a Finnish one it may
 * be national or not, so the user says.
 */

const SHIP_LEGACY_KEYS = new Set([
  'name', 'imoNumber', 'mmsi', 'callSign', 'typeCode', 'flagState',
  'grossWeight', 'netWeight', 'length', 'width',
]);

function shipValue(s: ObligationSnapshot['ship'], key: string): unknown {
  if (!s) return null;
  if (SHIP_LEGACY_KEYS.has(key)) return (s as unknown as Record<string, unknown>)[key];
  return s.fields?.[key];
}

/** The ship field's line against NEMO's ship database (spec 0064 words). */
function inNemoOf(s: ObligationSnapshot['ship'], key: string, value: unknown): Item['inNemo'] {
  const snapshot = s?.nemo;
  if (!snapshot) return { state: 'notRead', value: null };
  if (!snapshot.shipId) return { state: 'notInNemo', value: null };
  // NEMO found the ship by its IMO number — the identity matches by construction
  if (key === 'imoNumber') return { state: 'same', value: shown(value) };
  const theirs = snapshot.fields[key];
  if (!has(theirs)) return { state: has(value) ? 'notInNemo' : 'same', value: null };
  const same =
    sameValue(theirs, value) || String(theirs).trim().toLowerCase() === String(value ?? '').trim().toLowerCase();
  return { state: same ? 'same' : 'differs', value: shown(theirs) };
}

/** A ship field, To NEMO, with its read-back line. */
function onShip(label: string, de: string, s: ObligationSnapshot['ship'], key: string): Item {
  const value = shipValue(s, key);
  const kind: Item['kind'] = /Date$/.test(key) ? 'date' : 'text';
  return { ...item(label, de, value, 'ship', kind), shipKey: key, inNemo: inNemoOf(s, key, value) };
}

/**
 * A ship field NEMO asks for only while its ship database lacks it (the NOA
 * particulars, ERR-029): met by our value, or by NEMO's own (spec 0064 read-back).
 */
function onShipUnlessInNemo(label: string, de: string, s: ObligationSnapshot['ship'], key: string): Item {
  const line = onShip(label, de, s, key);
  return line.ok || !has(s?.nemo?.fields[key]) ? line : { ...line, ok: true };
}

/** NEMO UI rule lines (spec 0065): the state they check is NEMO's or the ship's. */
function ruleItems(rows: { label: string; ok: boolean }[], from: ItemSource): Item[] {
  return rows.map((r) => ({
    label: r.label,
    de: null,
    value: null,
    kind: 'text',
    from,
    ok: r.ok,
  }));
}

/** The ship particulars the notices carry (NOA/NOD, SHIP_FIELD_HOMES 'NOA'). */
/** Plain words for the SID/SHP elements that go (SHIP_FIELD_HOMES, sent). */
const SHIP_SENT_LABELS: Record<string, string> = {
  name: 'Ship name',
  imoNumber: 'IMO number',
  mmsi: 'MMSI number',
  callSign: 'Call sign',
  ownerName: 'Registered owner',
  operatorName: 'Lessee (operator)',
  iceClass: 'Ice class',
  buildDate: 'Build date',
  keelLayingDate: 'Keel laying date',
  inertGasSystem: 'Inert gas system',
  mainEnginePower: 'Main engine power (kW)',
  openWaterSpeedMeasure: 'Open water speed (kn)',
};

/** What a SID / SHP send carries — exactly the elements the send builds (spec 0070). */
function shipFormalityItems(formality: 'SID' | 'SHP', s: ObligationSnapshot['ship']): Item[] {
  return Object.entries(SHIP_FIELD_HOMES)
    // The checklist counts what Finland requires; the send carries more (spec 0083)
    .filter(([key, home]) => home.formality === formality && home.sent && FI_REQUIRED_SHIP_KEYS.has(key))
    .map(([key, home]) => onShip(SHIP_SENT_LABELS[key] ?? key, home.de, s, key));
}

function checklist(code: string, snap: ObligationSnapshot): Item[] {
  const s = snap.ship;
  const cargo =
    snap.cargoCount > 0
      ? (snap.cargoNames && snap.cargoNames.length > 0 ? snap.cargoNames : `${snap.cargoCount} item(s)`)
      : snap.cargoDescription;
  const prev = snap.prevPorts ?? (snap.prevPortCount ? `${snap.prevPortCount} port(s)` : null);
  const next = snap.nextPorts ?? (snap.nextPortCount ? `${snap.nextPortCount} port(s)` : null);
  switch (code) {
    case 'VID':
      return [
        onShip('Ship name', 'DE-005-01', s, 'name'),
        onShip('IMO number', 'DE-005-03', s, 'imoNumber'),
        onShip('MMSI number', 'DE-005-04', s, 'mmsi'),
        onShip('Call sign', 'DE-005-05', s, 'callSign'),
        onCall('Port of call', 'DE-014-04', snap.portLocode),
        onCall('Estimated arrival', 'DE-022-02', snap.eta, 'time'),
      ];
    case 'NOA': {
      // Only what NEMO requires (emsw.fi NOA guide, spec 0087). Tonnages,
      // length and breadth too, unless NEMO's ship database has them (ERR-029,
      // STG 2026-10-06 — the SHP carries only the FI-required set); the arrival confirmation
      // (DE-003-07, ST-FI-01) is added by the send once the other arrival
      // reports are in; optional elements (voyage number, cargo) are left out.
      // Entered here, else the sources (spec 0090) — the same values the send carries
      const f = noaCallFacts(snap);
      const v = (k: NoaCallFactKey): unknown => (Array.isArray(f[k].toNemo) ? (f[k].toNemo as string[]).join(', ') : f[k].toNemo);
      return [
        item('Fairway dues decision language', null, DUES_LANGUAGE, 'call'),
        onCall('Estimated arrival', 'DE-022-02', snap.eta, 'time'),
        onCall('Estimated departure', 'DE-022-05', snap.etd, 'time'),
        onCall('Last port of call', 'DE-022-06', v('lastPort')),
        // Always ZZUKN, sequence 1 (user decision 2026-09-26): emsw.fi allows it for the
        // next port only; the port is corrected once known
        onCall('Next port of call', 'DE-022-08', NEXT_PORT_UNKNOWN),
        // NEMO refuses the NOA without the port area (live, spec 0063)
        onCall('Port area', 'DE-015-01', snap.portAreaCode),
        onCall('Expected first location (berth)', 'DE-015-04', snap.berth),
        onCall('Type of voyage', 'DE-014-22', v('voyageType')),
        onCall('Primary purpose of call', 'DE-014-10', v('purposeOfCall')),
        onCall('Actual maximum draught (m)', 'DE-017-03', v('maxDraught')),
        onShip('Ship type', 'DE-005-16', s, 'typeCode'),
        onShip('Flag state', 'DE-005-09', s, 'flagState'),
        onShip('Ship registry', 'DE-005-10', s, 'registryCode'),
        onShip('Port of registry', 'DE-005-12', s, 'registryPort'),
        onShipUnlessInNemo('Length overall (m)', 'DE-008-25', s, 'length'),
        onShipUnlessInNemo('Breadth (m)', 'DE-008-13', s, 'width'),
        onShipUnlessInNemo('Gross tonnage', 'DE-008-27', s, 'grossWeight'),
        onShipUnlessInNemo('Net tonnage', 'DE-008-28', s, 'netWeight'),
        onShipUnlessInNemo('Deadweight (t)', 'DE-008-29', s, 'dwt'),
        onCall('Number of crew', 'DE-034-03', v('crew')),
        onCall('Persons on board', 'DE-034-01', v('personsOnBoard')),
        onCall("Master's family name", 'DE-012-01', v('masterFamilyName')),
        onCall("Master's given names", 'DE-012-08', v('masterGivenNames')),
        onOrg('Agent identification (EORI)', 'DE-029-01', snap.org.agentId),
        onOrg('Agency name', 'DE-029-02', snap.org.agencyName ?? snap.org.name),
        onOrg('Agent mobile', 'DE-029-07', snap.org.agentMobile),
        onOrg('Agent email', 'DE-029-08', snap.org.agentEmail),
      ];
    }
    case 'DUE':
      return [
        onOrg('Liable party name', 'DE-077-13', snap.org.agencyName ?? snap.org.name),
        onOrg('Liable party business ID', 'DE-077-11', snap.org.businessId),
        onOrg('Liable party email', 'DE-077-14', snap.org.agentEmail),
        // NEMO accepted the DUE with the address (spec 0063); the guide asks for it
        onOrg('Liable party street', 'DE-077-15', snap.org.street),
        onOrg('Liable party postcode', 'DE-077-18', snap.org.postcode),
        onOrg('Liable party city', 'DE-077-19', snap.org.city),
        onOrg('Liable party country', 'DE-077-20', snap.org.countryCode),
      ];
    case 'ATA':
      // NEMO's order first (spec 0065): the notices sent and confirmed
      return [
        ...ruleItems(prerequisiteChecklist('ATA', snap.submitted, snap.confirmed), 'nemo'),
        onCall('Actual arrival', 'DE-022-01', snap.ata, 'time'),
      ];
    case 'NOD': {
      // What NEMO checks (spec 0063, ND2; spec 0092): the ETD, the next port
      // (the call's own, else unknown — ZZUKN), the crew and the persons on
      // board the NOA resolved. Voyage number rides along when there is one.
      const f = noaCallFacts(snap);
      return [
        onCall('Estimated departure', 'DE-022-05', snap.etd, 'time'),
        onCall('Next port', 'DE-022-08', snap.nextPorts?.[0] ?? NEXT_PORT_UNKNOWN),
        onCall('Number of crew', 'DE-034-03', f.crew.toNemo),
        onCall('Persons on board', 'DE-034-01', f.personsOnBoard.toNemo),
      ];
    }
    case 'ATD':
      return [
        ...ruleItems(prerequisiteChecklist('ATD', snap.submitted, snap.confirmed), 'nemo'),
        onCall('Actual departure', 'DE-022-04', snap.atd, 'time'),
      ];
    case 'SID':
      return shipFormalityItems('SID', s);
    case 'SHP':
      return shipFormalityItems('SHP', s);
    case 'CRT':
      // NEMO's own bar (spec 0065): the five expected types, on file and not expired.
      return ruleItems(certificateChecklist(s?.certificates ?? [], snap.now), 'ship');
    default:
      return [];
  }
}

/** VID has no clock of its own; the notices hang off the times they serve. */
function deadlineFor(code: string, snap: ObligationSnapshot): string | null {
  switch (code) {
    case 'NOA':
      return snap.eta
        ? new Date(Date.parse(snap.eta) - NOA_LEAD_HOURS * HOUR).toISOString()
        : null;
    case 'ATA':
      return snap.eta;
    case 'NOD':
    case 'ATD':
      return snap.etd;
    default:
      return null;
  }
}

function dueStateOf(
  dueAt: string | null,
  now: number,
  state: ObligationState,
): DueState {
  if (!dueAt || state === 'sent') return 'none';
  const at = Date.parse(dueAt);
  if (!Number.isFinite(at)) return 'none';
  if (now > at) return 'overdue';
  if (now > at - DUE_SOON_HOURS * HOUR) return 'soon';
  return 'ok';
}

function groupOf(code: string): ObligationGroup {
  switch (code) {
    case 'VID':
      return 'call';
    case 'NOA':
    case 'DUE':
    // The reports that go with the NOA (spec 0098)
    case 'CWA':
    case 'EFF':
    case 'STA':
    case 'WAS':
    case 'SEC':
      return 'prearrival';
    case 'ATA':
      return 'arrival';
    case 'NOD':
      return 'predeparture';
    case 'ATD':
      return 'departure';
    default:
      return 'ship';
  }
}

function obligation(code: string, snap: ObligationSnapshot): Obligation {
  const items = checklist(code, snap);
  const filled = items.filter((i) => i.ok).length;
  const total = items.length;
  const sent = snap.submitted.includes(code);
  const rejected = snap.rejected?.[code] ?? null;
  const state: ObligationState = sent
    ? 'sent'
    : rejected
      ? 'rejected'
      : filled === 0 && total > 0
      ? 'notStarted'
      : filled === total
        ? 'ready'
        : 'missing';
  const dueAt = deadlineFor(code, snap);
  // "As soon as possible" (emsw.fi): the voyage was shorter than the 24 h
  // window, so there never was a compliant moment to send it.
  const asap =
    code === 'NOA' && !!dueAt && Date.parse(snap.created) > Date.parse(dueAt);
  return {
    code,
    title: FORMALITY_TITLES[code] ?? code,
    group: groupOf(code),
    state,
    filled,
    total,
    missing: items.filter((i) => !i.ok).map((i) => (i.de ? `${i.label} (${i.de})` : i.label)),
    items,
    dueAt,
    dueState: asap && state !== 'sent' ? 'overdue' : dueStateOf(dueAt, snap.now, state),
    asap,
    sent: sent ? snap.sentBy?.[code] ?? null : null,
    rejected,
    ...(code === 'NOA' || code === 'NOD' ? { confirmed: snap.confirmed.includes(code) } : {}),
  };
}

/** The pre-arrival reports NEMOLink sends with the NOA (spec 0098). */
export const WITH_NOA_CODES = ['CWA', 'EFF', 'STA', 'WAS', 'SEC'] as const;

/**
 * The always-given reports plus the once-per-ship ship-data reports, and
 * each report sent with the NOA once it has been sent — accepted or
 * refused (spec 0098): a refusal shows on its chip and on the Pre-arr chip.
 */
export function obligationsOf(snap: ObligationSnapshot): Obligation[] {
  const withNoa = WITH_NOA_CODES.filter((code) => snap.submitted.includes(code) || !!snap.rejected?.[code]);
  return [...ALWAYS_CODES, ...withNoa, ...SHIP_DATA_CODES].map((code) => obligation(code, snap));
}

/**
 * The next report the call owes, in flow order: VID → NOA (with the DUE)
 * → ATA → NOD → ATD (user, 2026-09-30, spec 0092). Null once all are sent.
 * The COA stands apart; ship data rides with the VID.
 */
export function nextReport(obligations: Obligation[]): string | null {
  return ALWAYS_CODES.find((code) => obligations.find((o) => o.code === code)?.state !== 'sent') ?? null;
}

/** How far the call's flow has come: the always-given reports sent, of all (spec 0092). */
export function flowProgress(obligations: Obligation[]): { sent: number; total: number } {
  const flow = obligations.filter((o) => (ALWAYS_CODES as readonly string[]).includes(o.code));
  return { sent: flow.filter((o) => o.state === 'sent').length, total: flow.length };
}
