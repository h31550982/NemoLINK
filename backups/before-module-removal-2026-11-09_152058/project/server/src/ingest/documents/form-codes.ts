/**
 * NEMO code checks on parsed ship forms (docs/specs/0093 §1, units per
 * docs/specs/0094). The same pattern as the LOCODE and GISIS checks in
 * form-checks.ts: every coded value must be an entry of the NEMO code list
 * NEMO validates it against, every quantity must carry a unit NEMO accepts
 * for that element, and anything that does not resolve is an error with
 * suggestions — never a silent guess.
 *
 * Resolution order (docs/03, code resolution & mapping memory):
 *   1. the code itself ("STO-001", "GBR", "SL1", or a code in front of the
 *      words — "STO-001 Rum", spec 0093 D2);
 *   2. the code list's own text (en / fi / sv, "Security level 1");
 *   3. the hand-kept vocabulary below ("Rum" → spirits, "AB" → able seafarer);
 *   4. the org's remembered picks (`mapping_alias`, written by corrections).
 * 1–2 are `ok`; 3–4 are `info` (shown, nothing to do); a miss is an `error`.
 */

import type { PoolClient } from 'pg';
import type { FormType, ParsedForm } from './form-parser';
import type { CheckAnnotation } from './form-checks';

// ---- what is coded where ---------------------------------------------------

/** The NEMO code lists the forms' values resolve to (platform.codelist_entry). */
export const LISTS = {
  storesArticle: 'ship_stores_article',
  crewEffects: 'crew_effects',
  wasteType: 'waste_type',
  securityLevel: 'imo_compendium_IMO0137',
  crewRank: 'crew_role',
  gender: 'un_edifact_3499',
  identityDocument: 'un_edifact_1001',
  nationality: 'iso3166_1_alpha_3_iso_iec_7501',
  country: 'iso3166_1_alpha_3_iso_3166_3',
} as const;

type ListName = (typeof LISTS)[keyof typeof LISTS];

interface CodeRule {
  key: string;
  list: ListName;
}

interface FormCodes {
  fields?: CodeRule[];
  rows?: CodeRule[];
  /** Stores quantities: a number and a unit (spec 0094). */
  quantities?: string[];
  /** FAL 4: one cell holding several effects items with quantities. */
  effects?: string;
  /** Waste amounts in m³: a number ≥ 0. [key, capacity key] pairs are compared. */
  amounts?: string[];
}

const RANK: CodeRule = { key: 'rank', list: LISTS.crewRank };
const NATIONALITY: CodeRule = { key: 'nationality', list: LISTS.nationality };
const GENDER: CodeRule = { key: 'gender', list: LISTS.gender };

export const FORM_CODES: Partial<Record<FormType, FormCodes>> = {
  'nsw-crew': {
    rows: [RANK, GENDER, NATIONALITY, { key: 'idDocumentNature', list: LISTS.identityDocument }],
  },
  'nsw-pax': {
    rows: [GENDER, NATIONALITY, { key: 'idDocumentType', list: LISTS.identityDocument }],
  },
  fal3: {
    rows: [{ key: 'article', list: LISTS.storesArticle }],
    quantities: ['quantity'],
  },
  fal4: { rows: [RANK], effects: 'effects' },
  fal5: { rows: [RANK, NATIONALITY] },
  fal6: { rows: [NATIONALITY] },
  'nsw-security': { rows: [{ key: 'securityLevel', list: LISTS.securityLevel }] },
  'nsw-waste': {
    rows: [{ key: 'typeCode', list: LISTS.wasteType }],
    amounts: ['toDeliver', 'maxCapacity', 'onBoard', 'estimatedGenerated', 'deliveredLastPort'],
  },
  'nmsw-mdh': {
    fields: [{ key: 'flagState', list: LISTS.country }],
    rows: [{ key: 'country', list: LISTS.country }],
  },
};

/** Every list the NEMO tables (spec 0096) resolve against. */
export const TABLE_LISTS = [
  ...new Set<string>([
    ...Object.values(LISTS),
    'iso3166_1_alpha_2_unedifact3207',
    'issc_type',
    'un_edifact_3035',
  ]),
];

