/**
 * Ship field lanes (docs/specs/0061) — the field-level form of the lane /
 * resolution model in docs/03, applied to ship master data:
 *
 *   data.lanes.<source>    what each pushing system last asserted, per field,
 *                          and when — external data, kept intact
 *   data.overrides.<key>   the operator's value for a field: the operator lane
 *                          and its selection in one record
 *   columns + mirror keys  the resolved value — override ?? latest lane value
 *
 * A push never clobbers an override. An admin edit that equals the latest
 * external value drops the override rather than storing a copy of it. Both
 * namespaces are ours (invariant 10) and never collide with vendored keys.
 *
 * Field keys: `name` · `mmsi` · `callSign` · every particulars wire key
 * (`dwt`, `operatorName`, `iceClass`, …) · `cert:<type>:<id>` for a
 * certificate as the source sent it · `cert:<type>:<id>:expiryDate` for the
 * one certificate field a source asserts and an operator may override.
 */

import type { IngestEnvelope, ShipPayload } from '../ingest/envelope.schema';
import { PARTICULARS_WIRE_KEYS, applyParticularsToData } from './ship-master-data';

export const PARTICULARS_KEY_SET: ReadonlySet<string> = new Set(PARTICULARS_WIRE_KEYS);
export const LANES_KEY = 'lanes';

/**
 * Lane tiers (spec 0068): sources rank, recency decides only within a rank.
 * A customer's system is the system of record for what it sends (tier 1);
 * NEMO's ship database fills what nobody pushes (tier 2); Digitraffic's
 * visits feed knows only the name (tier 3). A platform lane never displaces
 * a customer system's value.
 */
export const NSD_LANE = 'nsd';
export const DIGITRAFFIC_LANE = 'digitraffic';
const PLATFORM_LANE_TIERS: Readonly<Record<string, number>> = {
  [NSD_LANE]: 2,
  [DIGITRAFFIC_LANE]: 3,
};
export function laneTier(source: string): number {
  return PLATFORM_LANE_TIERS[source] ?? 1;
}
/** A lane a customer's system wrote, as opposed to a platform reference lane. */
export function isCustomerLane(source: string): boolean {
  return laneTier(source) === 1;
}
export const OVERRIDES_KEY = 'overrides';
export const IDENTITY_KEYS = ['name', 'mmsi', 'callSign'] as const;
export type IdentityKey = (typeof IDENTITY_KEYS)[number];

export interface LaneSnapshot {
  receivedAt: string;
  occurredAt: string;
  eventId: string;
  sourceRecordId: string;
  /** The org whose credential pushed it (spec 0067) — the mask reads it; absent on pre-0067 lanes. */
  org?: string;
  fields: Record<string, unknown>;
}

export interface FieldOverride {
  value: unknown;
  author: string;
  /** The author's org (spec 0067) — absent on pre-0067 overrides. */
  org?: string;
  at: string;
  /**
   * Certificate expiry only: the source has a NEWER date than the override,
   * so the override is disregarded and the external value goes to NEMO —
   * the record stays, highlighted, until someone clears it (spec 0061 rule 6).
   */
  superseded?: boolean;
}

