/**
 * NEMO's own tables (docs/specs/0096): the ship's uploaded forms merged into
 * the tables NEMO — and the National Spreadsheet — ask for, every column,
 * whether a form filled it or not. Crew and effects from the NSW crew list,
 * FAL 5 and FAL 4 become one crew table; stores from FAL 3; the 25 waste
 * types from the NSW waste form; the last ten calls from the NSW security
 * form.
 *
 * Every cell remembers where it came from (document + path), so it reuses
 * that form's checks (codes, units, ports, GISIS, dates — form-checks.ts)
 * rather than checking twice, and a correction goes back to that form. On
 * top the tables add what only they can see: a required column nothing
 * filled (*missing*, a warning — 0096 decision 3) and two forms that
 * disagree (*conflict*). Pure: no IO.
 */

import { CheckAnnotation, formValues, readLooseDate, slashOrderOf } from './form-checks';
import { CodeBook, LISTS, normText, readQuantity, resolveCode, splitEffects } from './form-codes';
import type { FormType, ParsedForm } from './form-parser';
import { DOCUMENT_PARTS, STORES_UNITS, storesQuantity } from '../../canonical/pre-arrival-formalities';

// ---- the tables' columns ----------------------------------------------------

export type ColumnKind = 'text' | 'date' | 'code' | 'number' | 'unit' | 'locode' | 'facility' | 'yesno';

export interface ColumnDef {
  key: string;
  /** The NEMO data element, as the National Spreadsheet heads the column. */
  de: string | null;
  label: string;
  kind: ColumnKind;
  /** The NEMO code list a `code` column resolves against. */
  list?: string;
  /** The FI profile requires it: empty is flagged *missing* (a warning). */
  required?: boolean;
  /** Personal data: logged as `[personal data]`, never verbatim. */
  personal?: boolean;
}

export type TableKey = 'crew' | 'passengers' | 'cargo' | 'stores' | 'waste' | 'security' | 'health';

export interface TableDef {
  key: TableKey;
  label: string;
  /** The National Spreadsheet sheet this table is. */
  sheet: string;
  /** What one row is: "crew members", "waste types". */
  rowNoun: string;
  fields: ColumnDef[];
  columns: ColumnDef[];
  /** Forms that feed it. */
  sources: FormType[];
}

const P = { personal: true } as const;
const R = { required: true } as const;

