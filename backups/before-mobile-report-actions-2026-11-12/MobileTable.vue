<template>
  <div class="ntm">
    <label :for="categoryId" class="ntm-category-label">Category</label>
    <div class="ntm-category">
      <select :id="categoryId" v-model="category" class="ntm-category__select">
        <option value="">All {{ table.rowNoun }}</option>
        <option v-for="column in columns" :key="column.key" :value="column.key">
          {{ column.label }}{{ column.required ? ' *' : '' }}
        </option>
      </select>
      <q-icon name="expand_more" size="24px" aria-hidden="true" />
    </div>

    <ul class="ntm-list" :aria-label="table.rowNoun">
      <li v-for="row in rows" :key="row.key" class="ntm-list__item">
        <button
          type="button"
          class="ntm-row"
          :class="{ 'ntm-row--category': selectedColumn }"
          :aria-label="rowAccessibleLabel(row)"
          aria-haspopup="dialog"
          @click="selectedKey = row.key"
        >
          <span class="ntm-row__name">
            <span class="ntm-row__primary">{{ rowName(row)[0] }}</span>
            <span v-if="rowName(row)[1]" class="ntm-row__secondary">{{ rowName(row)[1] }}</span>
          </span>
          <span v-if="selectedColumn" class="ntm-row__value" :class="valueTone(row, selectedColumn)">
            <template v-for="(cell, index) in cellsFor(row, selectedColumn)" :key="index">
              <NemoCellView v-if="cell?.value || cell?.flag" :cell="cell" :column="selectedColumn" />
              <span v-else class="ntm-empty">—</span>
            </template>
          </span>
          <span v-else class="ntm-row__end">
            <q-icon
              v-if="rowMark(row)"
              :name="rowMark(row) === 'error' ? 'error' : 'info'"
              :class="`ntm-mark ntm-mark--${rowMark(row)}`"
              size="20px"
              role="img"
              :aria-label="rowMark(row) === 'error' ? 'Has an error' : 'Needs attention'"
            />
            <q-icon name="chevron_right" size="24px" aria-hidden="true" />
          </span>
        </button>
      </li>
    </ul>

    <!-- A row becomes a full-height detail card. Keeping it mounted over the
         list preserves the selected category, scroll position and focus. -->
    <q-dialog :model-value="!!selectedRow" :aria-labelledby="detailTitleId" maximized :transition-duration="0" @update:model-value="closeDetail">
      <q-card v-if="selectedRow" class="ntm-detail">
        <header class="ntm-detail__nav">
          <button type="button" class="ntm-back" :aria-label="`Back to ${table.rowNoun}`" @click="closeDetail">
            <q-icon name="arrow_back" size="24px" aria-hidden="true" />
          </button>
          <span class="ntm-detail__position">{{ itemNoun }} {{ selectedIndex + 1 }} of {{ rows.length }}</span>
        </header>
        <div class="ntm-detail__body">
          <h2 :id="detailTitleId" class="ntm-detail__title">{{ nameOf(selectedRow) }}</h2>
          <dl class="ntm-detail__fields">
            <div v-for="column in columns" :key="column.key" class="ntm-detail__field">
              <dt>{{ column.label }}<span v-if="column.required"> *</span></dt>
              <dd>
                <button
                  v-for="(cell, index) in cellsFor(selectedRow, column)"
                  :key="index"
                  type="button"
                  class="ntm-detail__value"
                  :class="cellTone(cell)"
                  :aria-label="`Edit ${column.label}${index > 0 ? `, item ${index + 1}` : ''} for ${nameOf(selectedRow)}: ${cellWords(cell, column)}`"
                  @click="emit('pick', { rowKey: selectedRow.key, column, cell })"
                >
                  <NemoCellView v-if="cell?.value || cell?.flag" :cell="cell" :column="column" />
                  <span v-else class="ntm-empty">—</span>
                </button>
              </dd>
            </div>
          </dl>
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import type { NemoCell, NemoColumn, NemoRow, NemoTable } from '../auth/auth';
import NemoCellView from './NemoCellView.vue';

