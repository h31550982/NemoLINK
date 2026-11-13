/**
 * Session state + auth API calls (docs/specs/0013). One module-scoped
 * reactive store — the session cookie is httpOnly, so the SPA's only
 * source of truth is GET /auth/me. The router guard loads this once
 * before first navigation; the API enforces real authz regardless.
 */

import { computed, ref } from 'vue';

/** Captain's PEC (specs 0043/0045). */
export type PecInfo =
  | { none: true }
  | {
      number: string;
      type?: 'restricted' | 'unrestricted';
      /** VTS-area ids (see app/src/lib/pec.ts for names). */
      regions?: string[];
      /** Finnish port LOCODEs. */
      ports?: string[];
      /** 'YYYY-MM-DD'. */
      validUntil?: string;
    };

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  orgSlug: string;
  orgName: string;
  /**
   * Captain's PEC (specs 0043/0045): null/undefined = not answered yet,
   * {none: true} = no PEC for Finland, else the certificate details.
   */
  pec?: PecInfo | null;
  /** nauticAi platform admin (spec 0030). */
  platformAdmin?: boolean;
  /** Platform admin currently acting inside a selected customer org. */
  acting?: boolean;
}

export interface PlatformOrg {
  slug: string;
  name: string;
  isActive: boolean;
  created: string;
}

export interface PlatformAuditEvent {
  seq: number;
  category: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  data: Record<string, unknown>;
  created: string;
}

export interface OrgUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  role: string | null;
  authType: string;
  status: string;
  created: string;
  lockedUntil: string | null;
  lastSeen: string | null;
  welcomeEmail: { status: string; updated: string } | null;
  /** Captain's assigned ship (spec 0049); null for everyone else. */
  shipId: string | null;
}

export interface ShipCertificate {
  typeCode: string;
  certificateId: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  extendedUntil: string | null;
  description: string | null;
  issuer: string | null;
  /** Issuer elements the FI profile makes mandatory (DE-006-06/07/08). */
  issuerTypeCode: string | null;
  issuerId: string | null;
  issuerCountry: string | null;
}

export interface ShipIceClass {
  code: string;
  status?: string;
  entryDate?: string;
  validTo?: string;
  dateOfIssue?: string;
}

/** NSD-mirror particulars (spec 0036) — only fields that are set. */
export interface ShipParticulars {
  [field: string]: string | number | boolean | ShipIceClass | undefined;
  iceClass?: ShipIceClass;
}

export interface Ship {
  id: string;
  name: string | null;
  imoNumber: string | null;
  mmsi: string | null;
  callSign: string | null;
  isActive: boolean;
  created: string;
  updated: string;
  /** 'admin-ui', or 'ingest:<source>' when a pushing system created the ship (spec 0060). */
  source: string | null;
  /** Who registered it on the master list, as you may see it: a user, a source system, "Digitraffic", or "Other organisation" (specs 0067/0068). */
  addedBy: string;
  /** Registered by your own organisation. */
  own: boolean;
  /** Your fleet row (spec 0068); null when the ship is not in your fleet. */
  fleet: ShipFleetFacts | null;
  certificates: ShipCertificate[];
  particulars: ShipParticulars;
  /** The trail: what each source last asserted, per field key (spec 0061). */
  lanes: Record<string, ShipLane>;
  /** The External column, per field key: the master list's resolved value and its source (spec 0068). */
  external: Record<string, ShipExternalCell>;
  /** Your organisation's overrides, per field key (specs 0061/0068). */
  overrides: Record<string, ShipOverride>;
  lastIngest: { source: string; receivedAt: string } | null;
  /** What NEMO's ship database held when we last read it (spec 0064); null before the first refresh. */
  nemo: ShipNemoSnapshot | null;
  /** What NEMO's own screens show for the ship, computed server-side from the snapshot (spec 0065). */
  nemoIssues: NemoIssue[];
  /** The NEMO ID column (spec 0070): per field key, the report that carries it and its element id. */
  nemoIds: Record<string, ShipFieldId>;
}

/** Where a ship field lives in NEMO (spec 0070): the report and the EMSWe element id. */
export interface ShipFieldId {
  formality: 'SID' | 'SHP' | 'NOA';
  de: string;
  /** Carried by the ship-data send (the identity and the FI-required particulars). */
  sent: boolean;
}

/** What a port call remembers of one report NEMOLink sent (spec 0070). */
export interface ShipNemoSentFact {
  formalityId: string | null;
  documentId: string | null;
  sentAt: string;
  status: string | null;
  accepted: boolean;
  errors: number;
  version: number;
}

/** The confirmation before a ship-data send (spec 0070). */
export interface ShipNemoPreview {
  ship: { id: string; name: string | null; imoNumber: string | null };
  portCall: {
    id: string;
    visitId: string | null;
    portLocode: string | null;
    eta: string | null;
    etd: string | null;
    status: string | null;
    shipId: string | null;
    formalities: Record<string, ShipNemoSentFact>;
  } | null;
  declarant: { id: string; roleCode: string; name?: string } | null;
  /** Where the declarant EORI came from, in words. */
  declarantNote: string;
  policy: string;
  fields: { key: string; formality: 'SID' | 'SHP' | 'NOA'; de: string; value: unknown; sent: boolean }[];
  formalities: {
    type: 'SID' | 'SHP' | 'CRT';
    willSend: boolean;
    reason: string | null;
    envelope: Record<string, unknown> | null;
    problems: { pointer: string; message: string }[];
    previously: ShipNemoSentFact | null;
    /** CRT only (spec 0084): which certificate, what it lacks, its files, the ice class request. */
    certKey?: string;
    gaps?: string[];
    files?: { fileName: string; description: string }[];
    iceClassConfirmation?: boolean;
  }[];
}

/** A certificate file the org keeps for a ship (spec 0084). */
export interface CertificateFile {
  id: string;
  certKey: string;
  fileName: string;
  description: string;
  contentType: string;
  byteSize: number;
  uploadedBy: string;
  created: string;
}

/** The receipt of a ship-data send (spec 0070). */
export interface ShipNemoReceipt {
  visitId: string;
  sentAt: string;
  results: {
    type: 'SID' | 'SHP' | 'CRT' | 'NOA' | 'DUE' | 'ATA' | 'NOD' | 'ATD';
    accepted: boolean;
    status: string | null;
    errors: { code: string | null; message: string | null; path: string | null }[];
    formalityId: string | null;
    documentId: string | null;
    update: boolean;
    request: Record<string, unknown>;
    response: unknown;
    /** success · rejected · unavailable (NEMO not reached) · error (spec 0081). */
    outcome: NemoExchange['outcome'];
    exchange: NemoExchange;
  }[];
}

/** One exchange with NEMO as the result viewer shows it (spec 0081). */
export interface NemoExchange {
  operation: string;
  outcome: 'success' | 'rejected' | 'unavailable' | 'error';
  visitId: string | null;
  portCallId: string | null;
  httpStatus: number | null;
  frmStatus: string | null;
  headline: string;
  explanation: string;
  errors: { code: string | null; message: string | null; path: string | null }[];
  at: string;
  request: unknown;
  response: unknown;
  auditId: string | null;
  /** After an accepted send: NEMO's own copy read back and compared with ours (spec 0089). */
  readBack?: ReadBack;
}

/** NEMO's copy of a formality against what we sent (spec 0089). */
export interface ReadBack {
  state: 'same' | 'differs' | 'missing' | 'unread';
  differences: { path: string; sent: unknown; held: unknown }[];
  status: string | null;
  readAt: string;
}

