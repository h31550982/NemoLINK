<template>
<!-- One checked value: what the file says, how we read it, the port at
     hand, and the fix (specs 0050/0051) -->
<HouseDialog
  v-model="open"
  :title="annInfo?.label ?? ''"
  :subtitle="annInfo?.de ?? ''"
  title-style="detail"
  snug
  :max-width-px="440"
  :close-disable="correcting"
  :close-label="canUpload ? 'Cancel' : 'Close'"
  :main-label="canUpload ? 'Save' : undefined"
  :main-loading="correcting"
  :main-disable="editValue.trim() === (annInfo?.corr?.value ?? annInfo?.raw ?? '')"
  @main="saveCorrection(editValue)"
>
  <template v-if="annInfo">
    <div
      v-if="annInfo.ann?.message"
      class="doc-note q-mb-md"
      :class="{ 'doc-note--error': annInfo.ann.severity === 'error' }"
    >
      {{ annInfo.ann.message }}
    </div>

    <!-- External (the file), NEMOLink (the correction), To NEMO — the
         ledger's words, as in the table entry dialog -->
    <ValueLedger
      :externals="[{ value: annInfo.raw, source: annInfo.source }]"
      :to-nemo="toNemo"
      :to-nemo-note="toNemoNote"
    >
    <div v-if="!canUpload" class="ann-fact__value">{{ annInfo.corr?.value || '—' }}</div>

    <!-- Pick, don't type (spec 0051 amendment): a port picker for
         LOCODEs, "Did you mean" for GISIS codes -->
    <q-select
      v-if="canUpload && annInfo.ann?.kind === 'locode'"
      v-model="editValue"
      :options="portSearchOptions"
      label="Correct port"
      outlined
      dense
      use-input
      fill-input
      hide-selected
      emit-value
      map-options
      input-debounce="300"
      hint="UN/LOCODE ports worldwide (NEMO) — type a code or a name"
      @filter="filterPortSearch"
      @update:model-value="onPickPort"
    />

    <div
      v-if="canUpload && annInfo.ann?.kind === 'gisis' && gisisOptions.length > 0"
    >
      <div class="ann-fact__label">
        {{ annInfo.ann.severity === 'ok' ? 'Port facility' : 'Did you mean' }}
      </div>
      <div
        v-for="opt in gisisOptions"
        :key="opt.code"
        class="pick-row"
        :class="{ 'pick-row--on': gisisFullCode(editValue) === opt.code }"
        role="button"
        tabindex="0"
        @click="editValue = opt.code"
        @keyup.enter="editValue = opt.code"
      >
        <q-icon
          :name="gisisFullCode(editValue) === opt.code ? 'radio_button_checked' : 'radio_button_unchecked'"
          size="16px"
        />
        <span class="tnum text-no-wrap">{{ opt.code }}</span>
        <span v-if="opt.label" class="pick-row__label text-grey-7">({{ opt.label }})</span>
      </div>
    </div>

    <!-- NEMO codes (spec 0093 §1): "Did you mean", then the whole list —
         picked, never typed -->
    <template v-if="canUpload && annInfo.ann?.kind === 'code'">
      <div v-if="codeSuggestions.length > 0" class="q-mb-sm">
        <div class="ann-fact__label">Did you mean</div>
        <div
          v-for="opt in codeSuggestions"
          :key="opt.code"
          class="pick-row"
          :class="{ 'pick-row--on': editValue === opt.code }"
          role="button"
          tabindex="0"
          @click="editValue = opt.code"
          @keyup.enter="editValue = opt.code"
        >
          <q-icon
            :name="editValue === opt.code ? 'radio_button_checked' : 'radio_button_unchecked'"
            size="16px"
          />
          <span class="tnum text-no-wrap">{{ opt.code }}</span>
          <span class="pick-row__label text-grey-7">{{ opt.label }}</span>
        </div>
      </div>
      <q-select
        v-model="editValue"
        :options="codeOptions"
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
    </template>

    <!-- A quantity (spec 0094): a number and one of NEMO's five units, side
         by side (user 2026-11-02) -->
    <template v-if="canUpload && annInfo.ann?.kind === 'unit'">
      <div class="qty-stack">
        <q-input v-model="qtyAmount" label="Quantity" outlined dense inputmode="decimal" />
        <q-select
          v-model="qtyUnit"
          :options="UNIT_OPTIONS"
          label="Unit"
          outlined
          dense
          emit-value
          map-options
        />
      </div>
      <div class="ann-meta">
        NEMO takes these five units only. Bottles, cans and pieces are counted (NAR).
      </div>
    </template>

    <!-- Free entry for dates, names and the rest. Never for codes (user
         rule 2026-09-02): a LOCODE comes from the picker, a facility from
         the official list above — or the field stays flagged. -->
    <template v-if="canUpload && !PICKED_KINDS.includes(annInfo.ann?.kind ?? '')">
      <q-input
        v-model="editValue"
        outlined
        dense
        :hint="
          annInfo.ann?.kind === 'effects'
            ? 'One item per ; — e.g. CRE-001 Rum 2 LTR; CRE-006 Tobacco 0.5 KGM'
            : 'Kept in NEMOLink — the file itself is never changed'
        "
      />
    </template>
    <div v-if="annInfo.corr" class="ann-meta">Corrected by {{ annInfo.corr.author }} — the file itself is never changed</div>
    </ValueLedger>

    <!-- FAL 4: each effects item in the cell, as NEMO will get it -->
    <div v-if="annInfo.ann?.kind === 'effects' && annInfo.ann.items?.length" class="q-mt-md">
      <div class="ann-fact__label">Items</div>
      <div
        v-for="(item, i) in annInfo.ann.items"
        :key="i"
        class="effects-item"
        :class="item.severity === 'error' ? 'effects-item--error' : ''"
      >
        <span>{{ item.text }}</span>
        <span class="text-grey-7"> → {{ item.mapped ?? item.message }}</span>
      </div>
    </div>

    <!-- The port in full: every area, berth, facility and anchorage -->
    <div v-if="portDetail === 'loading'" class="row justify-center q-pa-sm">
      <q-spinner size="18px" color="secondary" />
    </div>
    <div v-else-if="portDetail === 'error'" class="text-caption text-grey-7 q-mt-sm">
      Couldn’t load the port details.
    </div>
    <div v-else-if="portDetail" class="port-ref q-mt-sm">
      <div class="port-ref__title">
        {{ portDetail.name ?? portDetail.locode }}
        <span class="text-grey-7 tnum">{{ portDetail.locode }}</span>
        <span v-if="portDetail.country" class="text-grey-7"> · {{ portDetail.country }}</span>
      </div>
      <div v-if="portDetail.facilities.length > 0" class="q-mt-xs">
        <div class="ann-fact__label">Security (ISPS) facilities</div>
        <div v-for="f in portDetail.facilities" :key="f.code" class="port-ref__codes">
          <span :class="f.retired ? 'text-strike text-grey-6' : ''">
            <span class="tnum text-no-wrap">{{ f.code }}</span>
            <template v-if="f.name"> — {{ f.name }}</template>
          </span>
          <span v-if="f.retired" class="text-grey-7"> · retired</span>
        </div>
      </div>
      <div v-else class="text-caption text-grey-7 q-mt-xs">
        No published facility list for this port.
      </div>
      <div v-for="a in portDetail.areas" :key="a.code" class="port-ref__area q-mt-xs">
        <div class="ann-fact__label">
          {{ a.name ?? a.code }} <span class="tnum">{{ a.code }}</span>
          <template v-if="a.isps"> · ISPS</template>
          <template v-if="a.gisisCode"> · facility <span class="tnum">{{ a.gisisCode }}</span></template>
        </div>
        <div v-if="a.berths.length > 0" class="port-ref__codes tnum">
          Berths:
          <template v-for="(b, bi) in a.berths" :key="b.code"><template v-if="bi > 0">, </template><span class="text-no-wrap">{{ b.code }}</span></template>
        </div>
        <div v-if="(a.anchorages?.length ?? 0) > 0" class="port-ref__codes tnum">
          Anchorages:
          <template v-for="(b, bi) in a.anchorages!" :key="b.code"><template v-if="bi > 0">, </template><span class="text-no-wrap">{{ b.code }}</span></template>
        </div>
      </div>
    </div>

  </template>
  <template #actions>
    <q-btn
      v-if="canUpload && annInfo?.corr"
      flat
      no-caps
      color="negative"
      label="Remove correction"
      :loading="correcting"
      @click="saveCorrection(null)"
    />
  </template>