const props = defineProps<{ table: NemoTable; rows: NemoRow[]; columns: NemoColumn[]; nameKey?: string | null }>();
const emit = defineEmits<{ pick: [target: { rowKey: string; column: NemoColumn; cell: NemoCell | undefined }] }>();
const categoryId = useId();
const detailTitleId = useId();
const category = ref('');
const selectedKey = ref<string | null>(null);
const selectedColumn = computed(() => props.columns.find(column => column.key === category.value));
const selectedIndex = computed(() => props.rows.findIndex(row => row.key === selectedKey.value));
const selectedRow = computed(() => props.rows[selectedIndex.value]);
const ITEM_NOUNS: Record<NemoTable['key'], string> = {
  crew: 'Crew member', passengers: 'Passenger', cargo: 'Cargo item', stores: 'Store article',
  waste: 'Waste type', security: 'Port facility call', health: 'Sanitary measure',
};
const itemNoun = computed(() => ITEM_NOUNS[props.table.key]);
const EFFECTS = new Set(['effectsType', 'effectsDescription', 'effectsQuantity', 'effectsUnit']);

/**
 * A row's name is what the desktop table's first column on the left shows
 * (user 2026-11-12): for cargo the Description of goods, not the optional
 * item name. Without a name column it is the row's own label.
 */
function nameOf(row: NemoRow): string {
  if (!props.nameKey) return row.label;
  const cell = row.cells[props.nameKey];
  const column = props.columns.find(c => c.key === props.nameKey);
  return cell?.reading || cell?.value || `${column?.label ?? 'Name'} missing`;
}
function rowName(row: NemoRow): [string, string] {
  const name = nameOf(row);
  if (props.table.key !== 'crew' && props.table.key !== 'passengers') return [name, ''];
  const comma = name.indexOf(',');
  return comma < 0 ? [name, ''] : [name.slice(0, comma).trim(), name.slice(comma + 1).trim()];
}

function cellsFor(row: NemoRow, column: NemoColumn): (NemoCell | undefined)[] {
  return EFFECTS.has(column.key) && row.items?.length
    ? row.items.map(item => item[column.key])
    : [row.cells[column.key]];
}

function cellWords(cell: NemoCell | undefined, column: NemoColumn): string {
  if (!cell?.value) return cell?.flag === 'missing' ? 'Missing' : 'Not provided';
  const value = column.kind === 'yesno' ? (cell.value === '1' ? 'Yes' : 'No') : cell.reading || cell.value;
  return cell.message ? `${value}. ${cell.message}` : value;
}

function rowAccessibleLabel(row: NemoRow): string {
  const column = selectedColumn.value;
  if (!column) return `View details for ${nameOf(row)}`;
  return `View details for ${nameOf(row)}. ${column.label}: ${cellsFor(row, column).map(cell => cellWords(cell, column)).join('; ')}`;
}

function cellTone(cell: NemoCell | undefined): string {
  if (cell?.flag === 'error') return 'ntm-value--error';
  return cell?.flag ? 'ntm-value--check' : '';
}

function valueTone(row: NemoRow, column: NemoColumn): string {
  const cells = cellsFor(row, column);
  if (cells.some(cell => cell?.flag === 'error')) return 'ntm-value--error';
  return cells.some(cell => cell?.flag) ? 'ntm-value--check' : '';
}

function rowMark(row: NemoRow): 'error' | 'check' | null {
  const cells = [...Object.values(row.cells), ...(row.items ?? []).flatMap(item => Object.values(item))];
  if (cells.some(cell => cell.flag === 'error')) return 'error';
  return cells.some(cell => cell.flag) ? 'check' : null;
}

function closeDetail(): void { selectedKey.value = null; }

watch(() => props.table.key, () => { category.value = ''; closeDetail(); });
watch(() => props.rows, rows => {
  if (selectedKey.value && !rows.some(row => row.key === selectedKey.value)) closeDetail();
});
watch(() => props.columns, columns => {
  if (!columns.some(column => column.key === category.value)) category.value = '';
});
</script>

