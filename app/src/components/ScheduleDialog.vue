<template>
  <!-- Set schedule (Figma 440:6767, 440:6983): arrival, departure, then both
       to confirm, the steps in the band under the title. One time alone
       (the pen in a schedule field, mode eta / etd) is the same picker
       without the steps, its main button saying what it changes.
       It takes the New port call card's place at once, no animation, over
       the same see-through backdrop (user 2026-11-03). -->
  <HouseDialog
    :model-value="modelValue"
    class="sched-dialog"
    :title="title"
    :sheet-title="sheetTitle"
    :step-label="stepLabel"
    :subtitle="subtitle"
    title-style="detail"
    snug
    no-close
    no-shortcut-hint
    :max-width-px="960"
    :transition-duration="0"
    :main-label="mainLabel"
    :main-icon-right="mode === 'all' && step !== 'confirm' ? 'arrow_forward' : undefined"
    :main-disable="mainDisable"
    @main="onMain"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-if="mode === 'all'" #band>
      <ol class="sd-steps" aria-label="Steps">
        <li
          v-for="(s, i) in STEPS"
          :key="s.key"
          class="sd-step"
          :class="`sd-step--${stepState(s.key)}`"
          :aria-current="s.key === step ? 'step' : undefined"
        >
          <q-icon v-if="i > 0" name="chevron_right" size="16px" class="sd-step__sep" />
          <span class="sd-step__pill">
            <span class="sd-step__dot">
              <q-icon v-if="stepState(s.key) === 'done'" name="check" size="16px" aria-label="Done" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span>{{ s.label }}</span>
          </span>
        </li>
      </ol>
    </template>

    <template v-if="mode === 'all'" #secondary>
      <!-- No Back on the first step: Close at the top right is the way out -->
      <q-btn v-if="step !== 'eta'" outline no-caps color="primary" icon="arrow_back" label="Back" class="sd-back" @click="onBack" />
      <span v-else aria-hidden="true" />
    </template>

    <div class="sd-body">
      <SchedulePicker
        v-if="step === 'eta'"
        key="eta"
        :date="draft.etaDate"
        :time="draft.etaTime"
        :today="today"
        :min-date="etaMinDate"
        @update:date="draft.etaDate = $event"
        @update:time="draft.etaTime = $event"
      />
      <SchedulePicker
        v-else-if="step === 'etd'"
        key="etd"
        :date="draft.etdDate"
        :time="draft.etdTime"
        :today="today"
        :min-date="etdMinDate"
        :after="etaValue || undefined"
        :start-date="draft.etaDate || undefined"
        :start-time="draft.etaTime || undefined"
        @update:date="onEtdDate"
        @update:time="draft.etdTime = $event"
      />
      <!-- 3 · both times, each with its Change back to its step -->
      <div v-else class="sd-overview">
        <div class="sd-row">
          <div class="sd-row__value">
            <div class="sd-row__title">Arrival (ETA)</div>
            <div class="sd-row__time">{{ fmtSchedule(etaValue) }}</div>
          </div>
          <button type="button" class="nl-close-link" aria-label="Change the arrival" @click="step = 'eta'">Change</button>
        </div>
        <div class="sd-row">
          <div class="sd-row__value">
            <div class="sd-row__title">Departure (ETD)</div>
            <div class="sd-row__time">{{ fmtSchedule(etdValue) }}</div>
          </div>
          <button type="button" class="nl-close-link" aria-label="Change the departure" @click="step = 'etd'">Change</button>
        </div>
      </div>
    </div>
  </HouseDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import HouseDialog from './HouseDialog.vue';
import SchedulePicker from './SchedulePicker.vue';
import { fmtSchedule } from '../lib/time';

type Step = 'eta' | 'etd' | 'confirm';

const props = defineProps<{
  modelValue: boolean;
  /** all: the three steps; eta / etd: that time alone. */
  mode: 'all' | 'eta' | 'etd';
  /** 'YYYY-MM-DDTHH:mm' or '' — the card's values as the dialog opens. */
  eta: string;
  etd: string;
  /** The port's name, for "Local time in …"; '' when none is picked yet. */
  portName: string;
  /** Today, 'YYYY-MM-DD' — the earliest arrival day. */
  today: string;
  /** The actual times instead (ATA / ATD, the opened port call's pens):
      eta / etd carry the ATA / ATD, and they may lie in the past. */
  actual?: boolean;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'save', value: { eta: string; etd: string }): void;
}>();

