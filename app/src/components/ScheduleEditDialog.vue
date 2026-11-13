<template>
  <!-- The ETA and ETD straight from the list (user 2026-11-13): a click on
       either time opens this pop-up — the ATA / ATD pop-up's look, the port
       call form's day and time fields — without opening the port call.
       After a change the new times can go to NEMO as an update. -->
  <HouseDialog
    :model-value="modelValue"
    class="sched-dialog ata-sheet eta-sheet"
    :title="receipt ? (allAccepted ? 'New times sent' : 'Estimated times') : 'Estimated times (ETA / ETD)'"
    :subtitle="subtitle"
    title-style="detail"
    snug
    no-close
    :max-width-px="960"
    :main-label="mainLabel"
    :sheet-main-label="receipt ? undefined : sends ? 'Send' : 'Save'"
    :main-icon="receipt ? undefined : sends ? 'send' : undefined"
    :main-disable="mainDisable"
    :main-loading="busy && !savingOnly"
    @main="onMain"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- Save only, beside the send: the times change here, NEMO later -->
    <template #secondary>
      <q-btn
        v-if="!receipt && canUpdateNemo && changed"
        outline no-caps color="primary" label="Save only"
        :loading="savingOnly"
        :disable="invalid || busy"
        @click="saveOnly"
      />
      <span v-else aria-hidden="true" />
    </template>

    <div v-if="!receipt" class="ata-body">
      <section class="ata-fields">
        <h2 class="ata-fields__title">Estimated arrival (ETA)</h2>
        <!-- After the arrival the ETA is history: it shows, it does not change -->
        <p v-if="arrived" class="eta-fixed tnum">
          Arrived {{ fmtSchedule(localArrival) }} — the ETA no longer changes.
        </p>
        <ScheduleFields
          v-else-if="modelValue"
          id="sched-eta"
          v-model="draft.eta"
          name="eta"
          :today="today"
          :min-date="original.eta && original.eta.slice(0, 10) < today ? original.eta.slice(0, 10) : today"
          :error="shownCheck.eta"
          @incomplete="incomplete.eta = $event"
        />
      </section>
      <section class="ata-fields">
        <h2 class="ata-fields__title">Estimated departure (ETD)</h2>
        <ScheduleFields
          v-if="modelValue"
          id="sched-etd"
          v-model="draft.etd"
          name="etd"
          :today="today"
          :min-date="draft.eta ? draft.eta.slice(0, 10) : today"
          :after="draft.eta || undefined"
          :error="shownCheck.etd"
          @incomplete="incomplete.etd = $event"
        />
      </section>

      <div class="ata-notes">
        <!-- Where the new times go in NEMO, in words -->
        <div class="ata-note">
          <q-icon name="info" size="18px" />
          <span>{{ nemoWords }}</span>
        </div>
        <div v-if="blockWords" class="wz-warn" role="status">{{ blockWords }}</div>
        <div v-if="sendError" class="wz-warn" role="alert">
          The times are saved, but NEMO did not get them: {{ sendError }}
        </div>
        <div v-if="sends && reviewOnly" class="wz-warn">{{ PLATFORM_ADMIN_SEND_WORDS }}</div>
      </div>
    </div>

    <NemoResultView v-else :exchanges="receipt.results.map((r) => r.exchange)" :expanded="false" />
  </HouseDialog>
</template>

<script setup lang="ts">
/**
 * The estimated times, edited on their own (user 2026-11-13): opened from
 * the ETA or ETD on the port call list. The times are checked as they are
 * picked (lib/schedule-rules — the ETD never before the ETA, nothing
 * missing, no mistyped year) and saved to the call; when NEMO already has a
 * notice that carries them (the NOA until the arrival, the NOD until the
 * departure) the main button also sends that notice again as an update.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type PortCall, type ShipNemoReceipt } from '../auth/auth';
import { PLATFORM_ADMIN_SEND_WORDS } from '../lib/obligations';
import { fmtSchedule } from '../lib/time';
import { checkSchedule, localInput } from '../lib/schedule-rules';
import HouseDialog from './HouseDialog.vue';
import NemoResultView from './NemoResultView.vue';
import ScheduleFields from './ScheduleFields.vue';

const props = defineProps<{
  modelValue: boolean;
  call: PortCall;
  /** The time that was clicked: its day field takes the focus. */
  focus?: 'eta' | 'etd' | undefined;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  /** The times were saved (and maybe sent) — the list reloads. */
  (e: 'changed'): void;
}>();

const $q = useQuasar();
const auth = useAuth();

const toLocal = (iso: string | null): string => (iso ? localInput(Date.parse(iso)) : '');
const toIso = (local: string): string | null => {
  if (!local) return null;
  const t = Date.parse(local);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const original = reactive({ eta: '', etd: '' });
const draft = reactive({ eta: '', etd: '' });
const incomplete = reactive({ eta: false, etd: false });
const saving = ref(false);
const savingOnly = ref(false);
const sending = ref(false);
const receipt = ref<ShipNemoReceipt | null>(null);
const sendError = ref<string | null>(null);

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    original.eta = toLocal(props.call.eta);
    original.etd = toLocal(props.call.etd);
    Object.assign(draft, original);
    receipt.value = null;
    sendError.value = null;
    // The clicked time's day field first, as the pen's picker did
    await nextTick();
    setTimeout(() => document.getElementById(`sched-${props.focus ?? 'eta'}-date`)?.focus(), 50);
  },
  { immediate: true },
);

const today = computed(() => localInput(Date.now()).slice(0, 10));
const arrived = computed(() => !!props.call.ata);
const localArrival = computed(() => toLocal(props.call.ata));

