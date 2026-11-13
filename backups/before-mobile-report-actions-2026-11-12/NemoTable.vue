<template>
  <div data-nemo-table>
    <!-- The parent's heading row (title, column tabs, Full screen) sits right
         on top of the list in every section (user 2026-11-02) — only a
         section with no list has it over its facts -->
    <slot v-if="rowsShown.length === 0" name="head" />

    <!-- The table's own facts (waste delivery, ISSC, the CSO…) -->
    <div v-if="headerShown.length > 0" class="nt-facts">
      <template v-for="f in headerShown" :key="f.key">
        <!-- As Send to NEMO: NOD (user 2026-11-07): the NEMO code on a hover on the name -->
        <div class="nt-facts__label">
          <span :class="{ 'nt-hover': f.de }">{{ f.label }}</span>
          <q-tooltip v-if="f.de" anchor="top middle" self="bottom middle" :offset="[0, 6]">NEMO code {{ f.de }}</q-tooltip>
        </div>
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
         the rest fold to nothing but keep their height, so rows never jump. -->
    <slot v-if="rowsShown.length > 0" name="head" />
    <MobileTable
      v-if="isMobile && rowsShown.length > 0"
      :table="table"
      :rows="rowsShown"
      :columns="columnsInOrder"
      :name-key="pinnedKey"
      @pick="emit('pick', $event)"
    />
    <div v-if="!isMobile && rowsShown.length > 0" ref="wrapEl" class="nt-wrap">
      <table ref="tableEl" class="nt-table">
        <thead>
          <tr>
            <th v-if="!labelLast" class="nt-first" :style="firstStyle">
              <div class="nt-th__label">{{ rowWord }}</div>
            </th>
            <th
              v-for="c in columnsInOrder"
              :key="c.key"
              :data-col="c.key"
              :class="{ 'nt-th--req': c.required, 'nt-off': !shownKeys.has(c.key), 'nt-pin': c.key === pinnedKey }"
            >
              <div class="nt-fold">
                <div class="nt-th__label" :class="{ 'nt-hover': c.de }" :data-cut="`col:${c.key}`">{{ c.label }}</div>
              </div>
              <!-- The NEMO code on hover, as Send to NEMO: NOD (user 2026-11-07) -->
              <q-tooltip v-if="cutKeys.has(`col:${c.key}`) || c.de" :delay="300" max-width="360px">
                <div v-if="cutKeys.has(`col:${c.key}`)">{{ c.label }}</div>
                <div v-if="c.de">NEMO code {{ c.de }}</div>
              </q-tooltip>
            </th>
            <!-- Cargo: required columns lead; the optional item name (Cargo items) closes the row on the right (user 2026-11-12) -->
            <th v-if="labelLast" class="nt-first nt-first--end" :style="firstStyle">
              <div class="nt-th__label">{{ rowWord }}</div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rowsShown" :key="r.key">
            <th v-if="!labelLast" class="nt-first" scope="row" :style="firstStyle">
              <div class="nt-first__text" :data-cut="`row:${r.key}`">{{ r.label }}</div>
              <q-tooltip v-if="cutKeys.has(`row:${r.key}`)" :delay="300" max-width="360px">{{ r.label }}</q-tooltip>
            </th>
            <td
              v-for="c in columnsInOrder"
              :key="c.key"
              :data-col="c.key"
              :class="{ 'nt-off': !shownKeys.has(c.key), 'nt-pin': c.key === pinnedKey }"
            >
              <div class="nt-fold">
                <!-- Effects: every item of the crew member, stacked -->
                <template v-if="EFFECTS.includes(c.key) && r.items && r.items.length > 0">
                  <div
                    v-for="(item, n) in r.items"
                    :key="n"
                    class="nt-cell nt-cell--item"
                    :class="cellClasses(item[c.key])"
                    role="button"
                    tabindex="0"
                    @click="pick(r.key, c, item[c.key])"
                    @keyup.enter="pick(r.key, c, item[c.key])"
                  >
                    <NemoCellView :cell="item[c.key]" :column="c" />
                  </div>
                </template>
                <div
                  v-else
                  class="nt-cell"
                  :class="cellClasses(r.cells[c.key])"
                  role="button"
                  tabindex="0"
                  @click="pick(r.key, c, r.cells[c.key])"
                  @keyup.enter="pick(r.key, c, r.cells[c.key])"
                >
                  <NemoCellView :cell="r.cells[c.key]" :column="c" />
                </div>
              </div>
            </td>
            <th v-if="labelLast" class="nt-first nt-first--end" scope="row" :style="firstStyle">
              <div class="nt-first__text" :data-cut="`row:${r.key}`">{{ r.label }}</div>
              <q-tooltip v-if="cutKeys.has(`row:${r.key}`)" :delay="300" max-width="360px">{{ r.label }}</q-tooltip>
            </th>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- The tabs sit in the heading row the parent names, beside Full screen.
         That row is drawn over the list or over the facts (above), so it is a
         new element when All details turns on or off; keyed by where it sits,
         the tabs follow it instead of staying in the removed one. -->
    <Teleport v-if="tabsTo && !isMobile" :key="rowsShown.length > 0 ? 'over-list' : 'over-facts'" defer :to="tabsTo">
      <ColumnTabs
        v-if="tabSegments.length > 1"
        :segments="tabSegments"
        :model-value="missingFields.active ? MISSING_TAB : activeSegment.id"
        :compact="compact"
        @update:model-value="chooseSegment"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * One NEMO table (spec 0096): the ship's forms merged into the columns the
 * National Spreadsheet has, DE codes over the names, the first column
 * sticky while the rest scroll. Without All details only what needs a
 * person: rows and facts with a flag.
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import type { NemoCell, NemoColumn, NemoRow, NemoTable } from '../auth/auth';
import { fitSegments, groupsOf, markOf, type ColumnSegment } from '../lib/column-groups';
import ColumnTabs from './ColumnTabs.vue';
import NemoCellView from './NemoCellView.vue';
import MobileTable from './MobileTable.vue';
import { reportAttachmentMovingKey, reportAttachmentVisibleKey } from '../lib/report-attachment-trigger';
import type { TableMissingFields } from '../composables/useTableMissingFields';