export const TABLES: TableDef[] = [
  {
    key: 'crew',
    label: 'Crew and effects',
    sheet: 'Crew list and crew’s effects',
    rowNoun: 'crew members',
    fields: [],
    columns: [
      { key: 'familyName', de: 'DE-035-02', label: 'Family name', kind: 'text', ...R, ...P },
      { key: 'givenName', de: 'DE-035-03', label: 'Given name', kind: 'text', ...R, ...P },
      { key: 'rank', de: 'DE-035-14', label: 'Rank or rating', kind: 'code', list: LISTS.crewRank, ...R },
      { key: 'nationality', de: 'DE-035-04', label: 'Nationality', kind: 'code', list: LISTS.nationality, ...R, ...P },
      { key: 'dateOfBirth', de: 'DE-035-05', label: 'Date of birth', kind: 'date', ...R, ...P },
      { key: 'placeOfBirth', de: 'DE-035-06', label: 'Place of birth', kind: 'text', ...P },
      { key: 'countryOfBirth', de: 'DE-035-07', label: 'Country of birth', kind: 'code', list: LISTS.country, ...P },
      { key: 'gender', de: 'DE-035-08', label: 'Gender', kind: 'code', list: LISTS.gender, ...R, ...P },
      { key: 'documentType', de: 'DE-035-16', label: 'Identity document type', kind: 'code', list: LISTS.identityDocument, ...P },
      { key: 'documentNumber', de: 'DE-035-17', label: 'Identity document number', kind: 'text', ...P },
      { key: 'documentIssuer', de: 'DE-035-18', label: 'Document issuing nation', kind: 'code', list: 'iso3166_1_alpha_2_unedifact3207', ...P },
      { key: 'documentExpiry', de: 'DE-035-22', label: 'Document expiry date', kind: 'date', ...P },
      { key: 'residencePermit', de: 'DE-039-09', label: 'Residence permit number', kind: 'text', ...P },
      { key: 'visaNumber', de: 'DE-039-10', label: 'Visa number', kind: 'text', ...P },
      { key: 'effectsType', de: 'DE-036-02', label: 'Crew effects type', kind: 'code', list: LISTS.crewEffects, ...P },
      { key: 'effectsDescription', de: 'DE-036-01', label: 'Crew effects description', kind: 'text', ...P },
      { key: 'effectsQuantity', de: 'DE-036-03', label: 'Crew effects quantity', kind: 'number', ...P },
      { key: 'effectsUnit', de: null, label: 'Unit', kind: 'unit', ...P },
    ],
    sources: ['nsw-crew', 'fal5', 'fal4'],
  },
  {
    key: 'passengers',
    label: 'Passengers',
    sheet: 'Passenger list',
    rowNoun: 'passengers',
    fields: [],
    columns: [
      { key: 'personType', de: 'DE-035-01', label: 'Person type', kind: 'code', list: 'un_edifact_3035', ...R },
      { key: 'familyName', de: 'DE-035-02', label: 'Family name', kind: 'text', ...R, ...P },
      { key: 'givenName', de: 'DE-035-03', label: 'Given name', kind: 'text', ...R, ...P },
      { key: 'nationality', de: 'DE-035-04', label: 'Nationality', kind: 'code', list: LISTS.nationality, ...R, ...P },
      { key: 'dateOfBirth', de: 'DE-035-05', label: 'Date of birth', kind: 'date', ...R, ...P },
      { key: 'placeOfBirth', de: 'DE-035-06', label: 'Place of birth', kind: 'text', ...P },
      { key: 'countryOfBirth', de: 'DE-035-07', label: 'Country of birth', kind: 'code', list: LISTS.country, ...R, ...P },
      { key: 'gender', de: 'DE-035-08', label: 'Gender', kind: 'code', list: LISTS.gender, ...R, ...P },
      { key: 'embarkationPort', de: 'DE-035-09', label: 'Port of embarkation', kind: 'locode', ...R },
      { key: 'disembarkationPort', de: 'DE-035-11', label: 'Port of disembarkation', kind: 'locode', ...R },
      { key: 'inTransit', de: 'DE-035-13', label: 'In transit', kind: 'yesno' },
      { key: 'documentType', de: 'DE-035-16', label: 'Identity document type', kind: 'code', list: LISTS.identityDocument, ...R, ...P },
      { key: 'documentNumber', de: 'DE-035-17', label: 'Identity document number', kind: 'text', ...R, ...P },
      { key: 'documentExpiry', de: 'DE-035-22', label: 'Document expiry date', kind: 'date', ...R, ...P },
      { key: 'documentIssuer', de: 'DE-035-18', label: 'Document issuing nation', kind: 'code', list: 'iso3166_1_alpha_2_unedifact3207', ...R, ...P },
      { key: 'residencePermit', de: 'DE-039-09', label: 'Residence permit number', kind: 'text', ...P },
      { key: 'visaNumber', de: 'DE-039-10', label: 'Visa number', kind: 'text', ...P },
      { key: 'specialCare', de: 'DE-035-25', label: 'Special care or assistance', kind: 'text', ...P },
      { key: 'emergencyContact', de: 'DE-035-29', label: 'Emergency contact number', kind: 'text', ...P },
    ],
    sources: ['nsw-pax', 'fal6'],
  },
  {
    key: 'cargo',
    label: 'Cargo',
    sheet: 'General cargo declaration',
    rowNoun: 'cargo items',
    fields: [],
    columns: [
      { key: 'description', de: 'DE-048-04', label: 'Description of goods', kind: 'text', ...R },
      { key: 'hsCode', de: 'DE-048-05', label: 'HS code', kind: 'text', ...R },
      { key: 'grossWeight', de: 'DE-048-03', label: 'Gross weight (kg)', kind: 'number', ...R },
      { key: 'loadingPort', de: 'DE-047-01', label: 'Port of loading', kind: 'locode', ...R },
      { key: 'dischargePort', de: 'DE-047-04', label: 'Port of discharge', kind: 'locode', ...R },
      { key: 'blNumber', de: null, label: 'Bill of lading', kind: 'text' },
      { key: 'marksAndNumbers', de: null, label: 'Marks and numbers', kind: 'text' },
      { key: 'packages', de: null, label: 'Packages', kind: 'text' },
      { key: 'measurement', de: null, label: 'Measurement (m³)', kind: 'number' },
    ],
    sources: ['fal2'],
  },
  {
    key: 'stores',
    label: 'Stores',
    sheet: 'Ship’s stores',
    rowNoun: 'store articles',
    fields: [],
    columns: [
      { key: 'article', de: 'DE-067-02', label: 'Ship stores article', kind: 'code', list: LISTS.storesArticle, ...R },
      { key: 'articleName', de: 'DE-067-01', label: 'Article name', kind: 'text' },
      { key: 'quantity', de: 'DE-067-03', label: 'Quantity on board', kind: 'number', ...R },
      { key: 'unit', de: 'DE-001-01', label: 'Unit', kind: 'unit', ...R },
      { key: 'location', de: 'DE-067-04', label: 'Location on board', kind: 'text' },
    ],
    sources: ['fal3'],
  },
  {
    key: 'waste',
    label: 'Waste',
    sheet: 'Waste notification',
    rowNoun: 'waste types',
    fields: [
      { key: 'remarks', de: 'DE-003-01', label: 'Remarks', kind: 'text' },
      { key: 'lastDeliveryDate', de: 'DE-068-03', label: 'Last waste delivery date', kind: 'date', ...R },
      { key: 'lastDeliveryPort', de: 'DE-068-01', label: 'Port of last waste delivery', kind: 'locode', ...R },
      { key: 'nextDeliveryPort', de: 'DE-068-02', label: 'Port of next waste delivery', kind: 'locode' },
    ],
    columns: [
      { key: 'description', de: 'DE-071-02', label: 'Waste description', kind: 'text' },
      { key: 'toDeliver', de: 'DE-071-03', label: 'To be delivered (m³)', kind: 'number' },
      { key: 'capacity', de: 'DE-071-04', label: 'Max. storage capacity (m³)', kind: 'number' },
      { key: 'retained', de: 'DE-071-05', label: 'Retained (m³)', kind: 'number' },
      { key: 'remainderPort', de: 'DE-071-06', label: 'Port of delivery of the rest', kind: 'locode' },
      { key: 'generated', de: 'DE-071-07', label: 'Estimated generated (m³)', kind: 'number' },
    ],
    sources: ['nsw-waste'],
  },
  {
    key: 'security',
    label: 'Security',
    sheet: 'Security notification',
    rowNoun: 'port facility calls',
    fields: [
      { key: 'securityLevel', de: 'DE-005-18', label: 'Ship current security level', kind: 'code', list: LISTS.securityLevel, ...R },
      { key: 'validIssc', de: 'DE-005-17', label: 'Valid ISSC on board', kind: 'text', ...R },
      { key: 'isscExpiry', de: 'DE-030-06', label: 'ISSC expiry date', kind: 'date' },
      { key: 'isscType', de: 'DE-030-07', label: 'ISSC type', kind: 'code', list: 'issc_type' },
      { key: 'rsoName', de: 'DE-030-05', label: 'RSO name', kind: 'text' },
      { key: 'csoGivenName', de: 'DE-031-07', label: 'CSO given name', kind: 'text', ...R, ...P },
      { key: 'csoFamilyName', de: 'DE-031-01', label: 'CSO family name', kind: 'text', ...R, ...P },
      { key: 'csoMobile', de: 'DE-031-03', label: 'CSO mobile number', kind: 'text', ...P },
      { key: 'csoEmail', de: 'DE-031-04', label: 'CSO e-mail', kind: 'text', ...P },
      { key: 'otherMatters', de: 'DE-014-08', label: 'Other security matters', kind: 'text' },
      { key: 'missingCalls', de: 'DE-014-43', label: 'Missing previous calls justification', kind: 'text' },
    ],
    columns: [
      { key: 'start', de: 'DE-023-04', label: 'Call start date', kind: 'date', ...R },
      { key: 'end', de: 'DE-023-05', label: 'Call end date', kind: 'date', ...R },
      { key: 'port', de: 'DE-023-01', label: 'Port of call', kind: 'locode', ...R },
      { key: 'facility', de: 'DE-023-02', label: 'Port facility', kind: 'facility', ...R },
      { key: 'level', de: 'DE-023-03', label: 'Security level', kind: 'code', list: LISTS.securityLevel, ...R },
      { key: 'measures', de: 'DE-023-06', label: 'Additional security measures', kind: 'text' },
    ],
    sources: ['nsw-security'],
  },
  {
    key: 'health',
    label: 'Health',
    sheet: 'Maritime declaration of health',
    rowNoun: 'sanitary measures',
    fields: [
      { key: 'remarks', de: 'DE-003-01', label: 'Remarks', kind: 'text' },
      { key: 'stowaways', de: 'DE-034-04', label: 'Stowaways found', kind: 'yesno', ...R },
      { key: 'stowawayPort', de: 'DE-042-04', label: 'Port where stowaways boarded', kind: 'locode' },
      { key: 'sanitationValid', de: 'DE-033-01', label: 'Valid sanitation control (exemption) certificate', kind: 'yesno', ...R },
      { key: 'reinspection', de: 'DE-033-04', label: 'Re-inspection required', kind: 'yesno' },
      { key: 'sanitationDate', de: 'DE-033-03', label: 'Certificate date of issue', kind: 'date' },
      { key: 'sanitationPort', de: 'DE-033-02', label: 'Certificate port of issue', kind: 'locode' },
      { key: 'infectedArea', de: 'DE-032-01', label: 'Visited an infected area', kind: 'yesno', ...R },
      { key: 'infectedDate', de: 'DE-032-03', label: 'Date of the visit', kind: 'date' },
      { key: 'infectedPort', de: 'DE-032-02', label: 'Port in the affected area', kind: 'locode' },
      { key: 'personDied', de: 'DE-032-04', label: 'Person died on board', kind: 'yesno', ...R },
      { key: 'deathCount', de: 'DE-032-17', label: 'Number of dead persons', kind: 'number' },
      { key: 'disease', de: 'DE-032-05', label: 'Case of infectious disease', kind: 'yesno', ...R },
      { key: 'illGreater', de: 'DE-032-06', label: 'Ill persons more than expected', kind: 'yesno', ...R },
      { key: 'illCount', de: 'DE-032-12', label: 'Number of ill persons', kind: 'number' },
      { key: 'illNow', de: 'DE-032-07', label: 'Ill persons on board now', kind: 'yesno', ...R },
      { key: 'practitioner', de: 'DE-032-08', label: 'Medical practitioner consulted', kind: 'yesno', ...R },
      { key: 'infection', de: 'DE-032-09', label: 'Condition that may spread infection', kind: 'yesno', ...R },
      { key: 'sanitaryMeasure', de: 'DE-032-10', label: 'Sanitary measure applied on board', kind: 'yesno', ...R },
      { key: 'sanitaryDetails', de: 'DE-032-13', label: 'Sanitary measure description', kind: 'text' },
      { key: 'sickAnimal', de: 'DE-032-11', label: 'Sick animal on board', kind: 'yesno', ...R },
    ],
    columns: [],
    sources: ['nmsw-mdh'],
  },
];

