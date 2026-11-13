<template>
  <HouseDialog
    :model-value="modelValue"
    :title="target?.column.label ?? ''"
    :subtitle="target?.column.de ?? ''"
    title-style="detail"
    snug
    :max-width-px="440"
    :close-disable="saving"
    close-label="Cancel"
    main-label="Save"
    :main-loading="saving"
    :main-disable="editValue.trim() === '' || editValue.trim() === (target?.cell?.value ?? '') || problem !== ''"
    @main="save(editValue)"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <ValueLedger
      v-if="target"
      :externals="externals"
      :to-nemo="toNemo"
      :to-nemo-note="toNemoNote"
    >
      <!-- Two forms disagree: one tap takes a form's value -->
      <div v-if="choices.length > 1" class="q-mb-xs">
        <div
          v-for="c in choices"
          :key="c.value + c.from"
          class="te-pick"
          :class="{ 'te-pick--on': editValue === c.value }"
          role="button"
          tabindex="0"
          @click="editValue = c.value"
          @keyup.enter="editValue = c.value"
        >
          <q-icon :name="editValue === c.value ? 'radio_button_checked' : 'radio_button_unchecked'" size="16px" />
          <span class="tnum">{{ c.value }}</span>
          <span class="text-grey-7">{{ c.from }}</span>
        </div>
      </div>

      <!-- Codes are picked from the NEMO list, never typed (spec 0051) -->
      <q-select
        v-if="target.column.kind === 'code' && target.column.list"
        v-model="editValue"
        :options="options"
        outlined
        dense
        use-input
        fill-input
        hide-selected
        emit-value
        map-options
        input-debounce="250"
        hint="The NEMO code list — type a code or a word"
        @filter="filterCodes"
      />
      <q-select
        v-else-if="target.column.kind === 'yesno'"
        v-model="editValue"
        :options="YES_NO"
        outlined
        dense
        emit-value
        map-options
      />
      <q-select
        v-else-if="target.column.kind === 'unit'"
        v-model="editValue"
        :options="UNIT_OPTIONS"
        outlined
        dense
        emit-value
        map-options
      />
      <q-input
        v-else
        v-model="editValue"
        outlined
        dense
        :inputmode="target.column.kind === 'number' ? 'decimal' : undefined"
        :hint="HINTS[target.column.kind] ?? 'Kept in NEMOLink — the ship’s file is not changed'"
        :error="problem !== ''"
        :error-message="problem"
      />
      <div v-if="target.cell?.entered" class="te-meta">Entered by {{ target.cell.entered.author }} — overrides the forms</div>
    </ValueLedger>
    <template #actions>
      <q-btn
        v-if="target?.cell?.entered"
        flat
        no-caps
        color="negative"
        label="Remove what was typed"
        :loading="saving"
        @click="save(null)"
      />
    </template>
  </HouseDialog>
</template>

<script setup lang="ts">
/**
 * A value typed into a NEMO table (spec 0096 decision 2): where no form had
 * it, or to settle two forms that disagree. Kept in NEMOLink for the
 * National Spreadsheet and the NEMO sends; the ship's own file is not
 * changed. Codes come from the NEMO list; removing falls back to the forms.
 */
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type NemoCell, type NemoColumn, type NemoTable } from '../auth/auth';
import HouseDialog from './HouseDialog.vue';
import ValueLedger from './ValueLedger.vue';

export interface EntryTarget {
  table: NemoTable['key'];
  rowKey: string;
  rowLabel: string;
  column: NemoColumn;
  cell: NemoCell | undefined;
}

const props = defineProps<{ modelValue: boolean; callId: string; target: EntryTarget | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [tables: NemoTable[]] }>();

const auth = useAuth();
const $q = useQuasar();

const UNIT_OPTIONS = [
  { label: 'KGM — kilogram', value: 'KGM' },
  { label: 'LTR — litre', value: 'LTR' },
  { label: 'MTQ — cubic metre', value: 'MTQ' },
  { label: 'NAR — number of articles', value: 'NAR' },
  { label: 'TNE — metric ton', value: 'TNE' },
];

const YES_NO = [
  { label: 'Yes', value: '1' },
  { label: 'No', value: '0' },
];

const HINTS: Partial<Record<NemoColumn['kind'], string>> = {
  date: 'yyyy-mm-dd (dd.mm.yyyy reads too)',
  number: 'A number, e.g. 0.5',
  locode: 'The five-letter port code, e.g. FIRAU',
};

const editValue = ref('');
const saving = ref(false);
const options = ref<{ label: string; value: string }[]>([]);
let firstPage: { label: string; value: string }[] = [];

