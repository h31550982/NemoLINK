/**
 * The corrected file (docs/specs/0093 §3): the ship's own workbook back,
 * with NEMO codes, units and the operator's corrections written into the
 * cells the parser read them from (ParsedForm.cells). Everything else —
 * formatting, other sheets, dropdowns, the ship's other text — is left
 * byte for byte: the sheet XML is patched cell by cell, never re-saved
 * through SheetJS (which drops styles). The stored original is untouched.
 *
 * `.xls` uploads cannot be patched; they come back as `.xlsx` (D3): the
 * converted template of the same form, with every cell the ship typed and
 * then the NEMO values, provided the upload's labels match the template.
 */

import { readFileSync } from 'fs';
import { deflateRawSync } from 'zlib';
import { join } from 'path';
import * as XLSX from 'xlsx';
import type { CheckAnnotation, Corrections, DocumentChecks } from './form-checks';
import { LISTS, splitEffects } from './form-codes';
import type { FormType, ParsedForm } from './form-parser';
import { SheetGrid, readGrids, sniffKind } from './workbook';

// ---- what to write ---------------------------------------------------------

export interface CellWrite {
  addr: string;
  value: string | number;
  /** A style to give the cell, whatever it had — for rows added past a table. */
  style?: string;
}

/** Lists written as "code + the ship's words" (spec 0093 D2). */
const PREFIXED = new Set<string>([LISTS.storesArticle, LISTS.crewRank]);
/** Lists written as the bare code. */
const BARE = new Set<string>([LISTS.nationality, LISTS.country]);

/** The words after the code in "STO-001 — Alcoholic spirits". */
function listText(ann: CheckAnnotation): string {
  return ann.mapped?.split(' — ').slice(1).join(' — ') ?? '';
}

/** "STO-001 Rum": the code in front, unless the words already start with it. */
function prefixed(code: string, words: string): string {
  const w = words.trim();
  if (w.toUpperCase() === code || w.toUpperCase().startsWith(`${code} `)) return w;
  return w === '' || w.toUpperCase() === code ? code : `${code} ${w}`;
}

/** The NEMO-ready text of one coded value, or null to leave the cell. */
function codeValue(ann: CheckAnnotation, written: string, original: string, corrected: boolean): string | null {
  const code = ann.code!;
  const list = ann.codelist ?? '';
  if (PREFIXED.has(list)) {
    // A picked bare code keeps the ship's own words beside it
    const words = corrected && written.trim().toUpperCase() === code ? original : written;
    return prefixed(code, words);
  }
  if (BARE.has(list)) return code;
  if (!corrected) return null;
  if (list === LISTS.gender) return code === '1' ? 'M' : code === '2' ? 'F' : code;
  // Security level and the like: the list's own words, as the template's dropdown has them
  return listText(ann) || code;
}

/** FAL 4: "CRE-001 Rum 2 LTR; CRE-006 Pipe tobacco 0.5 KGM". */
function effectsValue(ann: CheckAnnotation, written: string): string | null {
  const items = ann.items ?? [];
  if (items.length === 0) return null;
  const parts = splitEffects(written);
  if (parts.length !== items.length) return null;
  return items
    .map((item, i) => {
      const words = parts[i].article.replace(/^[A-Z]{3}-\d{3}\s+/, '');
      const qty = item.mapped?.match(/(\d+(?:\.\d+)?) ([A-Z]{3})$/);
      return `${item.code} ${words}${qty ? ` ${qty[1]} ${qty[2]}` : ''}`;
    })
    .join('; ');
}

/**
 * Every cell to write: the NEMO form of each checked value, and each
 * correction. Values still in error are not written — the caller refuses
 * the download while any remain.
 */