/** Every code list a form type's checks read. */
export function listsFor(formType: FormType): ListName[] {
  const spec = FORM_CODES[formType];
  if (!spec) return [];
  const lists = new Set<ListName>();
  for (const rule of [...(spec.fields ?? []), ...(spec.rows ?? [])]) lists.add(rule.list);
  if (spec.quantities) lists.add(LISTS.storesArticle);
  if (spec.effects) lists.add(LISTS.crewEffects);
  return [...lists];
}

// ---- normalising and the vocabulary ----------------------------------------

/** Comparable text: lower case, no accents, words only. */
export function normText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&#x27;|’/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The hand-kept vocabulary: what ships write → the NEMO code. Keys are
 * `normText` forms. Only words with one plain meaning belong here; anything
 * a person would have to think about is left to the pick list.
 */
const SPIRITS = ['rum', 'vodka', 'whisky', 'whiskey', 'gin', 'brandy', 'cognac', 'spirits', 'liquor', 'liquors', 'aquavit', 'tequila', 'schnapps'];
const TOBACCO = ['tobacco', 'pipe tobacco', 'rolling tobacco', 'snus', 'snuff', 'cigarillos'];

function articles(prefix: 'STO' | 'CRE'): Record<string, string> {
  const c = (n: string) => `${prefix}-${n}`;
  const same = prefix === 'STO'
    ? { spirits: '001', beer: '002', wine: '003', cigarettes: '004', cigars: '005', tobacco: '006', medicines: '009', meat: '010', firearms: '011', ammunition: '012' }
    : { spirits: '001', beer: '002', wine: '003', cigarettes: '004', cigars: '005', tobacco: '006', medicines: '007', meat: '008', firearms: '009', ammunition: '010' };
  const out: Record<string, string> = {};
  for (const w of SPIRITS) out[w] = c(same.spirits);
  for (const w of ['beer', 'beers', 'lager', 'ale', 'cider']) out[w] = c(same.beer);
  for (const w of ['wine', 'wines', 'red wine', 'white wine', 'rose wine', 'sparkling wine', 'champagne']) out[w] = c(same.wine);
  for (const w of ['cigarettes', 'cigarette', 'cigs']) out[w] = c(same.cigarettes);
  for (const w of ['cigars', 'cigar']) out[w] = c(same.cigars);
  for (const w of TOBACCO) out[w] = c(same.tobacco);
  for (const w of ['medicines', 'medicine', 'drugs', 'medical chest', 'medical stores', 'pharmaceuticals']) out[w] = c(same.medicines);
  for (const w of ['meat', 'beef', 'pork', 'chicken', 'poultry', 'lamb', 'sausages', 'ham', 'meat products']) out[w] = c(same.meat);
  for (const w of ['firearms', 'firearm', 'pistol', 'pistols', 'rifle', 'rifles', 'shotgun', 'gun', 'guns', 'revolver']) out[w] = c(same.firearms);
  for (const w of ['ammunition', 'ammo', 'cartridges', 'rounds', 'shot', 'pistol shot', 'bullets']) out[w] = c(same.ammunition);
  if (prefix === 'STO') {
    for (const w of ['gasoil', 'gas oil', 'mgo', 'marine gasoil', 'marine gas oil', 'diesel', 'diesel oil', 'mdo', 'marine diesel oil', 'lsmgo']) out[w] = 'STO-015';
    for (const w of ['fueloil', 'fuel oil', 'hfo', 'ifo', 'heavy fuel oil', 'vlsfo', 'lsfo', 'bunker oil', 'bunkers']) out[w] = 'STO-014';
    for (const w of ['lubricants', 'lubricating oil', 'lube oil', 'lub oil', 'cylinder oil', 'system oil', 'grease', 'hydraulic oil']) out[w] = 'STO-008';
    for (const w of ['petrol', 'gasoline', 'kerosene', 'lng', 'lpg', 'methanol']) out[w] = 'STO-007';
  }
  return out;
}

