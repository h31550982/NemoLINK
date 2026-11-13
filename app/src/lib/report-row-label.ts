import type { NemoRow, NemoTable } from '../auth/auth';

/** Cargo is identified by its required goods description. The legacy row
 * label can contain an optional bill-of-lading number, so never use it here. */
export function reportRowLabel(table: NemoTable, row: NemoRow, index: number): string {
  if (table.key !== 'cargo') return row.label;
  return row.cells.description?.value?.trim() || `Cargo item ${index + 1}`;
}
