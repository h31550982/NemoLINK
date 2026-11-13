<template>
  <!-- THE standard table (user 2026-11-13): the Ship forms table, used for
       every table in the app. Column heads 12px SemiBold uppercase Text/100,
       the row's name Text/300 Medium, values Text/200, a dashed Blue/700
       line under every row, rows as tall as a Crew details row (59px) even
       with one line of text, every cell's text centred
       vertically. Missing values are filled right in their cell
       (StandardCell + its editor), never in a separate missing list.
       See app/DESIGN_RULES.md "Standard table". -->
  <div ref="wrapEl" class="st-wrap">
    <table ref="tableEl" class="st-table" :class="{ 'st-table--fixed': fixed }">
      <thead>
        <tr>
          <th v-if="rowHead !== null && !rowHeadLast" class="st-first" scope="col" :style="firstStyle">
            <div class="st-th__label">{{ rowHead }}</div>
          </th>
          <th
            v-for="c in columns"
            :key="c.key"
            :data-col="c.key"
            scope="col"
            :class="{ 'st-th--req': c.required, 'st-off': shownKeys && !shownKeys.has(c.key), 'st-pin': c.key === pinnedKey }"
            :style="c.width ? { width: `${c.width}px` } : undefined"
          >
            <div class="st-fold">
              <div class="st-th__label" :class="{ 'st-hover': c.code }" :data-cut="`col:${c.key}`">{{ c.label }}</div>
            </div>
            <!-- The NEMO code on a hover on the name; a cut name in full -->
            <q-tooltip v-if="cutKeys.has(`col:${c.key}`) || c.code" :delay="300" max-width="360px">
              <div v-if="cutKeys.has(`col:${c.key}`)">{{ c.label }}</div>
              <div v-if="c.code">NEMO code {{ c.code }}</div>
            </q-tooltip>
          </th>
          <th v-if="rowHead !== null && rowHeadLast" class="st-first st-first--end" scope="col" :style="firstStyle">
            <div class="st-th__label">{{ rowHead }}</div>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(r, i) in rows" :key="r.key">
          <!-- A heading inside the table (the port above its area and berth) -->
          <tr v-if="r.group" class="st-group-row">
            <td :colspan="span"><slot name="group" :row="r">{{ r.group }}</slot></td>
          </tr>
          <tr :data-row-key="r.key">
            <th v-if="rowHead !== null && !rowHeadLast" class="st-first" scope="row" :style="firstStyle">
              <slot name="row-head" :row="r" :index="i">
                <div class="st-first__text" :class="{ 'st-hover': r.code }" :data-cut="`row:${r.key}`">{{ r.label }}</div>
              </slot>
              <q-tooltip v-if="cutKeys.has(`row:${r.key}`) || r.code" :delay="300" max-width="360px">
                <div v-if="cutKeys.has(`row:${r.key}`)">{{ r.label }}</div>
                <div v-if="r.code">NEMO code {{ r.code }}</div>
              </q-tooltip>
            </th>
            <td
              v-for="c in columns"
              :key="c.key"
              :data-col="c.key"
              :class="{ 'st-off': shownKeys && !shownKeys.has(c.key), 'st-pin': c.key === pinnedKey }"
            >
              <div class="st-fold">
                <slot name="cell" :row="r" :column="c" :index="i" />
              </div>
            </td>
            <th v-if="rowHead !== null && rowHeadLast" class="st-first st-first--end" scope="row" :style="firstStyle">
              <slot name="row-head" :row="r" :index="i">
                <div class="st-first__text" :data-cut="`row:${r.key}`">{{ r.label }}</div>
              </slot>
              <q-tooltip v-if="cutKeys.has(`row:${r.key}`)" :delay="300" max-width="360px">{{ r.label }}</q-tooltip>
            </th>
          </tr>
          <!-- A row opened for its details, the table's full width under it -->
          <tr v-if="r.expanded" class="st-detail-row">
            <td :colspan="span"><slot name="detail" :row="r" :index="i" /></td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
/**
 * The app's one table (user 2026-11-13: "Ship formsejen taulukko on
 * standardi taulukkomuoto"). Rows have a name column (sticky on the left,
 * or last for cargo); the cells come from the `cell` slot, normally a
 * StandardCell. Generic: NEMO tables, field/To NEMO/From tables and
 * document rows all render through it.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue';

export interface StandardTableColumn {
  key: string;
  label: string;
  /** Marked with * after the name. */
  required?: boolean | undefined;
  /** The NEMO code, shown on a hover on the name. */
  code?: string | null;
  /** Whole column width in px, the 12px gap included (fixed tables). */
  width?: number;
}
export interface StandardTableRow {
  key: string;
  label: string;
  /** The NEMO code, shown on a hover on the row's name. */
  code?: string | null;
  /** A heading row drawn above this row. */
  group?: string | null;
  /** Its details (the `detail` slot) open under it, full width. */
  expanded?: boolean;
}

