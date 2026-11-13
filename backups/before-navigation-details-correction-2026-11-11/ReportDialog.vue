<template>
  <component :is="page ? ModulePage : HouseDialog"
    :model-value="modelValue"
    :context="page ? `${call.shipName ?? 'Ship'} · ${call.portName ?? call.portLocode ?? 'Port not set'}` : undefined"
    :title="`Send to NEMO: ${preview?.title ?? code} (${code})`"
    :max-width-px="600"
    sectioned
    :main-label="receipt ? 'Done' : preview?.previously?.accepted ? `Send update to NEMO: ${code}` : `Send to NEMO: ${code}`"
    :sheet-main-label="receipt ? undefined : 'Send'"
    :main-icon="receipt ? undefined : 'send'"
    :main-disable="!receipt && (!preview?.willSend || reviewOnly)"
    :main-loading="sending || loading"
    :ready="page && !allDetails && !!preview?.willSend && !preview.missing.length && !receipt && !loading"
    @main="onMain"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-if="page" #tools>
      <q-toggle v-model="allDetails" dense size="sm" label="All details" left-label />
    </template>
    <div v-if="loading && !preview" class="row justify-center q-pa-lg">
      <q-spinner color="primary" size="32px" />
    </div>
    <div v-else-if="loadError" class="rd-warn">{{ loadError }}</div>

    <template v-else-if="preview && !receipt">
      <!-- Where it stands, in the legend's colours -->
      <div class="rd-state">
        <StatusPill v-bind="pill" />
        <span>{{ stateLine }}</span>
      </div>

      <!-- NEMO's own reasons for the last refusal, from the call's audit chain -->
      <div v-if="preview.lastRefusal" class="dlg-section">
        <div class="dlg-section__title">Why NEMO refused it</div>
        <ul class="rd-errors">
          <li v-for="(e, i) in refusalLines" :key="i">{{ e }}</li>
        </ul>
      </div>

      <div class="dlg-section">
        <div class="dlg-section__title">{{ preview.willSend ? 'What goes now' : 'The data now' }}</div>
        <div class="text-body2">{{ preview.data }}</div>
        <template v-if="preview.missing.length">
          <div class="rd-missing q-mt-sm">
            <q-icon name="error_outline" size="16px" />
            <span>Still missing — {{ fixWhere }}:</span>
          </div>
          <ul class="rd-errors rd-errors--amber">
            <li v-for="m in preview.missing" :key="m">{{ m }}</li>
          </ul>
        </template>
        <button v-if="SHIP_CODES.includes(code) && call.shipId" type="button" class="rd-link q-mt-sm" @click="editShip">
          Open the ship data
        </button>
        <!-- Several formalities (a CRT per certificate): each one's line -->
        <ul v-if="preview.parts.length > 1 || preview.parts.some((x) => !x.willSend)" class="rd-parts">
          <li v-for="x in preview.parts" :key="x.label">
            <q-icon :name="x.willSend ? 'send' : 'block'" size="14px" :class="x.willSend ? 'rd-go' : 'rd-stop'" />
            <b>{{ x.label }}</b> — {{ x.willSend ? 'goes' : x.reason }}
          </li>
        </ul>
        <div v-if="!preview.willSend && !preview.missing.length && preview.reason" class="rd-warn q-mt-sm">
          {{ preview.reason }}
        </div>
      </div>

      <q-expansion-item
        v-if="preview.envelope"
        dense
        dense-toggle
        expand-icon-class="text-grey-6"
        :label="`Raw JSON — ${code}`"
        header-class="send-raw-head"
      >
        <pre class="rd-raw">{{ JSON.stringify(preview.envelope, null, 2) }}</pre>
      </q-expansion-item>
      <div v-if="reviewOnly" class="rd-warn q-mt-sm">{{ PLATFORM_ADMIN_SEND_WORDS }}</div>
    </template>

    <NemoResultView v-else-if="receipt" :exchanges="receipt.results.map((r) => r.exchange)" />
  </component>
</template>

<script setup lang="ts">
/**
 * One formality on its own (spec 0098 amendment): every chip in the
 * opened call opens it — where it stands, why NEMO refused it last, what
 * goes now — and sends just that formality again. The row's chips open
 * the wizards.
 */
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type PortCall, type ReportPreview, type ShipNemoReceipt } from '../auth/auth';
import { PLATFORM_ADMIN_SEND_WORDS } from '../lib/obligations';
import { openShipEditor } from '../lib/ship-editor';
import { fmtStamp } from '../lib/time';
import HouseDialog from './HouseDialog.vue';
import ModulePage from './ModulePage.vue';
import { sendWasAccepted } from '../lib/port-call-sections';
import NemoResultView from './NemoResultView.vue';
import StatusPill, { type PillTone } from './StatusPill.vue';