/** The per-call NOA facts NEMOLink has no other source for (spec 0088). */
export interface NoticeFacts {
  purposeOfCall?: string | null;
  maxDraught?: number | null;
  crew?: number | null;
  personsOnBoard?: number | null;
  masterFamilyName?: string | null;
  masterGivenNames?: string | null;
  voyageType?: string | null;
}

/** One formality element as a ledger row (spec 0090) — see server canonical/noa-ledger.ts. */
export interface LedgerRow {
  key: string;
  label: string;
  de: string | null;
  /** date: a day, typed as dd.mm.yyyy, kept as YYYY-MM-DD (ship rows, user 2026-11-13). */
  kind: 'text' | 'number' | 'time' | 'code' | 'date';
  codelist?: 'purpose' | 'voyage' | 'country' | 'registry' | 'shipType' | 'language' | 'locode' | 'portArea' | 'berth' | 'iceClass' | 'yesNo';
  multiple?: boolean;
  owner: 'call' | 'ship' | 'org' | 'callCore' | 'fixed';
  editable: boolean;
  externals: { value: unknown; source: string; at: string | null }[];
  entered: unknown;
  toNemo: unknown;
  ok: boolean;
  /** Filled but not right (user 2026-11-13), e.g. an ETD before the ETA. */
  problem?: string;
  differs: boolean;
  /** Where a missing value comes from, so it is not typed twice (user 2026-11-13). */
  hint?: string;
}

/** The NOA wizard's view (spec 0088). */
export interface NoaPreview {
  portCallId: string;
  visitId: string | null;
  shipId: string | null;
  rows: LedgerRow[];
  items: ObligationItem[];
  missing: string[];
  willSend: boolean;
  reason: string | null;
  envelope: Record<string, unknown> | null;
  problems: { pointer: string; message: string }[];
  previously: { accepted: boolean; sentAt: string; statement?: string; sentBy?: string } | null;
  confirmed: boolean;
  waitingForConfirm: string[];
  /** The DUE, sent with the NOA until NEMO has one (spec 0092); null once accepted. */
  due: { envelope: Record<string, unknown> | null; problems: { pointer: string; message: string }[]; lrn: string } | null;
  /** The other pre-arrival reports (spec 0098): ticked or not, why, where their data stands. */
  reports: PreArrivalReport[];
}

/** One report that can go with the NOA (spec 0098). */
export interface PreArrivalReport {
  code: string;
  title: string;
  tier: 'usually' | 'compulsory' | 'ifApplies';
  /** NEMOLink builds it; the others are sent in NEMO for now. */
  built: boolean;
  on: boolean;
  decidedBy: 'default' | 'evidence' | 'user';
  why: string | null;
  data: string;
  missing: string[];
  inNemo: boolean;
  /** NEMO refused the latest send. */
  refused: boolean;
  /** In NEMO and unchanged since: this send leaves it be. */
  current: boolean;
}

/** One formality on its own (spec 0098 amendment): the opened card's chips open it. */
export interface ReportPreview {
  portCallId: string;
  visitId: string | null;
  code: string;
  title: string;
  /** Where its data stands, in words. */
  data: string;
  missing: string[];
  willSend: boolean;
  reason: string | null;
  /** One line per formality that would go — several for the CRT, one per certificate. */
  parts: { label: string; willSend: boolean; reason: string | null }[];
  envelope: Record<string, unknown> | null;
  problems: { pointer: string; message: string }[];
  previously: { accepted: boolean; sentAt: string; sentBy?: string; version?: number } | null;
  /** NEMO's reasons for refusing the latest send; null unless refused. */
  lastRefusal: { at: string; words: string; errors: { code?: string | null; message?: string | null; path?: string | null }[] } | null;
}

/** The ATA or ATD step (spec 0092): the time, what stops it, what goes. */
export interface ActualPreview {
  portCallId: string;
  visitId: string | null;
  at: string;
  /** The estimate it is measured against: the ETA (arrival) or the ETD (departure). */
  planned: string | null;
  berth: string | null;
  willSend: boolean;
  reason: string | null;
  /** The notice (NOA / NOD) lacks the customs confirmation: the step sends it first. */
  confirmsNotice: boolean;
  /** What the logbook and AIS said (spec 0095), the logbook first. */
  sources: PendingSuggestion[];
  envelope: Record<string, unknown> | null;
  noticeEnvelope: Record<string, unknown> | null;
  problems: { pointer: string; message: string }[];
  previously: { accepted: boolean; sentAt: string } | null;
}

/** The NOD dialog (spec 0092): the four elements NEMO checks, as ledger rows. */
export interface NodPreview {
  portCallId: string;
  visitId: string | null;
  rows: LedgerRow[];
  missing: string[];
  willSend: boolean;
  reason: string | null;
  envelope: Record<string, unknown> | null;
  problems: { pointer: string; message: string }[];
  previously: { accepted: boolean; sentAt: string } | null;
  confirmed: boolean;
}

/** One part of the header's status light (spec 0082). */
export interface StatusItem {
  key: 'nemo' | 'integrations' | 'system' | 'lists';
  label: string;
  light: 'green' | 'yellow' | 'red';
  words: string;
  at: string | null;
}

/** A NEMO call that did not go through, with the exchange when the server kept one (spec 0081). */
export class NemoExchangeError extends Error {
  constructor(
    message: string,
    readonly exchange: NemoExchange | null,
  ) {
    super(message);
    this.name = 'NemoExchangeError';
  }
}

async function exchangeError(res: Response, fallback: string): Promise<NemoExchangeError> {
  const body = (await res.json().catch(() => null)) as { message?: string; exchange?: NemoExchange } | null;
  return new NemoExchangeError(body?.message ?? fallback, body?.exchange ?? null);
}

/** One thing NEMO's UI would show for this ship that its API does not report (spec 0065). */
export interface NemoIssue {
  rule: string;
  level: 'warning' | 'info';
  words: string;
  codes?: string[];
  /** Where to act on it outside NEMOLink (the NEMO user interface, spec 0067). */
  link?: string;
}

/** The "In NEMO" snapshot: NSD's record in our wire keys, and when we read it (spec 0064). */
export interface ShipNemoSnapshot {
  shipId: string | null;
  at: string;
  source: string;
  fields: Record<string, unknown>;
  /** NSD's certificates by type (spec 0065). */
  certificates: { typeCode: string; expiryDate: string | null }[];
}

export interface ShipLane {
  receivedAt: string;
  occurredAt: string;
  eventId: string;
  sourceRecordId: string;
  /** The source system, "NEMO ship database", "Digitraffic", or "Other organisation" (specs 0067/0068). */
  by: string;
  fields: Record<string, unknown>;
}

/** One External cell (spec 0068): the master list's value for a field and where it came from. */
export interface ShipExternalCell {
  value: unknown;
  source: string;
  occurredAt: string;
  receivedAt: string;
}

export interface ShipFleetFacts {
  id: string;
  since: string;
  addedBy: string;
}

/** A master-list hit when adding a ship to the fleet (spec 0068). */
export interface ShipSearchHit {
  id: string;
  name: string | null;
  imoNumber: string | null;
  mmsi: string | null;
  callSign: string | null;
  inFleet: boolean;
  inNemo: 'yes' | 'no' | 'unread';
}

/** The platform page's view of a master ship (spec 0068). */
export interface PlatformShip extends Ship {
  fleets: string[];
}

