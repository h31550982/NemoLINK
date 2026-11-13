<template>
  <HouseDialog
    :model-value="modelValue"
    class="nod-wz"
    :title="receipt && allAccepted ? 'NOD sent' : 'Send to NEMO: NOD'"
    title-style="detail"
    help-topic="call.nod"
    help-beside-title
    :max-width-px="740"
    :main-label="receipt ? 'Done' : 'Send to NEMO: NOD'"
    :sheet-main-label="receipt ? undefined : 'Send'"
    :main-icon="receipt ? 'check' : 'send'"
    :main-disable="mainDisable"
    :main-loading="busy"
    @main="onMain"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- As the other pop-ups (user 2026-11-05): no Close in the footer —
         Close stays at the top right. An empty slot keeps the footer's own out -->
    <template #secondary>
      <span aria-hidden="true" />
    </template>

    <!-- The pre-departure notice (spec 0092): four things NEMO checks — the
         ETD and next port from the call, the crew and persons on board the
         NOA already resolved. What is missing is filled right here.
         White throughout, no cards inside the card (user 2026-11-05): each
         part is its heading and its rows, as Send to NEMO (VID). -->
    <div v-if="loading && !preview" class="row justify-center q-pa-lg">
      <q-spinner color="primary" size="32px" />
    </div>
    <div v-else-if="loadError" class="nod-warn">{{ loadError }}</div>

    <div v-else-if="preview && !receipt" class="rp">
      <!-- One table, as Send to NEMO (VID) — Figma 500:7424: every element
           NEMO gets, a missing one typed right in its To NEMO box -->
      <section class="rp-block">
        <!-- No heading over the rows (user 2026-11-07): the step's title says it -->
        <!-- As the NOA's This goes to NEMO (user 2026-11-07): each value its
             label over the value, Ready or Add missing data on the right;
             the button leads to the fix — the port call, or the field below -->
        <dl class="tg-rows">
          <div v-for="s in summary" :key="s.key" class="tg-row">
            <div class="tg-row__body">
              <dt class="tg-row__label">{{ s.label }}</dt>
              <dd class="tg-row__value tnum">{{ s.missing ? '–' : s.value }}</dd>
            </div>
            <StatusPill v-if="s.missing" tone="amber" label="Data missing" />
            <StatusPill v-else tone="green" label="Ready" />
          </div>
        </dl>
        <div ref="ledgerEl" class="tg-ledger">
          <button type="button" class="wz-more" :aria-expanded="allDetails" @click="allDetails = !allDetails">
            {{ allDetails ? 'Hide the fields and NEMO codes' : `All ${preview.rows.length} fields and NEMO codes` }}
            <q-icon name="chevron_right" size="18px" />
          </button>
          <FormalityLedger
            v-if="allDetails"
            :rows="preview.rows"
            :all-details="true"
            :busy-key="savingKey"
            code-on-hover
            hide-ready
            @save="saveField"
          />
        </div>
        <p class="rp-note nod-with">
          <q-icon :name="preview.confirmed ? 'verified' : 'schedule'" size="16px" />
          <span v-if="preview.confirmed">The departure is already confirmed to Customs (ST-FI-02); this update keeps it.</span>
          <span v-else>The departure is confirmed to Customs with the ATD, when the ship leaves.</span>
        </p>
      </section>
      <div v-if="preview.reason && !preview.missing.length" class="nod-warn">{{ preview.reason }}</div>
      <div v-if="reviewOnly" class="nod-warn">{{ PLATFORM_ADMIN_SEND_WORDS }}</div>
    </div>

    <template v-else-if="receipt && allAccepted">
      <div class="nod-done">
        <div class="nod-done__check"><q-icon name="check" size="40px" /></div>
        <div class="nod-done__title">NOD sent</div>
        <div class="nod-done__sub tnum">NEMO accepted it · {{ receipt.visitId }}</div>
      </div>
      <q-expansion-item dense dense-toggle expand-icon-class="text-grey-6" label="Details — NEMO's answer and the read-back">
        <NemoResultView :exchanges="receipt.results.map((r) => r.exchange)" :expanded="false" />
      </q-expansion-item>
    </template>
    <NemoResultView v-else-if="receipt" :exchanges="receipt.results.map((r) => r.exchange)" :expanded="false" />
  </HouseDialog>
</template>

<script setup lang="ts">
/**
 * The NOD (spec 0092): what NEMO checks before a departure, in words, the
 * gaps filled in place, one send. It goes unconfirmed; the ATD step sends
 * the departure confirmation (ST-FI-02), as the ATA step does the arrival's.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type NodPreview, type PortCall, type ShipNemoReceipt } from '../auth/auth';
import { PLATFORM_ADMIN_SEND_WORDS } from '../lib/obligations';
// Pre-departure keeps the ledger as it was before the 2026-11-05 Pre-arrival
// field restyle (user 2026-11-05): that restyle is for the NOA wizard only
import FormalityLedger from './NodFormalityLedger.vue';
import HouseDialog from './HouseDialog.vue';
import StatusPill from './StatusPill.vue';
import { ledgerWords } from '../lib/ledger-words';
import NemoResultView from './NemoResultView.vue';

const props = defineProps<{ modelValue: boolean; call: PortCall }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'sent'): void;
  /** Add missing data on a value the port call holds: the call's edit form. */
  (e: 'edit-call'): void;
}>();

