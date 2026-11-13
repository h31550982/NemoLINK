/**
 * Reference checks on parsed documents (docs/specs/0050): dates read
 * tolerantly and flagged when unreadable, LOCODEs against the synced
 * port master list (spec 0027), GISIS facility codes against the row's
 * port's published list, and the ship identity against the call the
 * file was dropped on. Every annotation is plain words; nothing here
 * ever guesses — an ambiguous value is flagged, not silently fixed.
 *
 * `runChecks` runs at upload (stored with the document) and again on
 * every detail read (fresh against the current master list) — same
 * function, so a refdata sync that adds a port heals old flags.
 */

import type { PoolClient } from 'pg';
import { aliasesForCodes } from '../../refdata/location-aliases';
import { EffectsItem, runCodeChecks } from './form-codes';
import { FormType, ParsedForm } from './form-parser';

export type CheckSeverity = 'ok' | 'info' | 'warning' | 'error';

export interface CheckAnnotation {
  severity: CheckSeverity;
  /** How we read it: "Kotka", "FIKTK-0007 — facility of Kotka", the ISO date. */
  mapped?: string;
  /** What is wrong or cannot be checked, in plain words. */
  message?: string;
  /**
   * The resolved port behind this value (spec 0051) — the UI offers its
   * areas, berths and facility codes so "what it should have been" is
   * one glance away.
   */
  port?: string;
  /**
   * What kind of value this is — the correction dialog shapes itself to it.
   * `code`: an entry of a NEMO code list (`codelist`); `unit`: a quantity
   * with a NEMO unit; `effects`: FAL 4 items (`items`); `amount`: waste m³
   * (spec 0093 §1, spec 0094).
   */
  kind?: 'locode' | 'gisis' | 'date' | 'code' | 'unit' | 'effects' | 'amount';
  /** The NEMO code list a `code` or `effects` value resolves against. */
  codelist?: string;
  /** The NEMO code the value resolved to. */
  code?: string;
  /** FAL 4: each effects item in the cell, checked on its own. */
  items?: EffectsItem[];
  /**
   * Codes worth offering instead (docs/specs/0056): a retired or superseded
   * LOCODE knows what replaced it, so "Did you mean" can offer it as one tap
   * rather than leaving the user to guess. Best first.
   */
  suggest?: string[];
}

/**
 * Operator corrections (spec 0051): an overlay keyed by check path —
 * the parsed form stays the file's own words (invariant 9).
 */
export type Corrections = Record<
  string,
  { value: string; author: string; at: string }
>;

/** The path grammar corrections and annotations share. */
export const CORRECTION_PATH_RE = /^(fields\.[A-Za-z0-9_]+|rows\.\d+\.[A-Za-z0-9_]+)$/;

/** The effective form: parsed values with the corrections laid over. */
export function applyCorrections(
  form: ParsedForm,
  corrections: Corrections | null,
): ParsedForm {
  if (!corrections || Object.keys(corrections).length === 0) return form;
  const effective: ParsedForm = {
    ...form,
    fields: { ...form.fields },
    rows: form.rows ? form.rows.map((row) => ({ ...row })) : form.rows,
  };
  for (const [path, correction] of Object.entries(corrections)) {
    const parts = path.split('.');
    if (parts[0] === 'fields' && parts.length === 2) {
      effective.fields[parts[1]] = correction.value;
    } else if (parts[0] === 'rows' && parts.length === 3 && effective.rows) {
      const row = effective.rows[Number(parts[1])];
      if (row) row[parts[2]] = correction.value;
    }
  }
  return effective;
}

/** The value a path addresses (on whichever form view you hand in). */
export function valueAt(form: ParsedForm, path: string): string | undefined {
  const parts = path.split('.');
  if (parts[0] === 'fields' && parts.length === 2) return form.fields[parts[1]];
  if (parts[0] === 'rows' && parts.length === 3 && form.rows) {
    return form.rows[Number(parts[1])]?.[parts[2]];
  }
  return undefined;
}

/** Does the path address a value the parsed form actually has? */
export function pathExists(form: ParsedForm, path: string): boolean {
  const parts = path.split('.');
  if (parts[0] === 'fields' && parts.length === 2) {
    return form.fields[parts[1]] !== undefined;
  }
  if (parts[0] === 'rows' && parts.length === 3 && form.rows) {
    const row = form.rows[Number(parts[1])];
    return !!row && row[parts[2]] !== undefined;
  }
  return false;
}

export interface DocumentChecks {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Keyed by path: `fields.<key>` or `rows.<index>.<key>`. */
  annotations: Record<string, CheckAnnotation>;
  checkedAt: string;
}

/** The ship of the port call the file was dropped on. */
export interface CallShip {
  name: string | null;
  imoNumber: string | null;
}