export interface ShipOverride {
  value: unknown;
  author: string;
  at: string;
  /** Certificate expiry: the source has a newer date, so this override is disregarded. */
  superseded?: boolean;
}

export interface ShipCertificateInput {
  typeCode: string;
  certificateId?: string;
  issueDate?: string;
  expiryDate?: string;
  extendedUntil?: string;
  description?: string;
  issuer?: string;
  issuerTypeCode?: string;
  issuerId?: string;
  issuerCountry?: string;
}

export interface ShipInput {
  name?: string;
  imoNumber?: string | null;
  mmsi?: string | null;
  callSign?: string | null;
  certificates?: ShipCertificateInput[];
  /** Fields present are set, null clears, absent stays (spec 0036). */
  particulars?: Record<string, string | number | boolean | ShipIceClass | null>;
}

export interface AuditEvent {
  chain: 'org' | 'platform';
  seq: number;
  category: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  action: string | null;
  data: Record<string, unknown>;
  created: string;
}

/** Carrier-agent defaults (spec 0038) — only set fields present. */
export interface OrgAgent {
  agentId?: string;
  agencyName?: string;
  mobile?: string;
  landline?: string;
  email?: string;
  /** The agency's postal address: the DUE's liable party (spec 0092). */
  street?: string;
  postcode?: string;
  city?: string;
  countryCode?: string;
}

export interface OrgInfo {
  slug: string;
  name: string;
  entraTenantId: string | null;
  ssoConfigured: boolean;
  created: string;
  businessId: string | null;
  eori: string | null;
  agent: OrgAgent;
}

/** Per-target NEMO credential status (spec 0059) — never carries the secret. */
export interface NemoCredentialStatus {
  target: 'stg' | 'prd';
  configured: boolean;
  label: string | null;
  keyId: string | null;
  author: string | null;
  updated: string | null;
}

export interface NemoCredentialInput {
  target: 'stg' | 'prd';
  clientId: string;
  clientSecret: string;
  label?: string | null;
}

/** Fields present are set, null clears, absent stays (spec 0038). */
export interface OrgUpdate {
  businessId?: string | null;
  eori?: string | null;
  agent?: Partial<Record<keyof OrgAgent, string | null>>;
}

export interface CodelistSummary {
  codelist: string;
  version: string;
  entries: number;
  updated: string;
}

export interface CodelistEntry {
  code: string;
  en: string | null;
  fi: string | null;
  sv: string | null;
  national: boolean;
  fiPreferred: boolean;
}

export interface RefLocation {
  locode: string;
  name: string | null;
  countryCode: string | null;
  data: Record<string, unknown>;
  updated: string;
}

export interface HsMapRow {
  groupCode: string;
  groupLabel: string | null;
  refinement: string;
  hs6: string;
  hsName: string | null;
  updated: string;
}

export interface HazmatItem {
  hazmatId: string;
  properShippingName: string | null;
  undgNumber: string | null;
  hazardClass: string | null;
  updated: string;
}

export interface ContractFile {
  file: string;
  source: string;
  sha256: string;
  sourceSha256: string | null;
}

export interface SyncDataset {
  job: string;
  rows: number;
  available: boolean;
  reason?: string;
  lastOk: string | null;
}

export interface SyncRun {
  id: string;
  job: string;
  status: string;
  started: string;
  finished: string | null;
  stats: Record<string, unknown>;
  error: string | null;
  author: string | null;
}

const user = ref<SessionUser | null>(null);
const loaded = ref(false);

export interface FleetCall {
  id: string;
  visitId: string | null;
  portLocode: string | null;
  portName: string | null;
  status: string | null;
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
  voyageNumber: string | null;
  cargoDescription: string | null;
  updated: string;
}

export interface FleetShip {
  shipId: string;
  name: string | null;
  imoNumber: string | null;
  callSign: string | null;
  call: FleetCall | null;
}

/** A ship/log-side value awaiting operator confirmation (spec 0034). */
export interface PendingSuggestion {
  value: string;
  /** Which source said it (spec 0095); absent on suggestions from before = the logbook. */
  lane?: 'log' | 'ais';
  portLocode?: string;
  /** AIS only: the berth the geofence names and where the ship was (never sent to NEMO). */
  berth?: string;
  position?: { latitude: number; longitude: number };
  sourceSystem: string;
  eventId: string;
  occurredAt: string;
  sourceRecordId: string;
  receivedAt: string;
}

/** One earlier leg of the rotation — most recent first (spec 0037). */
/** One entry in the port picker (spec 0042). */
export interface PortOption {
  locode: string;
  name: string | null;
}

/** One official cargo on a call (spec 0046): HS6 + the name as picked. */
export interface CargoItem {
  hs6: string;
  name: string;
}

export interface PrevPort {
  portLocode: string;
  arrival?: string;
  departure?: string;
}

/** One upcoming leg — next first. */
export interface NextPort {
  portLocode: string;
  eta?: string;
  etd?: string;
}

/** NEMO port-call status — the vendored declarant enum (spec 0048). */
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

/** One report the call owes NEMO, as the server computed it (spec 0048). */
/** One checklist line with its To NEMO value (spec 0075). */
export interface ObligationItem {
  label: string;
  de: string | null;
  value: string | number | null;
  kind: 'text' | 'time' | 'date';
  from: 'call' | 'ship' | 'org' | 'nemo';
  ok: boolean;
  /** Filled but not right (user 2026-11-13), e.g. an ETD before the ETA. */
  problem?: string;
  shipKey?: string;
  inNemo?: { state: 'same' | 'differs' | 'notInNemo' | 'notRead'; value: string | number | null };
}

export interface Obligation {
  code: string;
  title: string;
  group: ObligationGroup;
  state: ObligationState;
  filled: number;
  total: number;
  missing: string[];
  dueAt: string | null;
  dueState: DueState;
  asap: boolean;
  /** Every item counted, with the value it would carry (spec 0075). */
  items: ObligationItem[];
  /** The last accepted send: when, and who sent it (spec 0087); null until sent. */
  sent?: { at: string; by: string | null } | null;
  /** NOA/NOD: sent with the customs confirmation; false = sent unconfirmed (spec 0088). */
  confirmed?: boolean;
  /** NEMO refused the latest send: when (2026-10-06). */
  rejected?: { at: string } | null;
}

/** A berth inside a port area (spec 0048). */
export interface BerthOption {
  code: string;
  name: string | null;
}

/** One port area, with its berths (spec 0048; enriched in spec 0051). */
export interface PortAreaOption {
  code: string;
  name: string | null;
  isps: boolean;
  berths: BerthOption[];
  /** The area's own security facility code, where published. */
  gisisCode?: string | null;
  /** Published anchorages, where any. */
  anchorages?: BerthOption[];
}

export interface PortCall {
  id: string;
  visitId: string | null;
  portLocode: string | null;
  /** Display name from the location reference data (spec 0047). */
  portName: string | null;
  /** The place inside the port — NEMO portAreaCode / berth (spec 0048). */
  portAreaCode: string | null;
  berth: string | null;
  eta: string | null;
  etd: string | null;
  ata: string | null;
  atd: string | null;
  status: string | null;
  voyageNumber: string | null;
  cargoDescription: string | null;
  cargoItems: CargoItem[];
  source: string | null;
  sourceCallId: string | null;
  suggestions: Partial<Record<'ata' | 'atd', PendingSuggestion>>;
  /** What each source said, per event (spec 0095): the logbook first, then AIS. */
  actualSources: Record<'ata' | 'atd', PendingSuggestion[]>;
  prevPorts: PrevPort[];
  nextPorts: NextPort[];
  shipId: string | null;
  shipName: string | null;
  imoNumber: string | null;
  updated: string;
  /** Active uploaded documents on the call (spec 0049). */
  documentCount: number;
  /** The ship-movement flow, in NEMO words (spec 0048). */
  nemoStatus: NemoStatus;
  /** The reporting flow (spec 0048). */
  obligations: Obligation[];
  /** The next report owed, in flow order (spec 0092); null once all are sent. */
  next: string | null;
  /** The always-given reports sent, of all (spec 0092). */
  progress: { sent: number; total: number };
}

