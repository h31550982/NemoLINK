/**
 * Ship master data — the NSD-mirror field model (docs/specs/0036, ADR 0004).
 *
 * Pure mapping between the camelCase wire shape and the vendored storage
 * spellings inside ship.data: Port API `ShipData`/`IceClass` field names
 * for everything NSD serves, MIG SHP spelling for the FI-required elements
 * the Port API lacks, MIG CRT spelling for certificates (spec 0020,
 * unchanged). Nothing here is invented — every key traces to one vendor
 * file, every enum is read from the vendored contract.
 */

import { z } from 'zod';
import { MIG_SCHEMAS } from '../nemo-client/generated/mig-schemas';
import { SHIP_TYPE_CODES } from './generated/ship-type-codes';

// ---- certificates (spec 0020 — moved here from admin for ingest reuse) -----

/** MIG CRT storage key inside ship.data (invariant 10). */
export const CERT_KEY = 'ram:MaritimeApplicableSpecifiedCertificate';

function enumFrom(formality: string, def: string): Set<string> {
  const schema = MIG_SCHEMAS[formality] as
    | { $defs?: Record<string, { enum?: unknown[] }> }
    | undefined;
  const values = schema?.$defs?.[def]?.enum;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`embedded ${formality} schema: ${def} enum missing`);
  }
  return new Set(values.filter((v): v is string => typeof v === 'string'));
}

export const CERTIFICATE_TYPE_CODES = enumFrom(
  'CRT',
  'qdt:CertificateTypeCodeContentType',
);

/** MIG SHP ice class codes (FS1A … UKN) — the iceClass.code enum. */
export const ICE_CLASS_CODES = enumFrom('SHP', 'qdt:ICEClassCodeContentType');
/** NEMO's purposes of call (UN/EDIFACT 8025), the NOA's DE-014-10 — from the vendored MIG (spec 0090). */
export const CALL_PURPOSE_CODES = enumFrom('NOA', 'qdt:TransportCallPurposeCodeContentType');

/** MIG SHP types of navigation (NAV-01 … NAV-08) — spec 0040. */
export const NAVIGATION_TYPE_CODES = enumFrom(
  'SHP',
  'qdt:TypeOfNavigationCodeContentType',
);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be yyyy-mm-dd');

export const shipCertificateSchema = z
  .object({
    typeCode: z
      .string()
      .refine((c) => CERTIFICATE_TYPE_CODES.has(c), 'Unknown certificate type'),
    certificateId: z.string().min(1).max(64).optional(),
    issueDate: isoDate.optional(),
    expiryDate: isoDate.optional(),
    extendedUntil: isoDate.optional(),
    description: z.string().min(1).max(200).optional(),
    issuer: z.string().min(1).max(100).optional(),
    // The issuer elements Finland wants and the FI profile makes mandatory
    // (DE-006-06/07/08). Free strings, not enums: issuer type is "refer to the
    // IMO Compendium" with no vendored list, and the issuer list is a synced
    // codelist the UI picks from (spec 0040), not a compiled-in enum.
    issuerTypeCode: z.string().min(1).max(32).optional(),
    issuerId: z.string().min(1).max(32).optional(),
    issuerCountry: z
      .string()
      .regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2')
      .optional(),
  })
  .strict();

export type ShipCertificate = z.infer<typeof shipCertificateSchema>;

export interface ShipCertificateRow {
  typeCode: string;
  certificateId: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  extendedUntil: string | null;
  description: string | null;
  issuer: string | null;
  issuerTypeCode: string | null;
  issuerId: string | null;
  issuerCountry: string | null;
}

