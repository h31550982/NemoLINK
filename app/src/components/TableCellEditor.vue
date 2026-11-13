<template>
  <!-- A NEMO table value typed right in its cell (user 2026-11-13): codes
       picked from the NEMO list, yes/no and units from theirs, the rest
       typed. Enter or leaving the field saves; Esc puts the cell back. -->
  <div ref="rootEl" class="tce" @keydown.esc.stop.prevent="cancel">
    <q-select
      v-if="isSelect"
      ref="fieldRef"
      v-model="draft"
      :options="options"
      :use-input="isCode"
      :fill-input="isCode"
      :hide-selected="isCode"
      emit-value map-options dense outlined options-dense
      :input-debounce="250"
      :aria-label="label"
      :loading="busy"
      :disable="busy"
      popup-content-class="tce-options"
      @filter="filterCodes"
      @update:model-value="commit"
    />
    <q-input
      v-else
      ref="fieldRef"
      v-model="draft"
      dense outlined
      :aria-label="label"
      :inputmode="column.kind === 'number' ? 'decimal' : undefined"
      :placeholder="column.kind === 'date' ? 'yyyy-mm-dd' : undefined"
      :loading="busy"
      :disable="busy"
      :error="!!problem"
      :error-message="problem"
      hide-bottom-space
      @blur="commit"
      @keyup.enter="commit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useAuth, type NemoCell, type NemoColumn } from '../auth/auth';
import { TABLE_UNITS, TABLE_YES_NO, tableValueProblem } from '../lib/table-value';

const props = defineProps<{ column: NemoColumn; cell: NemoCell | undefined; busy: boolean; label: string }>();
const emit = defineEmits<{ save: [value: string]; cancel: [] }>();
const auth = useAuth();
const draft = ref(props.cell?.value ?? '');
const rootEl = ref<HTMLElement | null>(null);
const fieldRef = ref<{ focus: () => void; showPopup?: () => void } | null>(null);
const isCode = computed(() => props.column.kind === 'code' && !!props.column.list);
const isSelect = computed(() => isCode.value || props.column.kind === 'yesno' || props.column.kind === 'unit');
const problem = computed(() => tableValueProblem(props.column.kind, draft.value));
type Option = { label: string; value: string };
const codeOptions = ref<Option[]>([]);
const options = computed(() => (isCode.value ? codeOptions.value : props.column.kind === 'yesno' ? TABLE_YES_NO : TABLE_UNITS));

let search = 0;
function filterCodes(input: string, update: (fn: () => void) => void): void {
  const list = props.column.list;
  if (!list) {
    update(() => undefined);
    return;
  }
  const request = ++search;
  void auth
    .codeOptions(list, input.trim())
    .then((found) => {
      if (request === search) update(() => { codeOptions.value = found.map((o) => ({ label: `${o.code} — ${o.label}`, value: o.code })); });
    })
    .catch(() => {
      if (request === search) update(() => { codeOptions.value = []; });
    });
}

/** Saved or put back once: Enter, then the blur that follows, must not save twice. */
let done = false;
watch(() => props.busy, (busy) => {
  if (!busy) done = false; // a refused save leaves the field open to try again
});
function cancel(): void {
  if (done) return;
  done = true;
  emit('cancel');
}
function commit(): void {
  if (props.busy || done) return;
  const value = String(draft.value ?? '').trim();
  if (problem.value) return;
  if (!value || value === (props.cell?.value ?? '')) {
    cancel();
    return;
  }
  done = true;
  emit('save', value);
}

/** A tap anywhere else puts an untouched dropdown back (a typed field saves on blur). */
function outside(event: Event): void {
  if (!isSelect.value || !(event.target instanceof Element)) return;
  if (rootEl.value?.contains(event.target) || event.target.closest('.tce-options')) return;
  cancel();
}
onMounted(async () => {
  document.addEventListener('pointerdown', outside);
  await nextTick();
  fieldRef.value?.focus();
  if (isSelect.value && !isCode.value) fieldRef.value?.showPopup?.();
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
</script>

<style scoped>
/* The field as wide as the cell, at least room for a code and its words */
.tce {
  min-width: 180px;
}
.tce :deep(.q-field__control) {
  background: var(--nl-g-white);
  box-shadow: none;
}
.tce :deep(.q-field__control:before) {
  border-style: solid;
  border-color: var(--nl-g-field-line);
}
</style>