const props = withDefaults(
  defineProps<{
    columns: StandardTableColumn[];
    rows: StandardTableRow[];
    /** The name column's head ("Crew member", "Field"); null, no name column. */
    rowHead?: string | null;
    /** The name column closes the row on the right (cargo, user 2026-11-12). */
    rowHeadLast?: boolean;
    /** A column that stays in view on the left while the rest scroll. */
    pinnedKey?: string | null;
    /** Only these columns show; the rest fold to nothing (column tabs). */
    shownKeys?: Set<string> | null;
    /** The name column's width in px. */
    rowHeadWidth?: number | null;
    /** Column widths as given, values cut with … (field tables). */
    fixed?: boolean;
  }>(),
  { rowHead: null, rowHeadLast: false, pinnedKey: null, shownKeys: null, rowHeadWidth: null, fixed: false },
);

const span = computed(() => props.columns.length + (props.rowHead !== null ? 1 : 0));
const firstStyle = computed(() =>
  props.rowHeadWidth ? { width: `${props.rowHeadWidth}px`, minWidth: `${props.rowHeadWidth}px` } : undefined,
);

/** Column heads and row names cut short with … — measured, so only those get the full text on hover. */
const wrapEl = ref<HTMLElement | null>(null);
const tableEl = ref<HTMLTableElement | null>(null);
const cutKeys = ref(new Set<string>());
function measure(): void {
  const found = new Set<string>();
  for (const el of tableEl.value?.querySelectorAll<HTMLElement>('[data-cut]') ?? []) {
    if (el.closest('.st-off')) continue;
    if (el.scrollWidth > el.clientWidth + 1) found.add(el.dataset.cut!);
  }
  const same = found.size === cutKeys.value.size && [...found].every((k) => cutKeys.value.has(k));
  if (!same) cutKeys.value = found;
}
let observer: ResizeObserver | null = null;
onMounted(() => {
  void nextTick(measure);
  if (typeof ResizeObserver !== 'undefined' && wrapEl.value) {
    observer = new ResizeObserver(measure);
    observer.observe(wrapEl.value);
  }
});
onUpdated(measure);
onBeforeUnmount(() => observer?.disconnect());

defineExpose({ wrapEl, tableEl });
</script>

<style scoped>
/* No frame and no head surface (Figma 500:7424, the NOD/Ship forms table);
   the sideways scroll only for a column wider than the screen */
.st-wrap {
  overflow-x: auto;
}
.st-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 14px;
  line-height: 20px;
  color: var(--text-200);
}
.st-table--fixed {
  table-layout: fixed;
}
/* Every line stays on one line: up to 200px, then … with the whole text on hover */
.st-table th,
.st-table td {
  min-width: 112px;
  white-space: nowrap;
  text-align: left;
  vertical-align: middle;
  border-bottom: 1px dashed var(--blue-700);
}
.st-table--fixed th,
.st-table--fixed td {
  min-width: 0;
}
.st-th__label,
.st-first__text,
.st-table :deep(.nc__line),
.st-table :deep(.st-line) {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-table--fixed .st-th__label,
.st-table--fixed .st-first__text,
.st-table--fixed :deep(.nc__line),
.st-table--fixed :deep(.st-line) {
  max-width: none;
}
/* Column heads: Heading/12 SemiBold uppercase, Text/100, on the row line */
.st-table thead th {
  padding: 0 12px 6px 0;
  background: var(--nl-card);
  vertical-align: bottom;
}
.st-th__label {
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.72px;
  text-transform: uppercase;
  color: var(--text-100);
}
.st-th--req .st-th__label::after {
  content: ' *';
}
.st-hover {
  cursor: help;
}
/* Values: a cell's own padding plus the tappable value's */
.st-table td {
  padding: 6px 12px 5px 0;
}
/* Every row as tall as a Ship forms Crew details row (user 2026-11-13),
   one line of text or two: 6 + 4 + two 20px lines + 4 + 5 = 59px, the
   text centred in it */
.st-table tbody tr:not(.st-group-row):not(.st-detail-row) > th,
.st-table tbody tr:not(.st-group-row):not(.st-detail-row) > td {
  height: 59px;
}
/* The row's name: Text/300 Medium */
.st-table tbody th {
  padding: 6px 12px 5px 0;
  font-weight: 500;
  color: var(--text-300);
  background: var(--nl-card);
}
/* The name stays in view while the columns scroll */
.st-first {
  min-width: 171px;
  position: sticky;
  left: 0;
  z-index: 1;
}
.st-first--end {
  position: static;
}
.st-table thead .st-first--end,
.st-table tbody .st-first--end {
  padding-right: 0;
}
.st-table--fixed .st-first {
  min-width: 0;
}
.st-pin {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--nl-card);
}
/* A column of another tab: folded to nothing, its content still giving
   the row its height */
.st-table .st-off {
  width: 0;
  min-width: 0;
  padding-left: 0;
  padding-right: 0;
}
.st-off > .st-fold {
  width: 0;
  overflow: hidden;
  visibility: hidden;
}
/* A row's details, full width under it */
.st-table .st-detail-row > td {
  height: auto;
  padding: 4px 0 16px;
  white-space: normal;
}
/* A heading inside the table: the place in the port above its rows */
.st-table .st-group-row > td {
  padding: 12px 0 8px;
  white-space: normal;
  color: var(--text-300);
}
</style>
