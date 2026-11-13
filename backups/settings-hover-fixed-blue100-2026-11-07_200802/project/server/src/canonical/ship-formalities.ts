/**
 * Ship data as NEMO takes it (spec 0070): the SID and SHP formalities of a
 * port call. Every field NEMOLink holds has a home — the formality that
 * carries it and its EMSWe data element id — traced to
 * vendor/nemo/hub/de-index.json; the payload shapes follow the vendored MIG
 * 2.0.1.0 SID/SHP schemas (measures as {$, @unitCode}, indicators 0|1, codes
 * and dates as strings).
 *
 * Policy (user decision 2026-09-24, spec 0062): send what Finland requires,
 * nothing more by default. The SID carries the identity; the SHP carries the
 * eight FI-required elements (hub/fi-required.json). Every other field shows
 * its home in the ledger's NEMO ID column and stays here — the NOA/NOD
 * elements travel with the notices.
 */

import type { ShipParticulars } from './ship-master-data';

export type ShipHomeFormality = 'SID' | 'SHP' | 'NOA';

export interface ShipFieldHome {
  formality: ShipHomeFormality;
  /** EMSWe data element id, e.g. DE-009-03 (hub/de-index). */
  de: string;
  /** Carried by the ship-data send: the SID identity and the FI-required SHP set. */
  sent: boolean;
  /** Path under ram:UsedLogisticsTransportMeans; a '[0]' suffix = first array item. */
  path?: readonly string[];
  kind?: 'text' | 'code' | 'date' | 'indicator' | 'measure' | 'ice';
  /** UN/ECE Rec 20 unit of a measure (spec 0036: KWT, KNT). */
  unit?: string;
}

const CSTMC = 'ram:ConstructionSpecifiedTransportMeansCharacteristic';

function sent(
  formality: 'SID' | 'SHP',
  de: string,
  path: readonly string[],
  kind: NonNullable<ShipFieldHome['kind']>,
  unit?: string,
): ShipFieldHome {
  return { formality, de, sent: true, path, kind, ...(unit ? { unit } : {}) };
}

function shown(formality: ShipHomeFormality, de: string): ShipFieldHome {
  return { formality, de, sent: false };
}