/** The column a table and key name — header field or table column. */
export function columnOf(table: TableKey, key: string): ColumnDef | null {
  const def = TABLES.find((t) => t.key === table);
  return def ? ([...def.fields, ...def.columns].find((c) => c.key === key) ?? null) : null;
}

/**
 * What a typed value becomes, or why it cannot be one (spec 0096): codes
 * must be codes of the column's list (picked, never guessed), dates must
 * read, numbers must be numbers, ports five-letter codes.
 */
export function entryValue(def: ColumnDef, raw: string, book: CodeBook): { value: string } | { problem: string } {
  const text = raw.trim();
  if (text === '') return { problem: 'empty — remove the entry instead' };
  if (def.key === 'hsCode' && !/^\d{6}$/.test(text)) return { problem: 'write a six-digit HS code' };
  switch (def.kind) {
    case 'code': {
      const res = resolveCode(text, def.list!, book);
      return res.code !== null && res.how === 'code' ? { value: res.code } : { problem: `pick a ${def.label.toLowerCase()} from the NEMO list` };
    }
    case 'date': {
      const read = readLooseDate(text);
      return 'iso' in read ? { value: read.iso } : { problem: read.problem };
    }
    case 'number': {
      const n = Number(text.replace(/\s/g, '').replace(',', '.'));
      if (def.key === 'grossWeight' && (!Number.isFinite(n) || n <= 0)) return { problem: 'write a weight greater than 0 kg' };
      return Number.isFinite(n) && n >= 0 ? { value: String(n) } : { problem: 'write a number, e.g. 0.5' };
    }
    case 'yesno': {
      const yes = readYesNo(text);
      return yes === null ? { problem: 'yes or no' } : { value: yes };
    }
    case 'unit':
      return ['KGM', 'LTR', 'MTQ', 'NAR', 'TNE'].includes(text.toUpperCase())
        ? { value: text.toUpperCase() }
        : { problem: 'pick KGM, LTR, MTQ, NAR or TNE' };
    case 'locode':
      return /^[A-Z]{2}[A-Z2-9]{3}$/.test(text.toUpperCase()) ? { value: text.toUpperCase() } : { problem: 'a five-letter port code, e.g. FIRAU' };
    default:
      return { value: text.slice(0, 200) };
  }
}

// ---- what a table cell carries ------------------------------------------------

export interface CellSource {
  docId: string;
  fileName: string;
  formName: string;
  /** The form's value this cell came from — corrections go there (0051). */
  path: string;
}

export type CellFlag = 'error' | 'warning' | 'missing' | 'conflict';