export function certToMig(c: ShipCertificate): Record<string, unknown> {
  const out: Record<string, unknown> = { 'ram:TypeCode': c.typeCode };
  if (c.certificateId) out['ram:ID'] = c.certificateId;
  if (c.issueDate) out['ram:IssueDate'] = c.issueDate;
  if (c.expiryDate) out['ram:ExpiryDate'] = c.expiryDate;
  if (c.extendedUntil) out['ram:ValidityExtendedUntilDate'] = c.extendedUntil;
  if (c.description) out['ram:Description'] = c.description;
  // One issuer party carries name (DE-006-09), coded id (DE-006-08), type
  // (DE-006-06) and — inside its postal address — the flag state (DE-006-07).
  const issuer: Record<string, unknown> = {};
  if (c.issuer) issuer['ram:Name'] = c.issuer;
  if (c.issuerId) issuer['ram:ID'] = c.issuerId;
  if (c.issuerTypeCode) issuer['ram:TypeCode'] = c.issuerTypeCode;
  if (c.issuerCountry) {
    issuer['ram:PostalTradeAddress'] = { 'ram:CountryID': c.issuerCountry };
  }
  if (Object.keys(issuer).length > 0) {
    out['ram:IssuerCertificateIssuerParty'] = issuer;
  }
  return out;
}

export function certFromMig(m: Record<string, unknown>): ShipCertificateRow {
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const party =
    m['ram:IssuerCertificateIssuerParty'] &&
    typeof m['ram:IssuerCertificateIssuerParty'] === 'object'
      ? (m['ram:IssuerCertificateIssuerParty'] as Record<string, unknown>)
      : {};
  const address =
    party['ram:PostalTradeAddress'] && typeof party['ram:PostalTradeAddress'] === 'object'
      ? (party['ram:PostalTradeAddress'] as Record<string, unknown>)
      : {};
  return {
    typeCode: str(m['ram:TypeCode']) ?? '',
    certificateId: str(m['ram:ID']),
    issueDate: str(m['ram:IssueDate']),
    expiryDate: str(m['ram:ExpiryDate']),
    extendedUntil: str(m['ram:ValidityExtendedUntilDate']),
    description: str(m['ram:Description']),
    issuer: str(party['ram:Name']),
    issuerTypeCode: str(party['ram:TypeCode']),
    issuerId: str(party['ram:ID']),
    issuerCountry: str(address['ram:CountryID']),
  };
}

/**
 * Merge a source system's certificates into what the ship already holds
 * (docs/specs/0036 amendment, 2026-09-03).
 *
 * A chartering system knows a certificate's type and when it expires. The
 * issuer, its type and its flag state — the elements Finland makes mandatory —
 * are entered by an operator here, and a push every ten minutes must not wipe
 * them. So a push is an UPSERT PER CERTIFICATE, FIELD BY FIELD:
 *
 * - a certificate the push does not mention is left exactly as it is;
 * - a certificate it does mention keeps every stored field the push has no
 *   opinion about, and takes the fields it carries;
 * - a certificate nobody has yet is added.
 *
 * Identity is (type code, certificate id) — an id distinguishes two of a kind,
 * and without one the type is the key. Removing a certificate stays an admin
 * act (spec 0020), which is why nothing here deletes.
 */