export function nemoWrites(
  form: ParsedForm,
  effective: ParsedForm,
  checks: DocumentChecks,
  corrections: Corrections | null,
  wasteLabels: Map<string, string> = new Map(),
): CellWrite[] {
  const cells = form.cells ?? {};
  const writes = new Map<string, string | number>();
  const paths = new Set([...Object.keys(checks.annotations), ...Object.keys(corrections ?? {})]);

  for (const path of paths) {
    const addr = cells[path];
    if (!addr) continue;
    // "Plastics 501" is one cell: written through its code only
    if (form.formType === 'nsw-waste' && path.endsWith('.type')) continue;
    const ann = checks.annotations[path];
    const corrected = !!corrections?.[path];
    const written = valueOf(effective, path) ?? '';
    const original = valueOf(form, path) ?? '';
    if (ann?.severity === 'error') continue;

    let value: string | number | null = null;
    switch (ann?.kind) {
      case 'code':
        if (ann.code && form.formType === 'nsw-waste') {
          value = corrected ? (wasteLabels.get(ann.code) ?? `${listText(ann)} ${ann.code}`) : null;
        } else if (ann.code) {
          value = codeValue(ann, written, original, corrected);
        }
        break;
      case 'effects':
        value = effectsValue(ann, written);
        break;
      case 'unit':
        value = ann.mapped ?? null;
        break;
      case 'amount': {
        const n = Number((ann.mapped ?? written).replace(/\s*m³$/, '').replace(',', '.'));
        value = Number.isFinite(n) && (corrected || ann.mapped) ? n : null;
        break;
      }
      case 'date':
        value = ann.mapped && /^\d{4}-\d{2}-\d{2}$/.test(ann.mapped) ? ann.mapped : corrected ? written : null;
        break;
      default:
        value = corrected ? written : null;
    }
    if (value !== null && String(value) !== original) writes.set(addr, value);
  }
  return [...writes].map(([addr, value]) => ({ addr, value }));
}

function valueOf(form: ParsedForm, path: string): string | undefined {
  const [kind, a, b] = path.split('.');
  if (kind === 'fields') return form.fields[a];
  return form.rows?.[Number(a)]?.[b];
}

// ---- patching the sheet XML ------------------------------------------------

function escXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colIndex(addr: string): number {
  const letters = /^[A-Z]+/.exec(addr)![0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const rowOf = (addr: string) => Number(/\d+$/.exec(addr)![0]);

function cellXml(addr: string, value: string | number, style: string | null): string {
  const s = style ? ` s="${style}"` : '';
  if (typeof value === 'number') return `<c r="${addr}"${s}><v>${value}</v></c>`;
  return `<c r="${addr}"${s} t="inlineStr"><is><t xml:space="preserve">${escXml(value)}</t></is></c>`;
}

const CELL_RE = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
const ROW_RE = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;

/** Set cells in one worksheet's XML, keeping each cell's style (`s`). */
export function patchSheetXml(xml: string, writes: CellWrite[]): string {
  const byRow = new Map<number, CellWrite[]>();
  for (const w of writes) {
    const r = rowOf(w.addr);
    byRow.set(r, [...(byRow.get(r) ?? []), w]);
  }
  let out = xml.replace(/<sheetData\s*\/>/, '<sheetData></sheetData>');
  for (const [r, rowWrites] of byRow) {
    let found = false;
    out = out.replace(ROW_RE, (rowXml) => {
      const open = /^<row\b[^>]*?(\/?)>/.exec(rowXml)!;
      if (!new RegExp(`\\br="${r}"`).test(open[0])) return rowXml;
      found = true;
      // spans is an optimisation hint; a row we change drops it rather than lie
      const openTag = open[0].replace(/\sspans="[^"]*"/, '').replace(/\/>$/, '>');
      let body = open[1] === '/' ? '' : rowXml.slice(open[0].length, -'</row>'.length);
      const above = stylesAbove(out, r);
      for (const w of rowWrites) body = setCellInRow(body, w, above);
      return `${openTag}${body}</row>`;
    });
    if (!found) {
      // A row the sheet does not have yet: each cell styled like its column
      // in the nearest row above, so an added line looks like the table's
      const above = stylesAbove(out, r);
      const body = rowWrites
        .sort((a, b) => colIndex(a.addr) - colIndex(b.addr))
        .map((w) => cellXml(w.addr, w.value, w.style ?? above.get(/^[A-Z]+/.exec(w.addr)![0]) ?? null))
        .join('');
      out = insertRow(out, r, `<row r="${r}">${body}</row>`);
    }
  }
  return out;
}

/** Column letter → style of the cells of the nearest existing row above `r`. */
function stylesAbove(xml: string, r: number): Map<string, string> {
  let best: { n: number; row: string } | null = null;
  for (const m of xml.matchAll(ROW_RE)) {
    const n = Number(/\br="(\d+)"/.exec(m[0])?.[1]);
    if (n < r && (!best || n > best.n)) best = { n, row: m[0] };
  }
  const styles = new Map<string, string>();
  for (const c of best?.row.matchAll(CELL_RE) ?? []) {
    const col = /\br="([A-Z]+)\d+"/.exec(c[0])?.[1];
    const style = /^<c\b[^>]*\bs="(\d+)"/.exec(c[0])?.[1];
    if (col && style) styles.set(col, style);
  }
  return styles;
}

/** Set one cell in a row's XML; a new cell takes its column's style from `above`. */
function setCellInRow(body: string, w: CellWrite, above: Map<string, string>): string {
  const newStyle = w.style ?? above.get(/^[A-Z]+/.exec(w.addr)![0]) ?? null;
  let replaced = false;
  const next = body.replace(CELL_RE, (c) => {
    if (!new RegExp(`^<c\\b[^>]*\\br="${w.addr}"`).test(c)) return c;
    replaced = true;
    const style = w.style ?? /^<c\b[^>]*\bs="(\d+)"/.exec(c)?.[1] ?? null;
    return cellXml(w.addr, w.value, style);
  });
  if (replaced) return next;
  // A new cell goes before the first cell to its right
  const target = colIndex(w.addr);
  let inserted = false;
  const withNew = body.replace(CELL_RE, (c) => {
    if (inserted) return c;
    const r = /\br="([A-Z]+)\d+"/.exec(c)?.[1];
    if (r && colIndex(r) > target) {
      inserted = true;
      return cellXml(w.addr, w.value, newStyle) + c;
    }
    return c;
  });
  return inserted ? withNew : body + cellXml(w.addr, w.value, newStyle);
}

function insertRow(xml: string, r: number, rowXml: string): string {
  let inserted = false;
  const out = xml.replace(ROW_RE, (row) => {
    if (inserted) return row;
    const n = Number(/\br="(\d+)"/.exec(row)?.[1]);
    if (n > r) {
      inserted = true;
      return rowXml + row;
    }
    return row;
  });
  return inserted ? out : out.replace('</sheetData>', `${rowXml}</sheetData>`);
}

// ---- the workbook zip ------------------------------------------------------

/** SheetJS's zip container (XLSX.CFB): the fields the writer touches. */
interface Zip {
  FullPaths: string[];
  FileIndex: { content: Buffer | Uint8Array; size: number }[];
}

function entry(zip: Zip, path: string): { content: Buffer | Uint8Array; size: number } | null {
  const i = zip.FullPaths.findIndex((p) => p.replace(/^Root Entry\//, '') === path);
  return i === -1 ? null : zip.FileIndex[i];
}

const text = (e: { content: Buffer | Uint8Array }) => Buffer.from(e.content).toString('utf8');

const unescXml = (t: string) =>
  t.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The worksheet part of a named sheet, through workbook.xml and its rels. */
function sheetPart(zip: Zip, sheetName: string | undefined): string | null {
  const wb = entry(zip, 'xl/workbook.xml');
  const rels = entry(zip, 'xl/_rels/workbook.xml.rels');
  if (!wb || !rels) return null;
  const sheets = [...text(wb).matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: unescXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? ''),
    rid: /\br:id="([^"]*)"/.exec(m[0])?.[1] ?? '',
  }));
  const sheet = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  if (!sheet) return null;
  const rel = [...text(rels).matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0])
    .find((m) => new RegExp(`\\bId="${sheet.rid}"`).test(m));
  const target = rel && /\bTarget="([^"]*)"/.exec(rel)?.[1];
  if (!target) return null;
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