export interface ExternalValue {
  source: string;
  value: unknown;
  occurredAt: string;
  receivedAt: string;
  /** The org whose source asserted it (spec 0067). */
  org?: string;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function certKey(typeCode: string, certificateId?: string | null): string {
  return `cert:${typeCode}:${certificateId ?? ''}`;
}

export function certExpiryKey(typeCode: string, certificateId?: string | null): string {
  return `${certKey(typeCode, certificateId)}:expiryDate`;
}

export function parseCertExpiryKey(
  key: string,
): { typeCode: string; certificateId: string | null } | null {
  const m = /^cert:([^:]+):(.*):expiryDate$/.exec(key);
  if (!m) return null;
  return { typeCode: m[1]!, certificateId: m[2] === '' ? null : m[2]! };
}

export function isIdentityKey(key: string): key is IdentityKey {
  return (IDENTITY_KEYS as readonly string[]).includes(key);
}

export function lanesOf(data: Record<string, unknown>): Record<string, LaneSnapshot> {
  const out: Record<string, LaneSnapshot> = {};
  for (const [source, raw] of Object.entries(asObject(data[LANES_KEY]))) {
    const lane = asObject(raw);
    if (typeof lane['occurredAt'] !== 'string' || typeof lane['receivedAt'] !== 'string') {
      continue;
    }
    out[source] = {
      receivedAt: lane['receivedAt'],
      occurredAt: lane['occurredAt'],
      eventId: typeof lane['eventId'] === 'string' ? lane['eventId'] : '',
      sourceRecordId:
        typeof lane['sourceRecordId'] === 'string' ? lane['sourceRecordId'] : '',
      ...(typeof lane['org'] === 'string' ? { org: lane['org'] } : {}),
      fields: asObject(lane['fields']),
    };
  }
  return out;
}

export function overridesOf(data: Record<string, unknown>): Record<string, FieldOverride> {
  const out: Record<string, FieldOverride> = {};
  for (const [key, raw] of Object.entries(asObject(data[OVERRIDES_KEY]))) {
    const o = asObject(raw);
    if (typeof o['author'] !== 'string' || typeof o['at'] !== 'string') continue;
    out[key] = {
      value: 'value' in o ? o['value'] : null,
      author: o['author'],
      ...(typeof o['org'] === 'string' ? { org: o['org'] } : {}),
      at: o['at'],
      ...(o['superseded'] === true ? { superseded: true } : {}),
    };
  }
  return out;
}

const CERT_KEY = 'ram:MaritimeApplicableSpecifiedCertificate';

/**
 * Rule 6: a certificate expiry override older than what the source now says
 * is disregarded — the newer external date is what goes to NEMO — but the
 * override record stays, flagged, so the UI can show what happened. Runs
 * after every push and every admin edit; returns the keys it disregarded.
 */
export function applyCertSupersession(
  data: Record<string, unknown>,
): { data: Record<string, unknown>; superseded: string[] } {
  let out = data;
  const superseded: string[] = [];
  const certs = Array.isArray(out[CERT_KEY])
    ? (out[CERT_KEY] as Record<string, unknown>[]).map((c) => ({ ...c }))
    : [];
  let certsChanged = false;
  for (const [key, override] of Object.entries(overridesOf(out))) {
    const cert = parseCertExpiryKey(key);
    if (!cert) continue;
    const external = latestExternal(out, key);
    const newer =
      external !== null &&
      typeof external.value === 'string' &&
      typeof override.value === 'string' &&
      external.value > override.value;
    if (newer) {
      superseded.push(key);
      const at = certs.findIndex(
        (c) =>
          c['ram:TypeCode'] === cert.typeCode && (c['ram:ID'] ?? null) === cert.certificateId,
      );
      if (at >= 0 && certs[at]!['ram:ExpiryDate'] !== external.value) {
        certs[at]!['ram:ExpiryDate'] = external.value;
        certsChanged = true;
      }
    }
    if ((override.superseded === true) !== newer) {
      const { superseded: _flag, ...rest } = override;
      out = withOverride(out, key, newer ? { ...rest, superseded: true } : rest);
    }
  }
  if (certsChanged) out = { ...out, [CERT_KEY]: certs };
  return { data: out, superseded };
}

/** What a ship envelope asserts, keyed the way lanes and overrides are. */
export function laneFieldsFromEnvelope(
  envelope: IngestEnvelope & { payloadType: 'ship' },
): Record<string, unknown> {
  const fields: Record<string, unknown> = { name: envelope.ship.name.trim() };
  if (envelope.ship.mmsi) fields['mmsi'] = envelope.ship.mmsi;
  if (envelope.ship.callSign) fields['callSign'] = envelope.ship.callSign;
  const { certificates, ...particulars } = envelope.payload as ShipPayload;
  for (const [key, value] of Object.entries(particulars)) {
    if (value !== undefined) fields[key] = value;
  }
  for (const cert of certificates ?? []) {
    fields[certKey(cert.typeCode, cert.certificateId)] = cert;
    if (cert.expiryDate) {
      fields[certExpiryKey(cert.typeCode, cert.certificateId)] = cert.expiryDate;
    }
  }
  return fields;
}

/** Record a source's latest assertion of these fields (others it said before stay). */
export function withLane(
  data: Record<string, unknown>,
  source: string,
  fields: Record<string, unknown>,
  meta: Omit<LaneSnapshot, 'fields'>,
): Record<string, unknown> {
  const lanes = asObject(data[LANES_KEY]);
  const previous = asObject(asObject(lanes[source])['fields']);
  return {
    ...data,
    [LANES_KEY]: {
      ...lanes,
      [source]: { ...meta, fields: { ...previous, ...fields } },
    },
  };
}

/** Set (or with null, clear) the operator's override for one field. */
export function withOverride(
  data: Record<string, unknown>,
  key: string,
  override: FieldOverride | null,
): Record<string, unknown> {
  const overrides = { ...asObject(data[OVERRIDES_KEY]) };
  if (override === null) delete overrides[key];
  else overrides[key] = override;
  const out = { ...data };
  if (Object.keys(overrides).length > 0) out[OVERRIDES_KEY] = overrides;
  else delete out[OVERRIDES_KEY];
  return out;
}

/** The most recently asserted external value of a field, across sources. */
export function latestExternal(
  data: Record<string, unknown>,
  key: string,
): ExternalValue | null {
  let best: { tier: number; value: ExternalValue } | null = null;
  for (const [source, lane] of Object.entries(lanesOf(data))) {
    if (!(key in lane.fields)) continue;
    const tier = laneTier(source);
    const newer =
      !best ||
      tier < best.tier ||
      (tier === best.tier && Date.parse(lane.occurredAt) > Date.parse(best.value.occurredAt));
    if (newer) {
      best = {
        tier,
        value: {
          source,
          value: lane.fields[key],
          occurredAt: lane.occurredAt,
          receivedAt: lane.receivedAt,
          ...(lane.org ? { org: lane.org } : {}),
        },
      };
    }
  }
  return best?.value ?? null;
}

/** Every field some lane asserts, resolved by tier (spec 0068): the External column. */
export function externalsOf(data: Record<string, unknown>): Record<string, ExternalValue> {
  const keys = new Set<string>();
  for (const lane of Object.values(lanesOf(data))) {
    for (const key of Object.keys(lane.fields)) keys.add(key);
  }
  const out: Record<string, ExternalValue> = {};
  for (const key of keys) {
    const cell = latestExternal(data, key);
    if (cell) out[key] = cell;
  }
  return out;
}

/**
 * Land a platform lane's fields on the master values where nothing ranks
 * above it (spec 0068): identity as column values, particulars in the
 * mirror. Returns the data and the columns to write; a field a customer
 * system has asserted is left alone.
 */
export function applyLaneToResolved(
  data: Record<string, unknown>,
  source: string,
  fields: Record<string, unknown>,
): { data: Record<string, unknown>; columns: Partial<Record<IdentityKey, string | null>> } {
  const columns: Partial<Record<IdentityKey, string | null>> = {};
  const particulars: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (latestExternal(data, key)?.source !== source) continue;
    if (isIdentityKey(key)) {
      columns[key] = typeof value === 'string' ? value : null;
    } else if (PARTICULARS_KEY_SET.has(key)) {
      particulars[key] = value;
    }
  }
  const out =
    Object.keys(particulars).length > 0
      ? applyParticularsToData(data, particulars as never)
      : data;
  return { data: out, columns };
}

/** The last time a CUSTOMER system pushed this ship (platform lanes do not count). */
export function lastIngestOf(
  data: Record<string, unknown>,
): { source: string; receivedAt: string } | null {
  let best: { source: string; receivedAt: string } | null = null;
  for (const [source, lane] of Object.entries(lanesOf(data))) {
    if (!isCustomerLane(source)) continue;
    if (!best || Date.parse(lane.receivedAt) > Date.parse(best.receivedAt)) {
      best = { source, receivedAt: lane.receivedAt };
    }
  }
  return best;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