<style scoped>
.ntm { min-width: 0; color: var(--text-300); }
.ntm-category-label { display: block; margin-bottom: 8px; font-size: 14px; line-height: 20px; color: var(--text-100); }
.ntm-category { position: relative; margin-bottom: 12px; }
.ntm-category__select {
  display: block;
  appearance: none;
  width: 100%;
  min-height: 48px;
  padding: 10px 44px 10px 14px;
  border: 1.5px solid var(--blue-700);
  border-radius: 8px;
  background: var(--blue-100);
  color: var(--text-300);
  font: inherit;
  font-size: 16px;
  line-height: 24px;
  cursor: pointer;
}
.ntm-category > .q-icon { position: absolute; inset-block-start: 12px; inset-inline-end: 12px; pointer-events: none; }
.ntm-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--blue-600); }
.ntm-list__item { border-bottom: 1px solid var(--blue-600); }
.ntm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-height: 66px;
  padding: 10px 0;
  border: 0;
  background: var(--blue-100);
  color: var(--text-300);
  font: inherit;
  font-size: 16px;
  line-height: 23px;
  text-align: start;
  cursor: pointer;
}
.ntm-row--category { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); min-height: 84px; padding-block: 16px; }
.ntm-row__name { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.ntm-row__primary { font-weight: 600; }
.ntm-row__secondary { color: var(--text-200); }
.ntm-row__end { display: flex; align-items: center; gap: 8px; flex: none; color: var(--text-100); }
.ntm-row__value { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 6px 10px; border-radius: 8px; background: var(--blue-300); }
.ntm-row__value :deep(.nc__value) { font-weight: 600; color: var(--text-300); }
.ntm-row__value :deep(.nc__reading) { color: var(--text-100); font-size: 14px; line-height: 20px; }
.ntm :deep(.nc__line), .ntm-detail :deep(.nc__line) { white-space: normal; overflow-wrap: anywhere; overflow: visible; text-overflow: clip; }
.ntm-mark--error { color: var(--red-200); }
.ntm-mark--check { color: var(--orange-500); }
.ntm-empty { color: var(--text-100); }
.ntm-detail { display: flex; flex-direction: column; background: var(--blue-100); color: var(--text-300); border-radius: 0; box-shadow: none; }
.ntm-detail__nav { display: flex; align-items: center; gap: 12px; flex: none; min-height: 64px; padding: env(safe-area-inset-top, 0px) 12px 0; border-bottom: 1px solid var(--blue-600); }
.ntm-back { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex: none; padding: 0; border: 0; border-radius: 8px; background: var(--blue-100); color: var(--text-300); cursor: pointer; }
.ntm-detail__position { color: var(--text-100); font-size: 14px; line-height: 20px; }
.ntm-detail__body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 24px 20px calc(24px + env(safe-area-inset-bottom)); scrollbar-color: var(--blue-700) var(--blue-100); }
.ntm-detail__title { margin: 0 0 20px; color: var(--text-300); font-size: 24px; font-weight: 600; line-height: 30px; overflow-wrap: anywhere; }
.ntm-detail__fields { margin: 0; border-top: 1px solid var(--blue-600); }
.ntm-detail__field { padding-block: 14px; border-bottom: 1px solid var(--blue-600); }
.ntm-detail__field dt { color: var(--text-100); font-size: 12px; font-weight: 600; line-height: 18px; text-transform: uppercase; }
.ntm-detail__field dd { margin: 4px 0 0; }
.ntm-detail__value { display: block; width: 100%; min-height: 44px; padding: 6px 0; border: 0; border-radius: 6px; background: var(--blue-100); color: var(--text-300); font: inherit; font-size: 18px; line-height: 25px; text-align: start; cursor: pointer; }
.ntm-detail__value + .ntm-detail__value { margin-top: 8px; }
.ntm-detail__value :deep(.nc__value) { display: inline; color: var(--text-300); }
.ntm-detail__value :deep(.nc__reading) { display: inline; color: var(--text-300); }
.ntm-detail__value :deep(.nc__reading)::before { content: ' · '; }
.ntm-value--error { background: var(--red-100); }
.ntm-value--check { background: var(--orange-100); }
.ntm-detail__value.ntm-value--error, .ntm-detail__value.ntm-value--check { padding-inline: 10px; }
.ntm-category__select:focus-visible, .ntm-row:focus-visible, .ntm-back:focus-visible, .ntm-detail__value:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 2px; }
.ntm-row:focus-visible { outline-offset: -2px; }
.ntm-row:active, .ntm-back:active, .ntm-detail__value:active { background: var(--blue-300); }
@media (hover: hover) {
  .ntm-row:hover, .ntm-back:hover, .ntm-detail__value:hover { background: var(--blue-200); }
}
</style>