const drawerMoving = inject(reportAttachmentMovingKey, ref(false));
const $q = useQuasar();
const isMobile = computed(() => $q.screen.lt.md);
const drawerVisible = inject(reportAttachmentVisibleKey, ref(false));
// Opening attachments changes the table's viewport, not its chosen columns.
// Keep the groups until the drawer has closed so rows never switch layout
// at the end of either animation. Wider groups remain horizontally scrollable.
const keepColumnGroups = computed(() => drawerVisible.value || drawerMoving.value);

const props = defineProps<{
  table: NemoTable;
  allDetails: boolean;
  missingFields: TableMissingFields;
  /** Where the column tabs go (a selector in the parent's heading row); none, no tabs. */
  tabsTo?: string;
  /** A column of the chosen tab — kept by the parent, so a refresh or full screen keeps the place. */
  anchor?: string | null;
}>();
const emit = defineEmits<{
  pick: [target: { rowKey: string; column: NemoColumn; cell: NemoCell | undefined }];
  'update:anchor': [key: string];
}>();

const HEADER_ROW = '_';
const MISSING_TAB = '__missing-fields';
const EFFECTS = ['effectsType', 'effectsDescription', 'effectsQuantity', 'effectsUnit'];

const flagged = (c: NemoCell | undefined) => !!c?.flag;

function rowFlagged(r: NemoRow): boolean {
  return Object.values(r.cells).some(flagged) || (r.items ?? []).some((i) => Object.values(i).some(flagged));
}

const headerShown = computed(() =>
  props.table.fields.filter((f) => props.missingFields.active
    ? props.missingFields.fields.has(f.key)
    : props.allDetails || flagged(props.table.header[f.key])),
);
const rowsShown = computed(() => props.missingFields.active
  ? props.table.rows.filter(row => props.missingFields.rows.has(row.key))
  : props.allDetails ? props.table.rows : props.table.rows.filter(rowFlagged));
const rowWord = computed(() => props.table.rowNoun[0]!.toUpperCase() + props.table.rowNoun.slice(1));

/** The columns by group, and the tabs the width allows (lib/column-groups). */
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
const widths = ref(new Map<string, number>());
/** The first column's own width, kept on every tab: its line never moves (user 2026-11-02). */
const firstWidth = ref<number | null>(null);
const firstStyle = computed(() =>
  firstWidth.value ? { width: `${firstWidth.value}px`, minWidth: `${firstWidth.value}px` } : undefined,
);
const room = ref(Infinity);
const tabsRoom = ref(Infinity);
const segments = computed<ColumnSegment[]>(() =>
  fitSegments(groups.value, (k) => widths.value.get(k) ?? COL_MIN, room.value).map((s) => ({
    ...s,
    mark: markOf(props.table.rows, s.keys),
  })),
);
const tabSegments = computed<ColumnSegment[]>(() => props.missingFields.offered
  ? [{ id: MISSING_TAB, label: 'Missing fields', keys: [...props.missingFields.columns], mark: props.missingFields.count ? 'check' : null }, ...segments.value]
  : segments.value);