</HouseDialog>
</template>

<script setup lang="ts">
/**
 * One checked value of an uploaded ship form (specs 0050, 0051, 0093): what
 * the file says, how NEMOLink read it, the port at hand, and the fix —
 * picked from the port list, the GISIS facilities or the NEMO code list,
 * or typed where typing is allowed. Shared by the port call's document view
 * and the forms wizard; saving emits the fresh checks for the caller.
 */
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type CheckAnnotation, type CodeOption, type PortInfo } from '../auth/auth';
import HouseDialog from './HouseDialog.vue';
import ValueLedger from './ValueLedger.vue';

export interface CorrectionTarget {
  path: string;
  label: string;
  /** The row the value belongs to (a waste type, a crew member). */
  subtitle?: string | undefined;
  /** NEMO's data element, when the value is a NEMO table's cell. */
  de?: string | null | undefined;
  required?: boolean | undefined;
  /** Which form and file said it. */
  source?: string | undefined;
  raw: string;
  ann: CheckAnnotation | null;
  corr: { value: string; author: string; at: string } | null;
}

const props = defineProps<{
  modelValue: boolean;
  callId: string;
  docId: string;
  info: CorrectionTarget | null;
  canUpload: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [result: Awaited<ReturnType<ReturnType<typeof useAuth>['correctCallDocument']>>];
}>();

