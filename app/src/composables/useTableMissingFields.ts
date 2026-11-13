import { computed, reactive, ref, watch } from 'vue';
import type { NemoCell, NemoColumn, NemoTable } from '../auth/auth';
import { reportRowLabel } from '../lib/report-row-label.ts';

export interface MissingTableEntry {
  id: string;
  rowKey: string;
  rowLabel: string;
  column: NemoColumn;
  cell: NemoCell;
  itemIndex?: number;
}

/** Shared by the regular and full-screen table, so completing a field never
 * changes the current Missing visit or loses it when opening full screen. */
export function useTableMissingFields(table: () => NemoTable | null, desktop: () => boolean) {
  const selected = ref(false);
  const retained = ref(new Set<string>());
  const cells = computed(() => {
    const result = new Map<string, { row: string | null; column: string; missing: boolean; entry: MissingTableEntry }>();
    const add = (row: string | null, column: NemoColumn, cell: NemoCell | undefined, rowLabel = '', item?: number) => {
      const id = JSON.stringify([row, column.key, item ?? null]);
      if (cell) result.set(id, { row, column: column.key, missing: cell.flag === 'missing', entry: {
        id, rowKey: row ?? '_', rowLabel, column, cell, ...(item === undefined ? {} : { itemIndex: item }),
      } });
    };
    const t = table();
    if (!t) return result;
    for (const field of t.fields) add(null, field, t.header[field.key]);
    for (const [index, row] of t.rows.entries()) {
      const label = reportRowLabel(t, row, index);
      for (const column of t.columns) {
        add(row.key, column, row.cells[column.key], label);
        row.items?.forEach((item, index) => add(row.key, column, item[column.key], label, index));
      }
    }
    return result;
  });
  const count = computed(() => [...cells.value.values()].filter(cell => cell.missing).length);
  const active = computed(() => desktop() && selected.value);

  watch([() => table()?.key, cells], ([key, current], [previousKey, previous]) => {
    if (key !== previousKey) {
      retained.value = new Set();
      selected.value = [...current.values()].some(cell => cell.missing);
      return;
    }
    const keep = new Set([...retained.value].filter(id => current.has(id)));
    if (active.value) {
      for (const [id, cell] of current) {
        if (!cell.missing && previous?.get(id)?.missing) keep.add(id);
      }
    }
    retained.value = keep;
    if (!keep.size && ![...current.values()].some(cell => cell.missing)) selected.value = false;
  }, { immediate: true, flush: 'sync' });

  const visible = computed(() => [...cells.value].filter(([id, cell]) => cell.missing || retained.value.has(id)).map(([, cell]) => cell));
  const rows = computed(() => new Set(visible.value.filter(cell => cell.row !== null).map(cell => cell.row!)));
  const columns = computed(() => new Set(visible.value.filter(cell => cell.row !== null).map(cell => cell.column)));
  const fields = computed(() => new Set(visible.value.filter(cell => cell.row === null).map(cell => cell.column)));
  const offered = computed(() => count.value > 0 || retained.value.size > 0);
  const entries = computed(() => visible.value.map(cell => cell.entry));

  function choose(missing: boolean): void {
    if (selected.value === missing) return;
    retained.value = new Set();
    selected.value = missing;
  }
  function leaveCompleted(): void {
    if (count.value === 0 && retained.value.size) choose(false);
  }

  return reactive({ active, offered, count, rows, columns, fields, entries, choose, leaveCompleted });
}

export type TableMissingFields = ReturnType<typeof useTableMissingFields>;