export interface TableCell {
  /** The value as NEMO gets it written: a code, a number, a date, words. */
  value: string | null;
  /** NEMO's reading beside it: "10110 — Chief Mate …", "MTQ". */
  reading?: string;
  flag?: CellFlag;
  message?: string;
  source?: CellSource;
  /** Other forms' different values for the same cell (a conflict). */
  others?: { value: string; fileName: string }[];
  /** Typed in NEMOLink (spec 0096 decision 2): wins over the forms. */
  entered?: { author: string; at: string };
  /** Not from a form: the system that gave it, in words ("opsdesk voyage plan"). */
  origin?: string;
}

/** One value typed into a table (call_form_entry). */
export interface TableEntry {
  table: TableKey;
  rowKey: string;
  column: string;
  value: string;
  author: string;
  at: string;
}

export const HEADER_ROW = '_';

export interface TableRow {
  key: string;
  /** Who or what the row is: "SPARROW, JACK", "101 Oily bilge water". */
  label: string;
  cells: Record<string, TableCell>;
  /** Crew effects: one entry per item (the NS sheet holds one). */
  items?: Record<string, TableCell>[];
}

export interface MergedTable {
  key: TableKey;
  label: string;
  sheet: string;
  rowNoun: string;
  fields: ColumnDef[];
  columns: ColumnDef[];
  header: Record<string, TableCell>;
  rows: TableRow[];
  /** The forms that fed it. */
  sources: { docId: string; fileName: string; formName: string }[];
  /** What else fed it, in words: the chartering system's previous ports. */
  origins?: string[];
  counts: { error: number; warning: number; missing: number; conflict: number };
}

/** One uploaded, parsed form: corrections applied, checks run. */
export interface SourceDoc {
  id: string;
  fileName: string;
  created: string;
  form: ParsedForm;
  annotations: Record<string, CheckAnnotation>;
}

// ---- adapters: a form's values → table values with provenance ----------------

interface Found {
  value: string;
  path: string;
  /** The reading the form's own check gave, when it applies to this column. */
  reading?: string;
  /** A composite source cell ("1970-06-09, Tortuga") — no reading taken over. */
  part?: boolean;
}

interface Contribution {
  rowKey: string;
  label: string;
  values: Record<string, Found>;
  items?: Record<string, Found>[];
}

const personKey = (family: string, given: string) => `${normText(family)}|${normText(given)}`;

/** "SPARROW, JACK" → family, given. */
function splitName(name: string): [string, string] {
  const [family, ...rest] = name.split(',');
  return [family!.trim(), rest.join(',').trim()];
}

/** "1970-06-09, Tortuga" → date, place. */
function splitBirth(text: string): [string, string] {
  const m = /^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})\s*[,;]?\s*(.*)$/.exec(text);
  return m ? [m[1]!, m[2]!.trim()] : ['', text.trim()];
}

/** "Passport 548201937" → type words, number. */
function splitDocument(text: string): [string, string] {
  const m = /^\s*(.*?)\s*([A-Z0-9]*\d[A-Z0-9]*)\s*$/i.exec(text);
  return m && m[2] ? [m[1]!, m[2]] : ['', text.trim()];
}

function crewRows(doc: SourceDoc): Contribution[] {
  const rows = doc.form.rows ?? [];
  const put = (values: Record<string, Found>, key: string, value: string | undefined, path: string, part = false) => {
    if (value && value.trim() !== '') values[key] = { value: value.trim(), path, part };
  };
  return rows.flatMap((row, i): Contribution[] => {
    const at = (key: string) => `rows.${i}.${key}`;
    const values: Record<string, Found> = {};
    let family = '';
    let given = '';
    if (doc.form.formType === 'nsw-crew') {
      family = row['lastName'] ?? '';
      given = row['firstName'] ?? '';
      put(values, 'familyName', family, at('lastName'));
      put(values, 'givenName', given, at('firstName'));
      put(values, 'rank', row['rank'], at('rank'));
      put(values, 'nationality', row['nationality'], at('nationality'));
      put(values, 'dateOfBirth', row['dateOfBirth'], at('dateOfBirth'));
      put(values, 'placeOfBirth', row['placeOfBirth'], at('placeOfBirth'));
      put(values, 'gender', row['gender'], at('gender'));
      put(values, 'documentType', row['idDocumentNature'], at('idDocumentNature'));
      put(values, 'documentNumber', row['idDocumentNumber'], at('idDocumentNumber'));
      const permit = /^rp\b|residence/i.test(row['visaType'] ?? '');
      put(values, permit ? 'residencePermit' : 'visaNumber', row['visaNumber'], at('visaNumber'));
    } else {
      [family, given] = splitName(row['name'] ?? '');
      put(values, 'familyName', family, at('name'), true);
      put(values, 'givenName', given, at('name'), true);
      put(values, 'rank', row['rank'], at('rank'));
      if (doc.form.formType === 'fal5') {
        put(values, 'nationality', row['nationality'], at('nationality'));
        const [dob, place] = splitBirth(row['dateAndPlaceOfBirth'] ?? '');
        put(values, 'dateOfBirth', dob, at('dateAndPlaceOfBirth'), true);
        put(values, 'placeOfBirth', place, at('dateAndPlaceOfBirth'), true);
        const [type, number] = splitDocument(row['idDocument'] ?? '');
        put(values, 'documentType', type, at('idDocument'), true);
        put(values, 'documentNumber', number, at('idDocument'), true);
      }
    }
    if (!family && !given) return [];
    const contribution: Contribution = { rowKey: personKey(family, given), label: [family, given].filter(Boolean).join(', '), values };
    if (doc.form.formType === 'fal4' && row['effects']) {
      const ann = doc.annotations[at('effects')];
      const parts = splitEffects(row['effects']);
      contribution.items = parts.map((item, n) => {
        const checked = ann?.items?.[n];
        const q = item.quantity ? readQuantity(item.quantity) : null;
        const out: Record<string, Found> = {};
        const path = at('effects');
        out['effectsDescription'] = { value: item.article.replace(/^[A-Z]{3}-\d{3}\s+/, ''), path, part: true };
        out['effectsType'] = { value: checked?.code ?? item.article, path, part: true, ...(checked?.code ? { reading: checked.code } : {}) };
        if (q && !('problem' in q)) {
          out['effectsQuantity'] = { value: String(q.amount), path, part: true };
          out['effectsUnit'] = { value: q.unit, path, part: true };
        } else if (item.quantity) {
          out['effectsQuantity'] = { value: item.quantity, path, part: true };
        }
        return out;
      });
      if (/^(nil|none|-+|n\/a)$/i.test(row['effects'].trim())) contribution.items = [];
    }
    return [contribution];
  });
}

