<template>
  <!-- Actual times use the port-call form's day and time fields, with
       this step's own send as the main button. -->
  <HouseDialog
    :model-value="modelValue"
    class="sched-dialog ata-sheet"
    :title="receipt && allAccepted ? `${w.code} sent` : w.title"
    :subtitle="subtitle"
    title-style="detail"
    :help-topic="w.help"
    help-beside-title
    snug
    no-close
    :max-width-px="960"
    :main-label="mainLabel"
    :sheet-main-label="receipt ? undefined : 'Send'"
    :main-icon="receipt ? undefined : 'send'"
    :main-disable="mainDisable"
    :main-loading="sending"
    @main="onMain"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- The day and the time (spec 0092): it opens on what the logbook or
         AIS said, else now rounded to five minutes; nothing later than now.
         The step confirms the arrival or departure to Customs in the notice
         (NOA / NOD) first when that is still missing (D1) -->
    <div v-if="!receipt" class="ata-body">
      <section class="ata-fields">
        <h2 class="ata-fields__title">{{ w.title }}</h2>
        <ScheduleFields
          v-if="modelValue"
          :id="`actual-${w.api}`"
          v-model="actualValue"
          :name="w.api"
          :today="todayIso"
          min-date=""
          :not-after="nowLocal"
        />
      </section>
      <div class="ata-notes">
        <div v-if="preview?.confirmsNotice" class="ata-note">
          <q-icon name="verified" size="18px" />
          <span>{{ w.confirmWords }} It cannot be withdrawn.</span>
        </div>
        <div v-if="loadError" class="wz-warn">{{ loadError }}</div>
        <!-- "Send the X first": the missing step is a link straight to its own
             dialog (user 2026-10-23) -->
        <div v-else-if="preview && !preview.willSend" class="wz-warn">
          <template v-if="firstStep">
            <button type="button" class="ata-goto" @click="emit('open', firstStep.code)">{{ firstStep.words }}</button>{{ firstStep.rest }}
          </template>
          <template v-else>{{ preview.reason }}</template>
        </div>
        <div v-if="reviewOnly" class="wz-warn">{{ PLATFORM_ADMIN_SEND_WORDS }}</div>
      </div>
    </div>

    <template v-else-if="allAccepted">
      <div class="ata-done">
        <div class="ata-done__check"><q-icon name="check" size="40px" /></div>
        <div class="ata-done__title">{{ w.code }} {{ clock }} sent</div>
        <div class="ata-done__sub tnum">NEMO accepted it · {{ receipt.visitId }}</div>
      </div>
      <q-expansion-item
        dense dense-toggle
        expand-icon-class="text-grey-6"
        label="Details — NEMO's answer and the read-back"
        class="q-mt-sm"
      >
        <NemoResultView :exchanges="receipt.results.map((r) => r.exchange)" :expanded="false" />
      </q-expansion-item>
    </template>
    <NemoResultView v-else :exchanges="receipt.results.map((r) => r.exchange)" :expanded="false" />
  </HouseDialog>
</template>

<script setup lang="ts">
/**
 * The ATA or ATD step (spec 0092): the time the ship arrived or left —
 * now, rounded to five minutes, adjustable — and one button that sends it.
 * When the notice (NOA / NOD) does not carry the customs confirmation yet,
 * the server sends that first (D1).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type ActualPreview, type PortCall, type ShipNemoReceipt } from '../auth/auth';
import { PLATFORM_ADMIN_SEND_WORDS } from '../lib/obligations';
import HouseDialog from './HouseDialog.vue';
import NemoResultView from './NemoResultView.vue';
import ScheduleFields from './ScheduleFields.vue';

const props = defineProps<{ modelValue: boolean; call: PortCall; kind: 'arrival' | 'departure' }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'sent'): void;
  /** Open the step that must go first (its report code, e.g. 'ATA'). */
  (e: 'open', code: string): void;
}>();

const $q = useQuasar();
const auth = useAuth();

/** The words and the route, per side of the call. */
const WORDS = {
  arrival: {
    code: 'ATA', api: 'ata', happened: 'has arrived', title: 'Actual arrival (ATA)', help: 'call.ata', timeLabel: 'Time of arrival', fieldLabel: 'Arrived at',
    planned: 'ETA', confirmWords: 'Also confirms the arrival to Customs in the NOA (ST-FI-01), first.',
  },
  departure: {
    code: 'ATD', api: 'atd', happened: 'has left', title: 'Actual departure (ATD)', help: 'call.atd', timeLabel: 'Time of departure', fieldLabel: 'Departed at',
    planned: 'ETD', confirmWords: 'Also confirms the departure to Customs in the NOD (ST-FI-02), first.',
  },
} as const;
const w = computed(() => WORDS[props.kind]);

const FIVE = 5 * 60_000;
/** The actual time, in ms, on the minute. */
const at = ref(roundedNow());
/** Where the time came from: a source (its index), now rounded, or set by hand (null). */
const picked = ref<number | 'now' | null>('now');
const preview = ref<ActualPreview | null>(null);
const loadError = ref<string | null>(null);
const sending = ref(false);
const receipt = ref<ShipNemoReceipt | null>(null);

