<template>
  <div ref="rootEl" data-nemo-table>
    <!-- The parent's heading row (title, column tabs, Full screen) sits right
         on top of the list in every section (user 2026-11-02) — only a
         section with no list has it over its facts -->
    <slot v-if="rowsShown.length === 0" name="head" />

    <!-- The table's own facts (waste delivery, ISSC, the CSO…): on desktop
         the standard table, Field · To NEMO (user 2026-11-13) -->
    <StandardTable
      v-if="!isMobile && headerShown.length > 0"
      class="nt-facts-table"
      fixed
      row-head="Field"
      :row-head-width="290"
      :columns="FACT_COLUMNS"
      :rows="factRows"
    >
      <template #cell="{ row }">
        <StandardCell
          :state="table.header[row.key]?.flag"
          :editing="editingId === cellId(HEADER_ROW, row.key)"
          :label="cellAction(fieldOf(row.key), table.header[row.key])"
          @open="open(HEADER_ROW, fieldOf(row.key), table.header[row.key])"
        >
          <NemoCellView :cell="table.header[row.key]" :column="fieldOf(row.key)" />
          <template #editor>
            <TableCellEditor
              :column="fieldOf(row.key)"
              :cell="table.header[row.key]"
              :busy="savingId === cellId(HEADER_ROW, row.key)"
              :label="fieldOf(row.key).label"
              @save="(v) => save(HEADER_ROW, fieldOf(row.key), v)"
              @cancel="editingId = null"
            />
          </template>
        </StandardCell>
      </template>
    </StandardTable>
    <!-- Phones keep their own facts list (the mobile view stays as it is) -->
    <div v-else-if="isMobile && headerShown.length > 0" class="nt-facts">
      <template v-for="f in headerShown" :key="f.key">
        <div class="nt-facts__label">{{ f.label }}</div>
        <div
          class="nt-cell"
          :class="cellClasses(table.header[f.key])"
          role="button"
          tabindex="0"
          @click="pick(HEADER_ROW, f, table.header[f.key])"
          @keyup.enter="pick(HEADER_ROW, f, table.header[f.key])"
        >
          <NemoCellView :cell="table.header[f.key]" :column="f" />
        </div>
      </template>
    </div>

    <!-- The table itself: NEMO's columns in groups by meaning. Too many for
         the width and the groups come one tab at a time (user 2026-11-02):
         the rest fold to nothing but keep their height, so rows never jump.
         A missing value is typed right in its cell (user 2026-11-13): no
         separate Missing fields list on desktop. -->
    <slot v-if="rowsShown.length > 0" name="head" />
    <MobileTable
      v-if="isMobile && rowsShown.length > 0"
      :table="table"
      :rows="rowsShown"
      :columns="columnsInOrder"
      :name-key="pinnedKey"
      @pick="emit('pick', $event)"
    />
    <StandardTable
      v-if="!isMobile && rowsShown.length > 0"
      ref="listRef"
      :columns="listColumns"
      :rows="listRows"
      :row-head="rowWord"
      :row-head-last="labelLast"
      :row-head-width="firstWidth"
      :pinned-key="pinnedKey"
      :shown-keys="shownKeys"
    >
      <template #cell="{ row, column }">
        <!-- Effects: every item of the crew member, stacked -->
        <template v-if="EFFECTS.includes(column.key) && itemsOf(row.key).length > 0">
          <StandardCell
            v-for="(item, n) in itemsOf(row.key)"
            :key="n"
            class="nt-item"
            :state="item[column.key]?.flag"
            :label="cellAction(columnOf(column.key), item[column.key])"
            @open="pick(row.key, columnOf(column.key), item[column.key])"
          >
            <NemoCellView :cell="item[column.key]" :column="columnOf(column.key)" />
          </StandardCell>
        </template>
        <StandardCell
          v-else
          :state="cellOf(row.key, column.key)?.flag"
          :editing="editingId === cellId(row.key, column.key)"
          :label="cellAction(columnOf(column.key), cellOf(row.key, column.key))"
          @open="open(row.key, columnOf(column.key), cellOf(row.key, column.key))"
        >
          <NemoCellView :cell="cellOf(row.key, column.key)" :column="columnOf(column.key)" />
          <template #editor>
            <TableCellEditor
              :column="columnOf(column.key)"
              :cell="cellOf(row.key, column.key)"
              :busy="savingId === cellId(row.key, column.key)"
              :label="`${column.label} for ${row.label}`"
              @save="(v) => save(row.key, columnOf(column.key), v)"
              @cancel="editingId = null"
            />
          </template>
        </StandardCell>
      </template>
    </StandardTable>

    <!-- The tabs sit in the heading row the parent names, beside Full screen.
         That row is drawn over the list or over the facts (above), so it is a
         new element when All details turns on or off; keyed by where it sits,
         the tabs follow it instead of staying in the removed one. -->
    <Teleport v-if="tabsTo && !isMobile" :key="rowsShown.length > 0 ? 'over-list' : 'over-facts'" defer :to="tabsTo">
      <ColumnTabs
        v-if="segments.length > 1"
        :segments="segments"
        :model-value="activeSegment.id"
        :compact="compact"
        @update:model-value="emit('update:anchor', $event)"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * One NEMO table (spec 0096): the ship's forms merged into the columns the
 * National Spreadsheet has, drawn as the standard table (StandardTable,
 * user 2026-11-13). Without All details only what needs a person: rows and
 * facts with a flag. A missing value is typed right in its cell; a value a
 * form gave, or two forms disagreeing, opens its own dialog (pick).
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import type { NemoCell, NemoColumn, NemoRow, NemoTable } from '../auth/auth';
import { fitSegments, groupsOf, markOf, type ColumnSegment } from '../lib/column-groups';
import ColumnTabs from './ColumnTabs.vue';
import NemoCellView from './NemoCellView.vue';
import MobileTable from './MobileTable.vue';
import StandardTable, { type StandardTableColumn, type StandardTableRow } from './StandardTable.vue';
import StandardCell from './StandardCell.vue';
import TableCellEditor from './TableCellEditor.vue';
import { reportAttachmentMovingKey, reportAttachmentVisibleKey } from '../lib/report-attachment-trigger';