function cargoRows(doc: SourceDoc): Contribution[] {
  return (doc.form.rows ?? []).map((row, i) => {
    const values: Record<string, Found> = {};
    for (const key of ['description', 'hsCode', 'grossWeight', 'loadingPort', 'dischargePort', 'blNumber', 'marksAndNumbers', 'packages', 'measurement']) {
      const raw = row[key]?.trim();
      if (!raw) continue;
      let value = raw;
      if (key === 'grossWeight' || key === 'measurement') {
        const compact = raw.replace(/\s/g, '');
        // FAL workbooks display typed weights with thousands separators.
        value = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact) ? compact.replace(/,/g, '') : compact.replace(',', '.');
      }
      values[key] = { value, path: `rows.${i}.${key}` };
    }
    if (!values['dischargePort'] && doc.form.fields['port']) {
      values['dischargePort'] = { value: doc.form.fields['port'], path: 'fields.port' };
    }
    return { rowKey: `${doc.id} ${i + 1}`, label: row['blNumber'] || `Cargo item ${i + 1}`, values };
  });
}

function flagCargoValues(cells: Record<string, TableCell>): void {
  const hs = cells['hsCode'];
  if (hs?.value && !/^\d{6}$/.test(hs.value)) {
    hs.flag = 'error';
    hs.message = 'An HS code must contain six digits';
  }
  for (const key of ['grossWeight', 'measurement']) {
    const cell = cells[key];
    if (!cell?.value) continue;
    const n = Number(cell.value);
    if (!Number.isFinite(n) || (key === 'grossWeight' ? n <= 0 : n < 0)) {
      cell.flag = 'error';
      cell.message = key === 'grossWeight' ? 'Write a weight greater than 0 kg' : 'Write a non-negative measurement in m³';
    }
  }
}

function storesRows(doc: SourceDoc): Contribution[] {
  return (doc.form.rows ?? []).map((row, i) => {
    const at = (key: string) => `rows.${i}.${key}`;
    const values: Record<string, Found> = {};
    const article = row['article'] ?? '';
    const code = doc.annotations[at('article')]?.code;
    if (article) {
      values['article'] = { value: code ?? article, path: at('article'), ...(code ? { reading: code } : {}) };
      values['articleName'] = { value: article.replace(/^[A-Z]{3}-\d{3}\s+/, ''), path: at('article'), part: true };
    }
    const q = row['quantity'] ? readQuantity(row['quantity']) : null;
    if (q && !('problem' in q)) {
      values['quantity'] = { value: String(q.amount), path: at('quantity'), part: true };
      values['unit'] = { value: q.unit, path: at('quantity'), part: true };
    } else if (row['quantity']) {
      values['quantity'] = { value: row['quantity'], path: at('quantity') };
    }
    if (row['location']) values['location'] = { value: row['location'], path: at('location') };
    return { rowKey: String(i + 1), label: `${i + 1} · ${article.replace(/^[A-Z]{3}-\d{3}\s+/, '') || 'article'}`, values };
  });
}

function wasteRows(doc: SourceDoc): { header: Record<string, Found>; rows: Contribution[] } {
  const f = doc.form.fields;
  const header: Record<string, Found> = {};
  if (f['dateOfDelivery']) header['lastDeliveryDate'] = { value: f['dateOfDelivery'], path: 'fields.dateOfDelivery' };
  if (f['lastPortDelivered']) header['lastDeliveryPort'] = { value: f['lastPortDelivered'], path: 'fields.lastPortDelivered' };
  if (f['nextPortOfDelivery']) header['nextDeliveryPort'] = { value: f['nextPortOfDelivery'], path: 'fields.nextPortOfDelivery' };
  const map: [string, string][] = [
    ['toDeliver', 'toDeliver'],
    ['capacity', 'maxCapacity'],
    ['retained', 'onBoard'],
    ['remainderPort', 'deliveryPort'],
    ['generated', 'estimatedGenerated'],
  ];
  const rows = (doc.form.rows ?? []).flatMap((row, i): Contribution[] => {
    const code = doc.annotations[`rows.${i}.typeCode`]?.code ?? row['typeCode'];
    if (!code) return [];
    const values: Record<string, Found> = {};
    for (const [col, key] of map) {
      if (row[key]) values[col] = { value: row[key]!.replace(',', '.'), path: `rows.${i}.${key}` };
    }
    return [{ rowKey: code, label: code, values }];
  });
  return { header, rows };
}

function securityRows(doc: SourceDoc): Contribution[] {
  return (doc.form.rows ?? []).map((row, i) => {
    const at = (key: string) => `rows.${i}.${key}`;
    const values: Record<string, Found> = {};
    if (row['arrival']) values['start'] = { value: row['arrival'], path: at('arrival') };
    if (row['departure']) values['end'] = { value: row['departure'], path: at('departure') };
    const port = (row['portLocode'] ?? '').trim().toUpperCase();
    if (port) values['port'] = { value: port, path: at('portLocode') };
    if (row['facilityGisis']) {
      let suffix = row['facilityGisis'].trim().toUpperCase().replace(new RegExp(`^${port}-`), '');
      if (/^\d{1,4}$/.test(suffix)) suffix = suffix.padStart(4, '0');
      values['facility'] = { value: port ? `${port}-${suffix}` : suffix, path: at('facilityGisis') };
    }
    const level = doc.annotations[at('securityLevel')]?.code;
    if (row['securityLevel']) values['level'] = { value: level ?? row['securityLevel'], path: at('securityLevel'), ...(level ? { reading: level } : {}) };
    if (row['measures']) values['measures'] = { value: row['measures'], path: at('measures') };
    return { rowKey: String(i + 1), label: `${i + 1} · ${port || 'call'}`, values };
  });
}