/** Wire key → home. Keys are the ship row's (spec 0036 particulars + identity). */
export const SHIP_FIELD_HOMES: Readonly<Record<string, ShipFieldHome>> = {
  // ---- SID: the identity ---------------------------------------------------
  name: sent('SID', 'DE-005-01', ['ram:Name'], 'text'),
  imoNumber: sent('SID', 'DE-005-03', ['ram:IMOID'], 'text'),
  mmsi: sent('SID', 'DE-005-04', ['ram:MMSIID'], 'text'),
  callSign: sent('SID', 'DE-005-05', ['ram:CallSignID'], 'text'),

  // ---- SHP: the eight FI-required elements (hub/fi-required, spec 0062) ----
  ownerName: sent('SHP', 'DE-007-10', ['ram:OwnerTradeParty', 'ram:Name'], 'text'),
  operatorName: sent('SHP', 'DE-007-16', ['ram:OperatorTradeParty', 'ram:Name'], 'text'),
  iceClass: sent('SHP', 'DE-009-03', ['ram:ICEClassCode'], 'ice'),
  buildDate: sent(
    'SHP',
    'DE-009-04',
    [CSTMC, 'ram:ConstructionVesselBuilding', 'ram:ConstructionDate'],
    'date',
  ),
  keelLayingDate: sent(
    'SHP',
    'DE-009-05',
    [CSTMC, 'ram:ConstructionVesselBuilding', 'ram:KeelLayingDate'],
    'date',
  ),
  inertGasSystem: sent('SHP', 'DE-009-17', [CSTMC, 'ram:InertGasSystemIndicator'], 'indicator'),
  mainEnginePower: sent(
    'SHP',
    'DE-010-06',
    ['ram:OnboardMainEngine[0]', 'ram:PowerMeasure'],
    'measure',
    'KWT',
  ),
  openWaterSpeedMeasure: sent('SHP', 'DE-010-22', ['ram:OpenWaterSpeedMeasure'], 'measure', 'KNT'),

  // ---- SHP: every particular NEMOLink holds (spec 0083: the full set with
  //      every port call — NEMO's record is shared, so ours restates it) ----
  summerDraught: sent('SHP', 'DE-008-11', ['ram:SummerDraughtLevelMeasure'], 'measure', 'MTR'),
  betweenPerpendicularsLength: sent('SHP', 'DE-008-01', ['ram:BetweenPerpendicularsLengthMeasure'], 'measure', 'MTR'),
  reducedGrossTonnage: sent('SHP', 'DE-008-16', ['ram:ReducedGrossTonnageMeasure'], 'measure', 'GT'),
  summerDeadweight: sent('SHP', 'DE-008-09', [CSTMC, 'ram:SummerDeadweightTonnageMeasure'], 'measure', 'TNE'),
  bowThrusterPower: sent('SHP', 'DE-010-20', [CSTMC, 'ram:OnboardSpecifiedMarineThruster[0]', 'ram:BowPowerMeasure'], 'measure', 'KWT'),
  sternThrusterPower: sent('SHP', 'DE-010-21', [CSTMC, 'ram:OnboardSpecifiedMarineThruster[0]', 'ram:SternPowerMeasure'], 'measure', 'KWT'),
  navigationTypeCode: sent('SHP', 'DE-005-23', ['ram:NavigationTypeCode'], 'code'),
  externalMarkingText: sent('SHP', 'DE-005-21', ['ram:ExternalMarking'], 'text'),
  relatedTransportMode: sent('SHP', 'DE-005-22', ['ram:RelatedTransportModeCode'], 'code'),
  mainEngineAvailabilityIndicator: sent('SHP', 'DE-010-01', ['ram:MainEngineAvailabilityIndicator'], 'indicator'),
  satelliteId: sent('SHP', 'DE-005-19', ['ram:MobileSpecifiedSatelliteIdentification[0]', 'ram:ID'], 'text'),
  satelliteProviderCode: sent('SHP', 'DE-005-20', ['ram:MobileSpecifiedSatelliteIdentification[0]', 'ram:ProviderCode'], 'code'),
  shipDriveTypeCode: sent('SHP', 'DE-010-24', [CSTMC, 'ram:OnboardSpecifiedPropeller[0]', 'ram:DriveTypeCode'], 'code'),
  ownerRegisteredId: sent('SHP', 'DE-007-09', ['ram:OwnerTradeParty', 'ram:RegisteredID'], 'text'),
  ownerStreet: sent('SHP', 'DE-007-11', ['ram:OwnerTradeParty', 'ram:PostalTradeAddress', 'ram:LineOne'], 'text'),
  ownerPostcode: sent('SHP', 'DE-007-12', ['ram:OwnerTradeParty', 'ram:PostalTradeAddress', 'ram:PostcodeCode'], 'text'),
  ownerCity: sent('SHP', 'DE-007-13', ['ram:OwnerTradeParty', 'ram:PostalTradeAddress', 'ram:CityName'], 'text'),
  ownerCountryCode: sent('SHP', 'DE-007-14', ['ram:OwnerTradeParty', 'ram:PostalTradeAddress', 'ram:CountryID'], 'code'),
  pniClubName: sent('SHP', 'DE-007-15', ['ram:OwnerTradeParty', 'ram:ApplicableMembership', 'ram:ProvidingLegalOrganization', 'ram:Name'], 'text'),
  chartererTypeCode: sent('SHP', 'DE-007-27', ['ram:ChartererParty', 'ram:TypeCode'], 'code'),
  chartererName: sent('SHP', 'DE-007-28', ['ram:ChartererParty', 'ram:Name'], 'text'),
  chartererStreet: sent('SHP', 'DE-007-29', ['ram:ChartererParty', 'ram:PostalTradeAddress', 'ram:LineOne'], 'text'),
  chartererPostcode: sent('SHP', 'DE-007-30', ['ram:ChartererParty', 'ram:PostalTradeAddress', 'ram:PostcodeCode'], 'text'),
  chartererCity: sent('SHP', 'DE-007-31', ['ram:ChartererParty', 'ram:PostalTradeAddress', 'ram:CityName'], 'text'),
  chartererCountryCode: sent('SHP', 'DE-007-32', ['ram:ChartererParty', 'ram:PostalTradeAddress', 'ram:CountryID'], 'code'),

  // ---- elements of the notices (NOA/NOD carry them, spec 0063) -------------
  typeCode: shown('NOA', 'DE-005-16'),
  flagState: shown('NOA', 'DE-005-09'),
  registrationCountry: shown('NOA', 'DE-005-10'),
  registryCode: shown('NOA', 'DE-005-10'),
  registryPort: shown('NOA', 'DE-005-12'),
  length: shown('NOA', 'DE-008-25'),
  width: shown('NOA', 'DE-008-13'),
  grossWeight: shown('NOA', 'DE-008-27'),
  netWeight: shown('NOA', 'DE-008-28'),
  dwt: shown('NOA', 'DE-008-29'),
};

