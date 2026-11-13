/**
 * The FI requirement profile (docs/specs/0028). Two vendored sources join
 * here:
 *
 * - vendor/nemo/hub/fi-required.json — the published "Data Elements required
 *   in Finland" page: authoritative for WHICH elements are in the FI
 *   profile, with condition rule refs and code-list pointers.
 * - vendor/nemo/hub/config.json — the parsed per-formality Excel matrices:
 *   status M/O and occurrence per element (the page comments those columns
 *   out of its HTML).
 *
 * The two disagree on a handful of elements in some formalities (verified
 * 2026-08-23) — the join surfaces that (`pageOnly` / `matrixOnly`) instead
 * of hiding it. Pure filesystem → data; the Phase-2 validation/review UI
 * reads this to mark required fields.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FiRequiredElement {
  de: string;
  nameEn: string;
  nameFi: string;
  descriptionEn: string;
  descriptionFi: string;
  conditions: string[];
  codeList: string | null;
}

export interface FiRequiredFormality {
  code: string;
  title: string;
  elements: FiRequiredElement[];
}

export function loadFiRequired(vendorDir: string): FiRequiredFormality[] {
  const raw = JSON.parse(
    readFileSync(join(vendorDir, 'nemo', 'hub', 'fi-required.json'), 'utf8'),
  ) as { formalities?: unknown };
  if (!Array.isArray(raw.formalities) || raw.formalities.length === 0) {
    throw new Error('fi-required.json: expected a formalities array');
  }
  const out: FiRequiredFormality[] = [];
  for (const f of raw.formalities as Record<string, unknown>[]) {
    const code = typeof f.code === 'string' ? f.code : '';
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new Error(`fi-required.json: bad formality code '${code}'`);
    }
    if (!Array.isArray(f.elements) || f.elements.length === 0) {
      throw new Error(`fi-required.json: ${code} has no elements`);
    }
    const elements: FiRequiredElement[] = [];
    for (const e of f.elements as Record<string, unknown>[]) {
      const de = typeof e.de === 'string' ? e.de : '';
      if (!/^DE-\d{3}-\d{2}$/.test(de)) {
        throw new Error(`fi-required.json: ${code} has bad element id '${de}'`);
      }
      elements.push({
        de,
        nameEn: typeof e.nameEn === 'string' ? e.nameEn : '',
        nameFi: typeof e.nameFi === 'string' ? e.nameFi : '',
        descriptionEn: typeof e.descriptionEn === 'string' ? e.descriptionEn : '',
        descriptionFi: typeof e.descriptionFi === 'string' ? e.descriptionFi : '',
        conditions: Array.isArray(e.conditions)
          ? e.conditions.filter((c): c is string => typeof c === 'string')
          : [],
        codeList: typeof e.codeList === 'string' && e.codeList ? e.codeList : null,
      });
    }
    out.push({ code, title: typeof f.title === 'string' ? f.title : code, elements });
  }
  return out;
}

// ---- the reconciled profile ------------------------------------------------

export interface FiProfileElement extends FiRequiredElement {
  /** From the Excel matrix; null when the matrix has no row for this DE. */
  status: 'M' | 'O' | null;
  occurrence: string | null;
  /** On the published page but not FI-flagged in the matrix. */
  pageOnly: boolean;
  /** FI-flagged in the matrix but absent from the published page. */
  matrixOnly: boolean;
}

export interface FiProfileFormality {
  code: string;
  title: string;
  elements: FiProfileElement[];
}

interface MatrixElement {
  emsweDataElementId?: string;
  status?: string;
  occurrence?: string;
  finlandWanted?: boolean;
  labels?: { en?: string; fi?: string };
}

interface MatrixRow {
  status: 'M' | 'O' | null;
  occurrence: string | null;
  finlandWanted: boolean;
  nameEn: string;
  nameFi: string;
}

function matrixByDe(elements: Record<string, MatrixElement>): Map<string, MatrixRow[]> {
  const byDe = new Map<string, MatrixRow[]>();
  for (const e of Object.values(elements)) {
    const de = e.emsweDataElementId;
    if (!de) continue;
    const rows = byDe.get(de) ?? [];
    rows.push({
      status: e.status === 'M' || e.status === 'O' ? e.status : null,
      occurrence: typeof e.occurrence === 'string' && e.occurrence ? e.occurrence : null,
      finlandWanted: e.finlandWanted === true,
      nameEn: e.labels?.en ?? '',
      nameFi: e.labels?.fi ?? '',
    });
    byDe.set(de, rows);
  }
  return byDe;
}

/** A DE can appear on several matrix rows — prefer the FI-flagged one. */
function pickRow(rows: MatrixRow[]): MatrixRow {
  return rows.find((r) => r.finlandWanted) ?? rows[0]!;
}

export function loadFiProfile(vendorDir: string): FiProfileFormality[] {
  const page = loadFiRequired(vendorDir);
  const config = JSON.parse(
    readFileSync(join(vendorDir, 'nemo', 'hub', 'config.json'), 'utf8'),
  ) as { formalities?: Record<string, { elements?: Record<string, MatrixElement> }> };
  const matrices = config.formalities ?? {};

  return page.map((formality) => {
    const matrix = matrixByDe(matrices[formality.code]?.elements ?? {});
    const onPage = new Set(formality.elements.map((e) => e.de));

    const elements: FiProfileElement[] = formality.elements.map((e) => {
      const rows = matrix.get(e.de);
      const row = rows ? pickRow(rows) : null;
      return {
        ...e,
        status: row?.status ?? null,
        occurrence: row?.occurrence ?? null,
        pageOnly: !rows || !rows.some((r) => r.finlandWanted),
        matrixOnly: false,
      };
    });

    // FI-flagged in the matrix but not published on the page — keep visible
    for (const [de, rows] of matrix) {
      if (onPage.has(de) || !rows.some((r) => r.finlandWanted)) continue;
      const row = pickRow(rows);
      elements.push({
        de,
        nameEn: row.nameEn,
        nameFi: row.nameFi,
        descriptionEn: '',
        descriptionFi: '',
        conditions: [],
        codeList: null,
        status: row.status,
        occurrence: row.occurrence,
        pageOnly: false,
        matrixOnly: true,
      });
    }
    return { code: formality.code, title: formality.title, elements };
  });
}
