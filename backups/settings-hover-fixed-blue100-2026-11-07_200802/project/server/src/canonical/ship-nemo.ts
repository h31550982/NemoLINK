/**
 * The "In NEMO" column for ships (docs/specs/0064): what NEMO's ship
 * database (NSD) held the last time we read it, kept as a snapshot in the
 * ship's own `data.nemo` namespace (invariant 10, reserved by spec 0062).
 *
 *   data.nemo = { shipId, at, source, fields }
 *
 * `shipId` is NEMO's global NSD uuid (null when NSD has no such ship),
 * `at` when we read it, `source` where from ('nsd'), `fields` the record
 * mapped to our wire keys — the same keys the lanes and overrides use, so
 * the ledger compares like with like. A snapshot is never a source lane:
 * NEMO is where data goes, not where it comes from. Nothing declares from
 * it, and a refresh never touches lanes, overrides or the resolved values.
 */

import type { NemoShipRecord } from '../nemo-client/nemo-client.service';
import { CertificateFact, NemoIssue, shipIssuesInNemo } from './nemo-ui-rules';
import { NSD_LANE, applyLaneToResolved, withLane } from './ship-lanes';
import type { IdentityKey } from './ship-lanes';
import { particularsFromData } from './ship-master-data';

export const NEMO_KEY = 'nemo';

export interface NemoSnapshot {
  /** NEMO's global NSD ship uuid; null = NSD did not know the ship when we looked. */
  shipId: string | null;
  /** When we read it (ISO). */
  at: string;
  /** Where we read it: 'nsd' (the NSD record route). */
  source: string;
  /** The record in our wire keys: name, mmsi, callSign, the particulars, iceClass. */
  fields: Record<string, unknown>;
  /** NSD's certificate list, by type (spec 0065): one per type, expiry as a date. */
  certificates: CertificateFact[];
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function nemoSnapshotOf(data: Record<string, unknown>): NemoSnapshot | null {
  const raw = asObject(data[NEMO_KEY]);
  if (typeof raw['at'] !== 'string') return null;
  return {
    shipId: typeof raw['shipId'] === 'string' ? raw['shipId'] : null,
    at: raw['at'],
    source: typeof raw['source'] === 'string' ? raw['source'] : 'nsd',
    fields: asObject(raw['fields']),
    certificates: certificateFacts(raw['certificates']),
  };
}

function certificateFacts(raw: unknown): CertificateFact[] {
  if (!Array.isArray(raw)) return [];
  const out: CertificateFact[] = [];
  for (const item of raw) {
    const c = asObject(item);
    if (typeof c['typeCode'] !== 'string' || !c['typeCode']) continue;
    out.push({
      typeCode: c['typeCode'],
      expiryDate: typeof c['expiryDate'] === 'string' ? c['expiryDate'] : null,
    });
  }
  return out;
}

/** An ISO date-time from NSD becomes the date our certificates carry. */
function asDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const at = Date.parse(v);
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : v;
}

/**
 * NSD's `shipCertificates[]` → `{ typeCode, expiryDate }`. The keys are the
 * ones the NEMO UI reads (`certificateTypeCode`, `certificateDateOfExpiry`,
 * spec 0065); STG has returned an empty list so far.
 */
export function certificatesFromRecord(record: NemoShipRecord): CertificateFact[] {
  const out: CertificateFact[] = [];
  for (const item of record.shipCertificates ?? []) {
    const c = asObject(item);
    const type = c['certificateTypeCode'];
    if (typeof type !== 'string' || !type) continue;
    out.push({ typeCode: type, expiryDate: asDate(c['certificateDateOfExpiry']) });
  }
  return out;
}

/**
 * NEMO's edge answers 403, empty, to an API client on the ship-database
 * routes (STG since 2026-09-25 — the NEMO UI's user session still reads
 * them; open question 35). Said once, the same in the refresh and the sync.
 */
export const NSD_REFUSED_WORDS =
  'NEMO refused the ship-database read for this API client (403) — the NEMO user interface ' +
  'still shows the ship; NEMOLink cannot fill In NEMO until Fintraffic opens the ship database ' +
  'to API clients (open question 35)';

/** What NEMO's own screens show for this ship right now (spec 0065). */
export function shipIssuesOf(
  snapshot: NemoSnapshot | null,
  now: number,
  nemoUiUrl: string | null = null,
): NemoIssue[] {
  if (!snapshot) return [];
  const ice = asObject(snapshot.fields['iceClass']);
  const inNemo = shipIssuesInNemo(
    {
      shipId: snapshot.shipId,
      certificates: snapshot.certificates,
      iceClassStatus: typeof ice['status'] === 'string' ? ice['status'] : null,
    },
    now,
  ).map((issue) =>
    // The confirmation is asked for in the NEMO UI today (spec 0069) — link it like onboarding.
    issue.rule === 'ship-ice-class-status' && nemoUiUrl ? { ...issue, link: nemoUiUrl } : issue,
  );
  return [...shipOnboardingIssues(snapshot, nemoUiUrl), ...inNemo];
}