/**
 * The elements Finland requires (hub/fi-required): the SID identity and the
 * eight SHP particulars. The per-call checklists count these; the send
 * carries every particular NEMOLink holds (spec 0083).
 */
export const FI_REQUIRED_SHIP_KEYS: ReadonlySet<string> = new Set([
  'name', 'imoNumber', 'mmsi', 'callSign',
  'ownerName', 'operatorName', 'iceClass', 'buildDate', 'keelLayingDate', 'inertGasSystem', 'mainEnginePower', 'openWaterSpeedMeasure',
]);

/** The NEMO ID column of the ledger: per key, the formality and the element id. */
export function shipFieldIds(): Record<string, { formality: ShipHomeFormality; de: string; sent: boolean }> {
  const out: Record<string, { formality: ShipHomeFormality; de: string; sent: boolean }> = {};
  for (const [key, home] of Object.entries(SHIP_FIELD_HOMES)) {
    out[key] = { formality: home.formality, de: home.de, sent: home.sent };
  }
  return out;
}

/** What the send reads: the To NEMO view of a ship (override ?? master, spec 0064). */
export interface ShipToSend {
  name: string | null;
  imoNumber: string | null;
  mmsi: string | null;
  callSign: string | null;
  particulars: ShipParticulars;
}

export interface ShipFieldPlan {
  key: string;
  formality: ShipHomeFormality;
  de: string;
  /** The value as the ship row carries it (the app formats it like the ledger). */
  value: unknown;
  /** Goes in this send. */
  sent: boolean;
}

export interface ShipFormalityPlan {
  /** Every field with a value, sent ones first. */
  fields: ShipFieldPlan[];
  /** The SID data section (`sid:SID`), or null with the reason. */
  sid: Record<string, unknown> | null;
  sidReason: string | null;
  /** The SHP data section (`shp:SHP`), or null with the reason. */
  shp: Record<string, unknown> | null;
  shpReason: string | null;
}

function present(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'object') return 'code' in (v as object) && typeof (v as { code?: unknown }).code === 'string';
  return true;
}

/** Our wire value → the MIG element value (spec 0036 shapes). */
function migValue(home: ShipFieldHome, value: unknown): unknown {
  switch (home.kind) {
    case 'measure':
      return { $: Number(value), '@unitCode': home.unit };
    case 'indicator':
      return value === true || value === 1 || value === '1' ? 1 : 0;
    case 'ice':
      return (value as { code: string }).code;
    default:
      return String(value);
  }
}

/** Sets a value under UsedLogisticsTransportMeans; '[0]' segments make one-item arrays. */
function setAt(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node: Record<string, unknown> = root;
  path.forEach((segment, i) => {
    const last = i === path.length - 1;
    const array = segment.endsWith('[0]');
    const key = array ? segment.slice(0, -3) : segment;
    if (last) {
      node[key] = value;
      return;
    }
    if (array) {
      const list = (node[key] as Record<string, unknown>[] | undefined) ?? [{}];
      node[key] = list;
      node = list[0]!;
    } else {
      const next = (node[key] as Record<string, unknown> | undefined) ?? {};
      node[key] = next;
      node = next;
    }
  });
}

/**
 * The ship name as NEMO takes it: upper case. NEMO answers a mixed-case SID
 * name ('Black Pearl') with ERR-027 "Roman characters and Arabic numerals,
 * SOLAS I/B/15" and accepts 'BLACK PEARL' (STG, 2026-10-06). NEMOLink keeps
 * the name as typed; only the wire value is upper-cased.
 */