export function mergeCertificates(
  stored: Record<string, unknown>[],
  incoming: ShipCertificate[],
): Record<string, unknown>[] {
  const keyOf = (typeCode: unknown, id: unknown): string =>
    `${String(typeCode ?? '')}|${String(id ?? '')}`;
  const merged = stored.map((c) => ({ ...c }));
  const index = new Map<string, number>();
  merged.forEach((c, i) => index.set(keyOf(c['ram:TypeCode'], c['ram:ID']), i));

  for (const cert of incoming) {
    const patch = certToMig(cert);
    const at = index.get(keyOf(cert.typeCode, cert.certificateId));
    if (at === undefined) {
      merged.push(patch);
      index.set(keyOf(cert.typeCode, cert.certificateId), merged.length - 1);
      continue;
    }
    const before = merged[at]!;
    const party = {
      ...asRecord(before['ram:IssuerCertificateIssuerParty']),
      ...asRecord(patch['ram:IssuerCertificateIssuerParty']),
    };
    const address = {
      ...asRecord(asRecord(before['ram:IssuerCertificateIssuerParty'])['ram:PostalTradeAddress']),
      ...asRecord(asRecord(patch['ram:IssuerCertificateIssuerParty'])['ram:PostalTradeAddress']),
    };
    if (Object.keys(address).length > 0) party['ram:PostalTradeAddress'] = address;
    merged[at] = {
      ...before,
      ...patch,
      ...(Object.keys(party).length > 0
        ? { 'ram:IssuerCertificateIssuerParty': party }
        : {}),
    };
  }
  return merged;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function certificatesFromData(
  data: Record<string, unknown>,
): ShipCertificateRow[] {
  const raw = data?.[CERT_KEY];
  return Array.isArray(raw)
    ? raw
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        .map(certFromMig)
    : [];
}

// ---- particulars: wire key -> vendored ShipData key (ADR 0004) -------------

export const SHIP_DATA_STRING_FIELDS = {
  flagState: 'flagstate',
  registrationCountry: 'registrationcountry',
  // The NOA's registry (annex V of 2009/42/EC, e.g. FI00) and port of registry (spec 0088)
  registryCode: 'registry_code',
  registryPort: 'registry_port',
  relatedTransportMode: 'related_transport_mode',
  externalMarkingText: 'external_marking_text',
  navigationTypeCode: 'navigation_type_code',
  operatorName: 'operator_name',
  ownerName: 'owner_name',
  ownerRegisteredId: 'owner_registered_id',
  ownerPostcode: 'owner_postcode',
  ownerStreet: 'owner_street',
  ownerCity: 'owner_city',
  ownerCountryCode: 'owner_country_code',
  pniClubName: 'pni_club_name',
  satelliteId: 'satellite_id',
  satelliteProviderCode: 'satellite_provider_code',
  chartererTypeCode: 'charterer_type_code',
  chartererName: 'charterer_name',
  chartererPostcode: 'charterer_postcode',
  chartererStreet: 'charterer_street',
  chartererCity: 'charterer_city',
  chartererCountryCode: 'charterer_country_code',
  shipDriveTypeCode: 'ship_drive_type_code',
} as const;

export const SHIP_DATA_NUMBER_FIELDS = {
  length: 'length',
  width: 'width',
  grossWeight: 'grossweight',
  netWeight: 'netweight',
  dwt: 'dwt',
  summerDeadweight: 'summerdeadweight',
  summerDraught: 'summer_draught',
  betweenPerpendicularsLength: 'between_perpendiculars_length',
  openWaterSpeedMeasure: 'open_water_speed_measure',
  reducedGrossTonnage: 'reduced_gross_tonnage',
  bowThrusterPower: 'bow_thruster_power',
  sternThrusterPower: 'stern_thruster_power',
} as const;

/** FI-required SHP elements with no Port API home — MIG SHP spelling. */
export const CONSTRUCTION_KEY = 'ram:ConstructionVesselBuilding';
export const INERT_GAS_KEY = 'ram:InertGasSystemIndicator';
export const MAIN_ENGINE_KEY = 'ram:OnboardMainEngine';

const str = z.string().min(1).max(200);
const num = z.number().finite();

export const iceClassSchema = z
  .object({
    code: z.string().refine((c) => ICE_CLASS_CODES.has(c), 'Unknown ice class'),
    status: z.string().min(1).max(50).optional(),
    entryDate: isoDate.optional(),
    validTo: isoDate.optional(),
    dateOfIssue: isoDate.optional(),
  })
  .strict();

export type IceClassInput = z.infer<typeof iceClassSchema>;

/**
 * The full particulars wire model (docs/specs/0036). Everything optional;
 * `null` clears a field (admin use — the ingest payload rejects nulls, a
 * source omits what it does not know).
 */
export const shipParticularsSchema = z
  .object({
    flagState: str.nullable().optional(),
    registrationCountry: str.nullable().optional(),
    registryCode: z.string().regex(/^[A-Z]{2}\d{2}$/, 'A ship registry code, e.g. FI00').nullable().optional(),
    registryPort: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/, 'A UN/LOCODE, e.g. FIHEL').nullable().optional(),
    relatedTransportMode: str.nullable().optional(),
    externalMarkingText: str.nullable().optional(),
    navigationTypeCode: z
      .string()
      .refine((c) => NAVIGATION_TYPE_CODES.has(c), 'Unknown type of navigation')
      .nullable()
      .optional(),
    operatorName: str.nullable().optional(),
    ownerName: str.nullable().optional(),
    ownerRegisteredId: str.nullable().optional(),
    ownerPostcode: str.nullable().optional(),
    ownerStreet: str.nullable().optional(),
    ownerCity: str.nullable().optional(),
    ownerCountryCode: str.nullable().optional(),
    pniClubName: str.nullable().optional(),
    satelliteId: str.nullable().optional(),
    satelliteProviderCode: str.nullable().optional(),
    chartererTypeCode: str.nullable().optional(),
    chartererName: str.nullable().optional(),
    chartererPostcode: str.nullable().optional(),
    chartererStreet: str.nullable().optional(),
    chartererCity: str.nullable().optional(),
    chartererCountryCode: str.nullable().optional(),
    shipDriveTypeCode: str.nullable().optional(),
    length: num.nullable().optional(),
    width: num.nullable().optional(),
    grossWeight: num.nullable().optional(),
    netWeight: num.nullable().optional(),
    dwt: num.nullable().optional(),
    summerDeadweight: num.nullable().optional(),
    summerDraught: num.nullable().optional(),
    betweenPerpendicularsLength: num.nullable().optional(),
    openWaterSpeedMeasure: num.nullable().optional(),
    reducedGrossTonnage: num.nullable().optional(),
    bowThrusterPower: num.nullable().optional(),
    sternThrusterPower: num.nullable().optional(),
    typeCode: z
      .string()
      .refine((c) => SHIP_TYPE_CODES.has(c), 'Unknown ship type code')
      .nullable()
      .optional(),
    mainEngineAvailabilityIndicator: z.boolean().nullable().optional(),
    buildDate: isoDate.nullable().optional(),
    keelLayingDate: isoDate.nullable().optional(),
    inertGasSystem: z.boolean().nullable().optional(),
    mainEnginePower: num.nullable().optional(),
    iceClass: iceClassSchema.nullable().optional(),
  })
  .strict();