const VOCAB: Partial<Record<ListName, Record<string, string>>> = {
  [LISTS.storesArticle]: articles('STO'),
  [LISTS.crewEffects]: articles('CRE'),
  [LISTS.gender]: { m: '1', male: '1', man: '1', f: '2', female: '2', woman: '2', x: '0', unknown: '0' },
  [LISTS.identityDocument]: {
    p: '39', pp: '39', pass: '39', passport: '39', 'passport no': '39',
    sb: '718', s: '718', 'seaman book': '718', 'seamans book': '718', "seaman's book": '718',
    'seafarers identity document': '718', 'discharge book': '718', 'seaman s book': '718',
    id: '36', i: '36', 'id card': '36', 'identity card': '36', 'national id': '36',
  },
  [LISTS.securityLevel]: {
    '1': 'SL1', '2': 'SL2', '3': 'SL3', 'level 1': 'SL1', 'level 2': 'SL2', 'level 3': 'SL3',
    'sl 1': 'SL1', 'sl 2': 'SL2', 'sl 3': 'SL3', 'isps 1': 'SL1', 'isps level 1': 'SL1',
  },
  [LISTS.crewRank]: {
    master: '10100', captain: '10100', capt: '10100', 'ship master': '10100',
    'chief officer': '10110', 'ch off': '10110', 'ch officer': '10110', 'c o': '10110', co: '10110',
    'chief mate': '10110', 'ch mate': '10110', 'c m': '10110', 'first officer': '10110', '1st officer': '10110',
    '1st mate': '10110', 'first mate': '10110', 'ch offr': '10110',
    'second officer': '10121', '2nd officer': '10121', '2nd off': '10121', '2 o': '10121', '2nd mate': '10121', 'second mate': '10121',
    'third officer': '10122', '3rd officer': '10122', '3rd off': '10122', '3 o': '10122', '3rd mate': '10122', 'third mate': '10122',
    'watch officer': '10120', 'deck officer': '10120', oow: '10120', 'officer of the watch': '10120',
    'chief engineer': '10150', 'ch eng': '10150', 'ch engineer': '10150', 'c e': '10150', ce: '10150', 'chief eng': '10150',
    'second engineer': '10220', '2nd engineer': '10220', '2nd eng': '10220', '2 e': '10220', '1st engineer': '10220', 'first engineer': '10220',
    'third engineer': '10230', '3rd engineer': '10230', '3rd eng': '10230', '3 e': '10230',
    'fourth engineer': '10240', '4th engineer': '10240', '4th eng': '10240',
    bosun: '10400', boatswain: '10400', bsn: '10400',
    ab: '10420', 'a b': '10420', 'able seaman': '10420', 'able bodied seaman': '10420', 'able seafarer': '10420', 'ab deck': '10420',
    os: '10450', 'o s': '10450', 'ordinary seaman': '10450', 'ordinary seafarer': '10450', deckhand: '10450', 'deck hand': '10450',
    oiler: '10531', motorman: '10531', 'ab engine': '10531',
    cook: '10701', "ship's cook": '10701', 'ships cook': '10701', 'ch cook': '10700', 'chief cook': '10700',
    steward: '10822', stewardess: '10822', messman: '10823', 'mess man': '10823', pantryman: '10823',
  },
};

// ---- the code lists in memory ------------------------------------------------

interface Entry {
  code: string;
  en: string;
  /** Normalised texts the entry is known by: en/fi/sv and their parts. */
  texts: string[];
}

export interface CodeBook {
  lists: Map<string, Map<string, Entry>>;
  /** `${list}|${normText}` → code, the org's remembered picks. */
  aliases: Map<string, string>;
}

/**
 * Lists whose entries name synonyms with slashes and brackets: "Captain /
 * Master", "Boatswain (Bosun)". Only these are split — elsewhere a bracket
 * qualifies ("Virgin Islands (British)" is not "British").
 */
const SYNONYM_LISTS = new Set<string>([LISTS.crewRank]);

/** The entry's texts, and for synonym lists each part too. */
function textsOf(split: boolean, ...texts: (string | null)[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    out.add(normText(text));
    if (!split) continue;
    for (const part of text.split(/\s\/\s|[()]/)) {
      const n = normText(part);
      if (n) out.add(n);
    }
  }
  return [...out];
}