export function nemoShipName(name: string): string {
  return name.trim().toUpperCase();
}

function valueOf(ship: ShipToSend, key: string): unknown {
  switch (key) {
    case 'name':
      return typeof ship.name === 'string' ? nemoShipName(ship.name) : ship.name;
    case 'imoNumber':
      return ship.imoNumber;
    case 'mmsi':
      return ship.mmsi;
    case 'callSign':
      return ship.callSign;
    default:
      return ship.particulars[key];
  }
}

/**
 * What a ship-data send would carry, and why a part would not go: the SID
 * needs the IMO number (spec 0062 F11: indicator + IMO); the SHP needs the
 * registered owner or the lessee name (NR-SHP-001) — with neither, NEMO
 * refuses it, so it is left out and said.
 */
export function planShipFormalities(ship: ShipToSend): ShipFormalityPlan {
  const fields: ShipFieldPlan[] = [];
  for (const [key, home] of Object.entries(SHIP_FIELD_HOMES)) {
    const value = valueOf(ship, key);
    if (!present(value)) continue;
    fields.push({ key, formality: home.formality, de: home.de, value, sent: home.sent });
  }
  fields.sort((a, b) => Number(b.sent) - Number(a.sent));

  // SID
  let sid: Record<string, unknown> | null = null;
  let sidReason: string | null = null;
  if (!present(ship.imoNumber)) {
    sidReason = 'The ship needs an IMO number before NEMO can identify it (DE-005-03)';
  } else {
    const means: Record<string, unknown> = { 'ram:IMONumberIndicator': 1 };
    for (const key of ['name', 'imoNumber', 'mmsi', 'callSign']) {
      const value = valueOf(ship, key);
      if (present(value)) setAt(means, SHIP_FIELD_HOMES[key]!.path!, migValue(SHIP_FIELD_HOMES[key]!, value));
    }
    sid = {
      'sid:SpecifiedLogisticsTransportMovement': { 'ram:UsedLogisticsTransportMeans': means },
    };
  }

  // SHP
  let shp: Record<string, unknown> | null = null;
  let shpReason: string | null = null;
  const shpKeys = Object.entries(SHIP_FIELD_HOMES)
    .filter(([, home]) => home.formality === 'SHP' && home.sent)
    .map(([key]) => key);
  // The satellite id and its provider are one element pair: both, or neither
  const satellitePair = present(valueOf(ship, 'satelliteId')) && present(valueOf(ship, 'satelliteProviderCode'));
  const filled = shpKeys.filter(
    (key) => present(valueOf(ship, key)) && (satellitePair || (key !== 'satelliteId' && key !== 'satelliteProviderCode')),
  );
  if (filled.length === 0) {
    shpReason = 'No ship particulars to send yet — fill the ones Finland requires';
  } else if (!present(ship.particulars['ownerName']) && !present(ship.particulars['operatorName'])) {
    shpReason =
      'NEMO wants the registered owner name or the lessee (operator) name in the ship data (NR-SHP-001)';
  } else {
    const means: Record<string, unknown> = {};
    for (const key of filled) {
      const home = SHIP_FIELD_HOMES[key]!;
      setAt(means, home.path!, migValue(home, valueOf(ship, key)));
    }
    shp = {
      'shp:SpecifiedLogisticsTransportMovement': { 'ram:UsedLogisticsTransportMeans': means },
    };
  }

  // Only what will go is marked sent for the reader.
  for (const f of fields) {
    if (f.formality === 'SHP' && !filled.includes(f.key)) f.sent = false;
    if (f.formality === 'SID' && !sid) f.sent = false;
    if (f.formality === 'SHP' && !shp) f.sent = false;
  }
  fields.sort((a, b) => Number(b.sent) - Number(a.sent));

  return { fields, sid, sidReason, shp, shpReason };
}

// ---- NEMO's answers ----------------------------------------------------------

export interface AckError {
  code: string | null;
  message: string | null;
  /** NEMO's JSONPath into the envelope (ram:TagID), when given. */
  path: string | null;
}