/** The ship and the port's clock, as the ATA / ATD pop-up says it. */
const subtitle = computed(() => {
  const port = props.call.portName ?? props.call.portLocode;
  return `${props.call.shipName ?? 'Ship'} · ${port ? `Local time in ${port}` : 'Local time at the port'}`;
});

// ---- the checks, while the times are picked ------------------------------------

const check = computed(() =>
  checkSchedule({ eta: draft.eta, etd: draft.etd }, { required: arrived.value ? ['etd'] : ['eta', 'etd'], originalEta: original.eta }),
);
/** At the field: what is wrong now. An arrived call's ETA is not judged. */
const shownCheck = computed(() => ({ eta: arrived.value ? null : check.value.eta, etd: check.value.etd }));
const invalid = computed(() => !!shownCheck.value.eta || !!shownCheck.value.etd || incomplete.eta || incomplete.etd);
const changed = computed(() => draft.eta !== original.eta || draft.etd !== original.etd);

/** Why the main button is off, in words (user 2026-11-13). */
const blockWords = computed(() => {
  // Only what is empty: a half-filled or mistyped time says so at its own field
  const gaps = [!arrived.value && !draft.eta ? 'the ETA' : null, !draft.etd ? 'the ETD' : null].filter(Boolean);
  if (gaps.length > 0) return `Still needed: ${gaps.join(' and ')} — NEMO requires both.`;
  return null;
});

// ---- NEMO --------------------------------------------------------------------

const state = (code: string) => props.call.obligations.find((o) => o.code === code)?.state ?? null;
/** The notices NEMO has that carry the times, and may still change. */
const noaUpdates = computed(() => state('NOA') === 'sent' && state('ATA') !== 'sent');
const nodUpdates = computed(() => state('NOD') === 'sent' && state('ATD') !== 'sent');
const canUpdateNemo = computed(() => !!props.call.visitId && (noaUpdates.value || nodUpdates.value));
/** Platform admins acting in an org review, never send (invariant 4, spec 0076). */
const reviewOnly = computed(() => auth.user.value?.platformAdmin === true);
/** The main button sends: a notice to update, and someone who may send. */
const sends = computed(() => canUpdateNemo.value && !reviewOnly.value);

const nemoWords = computed(() => {
  if (!props.call.visitId) return 'The port call is not in NEMO yet — the times go with the VID.';
  if (noaUpdates.value && nodUpdates.value) return 'NEMO gets the new times as updates of the NOA and the NOD.';
  if (noaUpdates.value) return 'NEMO gets the new times as an update of the NOA.';
  if (nodUpdates.value) return 'NEMO gets the new ETD as an update of the NOD.';
  if (state('ATA') === 'sent') return 'The arrival is reported — NEMO gets the new ETD with the NOD.';
  return 'NEMO gets the new times with the NOA.';
});

const allAccepted = computed(() => !!receipt.value && receipt.value.results.every((r) => r.accepted));
const busy = computed(() => saving.value || sending.value);

const mainLabel = computed(() => {
  if (receipt.value) return 'Done';
  if (sends.value) return changed.value ? 'Save and send to NEMO' : 'Send to NEMO';
  return 'Save';
});
const mainDisable = computed(() => {
  if (receipt.value) return false;
  if (invalid.value || busy.value) return true;
  // Unchanged: nothing to save — only an update NEMO has not had yet to send
  return !changed.value && !sends.value;
});

/** The changed times to the call; false when the server refused them. */
async function save(): Promise<boolean> {
  if (!changed.value) return true;
  saving.value = true;
  try {
    await auth.updatePortCall(props.call.id, {
      ...(!arrived.value && draft.eta !== original.eta ? { eta: toIso(draft.eta) } : {}),
      ...(draft.etd !== original.etd ? { etd: toIso(draft.etd) } : {}),
    });
    Object.assign(original, draft);
    emit('changed');
    return true;
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not save the times' });
    return false;
  } finally {
    saving.value = false;
  }
}

async function saveOnly(): Promise<void> {
  savingOnly.value = true;
  try {
    if (await save()) {
      $q.notify({ type: 'positive', message: 'Times saved. NEMO still has the earlier ones.' });
      emit('update:modelValue', false);
    }
  } finally {
    savingOnly.value = false;
  }
}

async function onMain(): Promise<void> {
  if (receipt.value) {
    emit('update:modelValue', false);
    return;
  }
  if (invalid.value) return;
  if (!(await save())) return;
  if (!sends.value) {
    $q.notify({ type: 'positive', message: 'Times saved.' });
    emit('update:modelValue', false);
    return;
  }
  sending.value = true;
  sendError.value = null;
  try {
    receipt.value = await auth.sendScheduleUpdate(props.call.id);
    emit('changed');
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : 'NEMO could not be reached';
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
/* As the ATA / ATD pop-up (ActualSheet): the fields on the left, room
   beside them for the compact pickers, the notes at the bottom */
.ata-body {
  min-height: 479px;
  display: flex;
  flex-direction: column;
  gap: 28px;
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
.eta-fixed {
  margin: 0;
  color: var(--text-200);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.14px;
}
.ata-notes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
}
.ata-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--nl-blue-bg);
  color: var(--nl-blue-text);
  font-size: 14px;
}
.wz-warn {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  font-size: 14px;
}
</style>

<style>
/* The send button as the ATA / ATD pop-up's: its 24px send icon 12px from
   the label. Teleported, hence unscoped. */
.eta-sheet .house-dialog__footer .house-dialog__primary .q-icon {
  font-size: 24px;
}
.eta-sheet .house-dialog__footer .house-dialog__primary .on-left {
  margin-right: 12px;
}
</style>