/**
 * The call's previous ports as the chartering system (or the call form)
 * gives them, most recent first (spec 0037) — what the SEC's last calls
 * start from (user 2026-11-13).
 */
export interface Rotation {
  /** In words, for the cells: "opsdesk voyage plan". */
  origin: string;
  prev: { portLocode: string; arrival?: string; departure?: string }[];
}

const SEC_ROWS_MAX = 10;
const dayOf = (iso: string | undefined): string | null => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);

/**
 * The security form's last calls with the rotation's help: a call the form
 * lists takes the rotation's dates where the form left them empty (matched
 * by port, in order); with no form rows the rotation's calls are the rows,
 * and the facility and security level are left for the ship or a person.
 * The form always wins a value it gives.
 */
function securityFromRotation(rows: TableRow[], rotation: Rotation): boolean {
  const legs = rotation.prev.filter((p) => /^[A-Z]{2}[A-Z2-9]{3}$/.test(p.portLocode ?? ''));
  if (legs.length === 0) return false;
  const cell = (value: string): TableCell => ({ value, origin: rotation.origin });
  let used = false;
  if (rows.length === 0) {
    legs.slice(0, SEC_ROWS_MAX).forEach((leg, i) => {
      const cells: Record<string, TableCell> = { port: cell(leg.portLocode) };
      const start = dayOf(leg.arrival);
      const end = dayOf(leg.departure);
      if (start) cells['start'] = cell(start);
      if (end) cells['end'] = cell(end);
      rows.push({ key: String(i + 1), label: `${i + 1} · ${leg.portLocode}`, cells });
    });
    return true;
  }
  const taken = new Set<number>();
  for (const row of rows) {
    const port = row.cells['port']?.value;
    if (!port) continue;
    const at = legs.findIndex((leg, i) => !taken.has(i) && leg.portLocode === port);
    if (at < 0) continue;
    taken.add(at);
    const leg = legs[at]!;
    for (const [key, value] of [['start', dayOf(leg.arrival)], ['end', dayOf(leg.departure)]] as const) {
      if (value && !row.cells[key]?.value?.trim()) {
        row.cells[key] = cell(value);
        used = true;
      }
    }
  }
  return used;
}

/** A stores unit NEMO refuses for its type, with no exact conversion: an error on the unit cell. */
function flagStoresUnit(cells: Record<string, TableCell>): void {
  const type = cells['article']?.value;
  const unit = cells['unit'];
  const qty = Number(cells['quantity']?.value);
  if (!type || !unit?.value || unit.flag === 'error' || !Number.isFinite(qty)) return;
  if (storesQuantity(type, qty, unit.value)) return;
  unit.flag = 'error';
  unit.message = `NEMO takes ${STORES_UNITS[type]!.join(' or ')} for ${type}, not ${unit.value}`;
}

/** Yes / no as NEMO codes it: '1' or '0'; null when it is neither. */
export function readYesNo(text: string): '1' | '0' | null {
  const t = text.trim().toLowerCase();
  if (/^(1|y|yes|true|kyllä|kylla|ja|x)$/.test(t) || t.startsWith('1 /')) return '1';
  if (/^(0|n|no|false|ei|nej|-)$/.test(t) || t.startsWith('0 /')) return '0';
  return null;
}

function passengerRows(doc: SourceDoc): Contribution[] {
  return (doc.form.rows ?? []).flatMap((row, i): Contribution[] => {
    const at = (key: string) => `rows.${i}.${key}`;
    const values: Record<string, Found> = {};
    const put = (key: string, value: string | undefined, path: string, part = false) => {
      if (value && value.trim() !== '') values[key] = { value: value.trim(), path, part };
    };
    let family = '';
    let given = '';
    if (doc.form.formType === 'nsw-pax') {
      family = row['lastName'] ?? '';
      given = row['firstName'] ?? '';
      put('familyName', family, at('lastName'));
      put('givenName', given, at('firstName'));
      put('dateOfBirth', row['dateOfBirth'], at('dateOfBirth'));
      put('placeOfBirth', row['placeOfBirth'], at('placeOfBirth'));
      put('gender', row['gender'], at('gender'));
    } else {
      [family, given] = splitName(row['name'] ?? '');
      put('familyName', family, at('name'), true);
      put('givenName', given, at('name'), true);
      const [dob, place] = splitBirth(row['dateAndPlaceOfBirth'] ?? '');
      put('dateOfBirth', dob, at('dateAndPlaceOfBirth'), true);
      put('placeOfBirth', place, at('dateAndPlaceOfBirth'), true);
    }
    put('nationality', row['nationality'], at('nationality'));
    put('documentType', row['idDocumentType'], at('idDocumentType'), true);
    put('documentNumber', row['idDocumentNumber'], at('idDocumentNumber'));
    put('embarkationPort', row['embarkationPort'], at('embarkationPort'));
    put('disembarkationPort', row['disembarkationPort'], at('disembarkationPort'));
    if (!family && !given) return [];
    // Everyone on a passenger list is a passenger: NEMO's person type FL
    values['personType'] = { value: 'FL', path: at(family ? (doc.form.formType === 'nsw-pax' ? 'lastName' : 'name') : 'name'), part: true };
    return [{ rowKey: personKey(family, given), label: [family, given].filter(Boolean).join(', '), values }];
  });
}

function healthHeader(doc: SourceDoc): Record<string, Found> {
  const f = doc.form.fields;
  const map: [string, string][] = [
    ['stowaways', 'stowaways'],
    ['stowawayPort', 'stowawayPort'],
    ['sanitationValid', 'sanitationCertificate'],
    ['reinspection', 'reinspection'],
    ['sanitationDate', 'sanitationDate'],
    ['sanitationPort', 'sanitationPlace'],
    ['infectedArea', 'affectedArea'],
    ['infectedPort', 'affectedWhere'],
    ['personDied', 'personDied'],
    ['deathCount', 'deathCount'],
    ['disease', 'infectiousDisease'],
    ['illGreater', 'illGreater'],
    ['illCount', 'illCount'],
    ['illNow', 'illNow'],
    ['practitioner', 'practitioner'],
    ['infection', 'infectionCondition'],
    ['sanitaryMeasure', 'sanitaryMeasure'],
    ['sanitaryDetails', 'sanitaryDetails'],
    ['sickAnimal', 'sickAnimal'],
  ];
  const out: Record<string, Found> = {};
  for (const [col, key] of map) {
    if (f[key] && f[key]!.trim() !== '') out[col] = { value: f[key]!.trim(), path: `fields.${key}` };
  }
  return out;
}

