/**
 * GISIS port-facility master list (docs/specs/0053): parsing and import of
 * the IMO GISIS Maritime Security CSV export. GISIS sits behind a login —
 * no public bulk URL — so a platform admin uploads the export by hand and
 * this module turns it into `platform.gisis_port_facility`, the name source
 * behind facility codes everywhere they surface (port info, checks).
 *
 * Columns are addressed by header name, never by position; a structurally
 * wrong file throws `GisisCsvError` (the controller's 400) before any run
 * bookkeeping — rejected input leaves no durable trace (spec 0008).
 */

import type { PoolClient } from 'pg';

/** A file that is not a GISIS Maritime Security export — plain words. */
export class GisisCsvError extends Error {}

export interface GisisFacilityRow {
  /** Normalized full code: <LOCODE>-<4 digits>. */
  facilityCode: string;
  locode: string;
  /** Two-letter country, the facility code's own prefix. */
  country: string;
  portName: string | null;
  facilityName: string;
  description: string | null;
  longitude: string | null;
  latitude: string | null;
  planApproved: boolean | null;
  planWithdrawn: boolean | null;
  /** The export's own "Last Updated", as an ISO day. */
  sourceUpdated: string | null;
}

export interface GisisParseResult {
  /** Data records in the file (header excluded). */
  received: number;
  /** Normalized, deduped facility rows. */
  rows: GisisFacilityRow[];
  skipped: number;
  /** The first few skip reasons, plain words. */
  skippedReasons: string[];
  /** In-file duplicates folded away (last wins). */
  duplicates: number;
  /** The first few duplicated codes, so the stat explains itself. */
  duplicateCodes: string[];
}

// The headers the export carries; matched case-insensitively after trim.
const REQUIRED_HEADERS = [
  'imo port facility number',
  'facility name',
  'port name',
  'country code',
] as const;

// The 5-char prefix is GISIS's own port identifier — usually the UN/LOCODE,
// but NOT always a valid one: GISIS issues pseudo-codes with 0/1 in the tail
// (GB001-0001 = Braye Harbour, Alderney), which the UN/LOCODE alphabet bans.
// So the tail accepts all digits here, unlike the strict LOCODE checks.
const FACILITY_RE = /^([A-Z]{2}[A-Z0-9]{3})-(\d{1,4})$/;
const MAX_SKIP_REASONS = 5;

/** RFC 4180: quoted fields may hold commas, doubled quotes and line breaks. */
function parseCsvRecords(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  record.push(field);
  if (record.length > 1 || record[0] !== '') records.push(record);
  return records;
}