const $q = useQuasar();
const auth = useAuth();

const preview = ref<NodPreview | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const sending = ref(false);
const receipt = ref<ShipNemoReceipt | null>(null);
const savingKey = ref<string | null>(null);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    preview.value = null;
    receipt.value = null;
    void reload();
  },
  { immediate: true },
);

/* The port call edited from Add missing data: once it comes back changed,
   the NOD's values catch up */
watch(
  () => props.call,
  () => {
    if (props.modelValue && !receipt.value) void reload();
  },
);

async function reload(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    preview.value = await auth.nodPreview(props.call.id);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not prepare the NOD';
  } finally {
    loading.value = false;
  }
}

/** The rows still missing, as cards to fill (the ETD's says where: the port call). */
const gapRows = computed(() => preview.value?.rows.filter((r) => !r.ok) ?? []);

/** This goes to NEMO: each value in words; a missing one on the port call
    is fixed there, the others in the fields below. */
const summary = computed(() =>
  (preview.value?.rows ?? []).map((r) => ({
    key: r.key,
    label: r.label,
    value: ledgerWords(r, r.toNemo),
    missing: !r.ok,
    onCall: r.owner === 'callCore',
  })),
);

/** The fields and NEMO codes: shut until asked for, or until Add missing data. */
const allDetails = ref(false);
const ledgerEl = ref<HTMLElement | null>(null);
async function fillBelow(): Promise<void> {
  allDetails.value = true;
  await nextTick();
  ledgerEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** A crew or persons-on-board value saves as a call fact, as in the NOA (spec 0090). */
async function saveField(key: string, value: string | number | null): Promise<void> {
  savingKey.value = key;
  try {
    await auth.saveNoaField(props.call.id, key, value);
    emit('sent');
    await reload();
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not save' });
  } finally {
    savingKey.value = null;
  }
}

/** Platform admins acting in an org review, never send (invariant 4, spec 0076). */
const reviewOnly = computed(() => auth.user.value?.platformAdmin === true);
const allAccepted = computed(() => !!receipt.value && receipt.value.results.every((r) => r.accepted));
const busy = computed(() => sending.value || loading.value);
const mainDisable = computed(() => {
  if (receipt.value) return false;
  return reviewOnly.value || !preview.value?.willSend || !!savingKey.value;
});

async function onMain(): Promise<void> {
  if (receipt.value) {
    emit('update:modelValue', false);
    return;
  }
  sending.value = true;
  try {
    receipt.value = await auth.sendNod(props.call.id);
    emit('sent');
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not send the NOD' });
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
/* As Send to NEMO (VID) and Pre-arrival: parts on white, a 16px SemiBold
   heading, 28px between parts */
.rp {
  display: flex;
  flex-direction: column;
  gap: 28px;
  color: var(--text-200);
}
.rp-block {
  display: flex;
  flex-direction: column;
}
.rp-heading {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  line-height: normal;
  letter-spacing: 0.16px;
  color: var(--text-300);
}
.rp-note {
  margin: 0;
  padding-top: 12px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.12px;
  color: var(--text-200);
}
/* This goes to NEMO (user 2026-11-07): the NOA's rows — label over value
   between Blue/500 hairlines, the state on the right; 58px rows on mobile
   and tablet */
.tg-rows {
  margin: 0;
}
.tg-row {
  min-height: 48px;
  padding: 6px 0;
  display: flex;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--blue-500);
}
.tg-row__body {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}
.tg-row__label {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: normal;
  letter-spacing: 0.14px;
  color: var(--text-300); /* user 2026-11-07 */
}
.tg-row__value {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: normal;
  letter-spacing: 0.14px;
  color: var(--text-200);
  overflow-wrap: anywhere;
}
@media (max-width: 1023px) {
  .tg-row {
    min-height: var(--nl-row-mobile-min-height);
  }
  .tg-row,
  .tg-row__body {
    padding: 0;
  }
}
.tg-ledger {
  margin-top: 12px;
  scroll-margin-top: 16px;
}
.wz-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  margin-top: 8px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--nl-primary);
  cursor: pointer;
  text-align: left;
}
/* Heading to the table 20px, as heading to rows */
.rp-heading + .fl {
  margin-top: 12px;
}
.nod-with {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nod-warn {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  font-size: 14px;
}
.nod-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 16px 8px 20px;
}
.nod-done__check {
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
.nod-done__title {
  font-size: 20px;
  font-weight: 600;
}
.nod-done__sub {
  font-size: 14px;
  color: var(--nl-ink-2);
  margin-top: 4px;
}
</style>