const auth = useAuth();
const $q = useQuasar();

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});
const annInfo = computed(() => props.info);

const editValue = ref('');
const correcting = ref(false);

// One port's reference view, cached per block; a failed load says so
const portDetail = ref<PortInfo | 'loading' | 'error' | null>(null);
const portCache = new Map<string, PortInfo>();

function loadPort(locode: string): void {
  const cached = portCache.get(locode);
  if (cached) {
    portDetail.value = cached;
    return;
  }
  portDetail.value = 'loading';
  void auth
    .portInfo(locode)
    .then((port) => {
      portCache.set(locode, port);
      if (portDetail.value === 'loading') portDetail.value = port;
    })
    .catch(() => {
      if (portDetail.value === 'loading') portDetail.value = 'error';
    });
}

/**
 * "Did you mean" — the port's known facilities, named from the GISIS list
 * where it knows them (spec 0053), else by the area publishing the code.
 * Retired codes are never offered (0053 amendment) — they only show,
 * marked, in the port view below.
 */
const gisisOptions = computed<{ code: string; label: string | null }[]>(() => {
  const port = portDetail.value;
  if (!port || typeof port === 'string') return [];
  return port.facilities
    .filter((f) => !f.retired)
    .map((f) => ({
      code: f.code,
      label: f.name ?? port.areas.find((a) => a.gisisCode === f.code)?.name ?? null,
    }));
});

/**
 * The full code a written value resolves to — the checker's own
 * normalization (spec 0050): ships write `7` or `0007`, the list holds
 * `FIKTK-0007`. Lets the picked row light up even when the file's value
 * was fine as written (user rule 2026-09-02: show which one is selected).
 */
function gisisFullCode(value: string): string {
  const port = annInfo.value?.ann?.port;
  const trimmed = value.trim().toUpperCase();
  if (!port) return trimmed;
  let suffix = trimmed.startsWith(`${port}-`)
    ? trimmed.slice(port.length + 1)
    : trimmed;
  if (/^\d{1,4}$/.test(suffix)) suffix = suffix.padStart(4, '0');
  return `${port}-${suffix}`;
}

// The worldwide picker for LOCODE corrections (spec 0051 amendment)
const portSearchOptions = ref<{ label: string; value: string }[]>([]);

function filterPortSearch(
  input: string,
  update: (fn: () => void) => void,
): void {
  const q = input.trim();
  if (q.length < 2) {
    update(() => undefined);
    return;
  }
  void auth
    .searchPorts(q)
    .then((ports) => {
      update(() => {
        portSearchOptions.value = ports.map((p) => ({
          label: p.name ? `${p.locode} — ${p.name}` : p.locode,
          value: p.locode,
        }));
      });
    })
    .catch(() => update(() => undefined));
}