const drawerMoving = inject(reportAttachmentMovingKey, ref(false));
const $q = useQuasar();
const isMobile = computed(() => $q.screen.lt.md);
const drawerVisible = inject(reportAttachmentVisibleKey, ref(false));
// Opening attachments changes the table's viewport, not its chosen columns.
// Keep the groups until the drawer has closed so rows never switch layout
// at the end of either animation. Wider groups remain horizontally scrollable.
const keepColumnGroups = computed(() => drawerVisible.value || drawerMoving.value);

/** A value typed into the table: where, and what. */
export interface TableCellSave {
  rowKey: string;
  column: NemoColumn;
  value: string;
}

const props = defineProps<{
  table: NemoTable;
  allDetails: boolean;
  /** Where the column tabs go (a selector in the parent's heading row); none, no tabs. */
  tabsTo?: string;
  /** A column of the chosen tab — kept by the parent, so a refresh or full screen keeps the place. */
  anchor?: string | null;
  /** Values typed in NEMOLink are edited in their cell too (no dialog of their own on the page). */
  editEntered?: boolean;
}>();
const emit = defineEmits<{
  pick: [target: { rowKey: string; column: NemoColumn; cell: NemoCell | undefined }];
  'update:anchor': [key: string];
  /** Save the value; the parent calls done(true) once the table is fresh, done(false) when refused. */
  'save-cell': [target: TableCellSave, done: (ok: boolean) => void];
}>();

const HEADER_ROW = '_';
const EFFECTS = ['effectsType', 'effectsDescription', 'effectsQuantity', 'effectsUnit'];

const flagged = (c: NemoCell | undefined) => !!c?.flag;

function rowFlagged(r: NemoRow): boolean {
  return Object.values(r.cells).some(flagged) || (r.items ?? []).some((i) => Object.values(i).some(flagged));
}

/** Rows and facts filled here while All details is off stay in view until the
 *  section changes, so the row never vanishes under the pointer. */
const kept = ref(new Set<string>());
watch(() => props.table.key, () => {
  kept.value = new Set();
  editingId.value = null;
});

const headerShown = computed(() =>
  props.table.fields.filter((f) =>
    isMobile.value || props.allDetails || flagged(props.table.header[f.key]) || kept.value.has(cellId(HEADER_ROW, f.key)),
  ),
);
const rowsShown = computed(() =>
  isMobile.value || props.allDetails
    ? props.table.rows
    : props.table.rows.filter((r) => rowFlagged(r) || kept.value.has(r.key)),
);
const rowWord = computed(() => props.table.rowNoun[0]!.toUpperCase() + props.table.rowNoun.slice(1));

/** The facts as standard table rows: the field's name, its NEMO code on hover. */
const FACT_COLUMNS: StandardTableColumn[] = [{ key: 'value', label: 'To NEMO' }];
const factRows = computed<StandardTableRow[]>(() => headerShown.value.map((f) => ({ key: f.key, label: f.label, code: f.de })));
const fieldOf = (key: string): NemoColumn => props.table.fields.find((f) => f.key === key)!;