export async function loadCodeBook(client: PoolClient, lists: string[]): Promise<CodeBook> {
  const book: CodeBook = { lists: new Map(), aliases: new Map() };
  if (lists.length === 0) return book;
  for (const list of lists) book.lists.set(list, new Map());
  const entries = await client.query(
    `SELECT codelist, code, en, fi, sv FROM platform.codelist_entry
      WHERE is_active AND codelist = ANY($1)`,
    [lists],
  );
  for (const row of entries.rows as { codelist: string; code: string; en: string | null; fi: string | null; sv: string | null }[]) {
    const list = book.lists.get(row.codelist);
    if (!list || list.has(row.code)) continue;
    list.set(row.code, {
      code: row.code,
      en: (row.en ?? row.code).replace(/&#x27;/g, '’'),
      texts: textsOf(SYNONYM_LISTS.has(row.codelist), row.en, row.fi, row.sv),
    });
  }
  const aliases = await client.query(
    `SELECT normalized_text, code, codelist FROM mapping_alias
      WHERE is_active AND codelist = ANY($1)`,
    [lists],
  );
  for (const row of aliases.rows as { normalized_text: string; code: string; codelist: string }[]) {
    book.aliases.set(`${row.codelist}|${row.normalized_text}`, row.code);
  }
  return book;
}

// ---- resolving one value ---------------------------------------------------

export type Resolution =
  | { code: string; en: string; how: 'code' | 'text' | 'vocabulary' | 'remembered' }
  | { code: null; suggest: string[] };

/** The code a value starts with, when it does ("STO-001 Rum", "GBR"). */
function leadingCode(raw: string, list: Map<string, Entry>): string | null {
  const text = raw.trim();
  const whole = text.toUpperCase();
  if (list.has(whole)) return whole;
  if (list.has(text)) return text;
  const first = /^([A-Za-z0-9]+(?:-[0-9]+)?)(?:\s*[–—-]\s*|\s+)/.exec(text)?.[1];
  if (first && /\d/.test(first) && list.has(first.toUpperCase())) return first.toUpperCase();
  return null;
}

export function resolveCode(raw: string, listName: string, book: CodeBook): Resolution {
  const list = book.lists.get(listName) ?? new Map<string, Entry>();
  const hit = (code: string, how: 'code' | 'text' | 'vocabulary' | 'remembered'): Resolution => ({
    code,
    en: list.get(code)?.en ?? code,
    how,
  });

  const code = leadingCode(raw, list);
  if (code) return hit(code, 'code');

  const n = normText(raw);
  // The list's own words; several entries sharing a part → the shortest (the
  // generic "Captain / Master" over "Captain / Master on ships above 3000 GT")
  const byText = [...list.values()].filter((e) => e.texts.includes(n));
  if (byText.length > 0) {
    byText.sort((a, b) => a.en.length - b.en.length || a.code.localeCompare(b.code));
    return hit(byText[0].code, 'text');
  }
  const words = VOCAB[listName as ListName] ?? {};
  for (const variant of variants(raw)) {
    const vocab = words[variant];
    if (vocab && list.has(vocab)) return hit(vocab, 'vocabulary');
  }
  const remembered = book.aliases.get(`${listName}|${n}`);
  if (remembered && list.has(remembered)) return hit(remembered, 'remembered');

  return { code: null, suggest: suggest(n, list) };
}

/**
 * The ways a ship's words are tried against the vocabulary, best first:
 * as written, without the brackets, what is in the brackets, and the last
 * word ("Gasoil (MGO)" → gasoil, mgo; "Flintlock pistol (antique)" → pistol).
 */
function variants(raw: string): string[] {
  const out = [normText(raw)];
  const outside = normText(raw.replace(/\([^)]*\)/g, ' '));
  out.push(outside);
  for (const m of raw.matchAll(/\(([^)]*)\)/g)) out.push(normText(m[1]));
  const last = outside.split(' ').pop();
  if (last && last.length >= 3) out.push(last);
  return [...new Set(out.filter((v) => v !== ''))];
}

/** Best candidates by shared words (and word starts), best first. */
function suggest(n: string, list: Map<string, Entry>, max = 5): string[] {
  const words = n.split(' ').filter((w) => w.length >= 2);
  if (words.length === 0) return [];
  const scored: { code: string; score: number; len: number }[] = [];
  for (const entry of list.values()) {
    const theirs = entry.texts.join(' ').split(' ');
    let score = 0;
    for (const w of words) {
      if (theirs.includes(w)) score += 2;
      else if (w.length >= 3 && theirs.some((t) => t.startsWith(w) || w.startsWith(t) && t.length >= 3)) score += 1;
    }
    if (score > 0) scored.push({ code: entry.code, score, len: entry.en.length });
  }
  scored.sort((a, b) => b.score - a.score || a.len - b.len);
  return scored.slice(0, max).map((s) => s.code);
}