// ---- dates -----------------------------------------------------------------

function calendarValid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

/**
 * Tolerant date reading: ISO, dd.mm.yyyy, yyyy/mm/dd, and d/m/yyyy or
 * m/d/yyyy when the day value makes the order unambiguous. Returns the
 * ISO day, or a plain-words problem. Ambiguity is a problem, not a
 * guess — `5/6/2026` on a security form is not ours to decide.
 */
export type SlashOrder = 'dmy' | 'mdy';

/**
 * How a form writes its slashed dates, from the form itself: one date
 * like 29/09/2026 settles every 03/10/2026 in the same file as day/month
 * (and 09/29/2026 as month/day). Null when nothing tells, or the file
 * mixes both — then an ambiguous date stays a question for a person.
 */
export function slashOrderOf(values: Iterable<string>): SlashOrder | null {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    const m = /^\s*(\d{1,2})\/(\d{1,2})\/\d{4}\s*$/.exec(v);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy = true;
    if (b > 12 && a <= 12) mdy = true;
  }
  return dmy === mdy ? null : dmy ? 'dmy' : 'mdy';
}

/** Every text value of a form: its fields and each row's cells. */
export function formValues(form: ParsedForm): string[] {
  return [...Object.values(form.fields), ...(form.rows ?? []).flatMap((r) => Object.values(r))];
}