/** Picking a port shows everything we hold on it, before saving. */
function onPickPort(locode: string | null): void {
  if (locode) loadPort(locode);
}

/** Opening seeds the dialog from the value it was opened on. */
watch(
  () => props.modelValue,
  (isOpen) => {
    const info = props.info;
    if (!isOpen || !info) return;
    const { raw, ann, corr } = info;
    editValue.value = corr?.value ?? raw;
    portDetail.value = null;
    portSearchOptions.value = [];
    const current = editValue.value.trim().toUpperCase();
    if (ann?.kind === 'locode' && /^[A-Z]{2}[A-Z2-9]{3}$/.test(current)) {
      // Seed the picker so the current code shows in the field
      portSearchOptions.value = [{ label: current, value: editValue.value }];
    }
    if (ann?.port) loadPort(ann.port);
    if (ann?.kind === 'code') loadCodeChoices(ann);
    if (ann?.kind === 'unit') seedQuantity(corr?.value ?? ann.mapped ?? raw);
  },
);

// ---- NEMO codes and units (specs 0093, 0094) ------------------------------

/** Kinds corrected by picking only — codes are never typed (spec 0051). */
const PICKED_KINDS = ['locode', 'gisis', 'code', 'unit'];

const UNIT_OPTIONS = [
  { label: 'KGM — kilogram', value: 'KGM' },
  { label: 'LTR — litre', value: 'LTR' },
  { label: 'MTQ — cubic metre', value: 'MTQ' },
  { label: 'NAR — number of articles', value: 'NAR' },
  { label: 'TNE — metric ton', value: 'TNE' },
];

const codeSuggestions = ref<CodeOption[]>([]);
const codeOptions = ref<{ label: string; value: string }[]>([]);
/** The list's first page, shown again when the search is cleared. */
let codeFirstPage: { label: string; value: string }[] = [];
const asOption = (o: CodeOption) => ({ label: `${o.code} — ${o.label}`, value: o.code });

function loadCodeChoices(ann: CheckAnnotation): void {
  codeSuggestions.value = [];
  codeOptions.value = [];
  codeFirstPage = [];
  const list = ann.codelist;
  if (!list) return;
  const named = [...new Set([...(ann.code ? [ann.code] : []), ...(ann.suggest ?? [])])];
  void Promise.all([
    named.length > 0 ? auth.codeOptions(list, '', named) : Promise.resolve([]),
    auth.codeOptions(list, ''),
  ])
    .then(([known, page]) => {
      const byCode = new Map(known.map((o) => [o.code, o]));
      codeSuggestions.value = (ann.suggest ?? [])
        .map((c) => byCode.get(c))
        .filter((o): o is CodeOption => !!o);
      const seen = new Set(page.map((o) => o.code));
      codeFirstPage = [...known.filter((o) => !seen.has(o.code)), ...page].map(asOption);
      codeOptions.value = codeFirstPage;
    })
    .catch(() => undefined);
}

function filterCodes(input: string, update: (fn: () => void) => void): void {
  const list = annInfo.value?.ann?.codelist;
  const q = input.trim();
  if (!list || q === '') {
    update(() => {
      codeOptions.value = codeFirstPage;
    });
    return;
  }
  void auth
    .codeOptions(list, q)
    .then((found) => update(() => (codeOptions.value = found.map(asOption))))
    .catch(() => update(() => undefined));
}

// A quantity is edited as a number and a unit, saved as "85 MTQ"
const qtyAmount = ref('');
const qtyUnit = ref<string | null>(null);

function seedQuantity(text: string): void {
  const m = /^\s*(\d[\d\s]*(?:[.,]\d+)?)\s*([A-Z]{3})?/.exec(text);
  qtyAmount.value = m?.[1] ? m[1].replace(/\s/g, '').replace(',', '.') : '';
  qtyUnit.value = m?.[2] && UNIT_OPTIONS.some((u) => u.value === m[2]) ? m[2] : null;
}

watch([qtyAmount, qtyUnit], ([amount, unit]) => {
  if (annInfo.value?.ann?.kind !== 'unit') return;
  const n = amount.trim().replace(',', '.');
  if (n !== '' && unit) editValue.value = `${n} ${unit}`;
});

