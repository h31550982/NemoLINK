/**
 * The pre-arrival reports built from the call's NEMO tables (spec 0098):
 * CWA crew list, EFF crew effects, STA ship's stores, WAS waste, SEC
 * security. Each builder takes the merged table (spec 0096: every cell a
 * NEMO-ready value with its flag) and gives the data section, or what is
 * missing in words. Shapes: vendored MIG 2.0.1.0, checked against what
 * NEMO STG accepted (probe, visit -037-7, 2026-10-06).
 *
 * Personal data: the words name rows by number ("crew member 3"), never by
 * name — they reach the wizard and the logs. Pure: no IO.
 */

/** One cell of a merged table, as far as the builders read it. */
export interface TableCellLike {
  value: string | null;
  flag?: string;
}

/** A merged NEMO table (form-tables.ts MergedTable), as far as the builders read it. */
export interface TableLike {
  header: Record<string, TableCellLike>;
  rows: { key: string; cells: Record<string, TableCellLike>; items?: Record<string, TableCellLike>[] }[];
}

export type Built = { payload: Record<string, unknown> } | { missing: string[] };

/** A usable value: present and not an error the forms' checks raised. */
function val(cells: Record<string, TableCellLike> | undefined, key: string): string | null {
  const c = cells?.[key];
  if (!c || c.flag === 'error') return null;
  const v = typeof c.value === 'string' ? c.value.trim() : '';
  return v === '' ? null : v;
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const day = (v: string): string => v.slice(0, 10);

// ---- CWA: the crew list -------------------------------------------------------

/** NEMO's minimum per person (probe: no RoleCode → ERR-027). */
const CREW_REQUIRED: [string, string][] = [
  ['familyName', 'family name'],
  ['givenName', 'given name'],
  ['dateOfBirth', 'date of birth'],
  ['gender', 'gender'],
  ['nationality', 'nationality'],
  ['rank', 'rank or rating'],
];

/** The identity document goes whole or not at all — its four parts are one element in NEMO. */
const DOCUMENT_PARTS: [string, string][] = [
  ['documentType', 'identity document type'],
  ['documentNumber', 'identity document number'],
  ['documentIssuer', 'document issuing nation'],
  ['documentExpiry', 'document expiry date'],
];

export function buildCwaPayload(crew: TableLike | null): Built {
  const rows = crew?.rows ?? [];
  if (rows.length === 0) return { missing: ['the crew list (upload FAL 5 or the NSW crew list)'] };
  const missing: string[] = [];
  const persons = rows.map((row, i) => {
    const c = row.cells;
    const lacks = CREW_REQUIRED.filter(([k]) => !val(c, k)).map(([, words]) => words);
    const doc = DOCUMENT_PARTS.map(([k]) => val(c, k));
    const docGiven = doc.filter(Boolean).length;
    if (docGiven > 0 && docGiven < DOCUMENT_PARTS.length) {
      lacks.push(...DOCUMENT_PARTS.filter(([k]) => !val(c, k)).map(([, words]) => words));
    }
    if (lacks.length > 0) missing.push(`crew member ${i + 1}: ${lacks.join(', ')}`);
    const person: Record<string, unknown> = {
      'ram:SequenceNumeric': i + 1,
      'ram:FamilyName': val(c, 'familyName'),
      'ram:GivenName': val(c, 'givenName'),
      'ram:BirthDate': day(val(c, 'dateOfBirth') ?? ''),
      'ram:GenderCode': val(c, 'gender'),
      'ram:NationalityTradeCountry': [{ 'ram:AdditionalIdentificationID': val(c, 'nationality') }],
      'ram:RoleCode': val(c, 'rank'),
    };
    const place = val(c, 'placeOfBirth');
    if (place) person['ram:BirthplaceName'] = { $: place };
    const birthCountry = val(c, 'countryOfBirth');
    if (birthCountry) person['ram:BirthCountryID'] = birthCountry;
    if (docGiven === DOCUMENT_PARTS.length) {
      person['ram:TravelIdentityReferencedDocument'] = {
        'ram:TypeCode': val(c, 'documentType'),
        'ram:ID': val(c, 'documentNumber'),
        'ram:IssueLogisticsLocation': { 'ram:CountryID': val(c, 'documentIssuer') },
        'ram:EffectiveSpecifiedPeriod': { 'ram:EndDate': day(val(c, 'documentExpiry')!) },
      };
    }
    const permit = val(c, 'residencePermit');
    if (permit) person['ram:ResidencePermitReferencedDocument'] = { 'ram:ID': permit };
    const visa = val(c, 'visaNumber');
    if (visa) person['ram:TravelVisaReferencedDocument'] = { 'ram:ID': visa };
    return person;
  });
  if (missing.length > 0) return { missing };
  return { payload: { 'cwa:SpecifiedLogisticsTransportMovement': { 'ram:OnboardTransportPerson': persons } } };
}

// ---- EFF: the crew's effects ----------------------------------------------------

/**
 * The effects of the crew members who declared any (FAL 4); a member with
 * none is left out. No crew member with effects is not a gap: NEMO then has
 * nothing to take, and the wizard says so instead of building.
 */
export function buildEffPayload(crew: TableLike | null): Built {
  const rows = crew?.rows ?? [];
  const declaring = rows
    .map((row, i) => ({ row, n: i + 1 }))
    .filter(({ row }) => (row.items ?? []).some((it) => val(it, 'effectsType') || val(it, 'effectsDescription')));
  if (declaring.length === 0) return { missing: ['crew effects (upload FAL 4)'] };
  const missing: string[] = [];
  const persons = declaring.map(({ row, n }, seq) => {
    const c = row.cells;
    const lacks = [
      ['familyName', 'family name'],
      ['givenName', 'given name'],
      ['rank', 'rank or rating'],
    ]
      .filter(([k]) => !val(c, k!))
      .map(([, words]) => words!);
    const effects = (row.items ?? []).map((it, j) => {
      const type = val(it, 'effectsType');
      const qty = num(val(it, 'effectsQuantity'));
      const unit = val(it, 'effectsUnit');
      if (!type) lacks.push(`effects item ${j + 1} type`);
      const e: Record<string, unknown> = { 'ram:SequenceNumeric': j + 1, 'ram:TypeCode': type };
      const words = val(it, 'effectsDescription');
      if (words) e['ram:Description'] = { $: words };
      if (qty !== null && unit) e['ram:OnboardMeasure'] = { $: qty, '@unitCode': unit };
      else if (qty !== null || unit) lacks.push(`effects item ${j + 1} quantity and unit`);
      return e;
    });
    if (lacks.length > 0) missing.push(`crew member ${n}: ${lacks.join(', ')}`);
    return {
      'ram:SequenceNumeric': seq + 1,
      'ram:FamilyName': val(c, 'familyName'),
      'ram:GivenName': val(c, 'givenName'),
      'ram:RoleCode': val(c, 'rank'),
      'ram:DeclaredSpecifiedPersonalEffects': effects,
    };
  });
  if (missing.length > 0) return { missing };
  return { payload: { 'eff:SpecifiedLogisticsTransportMovement': { 'ram:OnboardTransportPerson': persons } } };
}

// ---- STA: the ship's stores -------------------------------------------------------

/**
 * The units NEMO accepts for each stores type — its own rule, word for word
 * in its ERR-027 refusal (STG, visit -044-5, 2026-10-06); the MIG schema
 * allows all five everywhere, so only this table catches it before NEMO.
 */
export const STORES_UNITS: Record<string, readonly string[]> = {
  'STO-001': ['LTR', 'NAR'], // alcoholic beverages
  'STO-002': ['LTR', 'NAR'], // beer
  'STO-003': ['LTR', 'NAR'], // wine
  'STO-004': ['NAR'], // cigarettes
  'STO-005': ['NAR'], // cigars
  'STO-006': ['KGM', 'NAR'], // nicotine products
  'STO-007': ['TNE', 'KGM', 'MTQ'], // other fuels
  'STO-008': ['TNE', 'KGM', 'MTQ'], // lubricants
  'STO-009': ['KGM', 'NAR'], // medicinal products
  'STO-010': ['KGM', 'NAR'], // meat and meat products
  'STO-011': ['NAR'], // firearms
  'STO-012': ['NAR'], // ammunition
  'STO-013': ['LTR', 'NAR'], // other substances containing alcohol
  'STO-014': ['TNE', 'KGM', 'MTQ'], // fuel oil
  'STO-015': ['TNE', 'KGM', 'MTQ'], // gas oil
  'STO-099': ['KGM', 'TNE', 'MTQ', 'LTR', 'NAR'], // other
};

/** Exact conversions only: the same amount in the unit NEMO takes (litres ↔ m³, tonnes ↔ kg). */
const EXACT: Record<string, Record<string, number>> = {
  LTR: { MTQ: 0.001 },
  MTQ: { LTR: 1000 },
  TNE: { KGM: 1000 },
  KGM: { TNE: 0.001 },
};

/** The quantity in a unit NEMO accepts for the type, converted exactly when needed; null when none fits. */
export function storesQuantity(type: string, qty: number, unit: string): { qty: number; unit: string } | null {
  const allowed = STORES_UNITS[type];
  if (!allowed || allowed.includes(unit)) return { qty, unit };
  for (const [to, factor] of Object.entries(EXACT[unit] ?? {})) {
    // Rounded to the micro-unit: 48 LTR is 0.048 MTQ, not 0.048000000000000001
    if (allowed.includes(to)) return { qty: Math.round(qty * factor * 1e6) / 1e6, unit: to };
  }
  return null;
}

export function buildStaPayload(stores: TableLike | null): Built {
  const rows = stores?.rows ?? [];
  if (rows.length === 0) return { missing: ['the ship’s stores (upload FAL 3)'] };
  const missing: string[] = [];
  const items = rows.map((row, i) => {
    const c = row.cells;
    const type = val(c, 'article');
    const qty = num(val(c, 'quantity'));
    const unit = val(c, 'unit');
    const lacks: string[] = [!type && 'article code', qty === null && 'quantity', !unit && 'unit'].filter((x): x is string => !!x);
    const measure = type && qty !== null && unit ? storesQuantity(type, qty, unit) : null;
    if (type && qty !== null && unit && !measure) {
      lacks.push(`unit ${unit} is not accepted for ${type} — NEMO takes ${STORES_UNITS[type]!.join(' or ')}`);
    }
    if (lacks.length > 0) missing.push(`article ${i + 1}: ${lacks.join(', ')}`);
    const item: Record<string, unknown> = {
      'ram:SequenceNumeric': i + 1,
      'ram:TypeCode': type,
      'ram:OnboardMeasure': { $: measure?.qty ?? qty, '@unitCode': measure?.unit ?? unit },
    };
    const words = val(c, 'articleName');
    if (words) item['ram:Description'] = { $: words };
    const where = val(c, 'location');
    if (where) item['ram:SpecifiedLogisticsLocation'] = { 'ram:Name': { $: where } };
    return item;
  });
  if (missing.length > 0) return { missing };
  return { payload: { 'sta:SpecifiedLogisticsTransportMovement': { 'ram:OnboardStoresItemInventory': items } } };
}

// ---- WAS: the waste notification ----------------------------------------------------

/** The four quantities NEMO needs for every waste type that is listed (m³). */
const WASTE_MEASURES: [string, string, string][] = [
  ['toDeliver', 'ram:PlannedDischargedMeasure', 'to be delivered'],
  ['capacity', 'ram:MaximumDedicatedStorageCapacityMeasure', 'storage capacity'],
  ['retained', 'ram:RetainedMeasure', 'retained'],
  ['generated', 'ram:EstimatedGeneratedMeasure', 'estimated generated'],
];

/**
 * The waste types the ship gave any figure for (the table lists all of
 * them, spec 0096); a listed type needs all four quantities — an empty
 * one is 0 only when the ship wrote 0.
 */
export function buildWasPayload(waste: TableLike | null): Built {
  const given = (waste?.rows ?? []).filter((r) => WASTE_MEASURES.some(([k]) => val(r.cells, k) !== null));
  const h = waste?.header ?? {};
  const missing: string[] = [];
  if (!val(h, 'lastDeliveryDate')) missing.push('last waste delivery date');
  if (!val(h, 'lastDeliveryPort')) missing.push('port of last waste delivery');
  if (given.length === 0) missing.push('the waste figures (upload the NSW waste form)');
  const components = given.map((row, i) => {
    const c = row.cells;
    const lacks = WASTE_MEASURES.filter(([k]) => num(val(c, k)) === null).map(([, , words]) => words);
    if (lacks.length > 0) missing.push(`waste ${row.key}: ${lacks.join(', ')}`);
    const component: Record<string, unknown> = { 'ram:SequenceNumeric': i + 1, 'ram:TypeCode': row.key };
    for (const [k, el] of WASTE_MEASURES) component[el] = { $: num(val(c, k)), '@unitCode': 'MTQ' };
    const words = val(c, 'description');
    if (words) component['ram:Description'] = { $: words };
    const rest = val(c, 'remainderPort');
    if (rest) component['ram:RemainingDeliveryTransportEvent'] = { 'ram:OccurrenceLogisticsLocation': { 'ram:ID': rest } };
    return component;
  });
  if (missing.length > 0) return { missing };
  const material: Record<string, unknown> = {
    'ram:PreviousDeliveryTransportEvent': {
      'ram:ActualOccurrenceDate': day(val(h, 'lastDeliveryDate')!),
      'ram:OccurrenceLogisticsLocation': { 'ram:ID': val(h, 'lastDeliveryPort') },
    },
  };
  const next = val(h, 'nextDeliveryPort');
  if (next) material['ram:NextDeliveryTransportEvent'] = { 'ram:OccurrenceLogisticsLocation': { 'ram:ID': next } };
  material['ram:IncludedTransportationWasteMaterialComponent'] = components;
  return { payload: { 'was:SpecifiedLogisticsTransportMovement': { 'ram:ReportedTransportationWasteMaterial': material } } };
}

// ---- SEC: the security notification ----------------------------------------------------

/**
 * `facility` is the GISIS code of the port area the NOA names (spec 0051
 * data) — NEMO refuses another facility of the same port (ERR-010, probe).
 * The approved security plan on board follows the valid ISSC: an ISSC is
 * issued only after the approved plan is verified (ISPS Code A/19.1).
 */
export function buildSecPayload(security: TableLike | null, facility: string | null): Built {
  const h = security?.header ?? {};
  const missing: string[] = [];
  if (!facility) missing.push('the port facility (GISIS code) of the NOA’s port area');
  const level = val(h, 'securityLevel');
  if (!level) missing.push('ship current security level');
  const issc = val(h, 'validIssc');
  const isscValid = issc === null ? null : /^(1|y|yes|true|kyllä|kylla|valid|x)$/i.test(issc) ? 1 : /^(0|n|no|false|ei)$/i.test(issc) ? 0 : null;
  if (isscValid === null) missing.push('valid ISSC on board (yes or no)');
  for (const [k, words] of [
    ['csoFamilyName', 'CSO family name'],
    ['csoGivenName', 'CSO given name'],
  ] as const) {
    if (!val(h, k)) missing.push(words);
  }
  if (!val(h, 'csoEmail') && !val(h, 'csoMobile')) missing.push('CSO e-mail or mobile number');
  const rows = security?.rows ?? [];
  const stops = rows.map((row, i) => {
    const c = row.cells;
    const lacks = [
      ['port', 'port'],
      ['facility', 'port facility'],
      ['start', 'start date'],
      ['end', 'end date'],
      ['level', 'security level'],
    ]
      .filter(([k]) => !val(c, k!))
      .map(([, words]) => words);
    if (lacks.length > 0) missing.push(`previous call ${i + 1}: ${lacks.join(', ')}`);
    const stop: Record<string, unknown> = {
      // The previous calls count back from this one: -1 is the latest
      'ram:SequenceNumeric': -(i + 1),
      'ram:SecurityLevelCode': val(c, 'level'),
      'ram:OccurrenceLogisticsLocation': { 'ram:ID': val(c, 'port'), 'ram:FacilityReferencedLocation': { 'ram:ID': val(c, 'facility') } },
      'ram:ConveyanceFacilityRelatedLogisticsLocation': {
        'ram:StaySpecifiedPeriod': { 'ram:StartDate': day(val(c, 'start') ?? ''), 'ram:EndDate': day(val(c, 'end') ?? '') },
      },
    };
    const measures = val(c, 'measures');
    if (measures) stop['ram:AdditionalSecurityMeasuresApplicableNote'] = [{ 'ram:Content': measures }];
    return stop;
  });
  if (missing.length > 0) return { missing };

  const cso: Record<string, unknown> = { 'ram:FamilyName': val(h, 'csoFamilyName'), 'ram:GivenName': val(h, 'csoGivenName') };
  if (val(h, 'csoMobile')) cso['ram:MobileTelephoneUniversalCommunication'] = { 'ram:CompleteNumber': val(h, 'csoMobile') };
  if (val(h, 'csoEmail')) cso['ram:EmailURIUniversalCommunication'] = { 'ram:URIID': val(h, 'csoEmail') };
  const certificate: Record<string, unknown> = { 'ram:ValidIndicator': isscValid };
  if (val(h, 'isscType')) certificate['ram:TypeCode'] = val(h, 'isscType');
  if (val(h, 'isscExpiry')) certificate['ram:ExpiryDate'] = day(val(h, 'isscExpiry')!);
  if (val(h, 'rsoName')) certificate['ram:IssuerTradeParty'] = { 'ram:SpecifiedLegalOrganization': { 'ram:Name': val(h, 'rsoName') } };

  const call: Record<string, unknown> = {
    'ram:OccurrenceLogisticsLocation': { 'ram:FacilityReferencedLocation': { 'ram:ID': facility } },
  };
  const gap = val(h, 'missingCalls');
  if (gap) call['ram:LastTenFacilityLocationsNotReportedReason'] = { $: gap };
  const movement: Record<string, unknown> = { 'ram:CallTransportEvent': call };
  if (stops.length > 0) movement['ram:ItineraryTransportRoute'] = { 'ram:ItineraryStopTransportEvent': stops };
  movement['ram:UsedLogisticsTransportMeans'] = {
    'ram:ApprovedSecurityPlanOnboardIndicator': isscValid,
    'ram:ISPSSecurityLevelCode': level,
    'ram:CompanySecurityOfficerTransportPerson': cso,
    'ram:MaritimeApplicableISSCCertificate': certificate,
  };
  return { payload: { 'sec:SpecifiedLogisticsTransportMovement': movement } };
}
