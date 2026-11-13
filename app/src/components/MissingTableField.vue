<template>
  <!-- One field of a row: its name as the header of the box, the row's
       name stays on the left in NemoTable (user 2026-11-13) -->
  <div ref="rootEl" class="mtf-field">
    <div class="mtf-label">
      <span :class="{ 'mtf-code': entry.column.de }">{{ entry.column.label }}<template v-if="entry.itemIndex !== undefined"> · Item {{ entry.itemIndex + 1 }}</template></span>
      <q-tooltip v-if="entry.column.de" anchor="top middle" self="bottom middle">NEMO code {{ entry.column.de }}</q-tooltip>
      <span v-if="!missing" class="mtf-done">{{ entry.cell.entered ? 'Entered here' : entry.cell.source?.formName ?? 'Entered here' }}</span>
    </div>
    <div class="mtf-value">
      <template v-if="missing || editing">
        <q-select
          v-if="isSelect"
          v-model="draft"
          :options="options"
          :use-input="isCode"
          :fill-input="isCode"
          :hide-selected="isCode"
          emit-value map-options dense outlined options-dense
          :input-debounce="250"
          :aria-label="accessibleLabel"
          :loading="busy"
          :disable="disabled"
          popup-content-class="missing-table-options"
          @filter="filterCodes"
          @update:model-value="commit"
        />
        <q-input
          v-else
          v-model="draft"
          dense outlined
          :aria-label="accessibleLabel"
          :inputmode="entry.column.kind === 'number' ? 'decimal' : undefined"
          :loading="busy"
          :disable="disabled"
          :error="!!problem"
          :error-message="problem"
          hide-bottom-space
          @blur="commit"
          @keyup.enter="commit"
        />
      </template>
      <div v-else class="mtf-completed prov-lane">
        <NemoCellView :cell="entry.cell" :column="entry.column" />
        <button type="button" class="mtf-edit" :aria-label="`Edit ${accessibleLabel}`" @click="beginEdit">Edit</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useAuth } from '../auth/auth';
import type { MissingTableEntry } from '../composables/useTableMissingFields';
import { TABLE_UNITS, TABLE_YES_NO, tableValueProblem } from '../lib/table-value';
import NemoCellView from './NemoCellView.vue';

const props = defineProps<{ entry: MissingTableEntry; busy: boolean; disabled: boolean }>();
const emit = defineEmits<{ save: [entry: MissingTableEntry, value: string] }>();
const auth = useAuth();
const draft = ref(props.entry.cell.value ?? '');
const editing = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const missing = computed(() => props.entry.cell.flag === 'missing');
const isCode = computed(() => props.entry.column.kind === 'code' && !!props.entry.column.list);
const isSelect = computed(() => isCode.value || props.entry.column.kind === 'yesno' || props.entry.column.kind === 'unit');
const accessibleLabel = computed(() => `${props.entry.column.label}${props.entry.rowLabel ? ` for ${props.entry.rowLabel}` : ''}${props.entry.itemIndex !== undefined ? `, item ${props.entry.itemIndex + 1}` : ''}`);
const problem = computed(() => tableValueProblem(props.entry.column.kind, draft.value));
type Option = { label: string; value: string };
const codeOptions = ref<Option[]>([]);
const options = computed(() => isCode.value ? codeOptions.value : props.entry.column.kind === 'yesno' ? TABLE_YES_NO : TABLE_UNITS);
watch(() => props.entry.cell.value, value => {
  draft.value = value ?? '';
  editing.value = false;
});

let search = 0;
function filterCodes(input: string, update: (fn: () => void) => void): void {
  const list = props.entry.column.list;
  if (!list) { update(() => undefined); return; }
  const request = ++search;
  void auth.codeOptions(list, input.trim()).then(found => {
    if (request === search) update(() => { codeOptions.value = found.map(option => ({ label: `${option.code} — ${option.label}`, value: option.code })); });
  }).catch(() => { if (request === search) update(() => { codeOptions.value = []; }); });
}
function commit(): void {
  const value = draft.value.trim();
  if (props.disabled || !value || problem.value) return;
  if (value === (props.entry.cell.value ?? '')) { editing.value = false; return; }
  emit('save', props.entry, value);
}
async function beginEdit(): Promise<void> {
  editing.value = true;
  await nextTick();
  rootEl.value?.querySelector<HTMLInputElement>('input')?.focus();
}
</script>

<style scoped>
/* The label 11px over the box, in the form fields' label style */
.mtf-field {
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-width: 0;
  font-size: 14px;
  color: var(--text-200);
}
.mtf-label { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; font-size: 14px; line-height: 18px; font-weight: 600; color: var(--text-200); }
.mtf-code { cursor: help; }
.mtf-done { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--text-100); }
.mtf-value { min-width: 0; }
.mtf-value :deep(.q-field__control) { background: var(--nl-g-white); box-shadow: none; }
.mtf-value :deep(.q-field__control:before) { border-style: solid; border-color: var(--nl-g-field-line); }
.mtf-completed { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0; min-height: 37px; }
.mtf-completed :deep(.nc) { min-width: 0; overflow-wrap: anywhere; }
.mtf-edit { border: 0; background: none; padding: 0; color: var(--nl-g-blue); font: inherit; font-weight: 600; cursor: pointer; }
.mtf-edit:hover { text-decoration: underline; text-underline-offset: 3px; }
.mtf-edit:focus-visible { outline: 2px solid var(--nl-g-blue); outline-offset: 3px; }
</style>