// ---- the merge ---------------------------------------------------------------

const comparable = (v: string) => normText(v);

function cellFrom(found: Found, doc: SourceDoc, def: ColumnDef | undefined, book: CodeBook): TableCell {
  const ann = doc.annotations[found.path];
  const cell: TableCell = {
    value: found.value,
    source: { docId: doc.id, fileName: doc.fileName, formName: doc.form.formName, path: found.path },
  };
  if (found.reading) {
    cell.reading = ann?.kind === 'code' && ann.mapped ? ann.mapped : found.reading;
    cell.value = found.reading;
  } else if (!found.part && ann?.kind === 'code' && ann.code) {
    // A coded column holds the NEMO code; the ship's words are the reading
    cell.value = ann.code;
    cell.reading = ann.mapped ?? ann.code;
  } else if (!found.part && ann?.mapped && ann.severity !== 'error') {
    cell.reading = ann.mapped;
  } else if (def?.kind === 'yesno') {
    const yes = readYesNo(found.value);
    if (yes === null) {
      cell.flag = 'error';
      cell.message = `“${found.value}” is not a yes or no`;
    } else {
      cell.value = yes;
      cell.reading = yes === '1' ? 'Yes' : 'No';
    }
  } else if (def?.kind === 'locode' && !/^[A-Z]{2}[A-Z2-9]{3}$/.test(found.value)) {
    // "Hamburg (DEHAM)": the code in the words; a bare name cannot be a port code
    const code = /\b([A-Z]{2}[A-Z2-9]{3})\b/.exec(found.value.toUpperCase())?.[1];
    if (code) {
      cell.value = code;
      cell.reading = found.value;
    } else if (!ann) {
      cell.flag = 'error';
      cell.message = `“${found.value}” is not a port code — pick the port`;
    }
  } else if (def?.kind === 'date' && !/^\d{4}-\d{2}-\d{2}/.test(found.value)) {
    const read = readLooseDate(found.value, slashOrderOf(formValues(doc.form)) ?? undefined);
    if ('iso' in read) cell.value = read.iso;
    else if (!ann) {
      cell.flag = 'error';
      cell.message = read.problem;
    }
  } else if (found.part && def?.kind === 'code' && def.list) {
    // A code inside a composite cell ("Passport 548201937"): resolved here
    const res = resolveCode(found.value, def.list, book);
    if (res.code !== null) {
      cell.value = res.code;
      cell.reading = res.code === res.en ? res.code : `${res.code} — ${res.en}`;
    } else {
      cell.flag = 'error';
      cell.message = `“${found.value}” is not a NEMO ${def.label.toLowerCase()} — pick one`;
    }
  }
  // The form's own flag holds for the whole cell it came from
  if (ann?.severity === 'error' || ann?.severity === 'warning') {
    cell.flag = ann.severity;
    cell.message = ann.message ?? (ann.items ?? []).map((i) => i.message).filter(Boolean).join(' · ');
  }
  return cell;
}

/** Newest upload wins a cell; an older different value makes it a conflict. */
function mergeCell(cells: Record<string, TableCell>, key: string, next: TableCell): void {
  const had = cells[key];
  if (had?.value && next.value && comparable(had.value) !== comparable(next.value)) {
    next.others = [...(had.others ?? []), { value: had.value, fileName: had.source?.fileName ?? '' }];
    if (next.flag !== 'error') {
      next.flag = 'conflict';
      next.message = `${had.source?.fileName ?? 'another form'} says ${had.value}`;
    }
  }
  cells[key] = next;
}

function mergeRows(table: TableDef, docs: SourceDoc[], adapt: (d: SourceDoc) => Contribution[], book: CodeBook): TableRow[] {
  const rows = new Map<string, TableRow>();
  const col = (key: string) => table.columns.find((c) => c.key === key);
  for (const doc of docs) {
    for (const c of adapt(doc)) {
      const row = rows.get(c.rowKey) ?? { key: c.rowKey, label: c.label, cells: {} };
      for (const [key, found] of Object.entries(c.values)) mergeCell(row.cells, key, cellFrom(found, doc, col(key), book));
      if (c.items) row.items = c.items.map((item) => Object.fromEntries(Object.entries(item).map(([k, f]) => [k, cellFrom(f, doc, col(k), book)])));
      rows.set(c.rowKey, row);
    }
  }
  return [...rows.values()];
}

/** Required columns nothing filled: *missing* (0096 decision 3). */
function flagMissing(cells: Record<string, TableCell>, defs: ColumnDef[], requiredKeys: string[] = []): void {
  for (const def of defs) {
    if (!def.required && !requiredKeys.includes(def.key)) continue;
    const cell = cells[def.key];
    if (!cell?.value?.trim()) {
      cells[def.key] = { value: null, flag: 'missing', message: `${def.label} is missing` };
    }
  }
}

function countFlags(t: { header: Record<string, TableCell>; rows: TableRow[] }): MergedTable['counts'] {
  const counts = { error: 0, warning: 0, missing: 0, conflict: 0 };
  const all = [
    ...Object.values(t.header),
    ...t.rows.flatMap((r) => [...Object.values(r.cells), ...(r.items ?? []).flatMap((i) => Object.values(i))]),
  ];
  for (const c of all) if (c.flag) counts[c.flag]++;
  return counts;
}

/**
 * The NEMO tables for a call's forms. `docs` in upload order (oldest first):
 * the newest form's value wins a cell. `wasteTypes`: the waste_type code
 * list (code → words) — the waste table always lists all of them.
 */