/** Column letter → style of one row of a sheet, as the workbook has it. */
export function rowStyles(xlsx: Buffer, sheetName: string, row: number): Map<string, string> {
  const zip = XLSX.CFB.read(xlsx, { type: 'buffer' }) as unknown as Zip;
  const part = sheetPart(zip, sheetName);
  const sheet = part ? entry(zip, part) : null;
  return sheet ? stylesAbove(text(sheet), row + 1) : new Map();
}

/** Write cells into one sheet of an .xlsx; every other part stays as it was. */
export function writeCells(xlsx: Buffer, sheetName: string | undefined, writes: CellWrite[]): Buffer {
  return writeSheets(xlsx, { [sheetName ?? '']: writes });
}

/** Write cells into several sheets at once (a key '' = the first sheet). */
export function writeSheets(xlsx: Buffer, bySheet: Record<string, CellWrite[]>): Buffer {
  const zip = XLSX.CFB.read(xlsx, { type: 'buffer' }) as unknown as Zip;
  for (const [sheetName, writes] of Object.entries(bySheet)) {
    const part = sheetPart(zip, sheetName === '' ? undefined : sheetName);
    const sheet = part ? entry(zip, part) : null;
    if (!sheet) throw new Error(`the sheet “${sheetName}” was not found in the workbook`);
    const patched = Buffer.from(patchSheetXml(text(sheet), writes), 'utf8');
    sheet.content = patched;
    sheet.size = patched.length;
  }
  return writeZip(zip);
}

// ---- packing the zip ---------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip of the given files, deflated with Node's zlib at full strength —
 * SheetJS's own zip writer compresses about 2.5 times worse than Excel, so
 * a corrected 2.7 MB form came back at 7 MB. `[Content_Types].xml` first,
 * as Office writes it.
 */
