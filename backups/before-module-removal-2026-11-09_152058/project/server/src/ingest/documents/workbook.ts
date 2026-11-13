/**
 * Workbook reading for uploaded ship forms (docs/specs/0049). SheetJS
 * (vendored 0.20.3) is the only maintained reader covering BIFF .xls —
 * the IMO FAL templates ships actually use. Everything here is pure:
 * buffer in, normalized text grids out. Values are kept as the sheet
 * displays them (`w`) — normalization to MIG codes/formats is the
 * mapping layer's job (docs/06), never the parser's.
 */

import * as XLSX from 'xlsx';

/** What the bytes actually are — ships rename files, so sniff, never trust. */
export type FileKind = 'xls' | 'xlsx' | 'pdf' | 'unknown';

export function sniffKind(buf: Buffer): FileKind {
  if (buf.length >= 4) {
    // %PDF
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
    // OLE2 compound file (BIFF .xls)
    if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'xls';
    // ZIP (OOXML .xlsx)
    if (buf[0] === 0x50 && buf[1] === 0x4b) return 'xlsx';
  }
  return 'unknown';
}

/** One sheet as trimmed display text; rows/cells beyond content dropped. */
export interface SheetGrid {
  name: string;
  rows: string[][];
}

/** Embedded code-list / instruction sheets carry no filled-in data. */
const REFERENCE_SHEET_RE = /instruction|locode|unlocode|isps|taul|^list$/i;

export function isReferenceSheet(name: string): boolean {
  return REFERENCE_SHEET_RE.test(name.trim());
}

const MAX_ROWS_PER_SHEET = 3000;
const MAX_COLS = 40;
const MAX_CELL_CHARS = 200;

interface DenseCell {
  v?: unknown;
  w?: string;
}

/**
 * Date cells are emitted as ISO, not as displayed (spec 0050): Kestrel's
 * `8/20/26` is a real date cell whose display format is locale noise —
 * the underlying value is exact. Hand-typed text dates stay as typed and
 * the checker flags them. `cellDates` gives UTC-midnight Dates.
 */
function isoOfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const time = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
  return time ? `${day} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : day;
}

function cellText(cell: DenseCell | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.v instanceof Date) {
    return Number.isNaN(cell.v.getTime()) ? '' : isoOfDate(cell.v);
  }
  const raw = cell.w !== undefined ? cell.w : String(cell.v as string | number | boolean);
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CELL_CHARS);
}

/**
 * Read every non-reference sheet into a text grid. Throws on anything
 * SheetJS cannot open — the caller records `failed` and keeps the raw file.
 */
export function readGrids(buf: Buffer): SheetGrid[] {
  const wb = XLSX.read(buf, { type: 'buffer', dense: true, cellDates: true });
  const grids: SheetGrid[] = [];
  for (const name of wb.SheetNames) {
    if (isReferenceSheet(name)) continue;
    const ws = wb.Sheets[name] as { '!data'?: DenseCell[][] } | undefined;
    const data = ws?.['!data'] ?? [];
    const rows: string[][] = [];
    for (let r = 0; r < Math.min(data.length, MAX_ROWS_PER_SHEET); r++) {
      const source = data[r] ?? [];
      const row: string[] = [];
      for (let c = 0; c < Math.min(source.length, MAX_COLS); c++) {
        row.push(cellText(source[c]));
      }
      while (row.length && row[row.length - 1] === '') row.pop();
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    grids.push({ name, rows });
  }
  return grids;
}

/**
 * The storable form of the grids: sparse [row, col, text] triples so no
 * ship-typed value is ever lost even where an extractor has no map yet
 * (spec 0049 — retrofittable extraction). Capped; the flag says so.
 */
export interface StoredGrid {
  name: string;
  cells: [number, number, string][];
}

const MAX_STORED_CELLS = 4000;

export function toStoredGrids(grids: SheetGrid[]): {
  grids: StoredGrid[];
  truncated: boolean;
} {
  const out: StoredGrid[] = [];
  let budget = MAX_STORED_CELLS;
  let truncated = false;
  for (const grid of grids) {
    const cells: [number, number, string][] = [];
    for (let r = 0; r < grid.rows.length && budget > 0; r++) {
      const row = grid.rows[r];
      for (let c = 0; c < row.length && budget > 0; c++) {
        if (row[c] === '') continue;
        cells.push([r, c, row[c]]);
        budget--;
      }
    }
    if (budget <= 0) truncated = true;
    out.push({ name: grid.name, cells });
  }
  return { grids: out, truncated };
}