/** A typed value as a cell: codes read from the list, the forms' value kept beside. */
function enteredCell(entry: TableEntry, def: ColumnDef | undefined, had: TableCell | undefined, book: CodeBook): TableCell {
  const cell: TableCell = { value: entry.value, entered: { author: entry.author, at: entry.at } };
  if (def?.kind === 'yesno') cell.reading = entry.value === '1' ? 'Yes' : 'No';
  if (def?.kind === 'code' && def.list) {
    const res = resolveCode(entry.value, def.list, book);
    if (res.code !== null) cell.reading = res.code === res.en ? res.code : `${res.code} — ${res.en}`;
  }
  if (had?.value && comparable(had.value) !== comparable(entry.value)) {
    cell.others = [...(had.others ?? []), { value: had.value, fileName: had.source?.fileName ?? '' }];
  }
  if (had?.source) cell.source = had.source;
  return cell;
}

function applyEntries(table: TableDef, header: Record<string, TableCell>, rows: TableRow[], entries: TableEntry[], book: CodeBook): void {
  const col = (key: string) => [...table.fields, ...table.columns].find((c) => c.key === key);
  for (const e of entries.filter((x) => x.table === table.key)) {
    if (e.rowKey === HEADER_ROW) {
      header[e.column] = enteredCell(e, col(e.column), header[e.column], book);
      continue;
    }
    const row = rows.find((r) => r.key === e.rowKey);
    if (!row) continue;
    if (EFFECTS.includes(e.column)) {
      // The first effects item (the one the National Spreadsheet holds)
      const items = row.items && row.items.length > 0 ? row.items : [{}];
      items[0]![e.column] = enteredCell(e, col(e.column), items[0]![e.column], book);
      row.items = items;
      continue;
    }
    row.cells[e.column] = enteredCell(e, col(e.column), row.cells[e.column], book);
  }
}

const EFFECTS = ['effectsType', 'effectsDescription', 'effectsQuantity', 'effectsUnit'];

export function buildTables(
  docs: SourceDoc[],
  book: CodeBook,
  entries: TableEntry[] = [],
  rotation: Rotation | null = null,
): MergedTable[] {
  const wasteTypes = new Map([...(book.lists.get(LISTS.wasteType)?.values() ?? [])].map((e) => [e.code, e.en]));
  const ordered = [...docs].sort((a, b) => a.created.localeCompare(b.created));
  const out: MergedTable[] = [];
  for (const def of TABLES) {
    const feeding = ordered.filter((d) => def.sources.includes(d.form.formType));
    // The security table also stands on the chartering system's previous ports
    const fromRotation = def.key === 'security' && !!rotation?.prev.some((p) => p.portLocode);
    if (feeding.length === 0 && !fromRotation) continue;
    const origins: string[] = [];
    const header: Record<string, TableCell> = {};
    let rows: TableRow[] = [];
    if (def.key === 'crew') rows = mergeRows(def, feeding, crewRows, book);
    if (def.key === 'passengers') rows = mergeRows(def, feeding, passengerRows, book);
    if (def.key === 'cargo') rows = mergeRows(def, feeding, cargoRows, book);
    if (def.key === 'health') {
      for (const doc of feeding) {
        for (const [key, found] of Object.entries(healthHeader(doc))) {
          mergeCell(header, key, cellFrom(found, doc, def.fields.find((f) => f.key === key), book));
        }
      }
    }
    if (def.key === 'stores') rows = mergeRows(def, feeding, storesRows, book);
    if (def.key === 'security') {
      rows = mergeRows(def, feeding, securityRows, book);
      if (rotation && securityFromRotation(rows, rotation)) origins.push(rotation.origin);
    }
    if (def.key === 'waste') {
      const given = new Map<string, TableRow>();
      for (const doc of feeding) {
        const w = wasteRows(doc);
        for (const [key, found] of Object.entries(w.header)) mergeCell(header, key, cellFrom(found, doc, def.fields.find((f) => f.key === key), book));
        for (const c of w.rows) {
          const row = given.get(c.rowKey) ?? { key: c.rowKey, label: c.rowKey, cells: {} };
          for (const [key, found] of Object.entries(c.values)) mergeCell(row.cells, key, cellFrom(found, doc, def.columns.find((d) => d.key === key), book));
          given.set(c.rowKey, row);
        }
      }
      // Every waste type NEMO knows, in its order — the sheet's fixed rows
      rows = [...wasteTypes.entries()].map(([code, words]) => ({
        ...(given.get(code) ?? { cells: {} }),
        key: code,
        label: `${code} ${words}`,
      }));
    }
    applyEntries(def, header, rows, entries, book);
    flagMissing(header, def.fields);
    // SEC needs one contact method, rather than both. Offer e-mail as the
    // missing entry and explain that a mobile number also satisfies it.
    if (def.key === 'security' && !header.csoEmail?.value?.trim() && !header.csoMobile?.value?.trim()) {
      header.csoEmail = { value: null, flag: 'missing', message: 'CSO e-mail or mobile number is missing' };
    }
    // Waste rows are all optional; the others must be complete when present
    if (def.key !== 'waste') for (const row of rows) {
      // CWA accepts no identity document; once supplied, all four parts
      // become compulsory, just as in buildCwaPayload.
      const documentKeys = def.key === 'crew' && DOCUMENT_PARTS.some(([key]) => row.cells[key]?.value?.trim())
        ? DOCUMENT_PARTS.map(([key]) => key) : [];
      flagMissing(row.cells, def.columns, documentKeys);
    }
    // Stores: NEMO takes only some units per type (ERR-027, spec 0098); an exact conversion is made on send
    if (def.key === 'stores') for (const row of rows) flagStoresUnit(row.cells);
    if (def.key === 'cargo') for (const row of rows) flagCargoValues(row.cells);
    const table = {
      key: def.key,
      label: def.label,
      sheet: def.sheet,
      rowNoun: def.rowNoun,
      fields: def.fields,
      columns: def.columns,
      header,
      rows,
      sources: feeding.map((d) => ({ docId: d.id, fileName: d.fileName, formName: d.form.formName })),
      ...(origins.length > 0 ? { origins } : {}),
    };
    out.push({ ...table, counts: countFlags(table) });
  }
  return out;
}