export function packZip(files: { name: string; data: Buffer }[]): Buffer {
  const ordered = [...files].sort((a, b) => (a.name === '[Content_Types].xml' ? -1 : b.name === '[Content_Types].xml' ? 1 : 0));
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of ordered) {
    const name = Buffer.from(f.name, 'utf8');
    const packed = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time, date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** SheetJS's container, written back as a proper zip (see packZip). */
function writeZip(zip: Zip): Buffer {
  return packZip(
    partNames(zip).map((name) => ({ name, data: Buffer.from(entry(zip, name)!.content) })),
  );
}

// ---- keeping only some sheets ----------------------------------------------

/** Part paths as the zip names them ("xl/worksheets/sheet9.xml"). */
function partNames(zip: Zip): string[] {
  return zip.FullPaths.filter((p) => !p.endsWith('/') && !p.includes('Sh33tJ5')).map((p) => p.replace(/^Root Entry\//, ''));
}

/** "xl/worksheets/_rels/sheet9.xml.rels" for "xl/worksheets/sheet9.xml". */
const relsOf = (part: string) => part.replace(/([^/]+)$/, '_rels/$1.rels');

/** A rels file's targets, resolved against its part's folder. */
function targetsOf(zip: Zip, relsPath: string): string[] {
  const rels = entry(zip, relsPath);
  if (!rels) return [];
  const folder = relsPath.replace(/_rels\/[^/]+$/, '');
  return [...text(rels).matchAll(/\bTarget="([^"]+)"/g)]
    .filter((m) => !/TargetMode="External"/.test(m.input.slice(m.index, m.index + 300).split('>')[0]!))
    .map((m) => {
      const t = m[1]!;
      if (t.startsWith('/')) return t.slice(1);
      const parts = (folder + t).split('/');
      const out: string[] = [];
      for (const p of parts) {
        if (p === '..') out.pop();
        else if (p !== '.' && p !== '') out.push(p);
      }
      return out.join('/');
    });
}

function setText(zip: Zip, path: string, xml: string): void {
  const e = entry(zip, path);
  if (!e) return;
  const buf = Buffer.from(xml, 'utf8');
  e.content = buf;
  e.size = buf.length;
}

/**
 * The shared strings only the kept sheets use, renumbered — the removed
 * lookup sheets' words (5 600 HS headings and the rest) go with them.
 */
function pruneSharedStrings(zip: Zip, sheets: string[]): void {
  const sst = entry(zip, 'xl/sharedStrings.xml');
  if (!sst) return;
  const xml = text(sst);
  const items = [...xml.matchAll(/<si>[\s\S]*?<\/si>|<si\/>/g)].map((m) => m[0]);
  const used = new Map<number, number>();
  const sharedRef = /(<c\b[^>]*\bt="s"[^>]*>\s*<v>)(\d+)(<\/v>)/g;
  for (const part of sheets) {
    const e = entry(zip, part);
    if (!e) continue;
    for (const m of text(e).matchAll(sharedRef)) {
      const old = Number(m[2]);
      if (!used.has(old)) used.set(old, used.size);
    }
  }
  for (const part of sheets) {
    const e = entry(zip, part);
    if (e) setText(zip, part, text(e).replace(sharedRef, (_a, pre: string, n: string, post: string) => `${pre}${used.get(Number(n))}${post}`));
  }
  const kept = [...used.entries()].sort((a, b) => a[1] - b[1]).map(([old]) => items[old] ?? '<si><t></t></si>');
  const head = /^[\s\S]*?<sst\b[^>]*>/.exec(xml)![0]
    .replace(/\bcount="\d+"/, `count="${kept.length}"`)
    .replace(/\buniqueCount="\d+"/, `uniqueCount="${kept.length}"`);
  setText(zip, 'xl/sharedStrings.xml', `${head}${kept.join('')}</sst>`);
}

/**
 * Empty cells far right of the tables go: NEMO's sheets carry styled blanks
 * out to column XEL (16 000 columns, megabytes of XML). A cell with a value
 * is never touched, wherever it is; every table sits well left of `maxCol`.
 */
function trimFarCells(xml: string, maxCol: number): string {
  return xml.replace(CELL_RE, (c) => {
    if (/<v>|<is>|<f>|<f /.test(c)) return c;
    const col = /\br="([A-Z]+)\d+"/.exec(c)?.[1];
    return col && colIndex(col) > maxCol ? '' : c;
  });
}

/**
 * The sheet opens at its top left, A1 selected — NEMO's template was saved
 * scrolled (the security sheet at C21, the health sheet at row 58), so the
 * download opened mid-sheet and looked as if parts were missing. Only the
 * first sheet is the selected tab: two selected tabs open as a group.
 */
function openAtTopLeft(xml: string, first: boolean): string {
  return xml.replace(/<sheetView\b[^>]*?(?:\/>|>[\s\S]*?<\/sheetView>)/, (view) => {
    const open = /^<sheetView\b[^>]*?\/?>/.exec(view)![0]
      .replace(/\s(topLeftCell|tabSelected)="[^"]*"/g, '')
      .replace(/\/?>$/, first ? ' tabSelected="1">' : '>');
    // A frozen pane stays; the selection moves to A1
    const pane = /<pane\b[^>]*\/>/.exec(view)?.[0] ?? '';
    return `${open}${pane}<selection activeCell="A1" sqref="A1"/></sheetView>`;
  });
}

/**
 * Only the named sheets, in their order; every other sheet goes, with the
 * drawings, images and printer settings nothing else uses, and the dropdowns
 * that looked their lists up in the removed sheets (the cells keep their
 * text). Dropdowns with a written-out list stay.
 */
export function keepSheets(xlsx: Buffer, keep: string[]): Buffer {
  const zip = XLSX.CFB.read(xlsx, { type: 'buffer' }) as unknown as Zip;
  const wbEntry = entry(zip, 'xl/workbook.xml')!;
  const relsEntry = entry(zip, 'xl/_rels/workbook.xml.rels')!;
  let wb = text(wbEntry);
  let rels = text(relsEntry);

  const gone: string[] = [];
  const kept: string[] = [];
  wb = wb.replace(/<sheet\b[^>]*\/>/g, (tag) => {
    const name = unescXml(/\bname="([^"]*)"/.exec(tag)?.[1] ?? '');
    const rid = /\br:id="([^"]*)"/.exec(tag)?.[1] ?? '';
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((m) => new RegExp(`\\bId="${rid}"`).test(m));
    const target = rel && /\bTarget="([^"]*)"/.exec(rel)?.[1];
    const part = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : '';
    if (keep.includes(name)) {
      kept.push(part);
      return tag;
    }
    gone.push(part);
    rels = rels.replace(rel ?? '\u0000', '');
    return '';
  });
  wb = wb.replace(/\bfirstSheet="\d+"/, 'firstSheet="0"').replace(/\bactiveTab="\d+"/, 'activeTab="0"');
  // The calculation chain lists cells of removed sheets; Excel rebuilds it
  rels = rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, '');
  setText(zip, 'xl/workbook.xml', wb);
  setText(zip, 'xl/_rels/workbook.xml.rels', rels);

  // Kept sheets: dropdowns that looked up a removed sheet go
  for (const part of kept) {
    const e = entry(zip, part);
    if (!e) continue;
    let xml = text(e).replace(/<ext\b[^>]*uri="\{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF\}"[^>]*>[\s\S]*?<\/ext>/g, '');
    xml = xml.replace(/<extLst>\s*<\/extLst>/g, '');
    xml = xml.replace(/<dataValidations\b[^>]*>([\s\S]*?)<\/dataValidations>/, (_all, inner: string) => {
      const keepDv = [...inner.matchAll(/<dataValidation\b[\s\S]*?(?:<\/dataValidation>|\/>)/g)]
        .map((m) => m[0])
        .filter((dv) => !/<formula1>[^<]*(!|#REF)/.test(dv));
      return keepDv.length > 0 ? `<dataValidations count="${keepDv.length}">${keepDv.join('')}</dataValidations>` : '';
    });
    setText(zip, part, openAtTopLeft(trimFarCells(xml, 60), part === kept[0]));
  }
  pruneSharedStrings(zip, kept);

  // What is still referenced, from the package root down
  const live = new Set<string>(['[Content_Types].xml', '_rels/.rels']);
  const queue = ['_rels/.rels', 'xl/_rels/workbook.xml.rels', ...kept.map(relsOf)];
  for (const k of kept) live.add(k);
  while (queue.length > 0) {
    const relsPath = queue.shift()!;
    if (!entry(zip, relsPath)) continue;
    live.add(relsPath);
    for (const t of targetsOf(zip, relsPath)) {
      if (live.has(t)) continue;
      live.add(t);
      if (!gone.includes(t)) queue.push(relsOf(t));
    }
  }
  for (const g of gone) live.delete(g);
  const dead = partNames(zip).filter((p) => !live.has(p));
  // SheetJS names container paths from the root: "/xl/worksheets/sheet1.xml"
  for (const p of dead) XLSX.CFB.utils.cfb_del(zip as never, `/${p}`);

  // The content types list only parts that are left
  const ct = entry(zip, '[Content_Types].xml')!;
  setText(
    zip,
    '[Content_Types].xml',
    text(ct).replace(/<Override\b[^>]*PartName="\/([^"]+)"[^>]*\/>/g, (tag, part: string) => (dead.includes(part) ? '' : tag)),
  );
  // The document properties' sheet titles would name the removed sheets
  const app = entry(zip, 'docProps/app.xml');
  if (app) setText(zip, 'docProps/app.xml', text(app).replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, '').replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, ''));

  return writeZip(zip);
}