/** External: what the forms say — the form's value, or the ones an entry overrides. */
const externals = computed(() => {
  const c = props.target?.cell;
  if (!c) return [];
  const own = c.source && !c.entered && c.value ? [{ value: c.value, source: `${c.source.formName} · ${c.source.fileName}` }] : [];
  return [...own, ...(c.others ?? []).map((o) => ({ value: o.value, source: o.fileName }))];
});

/** To NEMO: what saving sends — the picked code or choice in NEMO's words. */
const toNemo = computed(() => {
  const v = editValue.value.trim();
  const kind = props.target?.column.kind;
  if (v === '' || problem.value !== '') return '';
  if (kind === 'yesno') return YES_NO.find((o) => o.value === v)?.label ?? v;
  if (kind === 'unit') return UNIT_OPTIONS.find((o) => o.value === v)?.label ?? v;
  if (kind === 'code') return options.value.find((o) => o.value === v)?.label ?? props.target?.cell?.reading ?? v;
  if (kind === 'locode') return v.toUpperCase();
  return v;
});
const toNemoNote = computed(() => {
  const was = props.target?.cell?.value ?? '';
  if (toNemo.value === '') return props.target?.column.required ? 'NEMO asks for this' : '';
  return editValue.value.trim() !== was ? 'after Save' : '';
});

/** The same reading the server does (entryValue), said while typing so Save never meets a refusal. */
const problem = computed(() => {
  const kind = props.target?.column.kind;
  const text = editValue.value.trim();
  if (text === '') return '';
  if (kind === 'number') {
    const n = Number(text.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? '' : 'Write a number, e.g. 0.5';
  }
  if (kind === 'locode') {
    return /^[A-Z]{2}[A-Z2-9]{3}$/.test(text.toUpperCase()) ? '' : 'A five-letter port code, e.g. FIRAU';
  }
  if (kind === 'date') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text) ?? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
    if (!m) return 'A date: yyyy-mm-dd or dd.mm.yyyy';
    const [y, mo, d] = m[1]!.length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    return date.getUTCDate() === Number(d) && date.getUTCMonth() === Number(mo) - 1 ? '' : 'Not a real date';
  }
  return '';
});

/** A conflict's candidates: the value shown and the other forms' values. */
const choices = computed(() => {
  const c = props.target?.cell;
  if (!c?.others?.length) return [];
  const own = c.value ? [{ value: c.value, from: c.entered ? 'typed' : (c.source?.fileName ?? '') }] : [];
  return [...own, ...c.others.map((o) => ({ value: o.value, from: o.fileName }))];
});

watch(
  () => props.modelValue,
  (open) => {
    const t = props.target;
    if (!open || !t) return;
    editValue.value = t.cell?.value ?? '';
    options.value = [];
    firstPage = [];
    if (t.column.kind === 'code' && t.column.list) {
      const list = t.column.list;
      void auth
        .codeOptions(list, '', t.cell?.value ? [t.cell.value] : [])
        .then(async (named) => {
          const page = await auth.codeOptions(list, '');
          const seen = new Set(page.map((o) => o.code));
          firstPage = [...named.filter((o) => !seen.has(o.code)), ...page].map((o) => ({ label: `${o.code} — ${o.label}`, value: o.code }));
          options.value = firstPage;
        })
        .catch(() => undefined);
    }
  },
);

function filterCodes(input: string, update: (fn: () => void) => void): void {
  const list = props.target?.column.list;
  const q = input.trim();
  if (!list || q === '') {
    update(() => (options.value = firstPage));
    return;
  }
  void auth
    .codeOptions(list, q)
    .then((found) => update(() => (options.value = found.map((o) => ({ label: `${o.code} — ${o.label}`, value: o.code })))))
    .catch(() => update(() => undefined));
}

async function save(value: string | null): Promise<void> {
  const t = props.target;
  if (!t) return;
  saving.value = true;
  try {
    const tables = await auth.enterTableValue(props.callId, t.table, t.rowKey, t.column.key, value === null ? null : value.trim());
    emit('saved', tables);
    emit('update:modelValue', false);
    $q.notify({ type: 'positive', message: value === null ? 'Removed — the forms’ value is back.' : 'Saved in NEMOLink.' });
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not save the value.' });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.te-meta {
  font-size: 12px;
  color: var(--nl-ink-3);
  margin-top: 4px;
}
.te-pick {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.te-pick:hover {
  background: var(--nl-gray-bg);
}
.te-pick--on {
  background: var(--nl-blue-bg);
}
</style>