export function readLooseDate(
  raw: string,
  order?: SlashOrder,
): { iso: string } | { problem: string } {
  const text = raw.trim();
  const UNREADABLE = 'can’t read this as a date — write it as yyyy-mm-dd';

  let y = 0;
  let m = 0;
  let d = 0;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{2})-(\d{2})( \d{2}:\d{2})?$/.exec(text))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text))) {
    [y, m, d] = [Number(match[3]), Number(match[2]), Number(match[1])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    y = Number(match[3]);
    if (a > 12 && b <= 12) {
      [d, m] = [a, b];
    } else if (b > 12 && a <= 12) {
      [m, d] = [a, b];
    } else if (order === 'dmy') {
      [d, m] = [a, b];
    } else if (order === 'mdy') {
      [m, d] = [a, b];
    } else {
      return { problem: 'day and month are ambiguous — write it as yyyy-mm-dd' };
    }
  } else {
    return { problem: UNREADABLE };
  }
  if (!calendarValid(y, m, d)) return { problem: UNREADABLE };
  if (y < YEAR_MIN || y > YEAR_MAX) {
    return { problem: `the year ${y} doesn’t look right` };
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return { iso: `${y}-${p(m)}-${p(d)}` };
}

// ---- what to check per form ------------------------------------------------

interface CheckSpec {
  fieldDates?: string[];
  rowDates?: string[];
  fieldLocodes?: string[];
  rowLocodes?: string[];
  /** [gisis column, locode column of the same row] */
  rowGisis?: [string, string];
}

const CHECK_SPECS: Partial<Record<FormType, CheckSpec>> = {
  fal2: { fieldDates: ['date'], fieldLocodes: ['port'], rowLocodes: ['loadingPort', 'dischargePort'] },
  'nsw-security': {
    rowDates: ['arrival', 'departure'],
    rowLocodes: ['portLocode'],
    rowGisis: ['facilityGisis', 'portLocode'],
  },
  'nsw-crew': { rowDates: ['dateOfBirth'] },
  'nsw-pax': {
    rowDates: ['dateOfBirth'],
    rowLocodes: ['embarkationPort', 'disembarkationPort'],
  },
  'nsw-waste': {
    fieldDates: ['dateOfDelivery'],
    fieldLocodes: ['lastPortDelivered', 'nextPortOfDelivery'],
    rowLocodes: ['deliveryPort'],
  },
  'nmsw-mdh': {
    fieldDates: ['arrivalDate'],
    rowDates: ['dateFrom', 'dateTo'],
    rowLocodes: ['locode'],
  },
};

const LOCODE_RE = /^[A-Z]{2}[A-Z2-9]{3}$/;

/** Comparable ship name: the forms shout in capitals and pad with spaces. */
function normName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * The hard gate (spec 0050 amendment): an IMO in the file that is not
 * the call's ship's IMO — ship 1's data is never accepted for ship 2.
 * Returns both numbers on a mismatch, null when they match or when
 * either side has no IMO to compare.
 */
export function shipImoMismatch(
  form: ParsedForm,
  callShip: CallShip,
): { fileImo: string; shipImo: string } | null {
  const fileImo = form.fields['imo']?.replace(/\D/g, '') ?? '';
  if (!fileImo || !callShip.imoNumber) return null;
  return fileImo === callShip.imoNumber
    ? null
    : { fileImo, shipImo: callShip.imoNumber };
}

interface PortRef {
  name: string | null;
  facilities: string[] | null;
  /** GISIS facility names by full code (spec 0053) — the uploaded list. */
  gisis: Map<string, string>;
  /** Codes GISIS has retired (0053 amendment): kept, named, never ok. */
  gisisRetired: Map<string, string>;
}

// ---- the checker -----------------------------------------------------------

export async function runChecks(
  client: PoolClient,
  form: ParsedForm,
  callShip: CallShip,
): Promise<DocumentChecks> {
  const annotations: Record<string, CheckAnnotation> = {};
  const spec = CHECK_SPECS[form.formType] ?? {};
  const rows = form.rows ?? [];

  // Every (path, value) that claims to be a LOCODE, then one master read
  const locodeAt: { path: string; raw: string }[] = [];
  for (const key of spec.fieldLocodes ?? []) {
    if (form.fields[key]) locodeAt.push({ path: `fields.${key}`, raw: form.fields[key] });
  }
  rows.forEach((row, i) => {
    for (const key of spec.rowLocodes ?? []) {
      if (row[key]) locodeAt.push({ path: `rows.${i}.${key}`, raw: row[key] });
    }
  });

  const wanted = new Set<string>();
  for (const { raw } of locodeAt) {
    const code = raw.trim().toUpperCase();
    if (code !== 'ZZUKN' && LOCODE_RE.test(code)) wanted.add(code);
  }
  // Every code that looks like one, whether or not the port list knows it —
  // the alias table is exactly about codes the port list does not have.
  const aliases = await aliasesForCodes(client, [...wanted]);

  const ports = new Map<string, PortRef>();
  if (wanted.size > 0) {
    const result = await client.query(
      `SELECT locode, name, data->'portFacilityCodes' AS facilities
         FROM platform.location
        WHERE locode = ANY($1) AND is_active`,
      [[...wanted]],
    );
    for (const row of result.rows as {
      locode: string;
      name: string | null;
      facilities: string[] | null;
    }[]) {
      ports.set(row.locode, {
        name: row.name,
        facilities: row.facilities,
        gisis: new Map(),
        gisisRetired: new Map(),
      });
    }
    // The uploaded GISIS list (spec 0053): completes the published codes
    // and brings the facility names the hub dataset lacks. Retired rows
    // ride along — a retired code must flag as retired, not as unknown.
    const gisis = await client.query(
      `SELECT locode, facility_code, facility_name, is_active
         FROM platform.gisis_port_facility
        WHERE locode = ANY($1)`,
      [[...wanted]],
    );
    for (const row of gisis.rows as {
      locode: string;
      facility_code: string;
      facility_name: string;
      is_active: boolean;
    }[]) {
      const port = ports.get(row.locode);
      if (!port) continue;
      if (row.is_active) port.gisis.set(row.facility_code, row.facility_name);
      else port.gisisRetired.set(row.facility_code, row.facility_name);
    }
  }

  for (const { path, raw } of locodeAt) {
    const code = raw.trim().toUpperCase();
    if (code === 'ZZUKN') {
      annotations[path] = { severity: 'ok', mapped: 'port not known (official code)' };
    } else if (!LOCODE_RE.test(code)) {
      annotations[path] = {
        severity: 'error',
        message: 'not a LOCODE — two letters for the country, then three characters',
      };
    } else if (!ports.has(code)) {
      // A code the port list does not know may still be a code we recognise:
      // retired, superseded by the port that absorbed the place, or a valid
      // code for somewhere else entirely (docs/specs/0056).
      const alias = aliases.get(code);
      annotations[path] = alias
        ? {
            severity: 'error',
            message: alias.note,
            ...(alias.candidates.length > 0 ? { suggest: alias.candidates } : {}),
          }
        : {
            severity: 'error',
            message: 'not in the port master list — check the code',
          };
    } else {
      const name = ports.get(code)!.name;
      const alias = aliases.get(code);
      // The code resolves, but the port system runs the place as a port area of
      // another port — readable, and still not what a declaration should say.
      annotations[path] = alias
        ? {
            severity: 'warning',
            message: alias.note,
            ...(name ? { mapped: name } : {}),
            port: code,
            ...(alias.candidates.length > 0 ? { suggest: alias.candidates } : {}),
          }
        : {
            severity: 'ok',
            ...(name ? { mapped: name } : {}),
            port: code,
          };
    }
    annotations[path].kind = 'locode';
  }

  // GISIS: the row's port publishes full codes (FIKTK-0007); ships write
  // suffixes. Normalize and check against the union of the hub dataset's
  // codes and the uploaded GISIS list (spec 0053 — that is where names
  // come from). A port neither source knows facilities for is an info
  // note, never a false error.
  if (spec.rowGisis) {
    const [gisisKey, locodeKey] = spec.rowGisis;
    rows.forEach((row, i) => {
      const raw = row[gisisKey];
      if (!raw) return;
      const path = `rows.${i}.${gisisKey}`;
      const code = (row[locodeKey] ?? '').trim().toUpperCase();
      if (!ports.has(code)) {
        annotations[path] = {
          severity: 'info',
          message: 'the port on this row can’t be resolved, so the facility code can’t be checked',
          kind: 'gisis',
        };
        return;
      }
      const port = ports.get(code)!;
      const portWord = port.name ?? code;
      let suffix = raw.trim().toUpperCase().replace(new RegExp(`^${code}-`), '');
      if (/^\d{1,4}$/.test(suffix)) suffix = suffix.padStart(4, '0');
      const full = `${code}-${suffix}`;
      // Rank (0053 amendment): the hub dataset syncs daily while our GISIS
      // copy can be months old, so a hub-published code always stays ok;
      // then GISIS-active; then GISIS-retired; then unknown.
      const known = new Set(port.facilities ?? []);
      for (const knownCode of port.gisis.keys()) known.add(knownCode);
      if (known.has(full)) {
        const name = port.gisis.get(full);
        annotations[path] = {
          severity: 'ok',
          mapped: name ? `${full} — ${name}` : `${full} — facility of ${portWord}`,
          port: code,
        };
      } else if (port.gisisRetired.has(full)) {
        annotations[path] = {
          severity: 'error',
          message:
            `${full} (${port.gisisRetired.get(full)!}) was retired from the ` +
            `GISIS list — not to be used in new reports`,
          port: code,
        };
      } else if (known.size === 0) {
        annotations[path] = {
          severity: 'info',
          message: `${portWord} publishes no facility list — the code can’t be checked`,
          port: code,
        };
      } else {
        annotations[path] = {
          severity: 'error',
          message: `${full} is not among ${portWord}’s published facility codes`,
          port: code,
        };
      }
      annotations[path].kind = 'gisis';
    });
  }

  // Dates: date cells already arrive as ISO (workbook.ts); what needs
  // reading here is hand-typed text like `2607-18`.
  const dateAt: { path: string; raw: string }[] = [];
  for (const key of spec.fieldDates ?? []) {
    if (form.fields[key]) dateAt.push({ path: `fields.${key}`, raw: form.fields[key] });
  }
  rows.forEach((row, i) => {
    for (const key of spec.rowDates ?? []) {
      if (row[key]) dateAt.push({ path: `rows.${i}.${key}`, raw: row[key] });
    }
  });
  const order = slashOrderOf(formValues(form)) ?? undefined;
  for (const { path, raw } of dateAt) {
    const read = readLooseDate(raw, order);
    if ('problem' in read) {
      annotations[path] = { severity: 'error', message: read.problem, kind: 'date' };
    } else if (read.iso !== raw.trim().slice(0, 10)) {
      annotations[path] = { severity: 'ok', mapped: read.iso, kind: 'date' };
    }
  }

  // Ship identity (user rule 2026-09-02): the file must belong to the
  // ship the call is for. A mismatched IMO refuses the upload outright
  // (documents.service gate); the annotation remains for documents
  // stored before the gate existed. The name asks to be tidied.
  const mismatch = shipImoMismatch(form, callShip);
  const fileImo = form.fields['imo']?.replace(/\D/g, '') ?? '';
  if (mismatch) {
    annotations['fields.imo'] = {
      severity: 'error',
      message:
        `IMO number in the file (${mismatch.fileImo}) is not this ship’s IMO ` +
        `(${mismatch.shipImo}) — this file belongs to another ship`,
    };
  } else if (fileImo && callShip.imoNumber) {
    annotations['fields.imo'] = { severity: 'ok', mapped: 'matches this ship' };
  }
  const fileName = form.fields['shipName'];
  if (fileName && callShip.name) {
    if (normName(fileName) === normName(callShip.name)) {
      annotations['fields.shipName'] = { severity: 'ok', mapped: `matches ${callShip.name}` };
    } else {
      annotations['fields.shipName'] = {
        severity: 'warning',
        message:
          `Ship name in the file (${fileName}) does not match the name in ` +
          `NEMOLink (${callShip.name}) — please correct one or the other`,
      };
    }
  }

  // NEMO code lists and units (spec 0093 §1, spec 0094)
  Object.assign(annotations, await runCodeChecks(client, form));

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const ann of Object.values(annotations)) {
    if (ann.severity === 'error') errorCount++;
    else if (ann.severity === 'warning') warningCount++;
    else if (ann.severity === 'info') infoCount++;
  }
  return {
    errorCount,
    warningCount,
    infoCount,
    annotations,
    checkedAt: new Date().toISOString(),
  };
}