const props = defineProps<{ modelValue: boolean; page?: boolean; call: PortCall; code: string }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  /** NEMO answered — the list reloads. */
  (e: 'sent'): void;
  (e: 'completed'): void;
}>();

const $q = useQuasar();
const auth = useAuth();
const allDetails = ref(false);
const preview = ref<ReportPreview | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const sending = ref(false);
const receipt = ref<ShipNemoReceipt | null>(null);

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load();
  },
  { immediate: true },
);

async function load(): Promise<void> {
  preview.value = null;
  receipt.value = null;
  loadError.value = null;
  loading.value = true;
  try {
    preview.value = await auth.reportPreview(props.call.id, props.code);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : `Could not prepare the ${props.code}`;
  } finally {
    loading.value = false;
  }
}

const reviewOnly = computed(() => auth.user.value?.platformAdmin === true);
const pill = computed((): { tone: PillTone; label: string; icon?: string } => {
  const p = preview.value!;
  if (p.lastRefusal) return { tone: 'red', label: 'Refused', icon: 'warning' };
  if (p.previously?.accepted) return { tone: 'violet', label: 'In NEMO', icon: 'check' };
  if (p.missing.length) return { tone: 'amber', label: 'Data missing' };
  return { tone: 'green', label: 'Ready to send' };
});
const stateLine = computed(() => {
  const p = preview.value!;
  if (p.lastRefusal) {
    const kept = p.previously && (p.previously.version ?? 0) > 0 ? ' — the earlier version stays in NEMO' : '';
    return `NEMO refused the send of ${fmtStamp(p.lastRefusal.at)}${kept}`;
  }
  if (p.previously?.accepted) return `Sent ${fmtStamp(p.previously.sentAt)}${p.previously.sentBy ? ` by ${p.previously.sentBy}` : ''}`;
  return p.missing.length ? 'Not sent yet — its data is not complete' : 'Not sent yet';
});
const SHIP_CODES = ['SID', 'SHP', 'CRT'];
async function editShip(): Promise<void> {
  if (!props.call.shipId) return;
  if (await openShipEditor(props.call.shipId)) {
    emit('sent');
    await load();
  }
}

/** Where a gap is fixed, by where the formality's data lives. */
const fixWhere = computed(() => {
  const c = props.code;
  if (['CWA', 'EFF', 'STA', 'WAS', 'SEC'].includes(c)) return "fix it in the ship's forms (Review forms on the call)";
  if (SHIP_CODES.includes(c)) return 'fix it in the ship data';
  return `fill it in the ${c === 'NOD' ? 'Pre-dep' : 'Pre-arr'} wizard (the chip on the call's row)`;
});
/** "ERR-027 Unit selection …" — NEMO's words, one line per error. */
const refusalLines = computed(() => {
  const r = preview.value?.lastRefusal;
  if (!r) return [];
  const lines = r.errors.map((e) => [e.code, e.message].filter(Boolean).join(' ')).filter(Boolean);
  return lines.length ? lines : [r.words || 'NEMO gave no reason'];
});

async function onMain(): Promise<void> {
  if (receipt.value) {
    emit('update:modelValue', false);
    return;
  }
  sending.value = true;
  try {
    receipt.value = await auth.sendReport(props.call.id, props.code);
    if (props.page && sendWasAccepted(receipt.value)) emit('completed');
    else emit('sent');
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : `Could not send the ${props.code}` });
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.rd-state {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 2px 12px;
  font-size: 14px;
  color: var(--nl-ink-2);
}
.rd-errors {
  margin: 0;
  padding-left: 18px;
  font-size: 14px;
  color: var(--nl-red);
}
.rd-errors li + li {
  margin-top: 4px;
}
.rd-link {
  display: inline-block;
  padding: 0;
  border: none;
  background: none;
  color: var(--nl-primary);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.rd-parts {
  margin: 8px 0 0;
  padding-left: 0;
  list-style: none;
  font-size: 14px;
  color: var(--nl-ink-2);
}
.rd-parts li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rd-go {
  color: var(--nl-green);
}
.rd-stop {
  color: var(--nl-amber-text);
}
.rd-errors--amber {
  color: var(--nl-amber-text);
}
.rd-missing {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 14px;
  color: var(--nl-amber-text);
}
.rd-warn {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  font-size: 14px;
}
.rd-raw {
  font-size: 12px;
  max-height: 320px;
  overflow: auto;
  background: var(--nl-gray-bg);
  padding: 8px;
  border-radius: 6px;
}
</style>
