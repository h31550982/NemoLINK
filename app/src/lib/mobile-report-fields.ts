import type { NemoCell, NemoColumn, NemoRow, NemoTable } from '../auth/auth';
import { reportRowLabel } from './report-row-label.ts';

const EFFECTS = new Set(['effectsType', 'effectsDescription', 'effectsQuantity', 'effectsUnit']);
export function reportCells(row: NemoRow, column: NemoColumn): (NemoCell | undefined)[] {
  return EFFECTS.has(column.key) && row.items?.length ? row.items.map(item => item[column.key]) : [row.cells[column.key]];
}

/** Stable partition: keep the source order within missing and completed rows. */
export function missingFirstRows(rows: NemoRow[], columns: NemoColumn[]): NemoRow[] {
  const missing: NemoRow[] = [];
  const rest: NemoRow[] = [];
  for (const row of rows) {
    const needsValue = columns.some(column => reportCells(row, column).some(cell => cell?.flag === 'missing'));
    (needsValue ? missing : rest).push(row);
  }
  return [...missing, ...rest];
}
export interface MissingReportField {
  id: string;
  rowKey: string;
  rowLabel: string;
  column: NemoColumn;
  cell: NemoCell;
}
export function missingReportFields(table: NemoTable): MissingReportField[] {
  const fields: MissingReportField[] = [];
  const add = (rowKey: string, rowLabel: string, column: NemoColumn, cell: NemoCell | undefined, index = 0) => {
    if (cell?.flag === 'missing') fields.push({ id: JSON.stringify([rowKey, column.key, index]), rowKey, rowLabel, column, cell });
  };
  table.fields.forEach(column => add('_', 'Report details', column, table.header[column.key]));
  table.rows.forEach((row, rowIndex) => table.columns.forEach(column => reportCells(row, column).forEach((cell, index) => add(row.key, reportRowLabel(table, row, rowIndex), column, cell, index))));
  return fields;
}