export type ShipParticularsInput = z.infer<typeof shipParticularsSchema>;

export interface ShipIceClass {
  code: string;
  status?: string;
  entryDate?: string;
  validTo?: string;
  dateOfIssue?: string;
}

export interface ShipParticulars {
  [field: string]: string | number | boolean | ShipIceClass | undefined;
  iceClass?: ShipIceClass;
}

/** Every particulars wire key, for diffs and UI iteration. */
export const PARTICULARS_WIRE_KEYS: readonly string[] = [
  ...Object.keys(SHIP_DATA_STRING_FIELDS),
  ...Object.keys(SHIP_DATA_NUMBER_FIELDS),
  'typeCode',
  'mainEngineAvailabilityIndicator',
  'buildDate',
  'keelLayingDate',
  'inertGasSystem',
  'mainEnginePower',
  'iceClass',
];

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Merge one particulars input into a ship.data object (returns a new
 * object; never mutates). Present fields set, null clears, absent stays —
 * iceClass is replaced as a whole (spec 0036).
 */
export function applyParticularsToData(
  data: Record<string, unknown>,
  input: ShipParticularsInput,
): Record<string, unknown> {
  const out = { ...data };
  const record = input as Record<string, unknown>;

  const shipData = { ...(asObject(out['shipData']) ?? {}) };
  const setShipData = (store: string, value: unknown): void => {
    if (value === null) delete shipData[store];
    else shipData[store] = value;
  };
  for (const [wire, store] of Object.entries(SHIP_DATA_STRING_FIELDS)) {
    if (wire in input) setShipData(store, record[wire]);
  }
  for (const [wire, store] of Object.entries(SHIP_DATA_NUMBER_FIELDS)) {
    if (wire in input) setShipData(store, record[wire]);
  }
  if ('typeCode' in input) setShipData('typeCode', input.typeCode ?? null);
  if ('mainEngineAvailabilityIndicator' in input) {
    setShipData(
      'main_engine_availability_indicator',
      input.mainEngineAvailabilityIndicator ?? null,
    );
  }
  if (Object.keys(shipData).length > 0) out['shipData'] = shipData;
  else delete out['shipData'];

  if ('iceClass' in input) {
    if (input.iceClass == null) delete out['iceClass'];
    else {
      const ic: Record<string, unknown> = { code: input.iceClass.code };
      if (input.iceClass.status) ic['status'] = input.iceClass.status;
      if (input.iceClass.entryDate) ic['entryDate'] = input.iceClass.entryDate;
      if (input.iceClass.validTo) ic['validTo'] = input.iceClass.validTo;
      if (input.iceClass.dateOfIssue) ic['dateOfIssue'] = input.iceClass.dateOfIssue;
      out['iceClass'] = ic;
    }
  }

  if ('buildDate' in input || 'keelLayingDate' in input) {
    const cvb = { ...(asObject(out[CONSTRUCTION_KEY]) ?? {}) };
    if ('buildDate' in input) {
      if (input.buildDate == null) delete cvb['ram:ConstructionDate'];
      else cvb['ram:ConstructionDate'] = input.buildDate;
    }
    if ('keelLayingDate' in input) {
      if (input.keelLayingDate == null) delete cvb['ram:KeelLayingDate'];
      else cvb['ram:KeelLayingDate'] = input.keelLayingDate;
    }
    if (Object.keys(cvb).length > 0) out[CONSTRUCTION_KEY] = cvb;
    else delete out[CONSTRUCTION_KEY];
  }
  if ('inertGasSystem' in input) {
    if (input.inertGasSystem == null) delete out[INERT_GAS_KEY];
    else out[INERT_GAS_KEY] = input.inertGasSystem ? 1 : 0;
  }
  if ('mainEnginePower' in input) {
    if (input.mainEnginePower == null) delete out[MAIN_ENGINE_KEY];
    else {
      // Single-entry array per the MIG shape; kW = UN/ECE Rec 20 'KWT'
      out[MAIN_ENGINE_KEY] = [
        { 'ram:PowerMeasure': { $: input.mainEnginePower, '@unitCode': 'KWT' } },
      ];
    }
  }
  return out;
}