/** To NEMO: what saving sends, or what goes now (the checker's reading). */
const toNemo = computed(() => {
  const info = annInfo.value;
  if (!info) return '';
  const v = editValue.value.trim();
  const now = (info.corr?.value ?? info.raw).trim();
  if (v !== now) {
    if (info.ann?.kind === 'code') return codeOptions.value.find((o) => o.value === v)?.label ?? v;
    return v;
  }
  if (info.ann?.severity === 'error') return '';
  return info.ann?.mapped ?? now;
});
const toNemoNote = computed(() => {
  const info = annInfo.value;
  if (!info) return '';
  if (editValue.value.trim() !== (info.corr?.value ?? info.raw).trim()) return 'after Save';
  if (info.ann?.severity === 'error') return 'NEMO would refuse the file’s value — correct it in NEMOLink';
  return '';
});

/** Save (or with null: remove) the correction, refresh checks + the row. */
async function saveCorrection(value: string | null): Promise<void> {
  const info = annInfo.value;
  if (!info) return;
  correcting.value = true;
  try {
    const result = await auth.correctCallDocument(
      props.callId,
      props.docId,
      info.path,
      value === null ? null : value.trim(),
    );
    emit('saved', result);
    open.value = false;
    $q.notify({
      type: 'positive',
      message: value === null ? 'Correction removed.' : 'Corrected — checks updated.',
    });
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not save the correction.',
    });
  } finally {
    correcting.value = false;
  }
}
</script>

<style scoped>
.doc-note {
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
}

.doc-note--error {
  background: var(--nl-red-bg);
  color: var(--nl-red-text);
}

.port-ref {
  background: var(--nl-gray-bg);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  max-height: 320px;
  overflow-y: auto;
}

.port-ref__title {
  font-weight: 600;
  font-size: 14px;
}

.port-ref__codes {
  color: var(--nl-ink-2);
  overflow-wrap: anywhere;
}

.port-ref__area + .port-ref__area {
  border-top: 1px dashed var(--nl-line);
  padding-top: 4px;
}

.effects-item {
  padding: 2px 0;
  font-size: 14px;
}

.effects-item--error {
  color: var(--q-negative);
}

.pick-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}

.pick-row .q-icon {
  flex: 0 0 auto;
  margin-top: 2px;
}

.pick-row__label {
  min-width: 0;
}

.pick-row:hover {
  background: var(--nl-gray-bg);
}

.pick-row--on {
  background: var(--nl-teal-bg);
  color: var(--nl-teal-dark);
}

.ann-fact {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.ann-fact__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--nl-ink-3);
}

/* A note under the fields: as a single field's hint — 11px down, 12/16
   Text/100 (Figma 401:8083, user 2026-11-02) */
.ann-meta {
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.02em;
  color: var(--nl-ink-3);
  margin-top: 11px;
}
.qty-stack {
  display: flex;
  gap: 8px;
}
.qty-stack > * {
  flex: 1 1 0;
  min-width: 0;
}
/* Quantity and Unit (user 2026-11-02): 44px fields, their names Medium 12px
   Text/200 at full size (not Quasar's shrunk label) over the 14px value */
.qty-stack :deep(.q-field__control),
.qty-stack :deep(.q-field__marginal) {
  height: 44px;
  min-height: 44px;
}
.qty-stack :deep(.q-field__label) {
  font-size: 12px;
  font-weight: 500;
  color: var(--nl-g-body);
}
.qty-stack :deep(.q-field--float .q-field__label) {
  transform: translateY(-4px);
}
.qty-stack :deep(.q-field__native) {
  font-size: 14px;
}
/* The value's line ends 2px above the field's edge (user 2026-11-02) */
.qty-stack :deep(.q-field--labeled input.q-field__native) {
  padding-top: 25px;
  padding-bottom: 2px;
  line-height: 17px;
}
.qty-stack :deep(.q-select.q-field--labeled .q-field__control-container) {
  padding-top: 25px;
}
.qty-stack :deep(.q-select.q-field--labeled .q-field__native) {
  min-height: 17px;
  padding-bottom: 2px;
  line-height: 17px;
}

.ann-fact__value {
  font-size: 14px;
  overflow-wrap: anywhere;
}
</style>