function roundedNow(): number {
  return Math.round(Date.now() / FIVE) * FIVE;
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    at.value = roundedNow();
    picked.value = 'now';
    receipt.value = null;
    preview.value = null;
    void reload();
  },
  { immediate: true },
);

/** The preview follows the time: what stops the send can depend on it. */
let timer: ReturnType<typeof setTimeout> | null = null;
watch(at, () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void reload(), 250);
});

async function reload(): Promise<void> {
  loadError.value = null;
  try {
    const first = preview.value === null;
    preview.value = await auth.actualPreview(props.call.id, w.value.api, new Date(at.value).toISOString());
    // The sheet opens on what a source said, the logbook first (spec 0095)
    if (first && picked.value === 'now' && preview.value.sources.length > 0) pickSource(0);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : `Could not prepare the ${w.value.code}`;
  }
}

const p2 = (n: number) => String(n).padStart(2, '0');
function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
const clock = computed(() => clockOf(at.value));

const sources = computed(() => preview.value?.sources ?? []);
function pickSource(i: number): void {
  const src = sources.value[i];
  if (!src) return;
  at.value = Math.floor(Date.parse(src.value) / 60_000) * 60_000;
  picked.value = i;
}



/** As the pen's picker: "Local time in Kotka". */
const subtitle = computed(() => {
  const port = props.call.portName ?? props.call.portLocode;
  return port ? `Local time in ${port}` : 'Local time at the port';
});

// ---- the picker's day and slot ---------------------------------------------
const isoDay = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
const actualValue = computed({
  get: () => `${isoDay(at.value)}T${clock.value}`,
  set: (value: string) => setAt(Date.parse(value)),
});
/** Ticks each minute so "now" — the latest pickable — keeps up. */
const nowMs = ref(Date.now());
const ticker = setInterval(() => (nowMs.value = Date.now()), 60_000);
onBeforeUnmount(() => clearInterval(ticker));
const todayIso = computed(() => isoDay(nowMs.value));
const nowLocal = computed(() => `${isoDay(nowMs.value)}T${clockOf(nowMs.value)}`);
/** A picked time never lies after now: an arrival has happened. */
function setAt(ms: number): void {
  if (!Number.isFinite(ms)) return;
  at.value = Math.min(ms, Math.floor(Date.now() / FIVE) * FIVE);
  picked.value = null;
}
/** A blocking reason of the form "Send the X first — …", split for its link. */
const firstStep = computed(() => {
  const m = /^(Send the ([A-Z]{3}) first)(.*)$/.exec(preview.value?.reason ?? '');
  return m ? { words: m[1]!, code: m[2]!, rest: m[3]! } : null;
});

/** Platform admins acting in an org review, never send (invariant 4, spec 0076). */
const reviewOnly = computed(() => auth.user.value?.platformAdmin === true);
const allAccepted = computed(() => !!receipt.value && receipt.value.results.every((r) => r.accepted));
const mainLabel = computed(() => (receipt.value ? 'Done' : `Confirm ${w.value.code} ${clock.value} and send`));
const mainDisable = computed(() => {
  if (receipt.value) return false;
  return reviewOnly.value || !preview.value?.willSend;
});

async function onMain(): Promise<void> {
  if (receipt.value) {
    emit('update:modelValue', false);
    return;
  }
  sending.value = true;
  try {
    receipt.value = await auth.sendActual(props.call.id, w.value.api, new Date(at.value).toISOString());
    emit('sent');
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : `Could not send the ${w.value.code}` });
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
/* Keep room beside the fields for the compact pickers. */
.ata-body {
  min-height: 479px;
  display: flex;
  flex-direction: column;
}
.ata-fields {
  width: 100%;
  max-width: 512px;
}
.ata-fields__title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 14px;
  color: var(--nl-g-secondary);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.48px;
  text-transform: uppercase;
}
.ata-fields__title::before {
  content: '';
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--nl-g-blue);
}
.ata-notes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding: 0 20px;
}
.ata-goto {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-weight: 600;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.ata-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--nl-blue-bg);
  color: var(--nl-blue-text);
  font-size: 14px;
}
.wz-warn {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  font-size: 14px;
}
.ata-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 16px 8px 20px;
}
.ata-done__check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  margin-bottom: 12px;
  border-radius: 50%;
  background: var(--nl-green);
  color: var(--nl-on-fill);
}
.ata-done__title {
  font-size: 20px;
  font-weight: 600;
}
.ata-done__sub {
  font-size: 14px;
  color: var(--nl-ink-2);
  margin-top: 4px;
}
</style>

<style>
/* The send button as before (user 2026-11-06): its 24px send icon 12px from
   the label, not the picker's 18px arrows. Teleported, hence unscoped. */
.ata-sheet .house-dialog__footer .house-dialog__primary .q-icon {
  font-size: 24px;
}
.ata-sheet .house-dialog__footer .house-dialog__primary .on-left {
  margin-right: 12px;
}
</style>