/** Several files in one zip; a repeated name gets " (2)", " (3)". */
export function zipFiles(files: { fileName: string; content: Buffer }[]): Buffer {
  const used = new Set<string>();
  const out: { name: string; data: Buffer }[] = [];
  for (const f of files) {
    let name = f.fileName;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      name = f.fileName.replace(/(\.[a-z]+)$/i, ` (${n})$1`);
    }
    used.add(name.toLowerCase());
    out.push({ name, data: f.content });
  }
  return packZip(out);
}

// ---- .xls → the converted template (D3) ------------------------------------

const TEMPLATES: Partial<Record<FormType, string>> = {
  fal1: 'IMO FAL 1 General declaration.xlsx',
  fal3: 'IMO FAL Form 3 - Ships Stores Declaration.xlsx',
  fal4: 'IMO FAL Form 4 - Crews Effects Declaration.xlsx',
  fal5: 'IMO FAL Form 5 - Crew List.xlsx',
};

function templateOf(formType: FormType): Buffer | null {
  const name = TEMPLATES[formType];
  return name ? readFileSync(join(__dirname, 'templates', name)) : null;
}

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The template's labels are the upload's labels, cell for cell — else the
 * layout differs and a transplant would put values in the wrong boxes.
 */
function sameLayout(template: SheetGrid, upload: SheetGrid): boolean {
  let labels = 0;
  let same = 0;
  template.rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell === '') return;
      labels++;
      if (squash(upload.rows[r]?.[c] ?? '') === squash(cell)) same++;
    }),
  );
  return labels > 0 && same / labels >= 0.9;
}