/** ship.data → the wire shape; only fields that are actually set. */
export function particularsFromData(
  data: Record<string, unknown>,
): ShipParticulars {
  const out: ShipParticulars = {};
  const shipData = asObject(data?.['shipData']) ?? {};
  for (const [wire, store] of Object.entries(SHIP_DATA_STRING_FIELDS)) {
    const v = shipData[store];
    if (typeof v === 'string') out[wire] = v;
  }
  for (const [wire, store] of Object.entries(SHIP_DATA_NUMBER_FIELDS)) {
    const v = shipData[store];
    if (typeof v === 'number') out[wire] = v;
  }
  if (typeof shipData['typeCode'] === 'string') {
    out['typeCode'] = shipData['typeCode'];
  }
  if (typeof shipData['main_engine_availability_indicator'] === 'boolean') {
    out['mainEngineAvailabilityIndicator'] =
      shipData['main_engine_availability_indicator'];
  }

  const ice = asObject(data?.['iceClass']);
  if (ice && typeof ice['code'] === 'string') {
    const ic: ShipIceClass = { code: ice['code'] };
    if (typeof ice['status'] === 'string') ic.status = ice['status'];
    if (typeof ice['entryDate'] === 'string') ic.entryDate = ice['entryDate'];
    if (typeof ice['validTo'] === 'string') ic.validTo = ice['validTo'];
    if (typeof ice['dateOfIssue'] === 'string') ic.dateOfIssue = ice['dateOfIssue'];
    out.iceClass = ic;
  }

  const cvb = asObject(data?.[CONSTRUCTION_KEY]);
  if (cvb) {
    if (typeof cvb['ram:ConstructionDate'] === 'string') {
      out['buildDate'] = cvb['ram:ConstructionDate'];
    }
    if (typeof cvb['ram:KeelLayingDate'] === 'string') {
      out['keelLayingDate'] = cvb['ram:KeelLayingDate'];
    }
  }
  const inert = data?.[INERT_GAS_KEY];
  if (inert === 0 || inert === 1) out['inertGasSystem'] = inert === 1;
  const engines = data?.[MAIN_ENGINE_KEY];
  if (Array.isArray(engines) && engines.length > 0) {
    const power = asObject(asObject(engines[0])?.['ram:PowerMeasure']);
    if (power && typeof power['$'] === 'number') {
      out['mainEnginePower'] = power['$'];
    }
  }
  return out;
}

/** Field-level old→new particulars diff (spec 0032 pattern). */
export function diffParticulars(
  before: ShipParticulars,
  after: ShipParticulars,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of PARTICULARS_WIRE_KEYS) {
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      changes[key] = { from: from ?? null, to: to ?? null };
    }
  }
  return changes;
}
