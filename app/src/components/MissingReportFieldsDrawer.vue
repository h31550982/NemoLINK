<template>
  <HouseDialog :model-value="modelValue" title="Fill all missing fields" :sheet-breakpoint="1024" close-label="Done" main-label="Save changes" :main-loading="saving" :main-disable="!dirty.length" :close-disable="saving" :no-x="saving" no-shortcut-hint @main="save" @update:model-value="!saving && emit('update:modelValue', $event)">
    <template #title-extra><StatusPill v-if="remaining" tone="amber" :label="`${remaining} missing`" /></template>
    <section v-for="group in groups" :key="group.key" class="missing-drawer-group">
      <h3><span>{{ group.label }}</span><StatusPill v-if="group.missing" tone="amber" :label="`${group.missing} missing`" /></h3>
      <div v-for="field in group.fields" :key="field.id" class="missing-drawer-field">
        <FormField :name="field.id" :for-id="inputId(field.id)" :label="`${field.column.label}${field.column.required ? ' *' : ''}`" :error="errors[field.id]">
          <q-select v-if="field.column.kind === 'code' && field.column.list" v-model="values[field.id]" :for="inputId(field.id)" outlined dense use-input fill-input hide-selected emit-value map-options :options="options[field.id] ?? []" :input-debounce="250" :disable="saving" @filter="(query, update) => filterCodes(field, query, update)" />
          <q-select v-else-if="['yesno', 'unit'].includes(field.column.kind)" v-model="values[field.id]" :for="inputId(field.id)" outlined dense emit-value map-options :options="field.column.kind === 'yesno' ? yesNo : units" :disable="saving" />
          <q-input v-else v-model="values[field.id]" :for="inputId(field.id)" outlined dense :disable="saving" :inputmode="field.column.kind === 'number' ? 'decimal' : undefined" :placeholder="field.column.kind === 'date' ? 'yyyy-mm-dd' : undefined" />
        </FormField>
        <span v-if="saved.has(field.id) && values[field.id]?.trim() === originals[field.id]" class="missing-drawer-saved"><q-icon name="check_circle" size="18px" /> Saved</span>
      </div>
    </section>
  </HouseDialog>
</template>
<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue';
import { useAuth, type NemoTable } from '../auth/auth';
import { missingReportFields, type MissingReportField } from '../lib/mobile-report-fields';
import { tableValueProblem } from '../lib/table-value';
import HouseDialog from './HouseDialog.vue';
import FormField from './FormField.vue';
import StatusPill from './StatusPill.vue';
const props = defineProps<{ modelValue: boolean; table: NemoTable; callId: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [tables: NemoTable[]] }>();
const auth = useAuth();
const inputPrefix = useId();
function inputId(id: string): string { return `${inputPrefix}-${fields.value.findIndex(field => field.id === id)}`; }
const fields = ref<MissingReportField[]>([]);
const values = reactive<Record<string, string>>({});
const originals = reactive<Record<string, string>>({});
const errors = reactive<Record<string, string>>({});
const options = reactive<Record<string, { label: string; value: string }[]>>({});
const saving = ref(false);
const saved = reactive(new Set<string>());
const yesNo = [{ label: 'Yes', value: '1' }, { label: 'No', value: '0' }];
const units = [{ label: 'KGM — kilogram', value: 'KGM' }, { label: 'LTR — litre', value: 'LTR' }, { label: 'MTQ — cubic metre', value: 'MTQ' }, { label: 'NAR — number of articles', value: 'NAR' }, { label: 'TNE — metric ton', value: 'TNE' }];
const dirty = computed(() => fields.value.filter(field => (values[field.id] ?? '').trim() !== originals[field.id]));
const liveMissing = computed(() => new Set(missingReportFields(props.table).map(field => field.id)));
const remaining = computed(() => liveMissing.value.size);
const groups = computed(() => {
  const grouped = new Map<string, { key: string; label: string; fields: MissingReportField[] }>();
  for (const field of fields.value) {
    if (!grouped.has(field.rowKey)) grouped.set(field.rowKey, { key: field.rowKey, label: field.rowLabel, fields: [] });
    grouped.get(field.rowKey)!.fields.push(field);
  }
  return [...grouped.values()].map(group => ({ ...group, missing: group.fields.filter(field => liveMissing.value.has(field.id)).length }));
});
watch(() => props.modelValue, open => {
  if (!open) return;
  // Snapshot once per opening. Server refreshes must never remove completed inputs.
  fields.value = missingReportFields(props.table);
  saved.clear();
  for (const key of Object.keys(errors)) delete errors[key];
  for (const field of fields.value) values[field.id] = originals[field.id] = field.cell.value ?? '';
});
async function filterCodes(field: MissingReportField, query: string, update: (fn: () => void) => void): Promise<void> {
  try {
    const found = await auth.codeOptions(field.column.list!, query.trim());
    update(() => { options[field.id] = found.map(option => ({ label: `${option.code} — ${option.label}`, value: option.code })); });
  } catch { update(() => { options[field.id] = []; errors[field.id] = 'Could not load the code list. Try again.'; }); }
}
async function save(): Promise<void> {
  if (saving.value) return;
  const pending = dirty.value;
  if (!pending.length) return;
  saving.value = true;
  let failed = false;
  try {
    for (const field of pending) {
      const value = (values[field.id] ?? '').trim();
      errors[field.id] = '';
      const problem = value ? tableValueProblem(field.column.kind, value) : 'This field is required.';
      if (problem) { errors[field.id] = problem; failed = true; continue; }
      try {
        const tables = await auth.enterTableValue(props.callId, props.table.key, field.rowKey, field.column.key, value);
        originals[field.id] = value;
        saved.add(field.id);
        emit('saved', tables);
      } catch (error) {
        errors[field.id] = error instanceof Error ? error.message : 'Could not save this value. Try again.';
        failed = true;
      }
    }
    if (!failed) emit('update:modelValue', false);
  } finally { saving.value = false; }
}
</script>
<style scoped>
.missing-drawer-group + .missing-drawer-group { margin-top: 32px; }
/* Match HouseDialog's mobile drawer header, including its natural casing. */
.missing-drawer-group h3 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 20px; padding-bottom: 12px; border-bottom: 1px solid var(--blue-600); color: var(--text-300); font-size: 20px; font-weight: 600; line-height: normal; letter-spacing: 0.2px; text-transform: none; overflow-wrap: anywhere; }
.missing-drawer-group h3 > span:first-child { min-width: 0; }
.missing-drawer-field + .missing-drawer-field { margin-top: 24px; }
.missing-drawer-field :deep(input) { font-size: 16px; }
.missing-drawer-saved { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 14px; color: var(--green-400); }
</style>