/**
 * Cargo (user 2026-11-12): left to right the required columns come first and
 * the optional ones last. Description of goods is the first column, the one
 * that lists the cargo items and stays on every tab; the optional item name
 * (Cargo items) is the last column, never the first.
 */
const labelLast = computed(() => props.table.key === 'cargo');
const pinnedKey = computed(() =>
  labelLast.value && props.table.columns.some((c) => c.key === 'description') ? 'description' : null,
);
const groups = computed(() =>
  groupsOf(props.table)
    .map((g) => ({ label: g.label, keys: g.keys.filter((k) => k !== pinnedKey.value) }))
    .filter((g) => g.keys.length > 0),
);
const columnsInOrder = computed(() => {
  const byKey = new Map(props.table.columns.map((c) => [c.key, c]));
  const pinned = pinnedKey.value ? [byKey.get(pinnedKey.value)!] : [];
  return [...pinned, ...groups.value.flatMap((g) => g.keys.map((k) => byKey.get(k)!))];
});
const columnByKey = computed(() => new Map(props.table.columns.map((c) => [c.key, c])));
const columnOf = (key: string): NemoColumn => columnByKey.value.get(key)!;
const listColumns = computed<StandardTableColumn[]>(() =>
  columnsInOrder.value.map((c) => ({ key: c.key, label: c.label, required: c.required, code: c.de })),
);
const rowByKey = computed(() => new Map(props.table.rows.map((r) => [r.key, r])));
const listRows = computed<StandardTableRow[]>(() => rowsShown.value.map((r) => ({ key: r.key, label: r.label })));
const cellOf = (rowKey: string, colKey: string): NemoCell | undefined => rowByKey.value.get(rowKey)?.cells[colKey];
const itemsOf = (rowKey: string) => rowByKey.value.get(rowKey)?.items ?? [];

const widths = ref(new Map<string, number>());
/** The first column's own width, kept on every tab: its line never moves (user 2026-11-02). */
const firstWidth = ref<number | null>(null);
const room = ref(Infinity);
const tabsRoom = ref(Infinity);
const segments = computed<ColumnSegment[]>(() =>
  fitSegments(groups.value, (k) => widths.value.get(k) ?? COL_MIN, room.value).map((s) => ({
    ...s,
    mark: markOf(props.table.rows, s.keys),
  })),
);
const activeSegment = computed(
  () => segments.value.find((s) => !!props.anchor && s.keys.includes(props.anchor)) ?? segments.value[0]!,
);
const shownKeys = computed(() => new Set([
  ...(pinnedKey.value ? [pinnedKey.value] : []),
  ...activeSegment.value.keys,
]));

/** Over six tabs, or more than the heading row holds: the folded "‹ 1 of 7 ›". */
const compact = computed(() => {
  if (segments.value.length > 6) return true;
  // each tab a 30px circle, 8px apart
  return segments.value.length * 38 - 8 > tabsRoom.value;
});

// ---- typing a value in its cell (user 2026-11-13) --------------------------

const cellId = (rowKey: string, colKey: string) => `${rowKey}\u0000${colKey}`;
const editingId = ref<string | null>(null);
const savingId = ref<string | null>(null);

/** An empty cell is filled in place; so is a typed value where the page has no dialog for it. */
function inPlace(cell: NemoCell | undefined): boolean {
  if (!cell?.value) return true;
  return !!props.editEntered && !!cell.entered && cell.flag !== 'conflict';
}
function cellAction(column: NemoColumn, cell: NemoCell | undefined): string {
  return `${cell?.value ? 'Check' : 'Fill'} ${column.label}`;
}
function open(rowKey: string, column: NemoColumn, cell: NemoCell | undefined): void {
  if (savingId.value) return;
  if (inPlace(cell)) {
    editingId.value = cellId(rowKey, column.key);
    return;
  }
  pick(rowKey, column, cell);
}
function save(rowKey: string, column: NemoColumn, value: string): void {
  const id = cellId(rowKey, column.key);
  savingId.value = id;
  emit('save-cell', { rowKey, column, value }, (ok) => {
    if (savingId.value === id) savingId.value = null;
    if (!ok) return;
    if (editingId.value === id) editingId.value = null;
    if (!props.allDetails) kept.value = new Set([...kept.value, rowKey === HEADER_ROW ? id : rowKey]);
  });
}