// ---- quantities and units (spec 0094) ---------------------------------------

/** What NEMO accepts for stores and effects on board (STA/STD/EFF OnboardMeasure). */
export const ONBOARD_UNITS = ['KGM', 'LTR', 'MTQ', 'NAR', 'TNE'] as const;

/** Ships' spellings → NEMO unit (spec 0094). Keys are lower case, dots dropped. */
const UNIT_WORDS: Record<string, string> = {
  kgm: 'KGM', kg: 'KGM', kgs: 'KGM', kilo: 'KGM', kilos: 'KGM', kilogram: 'KGM', kilograms: 'KGM',
  tne: 'TNE', t: 'TNE', mt: 'TNE', ton: 'TNE', tons: 'TNE', tonne: 'TNE', tonnes: 'TNE',
  ltr: 'LTR', l: 'LTR', lt: 'LTR', lit: 'LTR', litre: 'LTR', litres: 'LTR', liter: 'LTR', liters: 'LTR', ltrs: 'LTR',
  mtq: 'MTQ', m3: 'MTQ', 'm³': 'MTQ', cbm: 'MTQ', cum: 'MTQ', 'cu m': 'MTQ', 'cubic metres': 'MTQ', 'cubic meters': 'MTQ',
  nar: 'NAR', pcs: 'NAR', pc: 'NAR', pce: 'NAR', piece: 'NAR', pieces: 'NAR', ea: 'NAR', each: 'NAR', unit: 'NAR', units: 'NAR',
  no: 'NAR', nos: 'NAR', bo: 'NAR', btl: 'NAR', btls: 'NAR', bottle: 'NAR', bottles: 'NAR', can: 'NAR', cans: 'NAR',
  ct: 'NAR', ctn: 'NAR', ctns: 'NAR', carton: 'NAR', cartons: 'NAR', pk: 'NAR', pkt: 'NAR', pack: 'NAR', packs: 'NAR',
  packet: 'NAR', packets: 'NAR', set: 'NAR', sets: 'NAR', box: 'NAR', boxes: 'NAR', doz: 'NAR', tin: 'NAR', tins: 'NAR',
  roll: 'NAR', rolls: 'NAR', stick: 'NAR', sticks: 'NAR',
};

export type QuantityRead =
  | { amount: number; unit: string; exact: boolean }
  | { problem: string };