function chooseSegment(id: string): void {
  props.missingFields.choose(id === MISSING_TAB);
  if (id !== MISSING_TAB) emit('update:anchor', id);
}
const activeSegment = computed(
  () => segments.value.find((s) => !!props.anchor && s.keys.includes(props.anchor)) ?? segments.value[0]!,
);
const shownKeys = computed(() => new Set([
  ...(pinnedKey.value ? [pinnedKey.value] : []),
  ...(props.missingFields.active ? props.missingFields.columns : activeSegment.value.keys),
]));

/** Over six tabs, or more than the heading row holds: the folded "‹ 1 of 7 ›". */
const compact = computed(() => {
  if (tabSegments.value.length > 6) return true;
  // each tab a 30px circle, 8px apart
  return tabSegments.value.length * 38 - 8 > tabsRoom.value;
});

/** Column heads and row names cut short with … — measured, so only those get the full text on hover. */
const wrapEl = ref<HTMLElement | null>(null);
const tableEl = ref<HTMLElement | null>(null);
const cutKeys = ref(new Set<string>());
function measure(): void {
  if (drawerMoving.value) return;
  const found = new Set<string>();
  for (const el of tableEl.value?.querySelectorAll<HTMLElement>('[data-cut]') ?? []) {
    if (el.closest('.nt-off')) continue;
    if (el.scrollWidth > el.clientWidth + 1) found.add(el.dataset.cut!);
  }
  cutKeys.value = found;
}

/** Each column's own width, folded or not: its widest line (200px at most) plus the padding. */
const COL_MIN = 112;
const FIRST_MIN = 171;
const LINE_MAX = 200;
function measureWidths(): void {
  if (keepColumnGroups.value) return;
  const table = tableEl.value;
  if (!table || !wrapEl.value) return;
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
    const lines = cell.querySelectorAll(head ? '.nt-de, .nt-th__label' : '.nc__line');
    let widest = 0;
    lines.forEach((l) => (widest = Math.max(widest, line(l))));
    // th 16 + 16; td 7 + 7 around the value's 6 + 6 and its 3px flag bar; 2px to spare
    const w = Math.max(COL_MIN, widest + (head ? 32 : 29) + 2);
    const key = cell.dataset.col!;
    out.set(key, Math.max(out.get(key) ?? 0, w));
  }
  let first = FIRST_MIN;
  table.querySelectorAll('.nt-first__text, thead .nt-first .nt-th__label').forEach((l) => {
    first = Math.max(first, line(l) + 32 + 2);
  });
  widths.value = out;
  firstWidth.value = Math.ceil(first);
  room.value = wrapEl.value.clientWidth - firstWidth.value - (pinnedKey.value ? (out.get(pinnedKey.value) ?? COL_MIN) : 0);
  const slot = props.tabsTo ? document.querySelector<HTMLElement>(props.tabsTo) : null;
  tabsRoom.value = slot ? slot.clientWidth : Infinity;
}

let observer: ResizeObserver | null = null;
function observe(): void {
  observer?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      measureWidths();
      measure();
    });
    if (wrapEl.value) observer.observe(wrapEl.value);
    if (tableEl.value) observer.observe(tableEl.value);
    const slot = props.tabsTo ? document.querySelector<HTMLElement>(props.tabsTo) : null;
    if (slot) observer.observe(slot);
  }
  measureWidths();
  measure();
}
function leaveCompletedMissing(event: Event): void {
  if (!(event.target instanceof Element)) return;
  // Editors and full-screen tables are portalled outside the regular table.
  if (event.target.closest('[data-nemo-table], .ct, .q-dialog, .q-menu')) return;
  props.missingFields.leaveCompleted();
}
onMounted(() => {
  void nextTick(observe);
  document.addEventListener('pointerdown', leaveCompletedMissing);
  document.addEventListener('focusin', leaveCompletedMissing);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('pointerdown', leaveCompletedMissing);
  document.removeEventListener('focusin', leaveCompletedMissing);
});
watch([rowsShown, () => props.table.columns, isMobile], () => void nextTick(observe));
watch(shownKeys, () => void nextTick(measure));
watch(keepColumnGroups, (keep) => {
  if (!keep) void nextTick(observe);
});

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
/* The table's own facts: the field name (Heading/14) with its DE code
   (Body/12) beside the value */
.nt-facts {
  display: grid;
  grid-template-columns: minmax(140px, max-content) minmax(0, 1fr);
  gap: 2px 16px;
  align-items: start;
  margin-bottom: 26px; /* the list's heading row then sits as far below as under the files (user 2026-11-02) */
}
.nt-facts__label {
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--nl-g-ink);
  padding: 4px 0;
}
.nt-de {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--nl-g-secondary);
  font-variant-numeric: tabular-nums;
}
/* The table (Figma "Crew table"): a Blue/600 frame, radius 10; the header
   row Blue/200 with a Blue/600 divider; rows white, divided by Blue/500.
   Every line is 1px (user 2026-11-02). */
