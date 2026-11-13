/**
 * Legacy and superseded LOCODEs (docs/specs/0056).
 *
 * The seed is ours, curated, committed beside this file — not vendored, so
 * invariant 8 does not apply; but every row carries the evidence for its
 * mapping, because a mapping without evidence is a guess.
 *
 * `relation` is the whole safety model:
 *
 *   not_a_code       the given code names nothing anywhere      -> may substitute
 *   port_area_of     bare code; the place is an area of another -> may substitute
 *   renamed          the place was renamed, the code was not    -> may substitute
 *   confusable_with  a VALID code for a different place         -> suggest only
 *
 * Replacing a valid code for a real place is an operator's decision, never a
 * lookup's — and neither is choosing between two candidates, so an alias whose
 * `data.ambiguous` lists more than one code suggests them all and substitutes
 * nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PoolClient } from 'pg';

export const ALIAS_RELATIONS = [
  'not_a_code',
  'port_area_of',
  'renamed',
  'confusable_with',
] as const;

export type AliasRelation = (typeof ALIAS_RELATIONS)[number];

export interface LocationAliasRow {
  givenCode: string | null;
  givenName: string | null;
  relation: AliasRelation;
  currentCode: string | null;
  note: string;
  evidence: string | null;
  data: Record<string, unknown>;
}

export interface AliasSeed {
  rows: LocationAliasRow[];
  received: number;
  skipped: number;
  reasons: string[];
}

const LOCODE_RE = /^[A-Z]{2}[A-Z2-9]{3}$/;

/**
 * The seed sits beside this module — in src/ for jest, copied into dist/ by the
 * nest build's `assets`. Read from disk rather than imported so the file stays
 * data anyone can edit, the way the vendored loaders read theirs.
 */
export function readSeedFile(): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, 'location-aliases.json'), 'utf8'),
  ) as unknown;
}

function text(value: unknown, max = 400): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/gu, ' ');
  return trimmed ? trimmed.slice(0, max) : null;
}

function code(value: unknown): string | null {
  const raw = text(value, 16);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return LOCODE_RE.test(upper) ? upper : null;
}

/**
 * Reads the committed seed. Invalid rows are counted and named, never thrown —
 * one bad row must not stop the locations job (AC 2).
 */
export function parseLocationAliases(input: unknown = readSeedFile()): AliasSeed {
  const raw = (input as { aliases?: unknown })?.aliases;
  if (!Array.isArray(raw)) {
    return { rows: [], received: 0, skipped: 0, reasons: ['no aliases array'] };
  }

  const rows: LocationAliasRow[] = [];
  const reasons: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const givenCode = code(item.givenCode);
    const givenName = text(item.givenName, 200);
    const label = givenCode ?? givenName ?? '(unnamed)';
    const relation = text(item.relation, 32) as AliasRelation | null;

    if (!givenCode && !givenName) {
      skip(reasons, label, 'neither givenCode nor givenName');
      continue;
    }
    if (item.givenCode && !givenCode) {
      skip(reasons, String(item.givenCode), 'givenCode is not LOCODE-shaped');
      continue;
    }
    if (!relation || !ALIAS_RELATIONS.includes(relation)) {
      skip(reasons, label, `unknown relation ${String(item.relation)}`);
      continue;
    }
    const note = text(item.note);
    if (!note) {
      skip(reasons, label, 'no note — nothing to tell a person');
      continue;
    }
    const currentCode = code(item.currentCode);
    if (item.currentCode && !currentCode) {
      skip(reasons, label, 'currentCode is not LOCODE-shaped');
      continue;
    }
    if (currentCode && currentCode === givenCode) {
      skip(reasons, label, 'currentCode equals givenCode');
      continue;
    }
    const key = `${givenCode ?? ''}|${givenName ?? ''}`;
    if (seen.has(key)) {
      skip(reasons, label, 'duplicate key in the seed');
      continue;
    }
    seen.add(key);

    const data = (item.data ?? {}) as Record<string, unknown>;
    rows.push({
      givenCode,
      givenName,
      relation,
      currentCode,
      note,
      evidence: text(item.evidence, 500),
      data: typeof data === 'object' && data !== null ? data : {},
    });
  }

  return { rows, received: raw.length, skipped: raw.length - rows.length, reasons };
}

function skip(reasons: string[], label: string, why: string): void {
  reasons.push(`${label}: ${why}`);
}

/** The seed's own provenance line, for the `source` column. */
export function aliasSource(input: unknown = readSeedFile()): string {
  const meta = (input as { version?: unknown })?.version;
  return `location-aliases.json@${typeof meta === 'string' ? meta : 'unknown'}`;
}

// ---- lookup ----------------------------------------------------------------

export interface AliasHit extends LocationAliasRow {
  /** The code to use instead, when this alias may be substituted at all. */
  substitute: string | null;
  /** Every candidate worth showing a person, best first. */
  candidates: string[];
}

function candidatesOf(row: LocationAliasRow): string[] {
  const fromData = [
    ...(Array.isArray(row.data.ambiguous) ? row.data.ambiguous : []),
    ...(Array.isArray(row.data.suggest) ? row.data.suggest : []),
  ].filter((c): c is string => typeof c === 'string' && LOCODE_RE.test(c));
  const all = row.currentCode ? [row.currentCode, ...fromData] : fromData;
  return [...new Set(all)];
}

/**
 * May this alias be applied without asking? Only when the given code names
 * nothing we could be overwriting, and only when there is exactly one answer.
 */
export function substituteFor(row: LocationAliasRow): string | null {
  if (row.relation === 'confusable_with') return null;
  const candidates = candidatesOf(row);
  if (candidates.length !== 1) return null;
  return row.currentCode ?? null;
}

export function asHit(row: LocationAliasRow): AliasHit {
  return { ...row, substitute: substituteFor(row), candidates: candidatesOf(row) };
}

interface AliasQueryRow {
  given_code: string | null;
  given_name: string | null;
  relation: AliasRelation;
  current_code: string | null;
  note: string;
  evidence: string | null;
  data: Record<string, unknown> | null;
}

function hitOf(row: AliasQueryRow): AliasHit {
  return asHit({
    givenCode: row.given_code,
    givenName: row.given_name,
    relation: row.relation,
    currentCode: row.current_code,
    note: row.note,
    evidence: row.evidence,
    data: row.data ?? {},
  });
}

/** Aliases for a set of codes, in one read — keyed by the given code. */
export async function aliasesForCodes(
  client: PoolClient,
  codes: string[],
): Promise<Map<string, AliasHit>> {
  const wanted = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const result = await client.query<AliasQueryRow>(
    `SELECT given_code, given_name, relation, current_code, note, evidence, data
       FROM platform.location_alias
      WHERE is_active AND given_code = ANY($1)`,
    [wanted],
  );
  const out = new Map<string, AliasHit>();
  for (const row of result.rows) {
    if (row.given_code) out.set(row.given_code, hitOf(row));
  }
  return out;
}

/** One alias by code, or by the plain name a person typed. */
export async function aliasFor(
  client: PoolClient,
  given: string,
): Promise<AliasHit | null> {
  const value = given.trim();
  if (!value) return null;
  const result = await client.query<AliasQueryRow>(
    `SELECT given_code, given_name, relation, current_code, note, evidence, data
       FROM platform.location_alias
      WHERE is_active
        AND (given_code = $1 OR lower(given_name) = lower($2))
      ORDER BY given_code IS NULL
      LIMIT 1`,
    [value.toUpperCase(), value],
  );
  const row = result.rows[0];
  return row ? hitOf(row) : null;
}