export interface ParsedAck {
  /** FRM ram:StatusCode: '1' accepted, '8' rejected (UN/EDIFACT 1373); null when not an FRM. */
  status: string | null;
  errors: AckError[];
  /** How many of `errors` the FRM itself reported — 0 with status 8 is a ship NEMO does not know (spec 0078). */
  frmErrors: number;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * A description in any of NEMO's shapes (spec 0078): one string; the live
 * list of three strings — Finnish, English, Swedish, in that order; or the
 * documented `{ $, @languageID }` items. English wherever it can be told.
 */
function englishOf(description: unknown): string | null {
  if (typeof description === 'string') return description;
  if (Array.isArray(description)) {
    if (description.length > 0 && description.every((d) => typeof d === 'string')) {
      const strings = description as string[];
      return strings[1] ?? strings[0] ?? null;
    }
    const items = description.map(asObject);
    const en = items.find((d) => String(d['@languageID'] ?? '').toLowerCase() === 'en') ?? items[0];
    return typeof en?.['$'] === 'string' ? (en['$'] as string) : null;
  }
  const one = asObject(description);
  return typeof one['$'] === 'string' ? (one['$'] as string) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * Reads the FRM acknowledgement (spec 0063 reply anatomy, completed by
 * 0078): a 2xx carries `env:Envelope` at the root, a 400 wraps it in
 * `frmResponse` beside the Declarant API's JSON error — `errorKey`,
 * `errorMessage` or `errorDescription` (fi, en, sv), `globalErrors`,
 * `fieldErrors[{ errorKey, errorMsg, paths }]` (the older `message` /
 * `field` names still read). The wrapper's field errors mirror the FRM's,
 * so they count only when the FRM reported none. Tolerant: anything else
 * yields status null and no errors.
 */
export function parseAck(body: unknown): ParsedAck {
  const root = asObject(body);
  const envelope = asObject(root['env:Envelope'] ?? asObject(root['frmResponse'])['env:Envelope']);
  const frm = asObject(asObject(envelope['frm:FRM'])['frm:AcknowledgementDocument']);
  const errors: AckError[] = [];
  const reported = frm['ram:ReferencedReportedError'];
  for (const item of Array.isArray(reported) ? reported : []) {
    const e = asObject(item);
    const pointers = e['ram:SpecifiedIdentifiedPointer'];
    const first = asObject(Array.isArray(pointers) ? pointers[0] : pointers);
    errors.push({
      code: str(e['ram:TypeCode']),
      message: englishOf(e['ram:Description']),
      path: str(first['ram:TagID']),
    });
  }
  const frmErrors = errors.length;
  const errorKey = str(root['errorKey']);
  const wrapperWords = str(root['errorMessage']) ?? str(root['message']) ?? englishOf(root['errorDescription']);
  if (errorKey || wrapperWords) {
    if (frmErrors === 0) {
      const fieldErrors = root['fieldErrors'];
      for (const item of Array.isArray(fieldErrors) ? fieldErrors : []) {
        const fe = asObject(item);
        const paths = Array.isArray(fe['paths']) ? fe['paths'].filter((p): p is string => typeof p === 'string') : [];
        errors.push({
          code: str(fe['errorKey']) ?? errorKey,
          message: str(fe['errorMsg']) ?? str(fe['message']),
          path: paths.length > 0 ? paths.join(', ') : str(fe['field']),
        });
      }
      const globals = root['globalErrors'];
      for (const item of Array.isArray(globals) ? globals : []) {
        if (typeof item === 'string') {
          errors.push({ code: errorKey, message: item, path: null });
        } else {
          const ge = asObject(item);
          errors.push({ code: str(ge['errorKey']) ?? errorKey, message: str(ge['errorMsg']) ?? str(ge['message']), path: null });
        }
      }
    }
    if (errors.length === 0) errors.push({ code: errorKey, message: wrapperWords, path: null });
  }
  const status = frm['ram:StatusCode'];
  return { status: typeof status === 'string' ? status : null, errors, frmErrors };
}

/** The document id our envelope carries (mai:ExchangedDocument/ram:ID). */
export function documentIdOf(envelope: Record<string, unknown>): string | null {
  const id = asObject(asObject(asObject(envelope['env:Envelope'])['mai:MAI'])['mai:ExchangedDocument'])['ram:ID'];
  return typeof id === 'string' ? id : null;
}