/** A number the way ships write it: "3 200", "0,5", "1.5". */
function readNumber(text: string): number | null {
  const t = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * "85 m3" → 85 MTQ, "2000 PCS" → 2000 NAR. `exact` when the file already
 * wrote the NEMO unit code. A missing or unknown unit is a problem: the
 * user picks one of the five (spec 0094).
 */
export function readQuantity(raw: string): QuantityRead {
  const text = raw.trim().replace(/^(abt|about|approx|appr|ca|c)\.?\s+/i, '');
  const m = /^(\d[\d\s]*(?:[.,]\d+)?)\s*(.*)$/.exec(text);
  if (!m) return { problem: 'no quantity — write a number and a unit, e.g. 120 LTR' };
  const amount = readNumber(m[1]);
  if (amount === null) return { problem: 'can’t read the number' };
  const unitText = m[2].trim().replace(/\./g, '').replace(/\s+/g, ' ');
  if (unitText === '') return { problem: `${m[1].trim()} what? — pick the unit (KGM, LTR, MTQ, NAR or TNE)` };
  const unit = UNIT_WORDS[unitText.toLowerCase()];
  if (!unit) return { problem: `“${unitText}” is not a unit NEMO accepts — pick KGM, LTR, MTQ, NAR or TNE` };
  return { amount, unit, exact: unitText === unit };
}

// ---- effects items (FAL 4) -------------------------------------------------

export interface EffectsItem {
  text: string;
  severity: CheckAnnotation['severity'];
  code?: string;
  mapped?: string;
  message?: string;
  suggest?: string[];
}

const NOTHING = /^(nil|none|no|nothing|-+|n\/a|na|0)$/i;

/** "Rum 2 L; Pipe tobacco 0.5 KG" → items; each an article and a quantity. */
export function splitEffects(raw: string): { article: string; quantity: string | null; text: string }[] {
  return raw
    .split(/;|\n|,(?!\d)/)
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((text) => {
      const m = /^(.*?)\s+((?:abt\.?\s+)?\d[\d\s]*(?:[.,]\d+)?\s*[A-Za-z³.]*\s*[A-Za-z.]*)$/.exec(text);
      return m ? { article: m[1].trim(), quantity: m[2].trim(), text } : { article: text, quantity: null, text };
    });
}

// ---- the checker -----------------------------------------------------------

const RANK_WORST: CheckAnnotation['severity'][] = ['ok', 'info', 'warning', 'error'];
const worst = (a: CheckAnnotation['severity'], b: CheckAnnotation['severity']) =>
  RANK_WORST.indexOf(a) >= RANK_WORST.indexOf(b) ? a : b;

function codeAnnotation(res: Resolution, list: string, noun: string): CheckAnnotation {
  if (res.code === null) {
    return {
      severity: 'error',
      message: `not a NEMO ${noun} — pick one from the list`,
      kind: 'code',
      codelist: list,
      ...(res.suggest.length > 0 ? { suggest: res.suggest } : {}),
    };
  }
  const mapped = res.code === res.en ? res.code : `${res.code} — ${res.en}`;
  return {
    severity: res.how === 'code' || res.how === 'text' ? 'ok' : 'info',
    mapped,
    ...(res.how === 'remembered' ? { message: 'remembered from an earlier correction' } : {}),
    kind: 'code',
    codelist: list,
    code: res.code,
  };
}

const NOUNS: Record<string, string> = {
  [LISTS.storesArticle]: 'stores article',
  [LISTS.crewEffects]: 'crew effects type',
  [LISTS.wasteType]: 'waste type',
  [LISTS.securityLevel]: 'security level',
  [LISTS.crewRank]: 'rank or rating',
  [LISTS.gender]: 'gender',
  [LISTS.identityDocument]: 'identity document type',
  [LISTS.nationality]: 'nationality code',
  [LISTS.country]: 'country code',
};

function quantityAnnotation(raw: string): CheckAnnotation {
  const read = readQuantity(raw);
  if ('problem' in read) return { severity: 'error', message: read.problem, kind: 'unit' };
  return {
    severity: read.exact ? 'ok' : 'info',
    mapped: `${read.amount} ${read.unit}`,
    kind: 'unit',
  };
}

function effectsAnnotation(raw: string, book: CodeBook): CheckAnnotation {
  if (NOTHING.test(raw.trim())) {
    return { severity: 'ok', mapped: 'nothing to declare', kind: 'effects', items: [] };
  }
  const items: EffectsItem[] = splitEffects(raw).map(({ article, quantity, text }) => {
    const res = resolveCode(article, LISTS.crewEffects, book);
    if (res.code === null) {
      return {
        text,
        severity: 'error' as const,
        message: `“${article}” is not a NEMO crew effects type — pick one`,
        ...(res.suggest.length > 0 ? { suggest: res.suggest } : {}),
      };
    }
    const q = quantity ? readQuantity(quantity) : { problem: 'no quantity — write a number and a unit' };
    if ('problem' in q) {
      return { text, severity: 'error' as const, code: res.code, message: q.problem };
    }
    return {
      text,
      severity: res.how === 'code' && q.exact ? ('ok' as const) : ('info' as const),
      code: res.code,
      mapped: `${res.code} ${res.en} ${q.amount} ${q.unit}`,
    };
  });
  const severity = items.reduce<CheckAnnotation['severity']>((s, i) => worst(s, i.severity), 'ok');
  const bad = items.filter((i) => i.severity === 'error').length;
  return {
    severity,
    kind: 'effects',
    codelist: LISTS.crewEffects,
    items,
    ...(bad > 0 ? { message: bad === 1 ? 'one item needs a NEMO type or unit' : `${bad} items need a NEMO type or unit` } : {}),
    ...(bad === 0 ? { mapped: items.map((i) => i.mapped).join('; ') } : {}),
  };
}

/** Waste amounts in m³ — a number ≥ 0; "0,5" reads as 0.5 (spec 0094). */
function amountAnnotation(raw: string): { ann: CheckAnnotation | null; value: number | null } {
  const value = readNumber(raw.trim().replace(/\s*(m3|m³|cbm)$/i, ''));
  if (value === null) {
    return { ann: { severity: 'error', message: 'not an amount in m³ — write a number, e.g. 0.5', kind: 'amount' }, value: null };
  }
  const plain = String(value);
  return {
    ann: plain === raw.trim() ? null : { severity: 'info', mapped: `${plain} m³`, kind: 'amount' },
    value,
  };
}

/** All NEMO code, unit and amount annotations for a (corrected) form. */
export async function runCodeChecks(
  client: PoolClient,
  form: ParsedForm,
): Promise<Record<string, CheckAnnotation>> {
  const spec = FORM_CODES[form.formType];
  if (!spec) return {};
  const book = await loadCodeBook(client, listsFor(form.formType));
  const annotations: Record<string, CheckAnnotation> = {};
  const rows = form.rows ?? [];

  for (const rule of spec.fields ?? []) {
    const raw = form.fields[rule.key];
    if (raw) annotations[`fields.${rule.key}`] = codeAnnotation(resolveCode(raw, rule.list, book), rule.list, NOUNS[rule.list]);
  }
  rows.forEach((row, i) => {
    for (const rule of spec.rows ?? []) {
      const raw = row[rule.key];
      if (raw) annotations[`rows.${i}.${rule.key}`] = codeAnnotation(resolveCode(raw, rule.list, book), rule.list, NOUNS[rule.list]);
    }
    for (const key of spec.quantities ?? []) {
      if (row[key]) annotations[`rows.${i}.${key}`] = quantityAnnotation(row[key]);
    }
    if (spec.effects && row[spec.effects]) {
      annotations[`rows.${i}.${spec.effects}`] = effectsAnnotation(row[spec.effects], book);
    }
    const read: Record<string, number | null> = {};
    for (const key of spec.amounts ?? []) {
      if (!row[key]) continue;
      const { ann, value } = amountAnnotation(row[key]);
      read[key] = value;
      if (ann) annotations[`rows.${i}.${key}`] = ann;
    }
    const kept = read['onBoard'];
    const capacity = read['maxCapacity'];
    if (kept != null && capacity != null && kept > capacity) {
      annotations[`rows.${i}.onBoard`] = {
        severity: 'warning',
        message: `more retained (${kept} m³) than the storage capacity (${capacity} m³)`,
        kind: 'amount',
      };
    }
  });
  return annotations;
}

// ---- mapping memory --------------------------------------------------------

/** Store one "the ship's words → this code" pick for the org (docs/03). */
async function remember(client: PoolClient, text: string, code: string, codelist: string, author: string): Promise<void> {
  const n = normText(text);
  if (n === '' || n === normText(code)) return;
  await client.query(
    `INSERT INTO mapping_alias (normalized_text, code, codelist, codelist_version, author, source, use_count)
     VALUES ($1, $2, $3, 'hub', $4, 'document-correction', 1)
     ON CONFLICT (normalized_text, codelist) WHERE is_active DO UPDATE
       SET code = EXCLUDED.code, author = EXCLUDED.author, updated = now(),
           use_count = mapping_alias.use_count + 1`,
    [n, code, codelist, author],
  );
}

/**
 * After a correction (spec 0093 §1): when the corrected value resolves to a
 * NEMO code, the file's own words are remembered as that code for the org,
 * so the next upload from the ship needs no correction. For a FAL 4 cell
 * each item is remembered on its own, when the items still line up.
 */
export async function rememberPick(
  client: PoolClient,
  original: string | undefined,
  after: CheckAnnotation | undefined,
  author: string,
): Promise<void> {
  if (!original || !after) return;
  if (after.kind === 'code' && after.code && after.codelist && after.severity !== 'error') {
    await remember(client, original, after.code, after.codelist, author);
  } else if (after.kind === 'effects' && after.items && after.codelist) {
    const was = splitEffects(original);
    if (was.length !== after.items.length) return;
    for (let i = 0; i < was.length; i++) {
      const item = after.items[i];
      if (item.code && item.severity !== 'error') {
        await remember(client, was[i].article, item.code, after.codelist, author);
      }
    }
  }
}