const STEPS: { key: Step; label: string }[] = [
  { key: 'eta', label: 'Arrival (ETA)' },
  { key: 'etd', label: 'Departure (ETD)' },
  { key: 'confirm', label: 'Confirm schedule' },
];

const step = ref<Step>('eta');
const draft = reactive({ etaDate: '', etaTime: '', etdDate: '', etdTime: '' });

// Every opening starts from the card's values
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    Object.assign(draft, {
      etaDate: props.eta.slice(0, 10),
      etaTime: props.eta.slice(11, 16),
      etdDate: props.etd.slice(0, 10),
      etdTime: props.etd.slice(11, 16),
    });
    step.value = props.mode === 'etd' ? 'etd' : 'eta';
  },
  { immediate: true },
);

const etaValue = computed(() => (draft.etaDate && draft.etaTime ? `${draft.etaDate}T${draft.etaTime}` : ''));
const etdValue = computed(() => (draft.etdDate && draft.etdTime ? `${draft.etdDate}T${draft.etdTime}` : ''));

/** Today, or an earlier arrival the call already had (a past call stays editable). */
const etaMinDate = computed(() => {
  if (props.actual) return '';
  const had = props.eta.slice(0, 10);
  return had && had < props.today ? had : props.today;
});
/** Not before the arrival's day. */
const etdMinDate = computed(() => draft.etaDate || etaMinDate.value);

/** A new day for the departure: a time at or before the arrival goes. */
function onEtdDate(date: string): void {
  draft.etdDate = date;
  if (etaValue.value && `${date}T${draft.etdTime}` <= etaValue.value) draft.etdTime = '';
}

function stepState(key: Step): 'done' | 'current' | 'next' {
  if (key === step.value) return 'current';
  const at = STEPS.findIndex((s) => s.key === step.value);
  return STEPS.findIndex((s) => s.key === key) < at ? 'done' : 'next';
}

const title = computed(() => {
  if (props.actual) return props.mode === 'etd' ? 'Actual departure (ATD)' : 'Actual arrival (ATA)';
  return props.mode === 'eta' ? 'Arrival (ETA)' : props.mode === 'etd' ? 'Departure (ETD)' : 'Set schedule';
});
const subtitle = computed(() =>
  props.portName ? `Local time in ${props.portName}` : 'Local time at the port',
);

/** The phone has no band: the step names the title, its number the action bar.
    One time on its own (mode eta / etd) has no steps to count. */
const stepIndex = computed(() => STEPS.findIndex((s) => s.key === step.value));
const sheetTitle = computed(() =>
  props.mode === 'all' ? STEPS[stepIndex.value]?.label : undefined,
);
const stepLabel = computed(() =>
  props.mode === 'all' && stepIndex.value >= 0
    ? `${stepIndex.value + 1} of ${STEPS.length}`
    : undefined,
);

const etdValid = computed(() => !!etdValue.value && (!etaValue.value || etdValue.value > etaValue.value));

const mainLabel = computed(() => {
  if (props.mode === 'eta') return props.actual ? 'Change actual arrival' : 'Change arrival';
  if (props.mode === 'etd') return props.actual ? 'Change actual departure' : 'Change departure';
  return step.value === 'confirm' ? 'Confirm schedule' : 'Next';
});
const mainDisable = computed(() => {
  if (step.value === 'eta') return !etaValue.value;
  if (step.value === 'etd') return !etdValid.value;
  return !etaValue.value || !etdValid.value;
});

function onMain(): void {
  if (mainDisable.value) return;
  if (props.mode === 'all' && step.value !== 'confirm') {
    step.value = step.value === 'eta' ? 'etd' : 'confirm';
    return;
  }
  // A changed arrival alone leaves the departure as it was: the card says
  // so if it now comes first
  emit('save', {
    eta: props.mode === 'etd' ? props.eta : etaValue.value,
    etd: props.mode === 'eta' ? props.etd : etdValue.value,
  });
  emit('update:modelValue', false);
}