/** Each column's own width, folded or not: its widest line (200px at most) plus the padding. */
const listRef = ref<InstanceType<typeof StandardTable> | null>(null);
const rootEl = ref<HTMLElement | null>(null);
const COL_MIN = 112;
const FIRST_MIN = 171;
const LINE_MAX = 200;
function measureWidths(): void {
  if (keepColumnGroups.value) return;
  const table = listRef.value?.tableEl ?? null;
  const wrap = listRef.value?.wrapEl ?? null;
  const slot = props.tabsTo ? document.querySelector<HTMLElement>(props.tabsTo) : null;
  tabsRoom.value = slot ? slot.clientWidth : Infinity;
  if (!table || !wrap) {
    if (rootEl.value) room.value = Math.max(0, rootEl.value.clientWidth - FIRST_MIN - (pinnedKey.value ? COL_MIN : 0));
    return;
  }
  // A block's scrollWidth includes the space the table stretched it into.
  // Measure its text instead, so resizing the drawer cannot inflate the
  // column's natural width and split a group on the next measurement.
  const textRange = document.createRange();
  const line = (el: Element) => {
    textRange.selectNodeContents(el);
    return Math.min(LINE_MAX, Math.ceil(textRange.getBoundingClientRect().width));
  };
  const out = new Map<string, number>();
  for (const cell of table.querySelectorAll<HTMLElement>('[data-col]')) {
    const head = cell.tagName === 'TH';
    const lines = cell.querySelectorAll(head ? '.st-th__label' : '.nc__line');
    let widest = 0;
    lines.forEach((l) => (widest = Math.max(widest, line(l))));
    // th 16 + 16; td 7 + 7 around the value's 6 + 6 and its 3px flag bar; 2px to spare
    const w = Math.max(COL_MIN, widest + (head ? 32 : 29) + 2);
    const key = cell.dataset.col!;
    out.set(key, Math.max(out.get(key) ?? 0, w));
  }
  let first = FIRST_MIN;
  table.querySelectorAll('.st-first__text, thead .st-first .st-th__label').forEach((l) => {
    first = Math.max(first, line(l) + 32 + 2);
  });
  widths.value = out;
  firstWidth.value = Math.ceil(first);
  room.value = wrap.clientWidth - firstWidth.value - (pinnedKey.value ? (out.get(pinnedKey.value) ?? COL_MIN) : 0);
}

let observer: ResizeObserver | null = null;
function observe(): void {
  observer?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => measureWidths());
    const wrap = listRef.value?.wrapEl;
    const table = listRef.value?.tableEl;
    if (wrap) observer.observe(wrap);
    if (rootEl.value) observer.observe(rootEl.value);
    if (table) observer.observe(table);
    const slot = props.tabsTo ? document.querySelector<HTMLElement>(props.tabsTo) : null;
    if (slot) observer.observe(slot);
  }
  measureWidths();
}
onMounted(() => void nextTick(observe));
onBeforeUnmount(() => observer?.disconnect());
watch([rowsShown, () => props.table.columns, isMobile], () => void nextTick(observe));
watch(keepColumnGroups, (keep) => {
  if (!keep) void nextTick(observe);
});

/** The phone's facts list keeps its own cell look. */
function cellClasses(c: NemoCell | undefined): string[] {
  const out: string[] = [];
  if (c?.flag) out.push(`nt-cell--${c.flag}`);
  if (c?.entered) out.push('nt-cell--entered');
  return out;
}

function pick(rowKey: string, column: NemoColumn, cell: NemoCell | undefined): void {
  emit('pick', { rowKey, column, cell });
}
</script>

<style scoped>
/* The list and its look are the standard table's (StandardTable.vue). */
/* The facts sit as far above the list's heading row as under the files (user 2026-11-02) */
.nt-facts-table {
  margin-bottom: 26px;
}
/* Crew effects: one value per item, stacked */
.nt-item + .nt-item {
  margin-top: 2px;
}

/* Phones: the facts as label · value lines (mobile stays as it is) */
.nt-facts {
  display: grid;
  grid-template-columns: 278px minmax(0, 1fr);
  gap: 0 12px;
  align-items: start;
  margin-bottom: 26px;
  font-size: 14px;
  line-height: 20px;
}
.nt-facts > * {
  min-height: 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 6px 0 5px;
  border-bottom: 1px dashed var(--blue-700);
}
.nt-facts__label {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--text-300);
}
.nt-cell {
  padding: 4px 6px;
  border-radius: 0;
  cursor: pointer;
  border-left: 3px solid transparent;
  min-height: 28px;
}
.nt-cell:hover {
  background: var(--nl-gray-bg);
}
.nt-cell--error {
  border-left-color: var(--red-200);
  background: var(--red-100);
}
.nt-cell--warning,
.nt-cell--conflict,
.nt-cell--missing {
  border-left-color: var(--orange-300);
  background: var(--orange-100);
}
@media (max-width: 599.98px) {
  .nt-facts {
    grid-template-columns: minmax(120px, 40%) minmax(0, 1fr);
  }
}
</style>