export interface TimelineEvent {
  at: string;
  actor: string | null;
  action: string;
  details: Record<string, unknown>;
}

export interface PortCallCreate {
  shipId: string;
  portLocode: string;
  portAreaCode?: string;
  berth?: string;
  eta?: string;
  etd?: string;
  voyageNumber?: string;
  cargoDescription?: string;
  cargoItems?: CargoItem[];
  prevPorts?: PrevPort[];
  nextPorts?: NextPort[];
}

export interface PortCallUpdate {
  portLocode?: string;
  portAreaCode?: string | null;
  berth?: string | null;
  eta?: string | null;
  etd?: string | null;
  ata?: string | null;
  atd?: string | null;
  voyageNumber?: string | null;
  cargoDescription?: string | null;
  cargoItems?: CargoItem[] | null;
  prevPorts?: PrevPort[] | null;
  nextPorts?: NextPort[] | null;
}

/** An uploaded ship form on a port call (spec 0049). */
export interface PortCallDocument {
  id: string;
  portCallId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  formType: string | null;
  context: 'arrival' | 'departure' | 'both' | null;
  parseStatus: 'parsed' | 'pdf' | 'unrecognized' | 'failed';
  parseNote: string | null;
  summary: {
    formName?: string;
    context?: string | null;
    shipName?: string;
    imo?: string;
    rowCount?: number;
    rowsLabel?: string;
    warnings?: string[];
    /** Check counts stored at upload (spec 0050). */
    errorCount?: number;
    warningCount?: number;
  } | null;
  uploadedBy: string;
  created: string;
  duplicate?: boolean;
  /** The file names no IMO: it counts for the call once confirmed (spec 0093 D4). */
  shipConfirmNeeded?: boolean;
  /** The Ship forms section it was dropped on (user 2026-11-02), or null. */
  section?: NemoTable['key'] | null;
  /** Upload only: earlier versions of the same form this one replaced. */
  supersededIds?: string[];
}

/** One checked value on a document (spec 0050). */
export interface CheckAnnotation {
  severity: 'ok' | 'info' | 'warning' | 'error';
  /** How we read it: "Kotka", "FIKTK-0007 — facility of Kotka", the ISO date. */
  mapped?: string;
  /** What is wrong or cannot be checked, in plain words. */
  message?: string;
  /** The resolved port behind the value — its details are one tap away (spec 0051). */
  port?: string;
  /**
   * What kind of value this is — the correction dialog shapes itself to it.
   * `code`: a NEMO code list entry; `unit`: a quantity with a NEMO unit;
   * `effects`: FAL 4 items; `amount`: waste m³ (specs 0093, 0094).
   */
  kind?: 'locode' | 'gisis' | 'date' | 'code' | 'unit' | 'effects' | 'amount';
  /** Codes worth offering instead, best first. */
  suggest?: string[];
  /** The NEMO code list a `code` / `effects` value resolves against. */
  codelist?: string;
  /** The NEMO code the value resolved to. */
  code?: string;
  /** FAL 4: each effects item in the cell, checked on its own. */
  items?: {
    text: string;
    severity: 'ok' | 'info' | 'warning' | 'error';
    code?: string;
    mapped?: string;
    message?: string;
    suggest?: string[];
  }[];
}

/** A column of a NEMO table (spec 0096), as the National Spreadsheet heads it. */
export interface NemoColumn {
  key: string;
  de: string | null;
  label: string;
  kind: 'text' | 'date' | 'code' | 'number' | 'unit' | 'locode' | 'facility' | 'yesno';
  list?: string;
  required?: boolean;
  personal?: boolean;
}

/** One cell of a NEMO table: the value, NEMO's reading, where it came from. */
export interface NemoCell {
  value: string | null;
  reading?: string;
  flag?: 'error' | 'warning' | 'missing' | 'conflict';
  message?: string;
  source?: { docId: string; fileName: string; formName: string; path: string };
  others?: { value: string; fileName: string }[];
  entered?: { author: string; at: string };
  /** Not from a form: the system that gave it, in words ("opsdesk voyage plan"). */
  origin?: string;
}

export interface NemoRow {
  key: string;
  label: string;
  cells: Record<string, NemoCell>;
  items?: Record<string, NemoCell>[];
}

/** The ship's forms merged into one NEMO table (spec 0096). */
export interface NemoTable {
  key: 'crew' | 'passengers' | 'cargo' | 'stores' | 'waste' | 'security' | 'health';
  label: string;
  sheet: string;
  rowNoun: string;
  fields: NemoColumn[];
  columns: NemoColumn[];
  header: Record<string, NemoCell>;
  rows: NemoRow[];
  sources: { docId: string; fileName: string; formName: string }[];
  /** What else fed it, in words: the chartering system's previous ports (user 2026-11-13). */
  origins?: string[];
  counts: { error: number; warning: number; missing: number; conflict: number };
}

/** One entry of a NEMO code list, for the correction picker (spec 0093). */
export interface CodeOption {
  code: string;
  label: string;
}

/** Operator corrections overlay, keyed by check path (spec 0051). */
export type DocumentCorrections = Record<
  string,
  { value: string; author: string; at: string }
>;

/** One named security facility (spec 0053): hub codes ∪ the GISIS list. */
export interface PortFacility {
  code: string;
  name: string | null;
  description: string | null;
  /** Retired from the GISIS list (0053 amendment): findable, never offered. */
  retired?: boolean;
}

/** One port at a glance (spec 0051). */
export interface PortInfo {
  locode: string;
  name: string | null;
  country: string | null;
  facilities: PortFacility[];
  areas: PortAreaOption[];
}

/** GISIS facility-list health (spec 0053) — the platform GISIS tab. */
export interface GisisStatus {
  facilities: number;
  /** Codes no longer in the latest uploads — kept, flagged, never offered. */
  retired: number;
  countries: number;
  lastImport: {
    id: string;
    finished: string;
    author: string | null;
    stats: Record<string, unknown>;
  } | null;
  staleAfterDays: number;
  stale: boolean;
}

export interface DocumentChecks {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Keyed by path: `fields.<key>` or `rows.<index>.<key>`. */
  annotations: Record<string, CheckAnnotation>;
  checkedAt: string;
}

/** The parsed content of one document — fields, rows and the raw grid. */
export interface PortCallDocumentDetail extends PortCallDocument {
  parsed: {
    form: {
      formType: string;
      formName: string;
      context: string | null;
      fields: Record<string, string>;
      rows: Record<string, string>[] | null;
      rowsLabel: string | null;
      rowsTruncated: boolean;
      warnings: string[];
    } | null;
    grid: { name: string; cells: [number, number, string][] }[];
    gridTruncated: boolean;
  } | null;
  /** Recomputed fresh against the current master list on every read. */
  checks: DocumentChecks | null;
  /** Operator corrections overlay (spec 0051). */
  corrections: DocumentCorrections | null;
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
}