// ---- the whole thing -------------------------------------------------------

export type CorrectedFile =
  | { ok: true; fileName: string; content: Buffer }
  | { ok: false; problem: string };

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** "Kestrel crew list.xls" → "Kestrel crew list (NEMO).xlsx". */
export function correctedName(fileName: string): string {
  return `${fileName.replace(/\.(xlsx|xls|xlsm)$/i, '')} (NEMO).xlsx`;
}

/** The NSW Waste template's own list: "Plastics 501" by code. */
function wasteLabelsOf(raw: Buffer): Map<string, string> {
  const labels = new Map<string, string>();
  const wb = XLSX.read(raw, { type: 'buffer', sheets: ['List'] });
  const list = wb.Sheets['List'];
  if (!list) return labels;
  for (const row of XLSX.utils.sheet_to_json<string[]>(list, { header: 1, raw: false })) {
    const m = /^(.*\S)\s+(\d{3})\s*$/.exec(String(row[0] ?? ''));
    if (m) labels.set(m[2], `${m[1]} ${m[2]}`);
  }
  return labels;
}

export function correctedFile(
  raw: Buffer,
  fileName: string,
  form: ParsedForm,
  effective: ParsedForm,
  checks: DocumentChecks,
  corrections: Corrections | null,
): CorrectedFile {
  if (checks.errorCount > 0) {
    return {
      ok: false,
      problem:
        checks.errorCount === 1
          ? 'One value still needs correcting before the NEMO file can be made'
          : `${checks.errorCount} values still need correcting before the NEMO file can be made`,
    };
  }
  const kind = sniffKind(raw);
  const labels = form.formType === 'nsw-waste' && kind === 'xlsx' ? wasteLabelsOf(raw) : undefined;
  const writes = nemoWrites(form, effective, checks, corrections, labels);

  if (kind === 'xlsx') {
    return { ok: true, fileName: correctedName(fileName), content: writeCells(raw, form.sheet, writes) };
  }
  if (kind !== 'xls') return { ok: false, problem: 'Only Excel files can be given back corrected' };

  const template = templateOf(form.formType);
  if (!template) {
    return { ok: false, problem: `A corrected ${form.formName} can be made from .xlsx uploads only` };
  }
  const uploadGrid = readGrids(raw)[0];
  const templateGrid = readGrids(template)[0];
  if (!uploadGrid || !templateGrid || !sameLayout(templateGrid, uploadGrid)) {
    return {
      ok: false,
      problem: 'This file’s layout differs from the standard form — ask the ship for the .xlsx version',
    };
  }
  // Every cell the ship typed, exactly as typed, then the NEMO values over them
  const upload = XLSX.read(raw, { type: 'buffer', cellDates: true });
  const ws = upload.Sheets[form.sheet ?? upload.SheetNames[0]] ?? {};
  const typed: CellWrite[] = [];
  for (const [addr, cell] of Object.entries(ws)) {
    if (addr.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    const v = (cell as XLSX.CellObject).v;
    if (v === undefined || v === null || v === '' || (templateGrid.rows[r]?.[c] ?? '') !== '') continue;
    const value =
      v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'number' ? v : String(v);
    typed.push({ addr, value });
  }
  const nemo = new Map(writes.map((w) => [w.addr, w]));
  const all = [...typed.filter((w) => !nemo.has(w.addr)), ...writes];
  return { ok: true, fileName: correctedName(fileName), content: writeCells(template, undefined, all) };
}