/**
 * One NSD read, landed twice (spec 0068): as the "In NEMO" snapshot and — when
 * NSD knew the ship — as the `nsd` lane of the master list, so a ship nobody
 * pushes gets its details from NEMO (tier 2: never over a customer system).
 * Returns the data to store and the identity columns the lane resolved to.
 */
export function nsdReadIntoData(
  data: Record<string, unknown>,
  record: NemoShipRecord | null,
  now: string = new Date().toISOString(),
): {
  data: Record<string, unknown>;
  snapshot: NemoSnapshot;
  columns: Partial<Record<IdentityKey, string | null>>;
} {
  const snapshot = { ...snapshotFromRecord(record), at: now };
  let out = withNemoSnapshot(data, snapshot);
  let columns: Partial<Record<IdentityKey, string | null>> = {};
  if (record && snapshot.shipId) {
    out = withLane(out, NSD_LANE, snapshot.fields, {
      receivedAt: now,
      occurredAt: now,
      eventId: snapshot.shipId,
      sourceRecordId: '',
    });
    const landed = applyLaneToResolved(out, NSD_LANE, snapshot.fields);
    out = landed.data;
    columns = landed.columns;
  }
  return { data: out, snapshot, columns };
}

// ---- creating the ship in NEMO (spec 0067 §5) ------------------------------
// A ship exists in NEMO only once somebody has filed its first VID; the
// published API cannot do that (0062 F2), the NEMO UI's own backend can (F3)
// and we use it while it works. Never for a ship that exists: NSD is searched
// first, whoever created the record. When the undocumented route refuses, the
// operator makes the first VID by hand — these are the words.

/** The sentence the submission flow shows when NEMO will not let us create the ship (verbatim, spec 0067 §5.3). */
export function manualOnboardingWords(nemoUiUrl: string | null): string {
  return (
    'This ship needs to be created manually in NEMO by making its first VID report. ' +
    'Please log in to the NEMO user interface to do so' +
    (nemoUiUrl ? ` at ${nemoUiUrl}` : '') +
    '.'
  );
}

/** The ledger's early word (spec 0067 §5.4): the last read found no NSD record. */
export function shipOnboardingIssues(
  snapshot: NemoSnapshot | null,
  nemoUiUrl: string | null,
): NemoIssue[] {
  if (!snapshot || snapshot.shipId) return [];
  return [
    {
      rule: 'ship-not-in-nemo',
      level: 'info',
      words:
        "Not in NEMO's ship database yet — NEMOLink creates it with the ship's first VID; " +
        'if NEMO refuses, the first VID report must be made by hand in the NEMO user interface',
      ...(nemoUiUrl ? { link: nemoUiUrl } : {}),
    },
  ];
}

export function withNemoSnapshot(
  data: Record<string, unknown>,
  snapshot: NemoSnapshot,
): Record<string, unknown> {
  return { ...data, [NEMO_KEY]: snapshot };
}

/**
 * NSD record → our wire keys. NSD's `shipData` is the Port API `ShipData`
 * model — the very spelling we mirror inside ship.data (ADR 0004) — so the
 * particulars mapping is the one the ship rows already use. Identity comes
 * from `shipId`, the ice class from NSD's own block. Nulls are skipped; the
 * ship type arrives as a number and is a string on our wire.
 */
export function nemoFieldsFromRecord(record: NemoShipRecord): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const id = asObject(record.shipId);
  if (typeof id['name'] === 'string' && id['name']) fields['name'] = id['name'];
  if (typeof id['mmsiid'] === 'string' && id['mmsiid']) fields['mmsi'] = id['mmsiid'];
  if (typeof id['callsignid'] === 'string' && id['callsignid']) {
    fields['callSign'] = id['callsignid'];
  }
  const shipData = { ...asObject(record.shipData) };
  if (typeof shipData['typeCode'] === 'number') {
    shipData['typeCode'] = String(shipData['typeCode']);
  }
  const ice = asObject(record.iceClass);
  const particulars = particularsFromData({
    shipData,
    ...(typeof ice['code'] === 'string' ? { iceClass: ice } : {}),
  });
  for (const [key, value] of Object.entries(particulars)) {
    if (value !== undefined && value !== null) fields[key] = value;
  }
  return fields;
}

export function snapshotFromRecord(
  record: NemoShipRecord | null,
  at = new Date().toISOString(),
): NemoSnapshot {
  const id = record ? asObject(record.shipId)['id'] : null;
  return {
    shipId: typeof id === 'string' ? id : null,
    at,
    source: 'nsd',
    fields: record ? nemoFieldsFromRecord(record) : {},
    certificates: record ? certificatesFromRecord(record) : [],
  };
}