export function useAuth() {
  return {
    user: computed(() => user.value),
    isAdmin: computed(() => user.value?.role === 'admin'),
    // Operator work (confirm/reject suggestions) — editors and admins
    isOperator: computed(() => ['admin', 'editor'].includes(user.value?.role ?? '')),
    loaded: computed(() => loaded.value),

    async fetchMe(): Promise<void> {
      try {
        const res = await api('/auth/me');
        user.value = res.ok
          ? ((await res.json()) as { user: SessionUser }).user
          : null;
      } catch {
        user.value = null;
      } finally {
        loaded.value = true;
      }
    },

    /**
     * Does this address sign in with SSO? (spec 0057) Domain-level only —
     * never an answer about a user. Any failure answers false: the hint is
     * a courtesy, the login form must still work without it.
     */
    async isSsoLogin(username: string): Promise<boolean> {
      try {
        const res = await api('/auth/sso-check', {
          method: 'POST',
          body: JSON.stringify({ username }),
        });
        if (!res.ok) return false;
        return ((await res.json()) as { sso: boolean }).sso === true;
      } catch {
        return false;
      }
    },

    /** Throws with a generic message on any failure (no oracle — spec 0011). */
    async login(username: string, password: string): Promise<void> {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        throw new Error('Sign-in didn’t work. Check your username and password.');
      }
      user.value = ((await res.json()) as { user: SessionUser }).user;
    },

    async logout(): Promise<void> {
      try {
        await api('/auth/logout', { method: 'POST' });
      } finally {
        user.value = null;
      }
    },

    /** A captain's own PEC (specs 0043/0045); {none: true} = no PEC, null resets. */
    async setMyPec(pec: PecInfo | null): Promise<void> {
      const res = await api('/auth/me/pec', {
        method: 'POST',
        body: JSON.stringify({ pec }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save the PEC');
      }
      user.value = ((await res.json()) as { user: SessionUser }).user;
    },

    async listUsers(): Promise<OrgUser[]> {
      const res = await api('/users');
      if (!res.ok) throw new Error('Could not load users');
      return ((await res.json()) as { users: OrgUser[] }).users;
    },

    async approveUser(id: string, role: string): Promise<void> {
      const res = await api(`/users/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error('Approval failed');
    },

    async rejectUser(id: string): Promise<void> {
      const res = await api(`/users/${id}/reject`, { method: 'POST' });
      if (!res.ok) throw new Error('Rejection failed');
    },

    async changeUserRole(id: string, role: string): Promise<void> {
      const res = await api(`/users/${id}/role`, {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not change the role');
      }
    },

    /** Bind a captain to their ship, or unbind with null (spec 0049). */
    async assignUserShip(id: string, shipId: string | null): Promise<void> {
      const res = await api(`/users/${id}/ship`, {
        method: 'POST',
        body: JSON.stringify({ shipId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not assign the ship');
      }
    },

    async resendWelcome(id: string): Promise<void> {
      const res = await api(`/users/${id}/welcome-email`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not send the welcome email');
      }
    },

    async listPlatformOrgs(): Promise<PlatformOrg[]> {
      const res = await api('/platform/orgs');
      if (!res.ok) throw new Error('Could not load customers');
      return ((await res.json()) as { orgs: PlatformOrg[] }).orgs;
    },

    /** Select (or clear, null) the customer to act in — spec 0030. */
    async setActingOrg(orgSlug: string | null): Promise<void> {
      const res = await api('/platform/acting-org', {
        method: 'POST',
        body: JSON.stringify({ orgSlug }),
      });
      if (!res.ok) throw new Error('Could not switch customer');
      user.value = ((await res.json()) as { user: SessionUser }).user;
    },

    async listPlatformAudit(
      before: string | null,
      q?: string,
    ): Promise<{ events: PlatformAuditEvent[]; nextBefore: string | null }> {
      const params = new URLSearchParams();
      if (before) params.set('before', before);
      if (q) params.set('q', q);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const res = await api(`/platform/audit${suffix}`);
      if (!res.ok) throw new Error('Could not load the audit log');
      return (await res.json()) as {
        events: PlatformAuditEvent[];
        nextBefore: string | null;
      };
    },

    /** GISIS facility-list health (spec 0053) — platform admin only. */
    async gisisStatus(): Promise<GisisStatus> {
      const res = await api('/platform/gisis/status');
      if (!res.ok) throw new Error('Could not load the GISIS status');
      return ((await res.json()) as { status: GisisStatus }).status;
    },

    /** Upload a GISIS Maritime Security CSV export (spec 0053). */
    async uploadGisisCsv(file: File): Promise<Record<string, unknown>> {
      const data = new FormData();
      data.append('file', file, file.name);
      const res = await fetch('/api/v1/platform/gisis/upload', {
        method: 'POST',
        body: data,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'The file could not be uploaded');
      }
      const run = ((await res.json()) as {
        run: { status: string; stats: Record<string, unknown>; error: string | null };
      }).run;
      if (run.status !== 'ok') throw new Error(run.error ?? 'The import failed');
      return run.stats;
    },

    async fetchFleet(): Promise<FleetShip[]> {
      const res = await api('/fleet');
      if (!res.ok) throw new Error('Could not load the fleet');
      return ((await res.json()) as { ships: FleetShip[] }).ships;
    },

    async listPortCalls(): Promise<PortCall[]> {
      const res = await api('/portcalls');
      if (!res.ok) throw new Error('Could not load port calls');
      return ((await res.json()) as { portCalls: PortCall[] }).portCalls;
    },

    // ---- port-call documents (spec 0049) ----------------------------------

    async listCallDocuments(callId: string): Promise<PortCallDocument[]> {
      const res = await api(`/portcalls/${callId}/documents`);
      if (!res.ok) throw new Error('Could not load the documents');
      return ((await res.json()) as { documents: PortCallDocument[] }).documents;
    },

    /** Multipart upload — no JSON content type, the browser sets the boundary.
     *  `section`: the Ship forms section it was dropped on (user 2026-11-02). */
    async uploadCallDocument(callId: string, file: File, section?: NemoTable['key']): Promise<PortCallDocument> {
      const data = new FormData();
      if (section) data.append('section', section);
      data.append('file', file, file.name);
      const res = await fetch(`/api/v1/portcalls/${callId}/documents`, {
        method: 'POST',
        body: data,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'The file could not be uploaded');
      }
      return ((await res.json()) as { document: PortCallDocument }).document;
    },

    async callDocumentDetail(
      callId: string,
      documentId: string,
    ): Promise<PortCallDocumentDetail> {
      const res = await api(`/portcalls/${callId}/documents/${documentId}`);
      if (!res.ok) throw new Error('Could not load the document');
      return ((await res.json()) as { document: PortCallDocumentDetail }).document;
    },

    /** Correct one value on a document; null removes the correction (spec 0051). */
    async correctCallDocument(
      callId: string,
      documentId: string,
      path: string,
      value: string | null,
    ): Promise<{
      document: PortCallDocument;
      corrections: DocumentCorrections;
      checks: DocumentChecks;
    }> {
      const res = await api(`/portcalls/${callId}/documents/${documentId}/correct`, {
        method: 'POST',
        body: JSON.stringify({ path, value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save the correction');
      }
      return (await res.json()) as {
        document: PortCallDocument;
        corrections: DocumentCorrections;
        checks: DocumentChecks;
      };
    },

    /** One port at a glance — areas, berths, facility codes (spec 0051). */
    async portInfo(locode: string): Promise<PortInfo> {
      const res = await api(`/portcalls/ports/${locode}/info`);
      if (!res.ok) throw new Error('Could not load the port details');
      return ((await res.json()) as { port: PortInfo }).port;
    },

    /** The call's forms in NEMO's own tables (spec 0096). */
    async formTables(callId: string): Promise<NemoTable[]> {
      const res = await api(`/portcalls/${callId}/form-tables`);
      if (!res.ok) throw new Error('Could not load the NEMO tables');
      return ((await res.json()) as { tables: NemoTable[] }).tables;
    },

    /** Type a value into a NEMO table — null removes it (spec 0096). */
    async enterTableValue(callId: string, table: string, rowKey: string, column: string, value: string | null): Promise<NemoTable[]> {
      const res = await api(`/portcalls/${callId}/form-tables/${table}/entry`, {
        method: 'POST',
        body: JSON.stringify({ rowKey, column, value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save the value');
      }
      return ((await res.json()) as { tables: NemoTable[] }).tables;
    },

    /** A NEMO code list for the correction picker: search, or named codes (spec 0093). */
    async codeOptions(list: string, q: string, codes: string[] = []): Promise<CodeOption[]> {
      const params = new URLSearchParams({ q, codes: codes.join(',') });
      const res = await api(`/portcalls/codes/${encodeURIComponent(list)}?${params.toString()}`);
      if (!res.ok) throw new Error('Could not load the code list');
      return ((await res.json()) as { options: CodeOption[] }).options;
    },

    /** Worldwide port search for the correction picker (spec 0051). */
    async searchPorts(q: string): Promise<PortOption[]> {
      const res = await api(`/portcalls/ports/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Could not search ports');
      return ((await res.json()) as { ports: PortOption[] }).ports;
    },

    /** NEMO's National Spreadsheet, prefilled from the call's forms — the NEMO-down backup (spec 0093 step 5). */
    nationalSpreadsheetUrl(callId: string): string {
      return `/api/v1/portcalls/${callId}/national-spreadsheet.xlsx`;
    },

    /** Several files back in NEMO codes, one zip (spec 0093 §4) — a plain link. */
    callDocumentsCorrectedZipUrl(callId: string, documentIds: string[]): string {
      return `/api/v1/portcalls/${callId}/nemo-files.zip?ids=${documentIds.join(',')}`;
    },

    /** "Yes, this form is our ship's" — it starts counting for the call (spec 0093 D4). */
    async confirmCallDocumentShip(callId: string, documentId: string): Promise<PortCallDocument> {
      const res = await api(`/portcalls/${callId}/documents/${documentId}/confirm-ship`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not confirm the ship');
      }
      return ((await res.json()) as { document: PortCallDocument }).document;
    },

    /** The file back in NEMO codes and units (spec 0093 §3) — a plain link too. */
    callDocumentCorrectedUrl(callId: string, documentId: string): string {
      return `/api/v1/portcalls/${callId}/documents/${documentId}/corrected`;
    },

    /** Session cookie rides along — a plain link downloads the original. */
    /** Several original files as one zip — a Ship forms section's "Download all". */
    callDocumentsOriginalZipUrl(callId: string, documentIds: string[]): string {
      return `/api/v1/portcalls/${callId}/original-files.zip?ids=${documentIds.join(',')}`;
    },

    callDocumentFileUrl(callId: string, documentId: string): string {
      return `/api/v1/portcalls/${callId}/documents/${documentId}/file`;
    },

    async removeCallDocument(callId: string, documentId: string): Promise<void> {
      const res = await api(`/portcalls/${callId}/documents/${documentId}/remove`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not remove the document');
      }
    },

    async listPortOptions(): Promise<{ frequent: PortOption[]; ports: PortOption[] }> {
      const res = await api('/portcalls/ports');
      if (!res.ok) throw new Error('Could not load ports');
      return (await res.json()) as { frequent: PortOption[]; ports: PortOption[] };
    },

    async listPortAreas(locode: string): Promise<PortAreaOption[]> {
      const res = await api(`/portcalls/ports/${locode}/areas`);
      if (!res.ok) throw new Error('Could not load port areas');
      return ((await res.json()) as { areas: PortAreaOption[] }).areas;
    },

    async portCallTimeline(id: string): Promise<TimelineEvent[]> {
      const res = await api(`/portcalls/${id}/timeline`);
      if (!res.ok) throw new Error('Could not load the timeline');
      return ((await res.json()) as { events: TimelineEvent[] }).events;
    },

    async confirmPortCallActual(
      id: string,
      field: 'ata' | 'atd',
      value?: string,
    ): Promise<void> {
      const res = await api(`/portcalls/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify(value ? { field, value } : { field }),
      });
      if (!res.ok) throw new Error('Could not confirm');
    },

    async rejectPortCallSuggestion(id: string, field: 'ata' | 'atd'): Promise<void> {
      const res = await api(`/portcalls/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ field }),
      });
      if (!res.ok) throw new Error('Could not reject');
    },

    async createPortCall(input: PortCallCreate): Promise<string> {
      const res = await api('/portcalls', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not create the port call');
      }
      return ((await res.json()) as { id: string }).id;
    },

    async updatePortCall(id: string, input: PortCallUpdate): Promise<void> {
      const res = await api(`/portcalls/${id}/update`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save the port call');
      }
    },

    /**
     * Cancel the port call. In NEMO this sends the COA first, with the
     * reason as its remark, and NEMO's refusal comes back as the words
     * (spec 0080); `coaSent` says whether NEMO was told.
     */
    /** Before a send dialog opens (2026-10-06): NEMO up and the visit alive; a cancelled visit comes back unlinked. */
    async nemoCheck(id: string): Promise<{ state: 'live' | 'unavailable' | 'unlinked' | 'notInNemo'; exchange: NemoExchange | null }> {
      const res = await api(`/portcalls/${id}/nemo-check`, { method: 'POST' });
      if (!res.ok) throw await exchangeError(res, 'Could not check the visit in NEMO');
      return (await res.json()) as { state: 'live' | 'unavailable' | 'unlinked' | 'notInNemo'; exchange: NemoExchange | null };
    },

    async cancelPortCall(id: string, reason?: string): Promise<{ coaSent: boolean; exchange: NemoExchange | null }> {
      const res = await api(`/portcalls/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) throw await exchangeError(res, 'Could not cancel the port call');
      const body = (await res.json().catch(() => null)) as { coaSent?: boolean; exchange?: NemoExchange } | null;
      return { coaSent: body?.coaSent === true, exchange: body?.exchange ?? null };
    },

    /** Your fleet (spec 0068). */
    async listShips(): Promise<Ship[]> {
      const res = await api('/ships');
      if (!res.ok) throw new Error('Could not load ships');
      return ((await res.json()) as { ships: Ship[] }).ships;
    },

    /** Search the shared master list by name or IMO (spec 0068). */
    async searchShips(q: string): Promise<ShipSearchHit[]> {
      const res = await api(`/ships/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Could not search the master list');
      return ((await res.json()) as { hits: ShipSearchHit[] }).hits;
    },

    async addShipToFleet(id: string): Promise<Ship> {
      const res = await api(`/ships/${id}/add`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not add the ship to your fleet');
      }
      return ((await res.json()) as { ship: Ship }).ship;
    },

    async removeShipFromFleet(id: string): Promise<void> {
      const res = await api(`/ships/${id}/remove`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not remove the ship from your fleet');
      }
    },

    /** The whole master list — platform admins (spec 0068). */
    async listPlatformShips(): Promise<PlatformShip[]> {
      const res = await api('/platform/ships');
      if (!res.ok) throw new Error('Could not load the master list');
      return ((await res.json()) as { ships: PlatformShip[] }).ships;
    },

    async refreshPlatformShipFromNemo(id: string): Promise<void> {
      const res = await api(`/platform/ships/${id}/nemo-refresh`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not read the ship from NEMO');
      }
    },

    async createShip(input: ShipInput): Promise<void> {
      const res = await api('/ships', { method: 'POST', body: JSON.stringify(input) });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save the ship');
      }
    },

    async updateShip(id: string, input: ShipInput): Promise<void> {
      const res = await api(`/ships/${id}/update`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save the ship');
      }
    },

    /** Drop the operator's override for one field and use the source's value (spec 0061). */
    /** Read the ship back from NEMO into its "In NEMO" column (spec 0064). */
    async refreshShipFromNemo(id: string): Promise<void> {
      const res = await api(`/ships/${id}/nemo-refresh`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not read the ship from NEMO');
      }
    },

    /** The confirmation before a ship-data send (spec 0070). */
    async shipNemoPreview(id: string, portCallId?: string): Promise<ShipNemoPreview> {
      const q = portCallId ? `?portCallId=${encodeURIComponent(portCallId)}` : '';
      const res = await api(`/ships/${id}/nemo-preview${q}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not prepare the send');
      }
      return ((await res.json()) as { preview: ShipNemoPreview }).preview;
    },

    /** Send the ship data to NEMO as the SID and SHP of a port call (spec 0070). */
    async sendShipToNemo(
      id: string,
      portCallId: string,
      /** One report at a time (user 2026-11-13); all when left out. */
      types?: ('SID' | 'SHP' | 'CRT')[],
    ): Promise<ShipNemoReceipt> {
      const res = await api(`/ships/${id}/nemo-send`, {
        method: 'POST',
        body: JSON.stringify({ portCallId, ...(types ? { types } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not send to NEMO');
      }
      return ((await res.json()) as { receipt: ShipNemoReceipt }).receipt;
    },

    /** The NOA wizard (spec 0088): the checklist, the envelope, whether it may be confirmed. */
    async noaPreview(portCallId: string, confirm = false): Promise<NoaPreview> {
      const res = await api(`/portcalls/${portCallId}/noa${confirm ? '?confirm=true' : ''}`);
      if (!res.ok) throw new Error('Could not prepare the NOA');
      return (await res.json()) as NoaPreview;
    },

    async setNoticeFacts(portCallId: string, facts: NoticeFacts): Promise<NoticeFacts> {
      const res = await api(`/portcalls/${portCallId}/noa/facts`, { method: 'POST', body: JSON.stringify(facts) });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save');
      }
      return ((await res.json()) as { notice: NoticeFacts }).notice;
    },

    /** One NOA row edited in place (spec 0090): saved to its owner — the call, the ship, the organisation. */
    /** One pre-arrival report on its own (spec 0098). */
    async reportPreview(portCallId: string, code: string): Promise<ReportPreview> {
      const res = await api(`/portcalls/${portCallId}/reports/${code}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Could not prepare the ${code}`);
      }
      return (await res.json()) as ReportPreview;
    },

    /** Send that one report again (spec 0098). */
    async sendReport(portCallId: string, code: string): Promise<ShipNemoReceipt> {
      const res = await api(`/portcalls/${portCallId}/reports/${code}/send`, { method: 'POST' });
      if (!res.ok) throw await exchangeError(res, `Could not send the ${code}`);
      return ((await res.json()) as { receipt: ShipNemoReceipt }).receipt;
    },

    /** Tick or untick one pre-arrival report (spec 0098); answers the NOA view again. */
    async setNoaReport(portCallId: string, code: string, on: boolean): Promise<NoaPreview> {
      const res = await api(`/portcalls/${portCallId}/noa/reports`, { method: 'POST', body: JSON.stringify({ code, on }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save the choice');
      }
      return (await res.json()) as NoaPreview;
    },

    async saveNoaField(portCallId: string, key: string, value: string | number | null): Promise<void> {
      const res = await api(`/portcalls/${portCallId}/noa/field`, { method: 'POST', body: JSON.stringify({ key, value }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save');
      }
    },

    /** Send the NOA; `confirm` is the sender's explicit answer (spec 0088). */
    async sendNoa(portCallId: string, confirm: boolean): Promise<ShipNemoReceipt> {
      const res = await api(`/portcalls/${portCallId}/noa/send`, { method: 'POST', body: JSON.stringify({ confirm }) });
      if (!res.ok) throw await exchangeError(res, 'Could not send the NOA');
      return ((await res.json()) as { receipt: ShipNemoReceipt }).receipt;
    },

    /** The ATA or ATD step for time `at` (ISO) — spec 0092. */
    async actualPreview(portCallId: string, code: 'ata' | 'atd', at: string): Promise<ActualPreview> {
      const res = await api(`/portcalls/${portCallId}/${code}?at=${encodeURIComponent(at)}`);
      if (!res.ok) throw new Error(`Could not prepare the ${code.toUpperCase()}`);
      return (await res.json()) as ActualPreview;
    },

    /** Send the ATA or ATD step: the notice's confirmation first when missing, then the actual. */
    async sendActual(portCallId: string, code: 'ata' | 'atd', at: string): Promise<ShipNemoReceipt> {
      const res = await api(`/portcalls/${portCallId}/${code}/send`, { method: 'POST', body: JSON.stringify({ at }) });
      if (!res.ok) throw await exchangeError(res, `Could not send the ${code.toUpperCase()}`);
      return ((await res.json()) as { receipt: ShipNemoReceipt }).receipt;
    },

    /** The NOD (spec 0092). */
    async nodPreview(portCallId: string): Promise<NodPreview> {
      const res = await api(`/portcalls/${portCallId}/nod`);
      if (!res.ok) throw new Error('Could not prepare the NOD');
      return (await res.json()) as NodPreview;
    },

    async sendNod(portCallId: string): Promise<ShipNemoReceipt> {
      const res = await api(`/portcalls/${portCallId}/nod/send`, { method: 'POST' });
      if (!res.ok) throw await exchangeError(res, 'Could not send the NOD');
      return ((await res.json()) as { receipt: ShipNemoReceipt }).receipt;
    },

    /**
     * The call's new ETA / ETD to NEMO (user 2026-11-13): the NOA and the NOD
     * NEMO already has go again as updates.
     */
    async sendScheduleUpdate(portCallId: string): Promise<ShipNemoReceipt> {
      const res = await api(`/portcalls/${portCallId}/schedule/send`, { method: 'POST' });
      if (!res.ok) throw await exchangeError(res, 'Could not send the new times to NEMO');
      return ((await res.json()) as { receipt: ShipNemoReceipt }).receipt;
    },

    /** Create the port call in NEMO — the VID (spec 0070). */
    async createPortCallInNemo(
      portCallId: string,
    ): Promise<{ visitId: string; route: string; exchange: NemoExchange }> {
      const res = await api(`/portcalls/${portCallId}/nemo-create`, { method: 'POST' });
      if (!res.ok) throw await exchangeError(res, 'Could not create the port call in NEMO');
      return (await res.json()) as { visitId: string; route: string; exchange: NemoExchange };
    },

    /** The certificate files of a ship (spec 0084). */
    async listCertificateFiles(shipId: string): Promise<CertificateFile[]> {
      const res = await api(`/ships/${shipId}/certificate-files`);
      if (!res.ok) throw new Error('Could not load the certificate files');
      return ((await res.json()) as { files: CertificateFile[] }).files;
    },

    async uploadCertificateFile(shipId: string, certKey: string, file: File): Promise<CertificateFile> {
      const form = new FormData();
      form.append('file', file, file.name);
      // Multipart: no JSON content type — the browser sets the boundary
      const res = await fetch(`/api/v1/ships/${shipId}/certificate-files/${encodeURIComponent(certKey)}`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not add the file');
      }
      return ((await res.json()) as { file: CertificateFile }).file;
    },

    async removeCertificateFile(shipId: string, fileId: string): Promise<void> {
      const res = await api(`/ships/${shipId}/certificate-files/file/${fileId}/remove`, { method: 'POST' });
      if (!res.ok) throw new Error('Could not remove the file');
    },

    certificateFileUrl(shipId: string, fileId: string): string {
      return `/api/v1/ships/${shipId}/certificate-files/file/${fileId}`;
    },

    /** The header's status light (spec 0082). */
    async systemStatus(): Promise<{ light: 'green' | 'yellow' | 'red'; items: StatusItem[]; checkedAt: string }> {
      const res = await api('/status');
      if (!res.ok) throw new Error('Status unavailable');
      return (await res.json()) as { light: 'green' | 'yellow' | 'red'; items: StatusItem[]; checkedAt: string };
    },

    /** Email an exchange to NEMOLink support, the user in cc (spec 0081). */
    async reportToSupport(exchange: NemoExchange, note?: string): Promise<{ sentTo: string; cc: string }> {
      const res = await api('/nemo/support-report', {
        method: 'POST',
        body: JSON.stringify(note ? { exchange, note } : { exchange }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not send the report');
      }
      return (await res.json()) as { sentTo: string; cc: string };
    },

    async useShipSource(id: string, field: string): Promise<void> {
      const res = await api(`/ships/${id}/use-source`, {
        method: 'POST',
        body: JSON.stringify({ field }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not use the source value');
      }
    },

    /** Platform-wide activation — platform admins (specs 0067/0068). */
    async setPlatformShipActive(id: string, active: boolean): Promise<void> {
      const res = await api(`/platform/ships/${id}/${active ? 'activate' : 'deactivate'}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not change the ship status');
      }
    },

    /** `kind` 'nemo' narrows to the NEMO log — every exchange with NEMO (spec 0078). */
    async listAudit(before: string | null, q?: string, kind?: 'nemo'): Promise<{
      events: AuditEvent[];
      nextBefore: string | null;
    }> {
      let query = before ? `?limit=40&before=${encodeURIComponent(before)}` : '?limit=40';
      if (q) query += `&q=${encodeURIComponent(q)}`;
      if (kind) query += `&kind=${encodeURIComponent(kind)}`;
      const res = await api(`/audit${query}`);
      if (!res.ok) throw new Error('Could not load the audit log');
      return (await res.json()) as { events: AuditEvent[]; nextBefore: string | null };
    },

    async getOrg(): Promise<OrgInfo> {
      const res = await api('/org');
      if (!res.ok) throw new Error('Could not load organization info');
      return ((await res.json()) as { org: OrgInfo }).org;
    },

    async updateOrg(input: OrgUpdate): Promise<OrgInfo> {
      const res = await api('/org/update', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save the organization profile');
      }
      return ((await res.json()) as { org: OrgInfo }).org;
    },

    /**
     * The org's own NEMO credentials (spec 0059). Status only — the stored
     * client id and secret are never sent to the browser, so the dialog always
     * starts empty and "replace" is the only edit.
     */
    async getNemoCredentials(): Promise<{
      credentials: NemoCredentialStatus[];
      vaultConfigured: boolean;
    }> {
      const res = await api('/org/nemo-credential');
      if (!res.ok) throw new Error('Could not load NEMO credentials');
      return (await res.json()) as {
        credentials: NemoCredentialStatus[];
        vaultConfigured: boolean;
      };
    },

    async setNemoCredential(
      input: NemoCredentialInput,
    ): Promise<NemoCredentialStatus[]> {
      const res = await api('/org/nemo-credential', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not save the NEMO credential');
      }
      return ((await res.json()) as { credentials: NemoCredentialStatus[] }).credentials;
    },

    async removeNemoCredential(target: 'stg' | 'prd'): Promise<NemoCredentialStatus[]> {
      const res = await api('/org/nemo-credential/remove', {
        method: 'POST',
        body: JSON.stringify({ target }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not remove the NEMO credential');
      }
      return ((await res.json()) as { credentials: NemoCredentialStatus[] }).credentials;
    },

    /** Current ingest envelope schema version (spec 0052). */
    async ingestSchemaMeta(): Promise<{ version: string; filename: string }> {
      const res = await api('/ingest/schema/meta');
      if (!res.ok) throw new Error('Could not load the ingest schema version');
      return (await res.json()) as { version: string; filename: string };
    },

    /** Session cookie rides along — a plain link downloads the schema. */
    ingestSchemaUrl(): string {
      return '/api/v1/ingest/schema';
    },

    async listCodelists(): Promise<CodelistSummary[]> {
      const res = await api('/refdata/codelists');
      if (!res.ok) throw new Error('Could not load codelists');
      return ((await res.json()) as { codelists: CodelistSummary[] }).codelists;
    },

    async listCodelistEntries(
      name: string,
      q?: string,
    ): Promise<{ entries: CodelistEntry[]; total: number }> {
      const query = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await api(`/refdata/codelists/${encodeURIComponent(name)}${query}`);
      if (!res.ok) throw new Error('Could not load the codelist');
      return (await res.json()) as { entries: CodelistEntry[]; total: number };
    },

    async listLocations(q?: string): Promise<{ locations: RefLocation[]; total: number }> {
      const query = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await api(`/refdata/locations${query}`);
      if (!res.ok) throw new Error('Could not load locations');
      return (await res.json()) as { locations: RefLocation[]; total: number };
    },

    async listHazmat(q?: string): Promise<{ items: HazmatItem[]; total: number }> {
      const query = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await api(`/refdata/hazmat${query}`);
      if (!res.ok) throw new Error('Could not load dangerous goods');
      return (await res.json()) as { items: HazmatItem[]; total: number };
    },

    async listContracts(): Promise<ContractFile[]> {
      const res = await api('/refdata/contracts');
      if (!res.ok) throw new Error('Could not load the contract list');
      return ((await res.json()) as { contracts: ContractFile[] }).contracts;
    },

    async listHsMap(): Promise<HsMapRow[]> {
      const res = await api('/refdata/hsmap');
      if (!res.ok) throw new Error('Could not load the HS map');
      return ((await res.json()) as { entries: HsMapRow[] }).entries;
    },

    async syncStatus(): Promise<{ datasets: SyncDataset[]; runs: SyncRun[] }> {
      const res = await api('/refdata/sync/status');
      if (!res.ok) throw new Error('Could not load sync status');
      return (await res.json()) as { datasets: SyncDataset[]; runs: SyncRun[] };
    },

    async runSync(job: string): Promise<SyncRun> {
      const res = await api(`/refdata/sync/${encodeURIComponent(job)}`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not run the sync');
      }
      return ((await res.json()) as { run: SyncRun }).run;
    },
  };
}