/* The tabs keep every column of the chosen group in view; the sideways
   scroll is only a last resort for a column wider than the screen */
.nt-wrap {
  overflow-x: auto;
  border: 1px solid var(--nl-g-line-white);
  border-radius: 10px;
}
.nt-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 14px;
  line-height: 20px;
  color: var(--nl-g-body);
}
/* Every line in the list stays on one line (user 2026-11-02): a line may
   be 200px wide and ends in … beyond that, the whole text on hover */
.nt-table th,
.nt-table td {
  min-width: 112px;
  white-space: nowrap;
  vertical-align: top;
  text-align: left;
}
.nt-th__label,
.nt-first__text,
.nt-table :deep(.nc__line) {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* A column of another tab: folded to nothing, its content still giving
   the row its height (several crew effects stay several lines tall) */
.nt-table .nt-off {
  width: 0;
  min-width: 0;
  padding-left: 0;
  padding-right: 0;
}
.nt-off > .nt-fold {
  width: 0;
  overflow: hidden;
  visibility: hidden;
}
/* Column heads: the DE code over the name, Heading/12 */
.nt-table thead th {
  padding: 14px 16px;
  background: var(--nl-g-head-surface);
}
.nt-th__label {
  margin-top: 2px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--nl-g-ink);
}
.nt-th--req .nt-th__label::after {
  content: ' *';
}
.nt-table tbody tr + tr > * {
  border-top: 1px solid var(--nl-g-line-row);
}
/* A cell's own padding plus the tappable value's: 14px 16px as in Figma */
.nt-table td {
  padding: 10px 7px;
}
/* The row's person or article: Heading/14, ink */
.nt-table tbody th {
  padding: 14px 16px;
  font-weight: 600;
  color: var(--nl-g-ink);
  background: var(--nl-card);
}
/* The row's person or article stays in view while the columns scroll */
.nt-first {
  min-width: 171px;
  position: sticky;
  left: 0;
  z-index: 1;
}
/* Its 1px Blue/600 line on the right, head to last row; drawn on the cell
   itself — Chrome paints no box-shadow on cells of this collapsed table */
.nt-first::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  background: var(--nl-g-line-white);
  pointer-events: none;
}
.nt-table thead .nt-first {
  background: var(--nl-g-head-surface);
}
.nt-cell {
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  border-left: 3px solid transparent;
  min-height: 28px;
}
.nt-cell--item + .nt-cell--item {
  margin-top: 2px;
}
.nt-cell:hover {
  background: var(--nl-gray-bg);
}
.nt-cell--error {
  border-left-color: var(--red-200);
  background: var(--red-100);
}
/* Missing, disagreeing or to check: the missing-field orange */
.nt-cell--warning,
.nt-cell--conflict,
.nt-cell--missing {
  border-left-color: var(--orange-300);
  background: var(--orange-100);
}

/* Every list table as Send to NEMO: NOD (Figma 500:7424, user 2026-11-07):
   no frame and no head surface; dashed Blue/700 under every row, rows at
   least 48px, heads Text/100, the row's name Text/300 Medium, values
   Text/200; the NEMO code on a hover on the name. Overrides the above. */
.nt-hover {
  cursor: help;
}
.nt-facts {
  grid-template-columns: 278px minmax(0, 1fr);
  gap: 0 12px;
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
  font-weight: 500;
  color: var(--text-300);
}
.nt-facts > .nt-cell {
  border-radius: 0;
}
.nt-wrap {
  border: 0;
  border-radius: 0;
}
.nt-table {
  color: var(--text-200);
}
.nt-table thead th,
.nt-table thead .nt-first {
  padding: 0 12px 6px 0;
  background: var(--nl-card);
  vertical-align: bottom;
}
.nt-th__label {
  margin-top: 0;
  letter-spacing: 0.72px;
  color: var(--text-100);
}
.nt-table tr > * {
  border-bottom: 1px dashed var(--blue-700);
}
.nt-table tbody tr + tr > * {
  border-top: 0;
}
.nt-table td {
  padding: 6px 12px 5px 0;
  vertical-align: middle;
}
.nt-table tbody th {
  height: 48px;
  padding: 6px 12px 5px 0;
  font-weight: 500;
  color: var(--text-300);
  vertical-align: middle;
}
/* No column lines, as NOD */
.nt-first::after {
  display: none;
}
/* Cargo: the item name is the last column; the description is the one that stays in view */
.nt-first--end {
  position: static;
}
.nt-table thead .nt-first--end,
.nt-table tbody .nt-first--end {
  padding-right: 0;
}
.nt-pin {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--nl-card);
}
@media (max-width: 599.98px) {
  .nt-facts {
    grid-template-columns: minmax(120px, 40%) minmax(0, 1fr);
  }
}
</style>