/** GISIS dates are dd/mm/yyyy (with a time we drop); unreadable → null. */
function readGisisDate(raw: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw.trim());
  if (!match) return null;
  const [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

function readGisisBool(raw: string): boolean | null {
  const text = raw.trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

export function parseGisisCsv(text: string): GisisParseResult {
  const records = parseCsvRecords(text);
  if (records.length === 0) {
    throw new GisisCsvError('The file is empty');
  }
  const header = records[0]!.map((h) => h.trim().toLowerCase());
  const col = new Map(header.map((name, i) => [name, i]));
  for (const name of REQUIRED_HEADERS) {
    if (!col.has(name)) {
      throw new GisisCsvError(
        `This doesn’t look like a GISIS Maritime Security export — ` +
          `the column “${name}” is missing`,
      );
    }
  }
  const cell = (record: string[], name: string): string => {
    const i = col.get(name);
    return i === undefined ? '' : (record[i] ?? '').trim();
  };

  const byCode = new Map<string, GisisFacilityRow>();
  let received = 0;
  let skipped = 0;
  let duplicates = 0;
  const skippedReasons: string[] = [];
  const duplicateCodes: string[] = [];
  const skip = (row: number, reason: string): void => {
    skipped++;
    if (skippedReasons.length < MAX_SKIP_REASONS) {
      skippedReasons.push(`row ${row}: ${reason}`);
    }
  };

  for (let r = 1; r < records.length; r++) {
    const record = records[r]!;
    received++;
    const rawCode = cell(record, 'imo port facility number').toUpperCase();
    const match = FACILITY_RE.exec(rawCode);
    if (!match) {
      skip(r, `“${rawCode || '(empty)'}” is not a facility number`);
      continue;
    }
    const facilityName = cell(record, 'facility name');
    if (!facilityName) {
      skip(r, `${rawCode} has no facility name`);
      continue;
    }
    const locode = match[1]!;
    const facilityCode = `${locode}-${match[2]!.padStart(4, '0')}`;
    if (byCode.has(facilityCode)) {
      duplicates++;
      if (duplicateCodes.length < MAX_SKIP_REASONS) duplicateCodes.push(facilityCode);
    }
    byCode.set(facilityCode, {
      facilityCode,
      locode,
      country: locode.slice(0, 2),
      portName: cell(record, 'port name') || null,
      facilityName,
      description: cell(record, 'description') || null,
      longitude: cell(record, 'longitude') || null,
      latitude: cell(record, 'latitude') || null,
      planApproved: readGisisBool(cell(record, 'plan approved?')),
      planWithdrawn: readGisisBool(cell(record, 'security plan withdrawn?')),
      sourceUpdated: readGisisDate(cell(record, 'last updated')),
    });
  }
  return {
    received,
    rows: [...byCode.values()],
    skipped,
    skippedReasons,
    duplicates,
    duplicateCodes,
  };
}

/**
 * Per-country replace (docs/specs/0053): a GISIS export is complete for the
 * countries it covers — upsert every row (churn-guarded, spec 0027 pattern),
 * then RETIRE the uploaded countries' facilities the file no longer lists
 * (is_active = false, row kept, `updated` = the moment it dropped out; a
 * code that reappears later reactivates in place). Countries not in the
 * file are never touched, and an identical re-upload writes nothing.
 */
export async function importGisisFacilities(
  client: PoolClient,
  parsed: GisisParseResult,
  author: string,
): Promise<Record<string, unknown>> {
  const countries = [...new Set(parsed.rows.map((r) => r.country))].sort();
  let inserted = 0;
  let updated = 0;
  for (const chunk of chunksOf(parsed.rows, 500)) {
    const values: unknown[] = [];
    const tuples = chunk.map((row, i) => {
      values.push(
        row.facilityCode,
        row.locode,
        row.country,
        row.portName,
        row.facilityName,
        row.description,
        row.longitude,
        row.latitude,
        row.planApproved,
        row.planWithdrawn,
        row.sourceUpdated,
        author,
      );
      const b = i * 12;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}::date, $${b + 12})`;
    });
    const result = await client.query<{ inserted: boolean }>(
      `INSERT INTO platform.gisis_port_facility AS gf
         (facility_code, locode, country, port_name, facility_name, description,
          longitude, latitude, plan_approved, plan_withdrawn, source_updated, author)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (facility_code) DO UPDATE
         SET locode = EXCLUDED.locode, country = EXCLUDED.country,
             port_name = EXCLUDED.port_name, facility_name = EXCLUDED.facility_name,
             description = EXCLUDED.description, longitude = EXCLUDED.longitude,
             latitude = EXCLUDED.latitude, plan_approved = EXCLUDED.plan_approved,
             plan_withdrawn = EXCLUDED.plan_withdrawn,
             source_updated = EXCLUDED.source_updated, author = EXCLUDED.author,
             is_active = true, updated = now()
         WHERE gf.port_name IS DISTINCT FROM EXCLUDED.port_name
            OR gf.facility_name IS DISTINCT FROM EXCLUDED.facility_name
            OR gf.description IS DISTINCT FROM EXCLUDED.description
            OR gf.longitude IS DISTINCT FROM EXCLUDED.longitude
            OR gf.latitude IS DISTINCT FROM EXCLUDED.latitude
            OR gf.plan_approved IS DISTINCT FROM EXCLUDED.plan_approved
            OR gf.plan_withdrawn IS DISTINCT FROM EXCLUDED.plan_withdrawn
            OR gf.source_updated IS DISTINCT FROM EXCLUDED.source_updated
            OR NOT gf.is_active
       RETURNING (xmax = 0) AS inserted`,
      values,
    );
    for (const row of result.rows) {
      if (row.inserted) inserted++;
      else updated++;
    }
  }
  const retired = await client.query(
    `UPDATE platform.gisis_port_facility
        SET is_active = false, updated = now()
      WHERE country = ANY($1) AND is_active
        AND NOT (facility_code = ANY($2))`,
    [countries, parsed.rows.map((r) => r.facilityCode)],
  );
  return {
    received: parsed.received,
    imported: parsed.rows.length,
    inserted,
    updated,
    unchanged: parsed.rows.length - inserted - updated,
    retired: retired.rowCount ?? 0,
    skipped: parsed.skipped,
    ...(parsed.skippedReasons.length ? { skippedReasons: parsed.skippedReasons } : {}),
    ...(parsed.duplicates
      ? { duplicates: parsed.duplicates, duplicateCodes: parsed.duplicateCodes }
      : {}),
    countries,
  };
}

/** "More than 3 months old" (user decision 2026-09-02) — the reminder gate. */
export const GISIS_STALE_DAYS = 90;

export function gisisStale(
  lastOkFinished: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastOkFinished) return true;
  const age = now.getTime() - new Date(lastOkFinished).getTime();
  return age > GISIS_STALE_DAYS * 24 * 60 * 60 * 1000;
}

function chunksOf<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