/** Back: the step before; the first step has none. */
function onBack(): void {
  step.value = step.value === 'confirm' ? 'etd' : 'eta';
}
</script>

<style scoped>
/* The steps (Figma 440:6773): pills joined by chevrons; the current one on
   Blue/300, a done one's dot ticked */
.sd-steps {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
}
.sd-step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sd-step__sep {
  color: var(--nl-g-body);
}
.sd-step__pill {
  height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 12px 3px 4px;
  border: 1px solid var(--nl-g-white);
  border-radius: 999px;
  background: var(--nl-g-white);
  color: var(--nl-g-secondary);
  font-size: 14px;
  line-height: normal;
  font-weight: 500;
  letter-spacing: 0.14px;
  white-space: nowrap;
}
.sd-step__dot {
  width: 22px;
  height: 22px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: var(--blue-300);
  color: var(--nl-g-secondary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12px;
}
.sd-step--current .sd-step__pill {
  background: var(--blue-300);
  border-color: var(--blue-150);
  color: var(--nl-g-ink);
  font-weight: 600;
}
.sd-step--current .sd-step__dot,
.sd-step--done .sd-step__dot {
  background: var(--nl-g-blue);
  color: var(--nl-on-fill);
}
.sd-step--done .sd-step__pill {
  color: var(--nl-g-body);
}

/* The body keeps one height from step to step (Figma: 527 with padding);
   the pickers sit at its top */
.sd-body {
  min-height: 479px;
  display: flex;
  flex-direction: column;
}
/* 3 · the overview: 495px of rows on the lightest stroke, in the middle */
.sd-overview {
  width: 100%;
  max-width: 495px;
  margin: auto 0;
}
.sd-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--nl-g-line-row);
}
.sd-row__value {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sd-row__title {
  color: var(--nl-g-ink);
  font-size: 20px;
  line-height: normal;
  font-weight: 600;
  letter-spacing: 0.2px;
}
.sd-row__time {
  color: var(--nl-g-body);
  font-size: 16px;
  line-height: normal;
  font-weight: 500;
  letter-spacing: 0.16px;
}
.sd-back {
  background: var(--nl-g-white) !important;
}
</style>

<style>
/* The New port call card's size too (--nl-large-card-*), whatever the step
   or mode; the phone sheet keeps its own height */
.sched-dialog .house-dialog:not(.house-dialog--sheet) {
  height: var(--nl-large-card-height);
}
/* Footer buttons (Figma Button/Large with arrow 436:6719): 18px arrows, 8px
   from the label. The dialog is teleported, hence unscoped. */
.sched-dialog .house-dialog__footer .q-btn .q-icon {
  font-size: 18px;
}
.sched-dialog .house-dialog__footer .q-btn .on-left {
  margin-right: 8px;
}
.sched-dialog .house-dialog__footer .q-btn .on-right {
  margin-left: 8px;
}
.sched-dialog .house-dialog__footer .sd-back {
  padding: 0 16px 0 12px;
}
.sched-dialog .house-dialog__footer .house-dialog__primary:has(.on-right) {
  padding: 0 12px 0 16px;
}
/* Spacing as in Figma 440:6767: 18px under the titles, the steps band
   14 / 20, the body 24 all round, the footer 16 / 24 with its buttons centred */
.sched-dialog .house-dialog.house-dialog--snug .house-dialog__header--banded {
  padding-bottom: 18px;
}
.sched-dialog .house-dialog .house-dialog__band {
  padding: 14px 24px 20px;
}
.sched-dialog .house-dialog .house-dialog__band + .house-dialog__body {
  padding-top: 24px;
}
.sched-dialog .house-dialog.house-dialog--snug .house-dialog__footer {
  padding: 16px 24px;
  align-items: center;
}
@media (max-width: 599.98px) {
  .sched-dialog .house-dialog .house-dialog__band {
    padding: 14px 16px 16px;
  }
}
/* Phones: 16px is for SemiBold headings only (user 2026-11-06) */
@media (max-width: 599.98px) {
  .sd-row__time {
    font-size: 14px;
    letter-spacing: 0.14px;
  }
}
</style>
