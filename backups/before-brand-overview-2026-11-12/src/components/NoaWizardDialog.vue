<template>
  <component :is="page ? ModulePage : HouseDialog"
    :model-value="modelValue"
    :context="page ? `${call.shipName ?? 'Ship'} · ${call.portName ?? call.portLocode ?? 'Port not set'}` : undefined"
    class="noa-wz"
    title="Send to NEMO: Pre-arrival"
    :sheet-title="sheetTitle"
    :step-label="page && receipt ? '3 of 3' : stepLabel"
    :sheet-main-label="sheetMainLabel"
    :ready="page && !allDetails && reportReady"
    title-style="detail"
    help-topic="call.noa"
    help-beside-title
    :max-width-px="1240"
    full-height
    :main-label="mainLabel"
    :main-icon="step === 'send' && !receipt ? 'send' : undefined"
    :main-icon-right="!receipt && step !== 'send' ? 'arrow_forward' : undefined"
    :main-disable="mainDisable || !!attachmentsBusy"
    :main-loading="busy"
    @main="onMain"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- The steps (spec 0088), in the band under the title as in Ship forms
         (user 2026-11-04): white throughout, passed steps look like the ones
         ahead, only the current one stands out. Ctrl+Enter walks them -->
    <template v-if="page" #tools><q-toggle v-model="allDetails" dense size="sm" label="All details" left-label class="wz-details" /></template>
    <template v-if="$q.screen.gt.sm && $slots.attachments" #attachments><slot name="attachments" /></template>
    <template v-if="!page" #band>
    <div class="wz-head">
      <ol class="wz-steps" aria-label="Steps">
        <li
          v-for="s in steps"
          :key="s.key"
          class="wz-step"
          :class="`wz-step--${s.state}`"
          :aria-current="s.state === 'current' ? 'step' : undefined"
        >
          <q-icon v-if="s.n > 1" name="chevron_right" size="16px" class="wz-step__sep" />
          <span class="wz-step__pill">
            <span class="wz-step__n">{{ s.n }}</span>
            <span>{{ s.label }}</span>
          </span>
        </li>
      </ol>
      <q-toggle v-model="allDetails" dense size="sm" label="All details" left-label class="wz-details" />
    </div>
    </template>

    <!-- Back in the footer, as Ship forms; none on the first step or once
         sent. Close stays at the top right -->
    <template #secondary>
      <q-btn
        v-if="canGoBack"
        outline no-caps color="primary" label="Back"
        class="wz-back"
        :disable="busy"
        @click="goBack"
      />
      <!-- An empty slot would bring the footer's own Close back -->
      <span v-else aria-hidden="true" />
    </template>

    <div v-if="loading && !preview" class="row justify-center q-pa-lg">
      <q-spinner color="primary" size="32px" />
    </div>
    <div v-else-if="loadError" class="wz-warn">{{ loadError }}</div>

    <!-- 1 · what goes to NEMO with the NOA (spec 0098): the notice and the
         dues always; the usual and the compulsory reports ticked; the ones
         that apply only sometimes ticked when the call shows they apply,
         saying why. Every tick is yours to change and kept on the call. -->
    <template v-else-if="preview && step === 'reports'">
      <!-- Figma 465:6999 (user 2026-11-05): the name only, no line under it;
           the state is the pill on the right. A yellow or red pill names
           what is missing on hover and opens the form's table on click. -->
      <div class="rp">
        <div class="rp-groups">
          <div class="rp-block">
            <div class="rp-group">Always</div>
            <div class="rp-rows">
              <div class="rp-row rp-row--fixed">
                <div class="rp-body">
                  <div class="rp-title">Pre-arrival notice</div>
                </div>
                <StatusPill v-if="preview.previously?.accepted" tone="violet" icon="check" label="In NEMO" />
              </div>
              <div v-if="preview.due" class="rp-row rp-row--fixed">
                <div class="rp-body">
                  <div class="rp-title">Fairway and port dues</div>
                </div>
              </div>
            </div>
          </div>
          <div v-for="g in reportGroups" :key="g.tier" class="rp-block">
            <div class="rp-group">{{ g.title }}</div>
            <div class="rp-rows">
              <div v-for="r in g.items" :key="r.code" class="rp-row" :class="{ 'rp-row--quiet': !r.built }">
                <q-checkbox
                  :model-value="r.on"
                  :disable="!r.built || r.inNemo || reviewOnly || choosing === r.code"
                  dense
                  :aria-label="`${r.title} — ${r.on ? 'goes' : 'does not go'}`"
                  @update:model-value="(v: boolean) => choose(r, v)"
                >
                  <q-tooltip v-if="r.inNemo">In NEMO already — its update goes when its data changes</q-tooltip>
                  <q-tooltip v-else-if="!r.built">{{ r.data }}</q-tooltip>
                </q-checkbox>
                <div class="rp-body">
                  <div class="rp-title">{{ r.title }}</div>
                  <div v-if="r.why && r.decidedBy !== 'user' && (r.decidedBy !== 'default' || r.inNemo)" class="rp-why" :class="{ 'rp-why--evidence': r.decidedBy === 'evidence' }">{{ r.why }}</div>
                </div>
                <template v-if="reportPill(r)">
                  <!-- Yellow or red: hover names the gaps, a click opens the table -->
                  <!-- Data missing is a button (user 2026-11-06): 28px, the
                       buttons' 8px corners, in the pill's yellow -->
                  <span
                    v-if="pillHasHelp(r)"
                    tabindex="0"
                    class="rp-pill-info"
                    :aria-label="pillAria(r)"
                  >
                    <StatusPill v-bind="reportPill(r)!" />
                    <q-tooltip class="rp-tip" anchor="top middle" self="bottom middle" :offset="[0, 8]" max-width="340px">
                      <div class="rp-tip__title">{{ r.missing.length ? 'Missing' : 'NEMO refused the last send' }}</div>
                      <ul v-if="r.missing.length" class="rp-tip__list">
                        <li v-for="m in r.missing.slice(0, TIP_MAX)" :key="m">{{ m }}</li>
                        <li v-if="r.missing.length > TIP_MAX">and {{ r.missing.length - TIP_MAX }} more</li>
                      </ul>
                    </q-tooltip>
                  </span>
                  <StatusPill v-else v-bind="reportPill(r)!" />
                </template>
              </div>
            </div>
          </div>
        </div>
        <p class="rp-note">
          Crew, stores, waste and security come from the ship's forms — add them under
          <b>Ship documents</b> on the call and check them with <b>Review forms</b>. A ticked report
          without its data does not hold the notice: it goes with a later send.
        </p>
      </div>
    </template>

    <!-- 1 · only what needs a person (spec 0092): what the sources already
         gave is one line; what is missing or disagrees is a card, edited
         right here and saved where it belongs — the call, the ship (your
         override), your organisation. Every field is one tap away. -->
    <template v-else-if="preview && step === 'facts'">
      <div class="dlg-section">
        <FormalityLedger
          code-on-hover
          can-edit-call
          :rows="preview.rows"
          :port-locode="call.portLocode"
          :port-name="call.portName"
          :all-details="allDetails"
          :busy-key="savingKey"
          hide-ready
          @save="saveField"
          @edit-call="emit('edit-call')"
        />
        <!-- No "Only what needs you" under the list (user 2026-11-05): the
             All details switch above does it -->
        <button v-if="!allDetails" type="button" class="wz-more" @click="allDetails = true">
          {{ `Show all ${preview.rows.length} fields — External, NEMOLink, To NEMO` }}
          <q-icon name="chevron_right" size="18px" />
        </button>
        <div v-if="allDetails && shipLink" class="text-body2 q-mt-sm">
          <a :href="shipLink" class="wz-link" @click.prevent="editShip">Open the ship data</a>
          — every field of the ship, its certificates and files.
        </div>
      </div>
    </template>

    <!-- 2 · what NEMO receives, the confirmation (asked, no default), the send -->
    <template v-else-if="preview && step === 'send' && !receipt">
      <!-- Step 3 (user 2026-11-05, reference): one column on white with the
           What goes row spacing — 48px rows between Blue/500 hairlines — and
           16px SemiBold headings. Each value is its label over the value
           with its state on the right; missing values use informational report pills. -->
      <div class="rp">
        <div class="rp-groups">
          <section class="rp-block">
            <h3 class="rp-heading tg-heading">This goes to NEMO{{ missingCount ? ` - ${missingCount} missing` : '' }}</h3>
            <dl class="rp-rows tg-rows">
              <div v-for="s in summary" :key="s.label" class="rp-row tg-row">
                <div class="rp-body tg-row__body">
                  <dt class="tg-row__label">{{ s.label }}</dt>
                  <dd class="tg-row__value tnum">{{ s.missing ? '–' : s.value }}</dd>
                </div>
                <StatusPill v-if="s.missing" tone="amber" label="Data missing" />
                <StatusPill v-else tone="green" label="Ready" />
              </div>
            </dl>
          </section>

          <!-- The reports that go with it (spec 0092): the DUE rides with the
               NOA, each ticked report with its state; a missing one opens its table -->
          <section class="rp-block">
            <h3 class="rp-heading tg-heading">Reports that go with it</h3>
            <div class="rp-rows tg-rows">
              <div v-if="preview.due" class="rp-row tg-row">
                <div class="rp-body tg-row__body">
                  <div class="tg-row__value">Fairway and port dues</div>
                  <div class="tg-row__label">Your agency as the liable party</div>
                </div>
                <StatusPill tone="green" label="Ready" />
              </div>
              <ReportListRow v-for="r in [...going, ...waiting]" :key="r.code">
                <div class="tg-row__value">{{ r.title }}</div>
                <template v-if="reportPill(r)" #status>
                  <!-- Data missing is a button (user 2026-11-06): 28px, the
                       buttons' 8px corners, in the pill's yellow -->
                  <span
                    v-if="pillHasHelp(r)"
                    tabindex="0"
                    class="rp-pill-info"
                    :aria-label="pillAria(r)"
                  >
                    <StatusPill v-bind="reportPill(r)!" />
                    <q-tooltip class="rp-tip" anchor="top middle" self="bottom middle" :offset="[0, 8]" max-width="340px">
                      <div class="rp-tip__title">Missing</div>
                      <ul class="rp-tip__list">
                        <li v-for="m in r.missing.slice(0, TIP_MAX)" :key="m">{{ m }}</li>
                        <li v-if="r.missing.length > TIP_MAX">and {{ r.missing.length - TIP_MAX }} more</li>
                      </ul>
                    </q-tooltip>
                  </span>
                  <StatusPill v-else v-bind="reportPill(r)!" />
                </template>
              </ReportListRow>
            </div>
          </section>
        </div>
        <p v-if="preview.previously?.accepted" class="rp-note">
          Updates the NOA sent {{ fmtStamp(preview.previously.sentAt) }}.
        </p>
      </div>

      <div ref="ledgerEl" class="tg-ledger">
        <button type="button" class="wz-more" :aria-expanded="allDetails" @click="allDetails = !allDetails">
          {{ allDetails ? 'Hide the fields and NEMO codes' : `All ${preview.rows.length} fields and NEMO codes` }}
          <q-icon name="chevron_right" size="18px" />
        </button>
        <FormalityLedger
          code-on-hover
          can-edit-call
          v-if="allDetails"
          :rows="preview.rows"
          :port-locode="call.portLocode"
          :port-name="call.portName"
          :all-details="true"
          :busy-key="savingKey"
          @save="saveField"
          @edit-call="emit('edit-call')"
        />
      </div>
      <div v-if="!preview.missing.length && sendReason" class="wz-warn">{{ sendReason }}</div>
      <template v-if="allDetails && preview.envelope">
        <q-expansion-item
          dense dense-toggle
          expand-icon-class="text-grey-6"
          label="Raw JSON — NOA"
          header-class="send-raw-head"
          class="q-mt-sm"
        >
          <pre class="send-raw">{{ JSON.stringify(preview.envelope, null, 2) }}</pre>
        </q-expansion-item>
      </template>
      <div v-if="reviewOnly" class="wz-warn q-mt-sm">{{ PLATFORM_ADMIN_SEND_WORDS }}</div>
    </template>

    <!-- 3 · sent: the answer in one line, then what is next on this call;
         NEMO's full answer and the read-back behind Details (spec 0092) -->
    <template v-else-if="receipt && allAccepted">
      <div class="wz-done">
        <div class="wz-done__check"><q-icon name="check" size="40px" /></div>
        <div class="wz-done__title">{{ sentWords }}</div>
        <div class="wz-done__sub">{{ call.shipName ?? 'The ship' }} → {{ call.portName ?? call.portLocode }}</div>
        <div class="wz-done__sub tnum">NEMO accepted it {{ fmtStamp(receipt.sentAt) }} · {{ receipt.visitId }}</div>
      </div>
      <div v-if="nextOb" class="dlg-section">
        <div class="dlg-section__title">Next on this call</div>
        <div class="wz-next">
          <span class="wz-next__title">{{ nextOb.title }} · {{ nextOb.code }}</span>
          <span v-if="nextOb.dueAt" class="wz-next__due tnum">{{ dueLine(nextOb) }}</span>
        </div>
      </div>
      <q-expansion-item
        dense dense-toggle
        expand-icon-class="text-grey-6"
        label="Details — NEMO's answer and the read-back"
        header-class="send-raw-head"
        class="q-mt-sm"
        :default-opened="allDetails"
      >
        <NemoResultView :exchanges="receipt.results.map((r) => r.exchange)" :expanded="allDetails" />
      </q-expansion-item>
    </template>
    <NemoResultView v-else-if="receipt" :exchanges="receipt.results.map((r) => r.exchange)" :expanded="allDetails" />
  </component>
</template>

<script setup lang="ts">
import { useAutoDetails } from '../composables/useAutoDetails';
/**
 * The NOA wizard (spec 0088): 1 · the facts of this call — purpose,
 * draught, crew, persons on board, master, and the voyage type when the
 * last port does not decide it — with what is missing elsewhere and where
 * to fix it; 2 · the arrival confirmation, asked every time with no default
 * (user decision 2026-09-26), and the send. NEMO's answer follows in the
 * result view, with its copy read back (spec 0089).
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import {
  useAuth,
  type NoaPreview,
  type PortCall,
  type PreArrivalReport,
  type ShipNemoReceipt,
} from '../auth/auth';
import { openShipEditor } from '../lib/ship-editor';
import { PLATFORM_ADMIN_SEND_WORDS, dueLine } from '../lib/obligations';
import { ledgerWords } from '../lib/ledger-words';
import { fmtStamp } from '../lib/time';
import FormalityLedger from './NodFormalityLedger.vue';
import HouseDialog from './HouseDialog.vue';
import ModulePage from './ModulePage.vue';
import ReportListRow from './ReportListRow.vue';
import { sendWasAccepted } from '../lib/port-call-sections';
import NemoResultView from './NemoResultView.vue';
import StatusPill, { type PillTone } from './StatusPill.vue';

type StepKey = 'reports' | 'facts' | 'send';

const props = defineProps<{
  modelValue: boolean; page?: boolean;
  attachmentsBusy?: boolean;
  call: PortCall;
  /** Bumped by the host when a form table it opened closes: reload the gaps. */
  refreshKey?: number;
  /** Open the phase chosen in the port-call process list. */
  startAt?: StepKey;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  /** Something changed or reached NEMO — the list reloads. */
  (e: 'sent'): void;
  (e: 'completed'): void;
  /** A report's pill was clicked: open its form table (Review forms) at this step. */
  (e: 'open-table', table: string): void;
  /** "Edit details" on a port call field: open the port call's edit pop-up. */
  (e: 'edit-call'): void;
}>();

const $q = useQuasar();
const auth = useAuth();

const step = ref<StepKey>('facts');
const preview = ref<NoaPreview | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const sending = ref(false);
const receipt = ref<ShipNemoReceipt | null>(null);

const allDetails = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) start();
  },
  { immediate: true },
);

function start(): void {
  preview.value = null;
  receipt.value = null;
  loadError.value = null;
  step.value = props.startAt ?? 'reports';
  void reload();
}

watch(
  () => props.refreshKey,
  () => {
    if (props.modelValue) void reload();
  },
);

async function reload(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    preview.value = await auth.noaPreview(props.call.id);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Could not prepare the NOA';
  } finally {
    loading.value = false;
  }
}

/**
 * One row edited in place (spec 0090): the server saves it to the row's
 * owner — the call, the ship (the organisation's override) or the
 * organisation — and the preview reloads with what now goes.
 */
const savingKey = ref<string | null>(null);
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

// ---- what goes with the NOA (spec 0098) ---------------------------------------

const TIER_TITLES: Record<PreArrivalReport['tier'], string> = {
  usually: 'Usually sent',
  compulsory: 'Compulsory for most ships',
  ifApplies: 'If it applies',
};
const reportGroups = computed(() =>
  (['usually', 'compulsory', 'ifApplies'] as const)
    .map((tier) => ({ tier, title: TIER_TITLES[tier], items: (preview.value?.reports ?? []).filter((r) => r.tier === tier) }))
    .filter((g) => g.items.length > 0),
);
/** Ticked, its data in, and changed since NEMO last took it: goes with this send. */
const going = computed(() => (preview.value?.reports ?? []).filter((r) => r.built && r.on && r.missing.length === 0 && !r.current));
/** Ticked but its data not in yet: stays out, named. */
const waiting = computed(() => (preview.value?.reports ?? []).filter((r) => r.built && r.on && r.missing.length > 0));

/** The chip beside a report, in the legend's colours. */
function reportPill(r: PreArrivalReport): { tone: PillTone; label: string; icon?: string } | null {
  if (r.refused) return { tone: 'red', label: 'Refused', icon: 'warning' };
  if (r.inNemo && r.current) return { tone: 'violet', label: 'In NEMO', icon: 'check' };
  if (!r.built || !r.on) return null;
  if (r.missing.length > 0) return { tone: 'amber', label: 'Data missing' };
  return { tone: 'green', label: r.inNemo ? 'Update ready' : 'Ready' };
}
/** The form table that feeds each built report (spec 0096). */
const TABLE_OF: Record<string, string> = { CWA: 'crew', EFF: 'crew', STA: 'stores', WAS: 'waste', SEC: 'security' };
/** Gaps named in the hover pop-up before "and N more" (user 2026-11-05: two). */
const TIP_MAX = 2;
/** A yellow (data missing) or red (refused) pill: it has something to say on hover. */
function pillHasHelp(r: PreArrivalReport): boolean {
  const pill = reportPill(r);
  return !!pill && (pill.tone === 'amber' || pill.tone === 'red');
}
function pillAria(r: PreArrivalReport): string {
  const what = r.missing.length ? `missing ${r.missing.join('; ')}` : 'NEMO refused the last send';
  return `${r.title}: ${what}`;
}
/** The pill's click: straight to the table where the gaps are filled. */
function openTable(r: PreArrivalReport): void {
  const table = TABLE_OF[r.code];
  if (table) emit('open-table', table);
}

const choosing = ref<string | null>(null);
async function choose(r: PreArrivalReport, on: boolean): Promise<void> {
  choosing.value = r.code;
  try {
    preview.value = await auth.setNoaReport(props.call.id, r.code, on);
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not save the choice' });
  } finally {
    choosing.value = null;
  }
}

/** The codes this send carries, in order. */
const sendCodes = computed(() => [
  'NOA',
  ...(preview.value?.due ? ['DUE'] : []),
  ...going.value.map((r) => r.code),
]);
/** "NOA, DUE and CWA sent" — what NEMO accepted. */
const sentWords = computed(() => {
  const codes = (receipt.value?.results ?? []).filter((r) => r.accepted).map((r) => r.type);
  if (codes.length <= 1) return `${codes[0] ?? 'NOA'} sent`;
  return `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]} sent`;
});

/**
 * "This goes to NEMO" (spec 0092): the headline values, in words, from the
 * same rows the payload is built from. A value entered on this call is
 * marked, everything else came from its source.
 */
const SUMMARY: { label: string; key?: string; de?: string }[] = [
  { label: 'ETA', de: 'DE-022-02' },
  { label: 'ETD', de: 'DE-022-05' },
  { label: 'Previous port', de: 'DE-022-06' },
  { label: 'Next port', de: 'DE-022-08' },
  { label: 'Persons on board', de: 'DE-034-01' },
  { label: 'Crew', de: 'DE-034-03' },
  { label: 'Purpose', de: 'DE-014-10' },
  { label: 'Fairway dues language', key: 'fixed:duesLanguage' },
];
const summary = computed(() => {
  const rows = preview.value?.rows ?? [];
  const call = props.call;
  const berth = rows.find((r) => r.de === 'DE-015-04');
  const head = [
    { label: 'Ship', value: [call.shipName, call.imoNumber ? `IMO ${call.imoNumber}` : null].filter(Boolean).join(' · ') || '—', mine: false, missing: false, onCall: false },
    {
      label: 'Port · berth',
      value: `${call.portLocode ?? '—'} · ${berth?.ok ? ledgerWords(berth, berth.toNemo) : 'no berth yet'}`,
      mine: false,
      missing: !berth?.ok,
      onCall: true,
    },
  ];
  return [
    ...head,
    ...SUMMARY.flatMap((s) => {
      const r = rows.find((x) => (s.key ? x.key === s.key : x.de === s.de));
      if (!r) return [];
      return [{
        label: s.label,
        // A date and its time stay on one line
        value: r.ok ? ledgerWords(r, r.toNemo).replace(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/g, '$1' + String.fromCharCode(160) + '$2') : 'missing',
        mine: r.owner === 'call' && r.entered !== null,
        missing: !r.ok,
        // A port call's own field is fixed on the port call, not here
        onCall: r.owner === 'callCore',
      }];
    }),
  ];
});

/** How many headline values are still missing: the heading's state. */
const missingCount = computed(() => summary.value.filter((s) => s.missing).length);
const reportReady = computed(() => {
  const p = preview.value;
  if (!p || loading.value || loadError.value || receipt.value) return false;
  if (p.missing.length || p.problems.length || !p.rows.every(row => row.ok && !row.differs)) return false;
  if (step.value === 'facts') return true;
  return p.reports.filter(report => report.on).every(report => !report.missing.length && !report.refused);
});
useAutoDetails(allDetails, () => {
  if (loadError.value) return true;
  const p = preview.value;
  if (loading.value || !p || receipt.value) return null;
  return !reportReady.value;
});

const ledgerEl = ref<HTMLElement | null>(null);
/** "Fill in below": open every field under the card and bring it into view. */
async function fillBelow(): Promise<void> {
  allDetails.value = true;
  await nextTick();
  ledgerEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const shipLink = computed(() => (props.call.shipId ? `/admin/ships?ship=${props.call.shipId}` : null));
async function editShip(): Promise<void> {
  if (!props.call.shipId) return;
  const changed = await openShipEditor(props.call.shipId);
  if (changed) {
    emit('sent');
    await reload();
  }
}

/** Platform admins acting in an org review, never send (invariant 4, spec 0076). */
const reviewOnly = computed(() => auth.user.value?.platformAdmin === true);

const sendReason = computed(() => {
  const p = preview.value;
  if (!p || p.willSend) return null;
  return p.reason;
});

const steps = computed(() => {
  const at = step.value;
  const sent = !!receipt.value;
  return [
    { key: 'reports', n: 1, label: 'What goes to NEMO', state: at === 'reports' ? 'current' : 'done' },
    { key: 'facts', n: 2, label: 'The facts', state: at === 'facts' ? 'current' : at === 'reports' ? 'todo' : 'done' },
    { key: 'send', n: 3, label: 'Confirm and send', state: sent ? 'done' : at === 'send' ? 'current' : 'todo' },
  ];
});

/** Every part of the send accepted: the done screen; otherwise NEMO's answer in full. */
const allAccepted = computed(() => !!receipt.value && receipt.value.results.every((r) => r.accepted));
/** The next report the call owes (server's flow order, spec 0092) — once the list has reloaded past the NOA. */
const nextOb = computed(() => {
  const code = props.call.next;
  if (!code || code === 'NOA') return null;
  return props.call.obligations.find((o) => o.code === code) ?? null;
});

const busy = computed(() => sending.value || loading.value);
const mainLabel = computed(() => {
  if (receipt.value) return 'Done';
  if (step.value !== 'send') return 'Next';
  const codes = sendCodes.value;
  return codes.length <= 3 ? `Send to NEMO: ${codes.join(' + ')}` : `Send ${codes.length} reports to NEMO`;
});

/** The phone has no band: the step names the title, its number the action bar,
    and the send button is bare — the title already says where it goes. */
const currentStep = computed(() => steps.value.find((s) => s.state === 'current') ?? null);
const sheetTitle = computed(() => currentStep.value?.label);
const stepLabel = computed(() =>
  currentStep.value ? `${currentStep.value.n} of ${steps.value.length}` : undefined,
);
const sheetMainLabel = computed(() =>
  !receipt.value && step.value === 'send' ? 'Send' : undefined,
);
const mainDisable = computed(() => {
  const p = preview.value;
  if (!p || receipt.value) return false;
  if (step.value === 'reports') return !!choosing.value;
  if (step.value === 'facts') return !!savingKey.value;
  if (reviewOnly.value) return true;
  return !p.willSend;
});

/** Back: the step before, until the first; nothing once it is sent. */
const canGoBack = computed(() => !receipt.value && step.value !== 'reports');
function goBack(): void {
  if (!canGoBack.value || busy.value) return;
  step.value = step.value === 'send' ? 'facts' : 'reports';
}

async function onMain(): Promise<void> {
  if (receipt.value) {
    emit('update:modelValue', false);
    return;
  }
  if (step.value === 'reports') {
    step.value = 'facts';
    return;
  }
  if (step.value === 'facts') {
    step.value = 'send';
    return;
  }
  const p = preview.value;
  if (!p) return;
  sending.value = true;
  try {
    // Unconfirmed: the ATA step confirms the arrival (D1); a confirmed NOA stays confirmed
    receipt.value = await auth.sendNoa(props.call.id, p.confirmed);
    if (props.page && sendWasAccepted(receipt.value)) emit('completed');
    else emit('sent');
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not send the NOA' });
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
/* What goes to NEMO (Figma 465:6999, user 2026-11-05): no heading — the
   step's name says it (user 2026-11-06); groups 24px apart, each a 12px caps label 4px over 48px rows
   between Blue/500 hairlines; the tick left, the state pill right */
.rp {
  max-width: 806px;
  color: var(--text-200);
}
.rp-heading {
  margin: 0 0 26px;
  font-size: 16px;
  font-weight: 600;
  line-height: normal;
  letter-spacing: 0.16px;
  color: var(--text-300);
}
.rp-groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.rp-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rp-group {
  padding-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-100);
}
.rp-row {
  min-height: 48px;
  padding: 6px 0;
  display: flex;
  align-items: center;
  gap: 10px;
  border-top: 1px solid var(--blue-500);
}
/* Not built in NEMOLink: a Blue/200 row, the name in SemiBold Text/100 */
.rp-row--quiet {
  min-height: 61px;
  background: var(--blue-200);
}
.rp-body {
  flex: 1 1 0;
  min-width: 0;
  padding-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rp-title {
  font-size: 14px;
  font-weight: 500;
  line-height: normal;
  letter-spacing: 0.14px;
  color: var(--text-200);
}
.rp-row--fixed .rp-title {
  font-weight: 600;
}
.rp-row--quiet .rp-title {
  font-weight: 600;
  color: var(--text-100);
}
.rp-why {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.12px;
  color: var(--text-100);
}
.rp-why--evidence {
  color: var(--blue-800);
}
/* The pill as a button: no chrome of its own, only the focus ring */
.rp-pill-btn {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  border-radius: 999px;
  display: inline-flex;
}
.tg-row .rp-pill-btn {
  /* The whole row's height taps the pill, not only the pill itself */
  align-self: stretch;
  align-items: center;
}
.rp-pill-btn:focus-visible {
  outline: 2px solid var(--blue-800);
  outline-offset: 2px;
}
.rp-note {
  margin: 0;
  padding-top: 12px;
  font-size: 12px;
  font-weight: 500;
  line-height: normal;
  letter-spacing: 0.12px;
  color: var(--text-200);
}
.rp-note b {
  font-weight: 600;
}
.wz-with.wz-with--wait {
  color: var(--nl-amber-text);
}
.wz-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 12px;
}
.wz-steps {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
}
.wz-step {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wz-step__sep {
  color: var(--nl-ink-3);
}
/* Every step's pill is the same size — 36px tall, a 24px number — only
   the colours mark the current one (user 2026-11-06) */
.wz-step__pill {
  height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 6px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--nl-line);
  font-size: 14px;
  color: var(--nl-ink-2);
  white-space: nowrap;
}
.wz-step__n {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--nl-gray-bg);
  color: var(--nl-ink-2);
}
/* The current step as Ship forms (Figma 341:5794): a Blue/300 pill 36px
   tall, no border, no animation; passed steps look like the ones ahead */
.wz-step--current .wz-step__pill {
  height: 36px;
  padding: 0 12px 0 6px;
  background: var(--blue-300);
  border-color: transparent;
  line-height: 20px;
  color: var(--nl-g-ink);
  font-weight: 600;
}
.wz-step--current .wz-step__n {
  width: 24px;
  height: 24px;
  line-height: 16px;
  background: var(--nl-g-blue);
  color: var(--nl-on-fill);
}
/* Back: an outline button on a white fill, as Ship forms */
.wz-back {
  background: var(--nl-g-white) !important;
}
.wz-muted {
  color: var(--nl-ink-3);
}
.wz-ok {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--nl-green-text);
  font-size: 14px;
}
.wz-amber {
  color: var(--nl-amber-text);
}
.wz-warn {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  font-size: 14px;
}
.wz-link {
  color: var(--nl-primary);
  font-weight: 600;
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

/* 2 · what NEMO receives: the value that goes to NEMO left, what it is
   right; one 40px row each (8px top and bottom). DOM keeps dt before dd. */
.wz-sum {
  max-width: 560px;
  margin: 0;
  font-size: 14px;
}
.wz-sum__row {
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  min-height: 40px;
  padding: 8px 0;
  border-top: 1px solid var(--nl-line-row);
}
.wz-sum__row:first-child {
  border-top: none;
}
.wz-sum dt,
.wz-sum dd {
  margin: 0;
  line-height: 24px;
}
.wz-sum dt {
  flex: none;
  color: var(--nl-ink-2);
  text-align: right;
}
.wz-sum dd {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.wz-gap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 12px;
}
.wz-more--inline {
  min-height: 32px;
  margin: 0;
}
.wz-sum--missing {
  color: var(--nl-red-text);
}
.wz-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--nl-blue);
  vertical-align: middle;
}
.wz-legend {
  margin-top: 6px;
  font-size: 12px;
  color: var(--nl-ink-3);
}
.wz-legend .wz-dot {
  margin: 0 4px 0 0;
}
.wz-with {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
  color: var(--nl-ink-2);
}
.wz-with + .wz-with {
  margin-top: 8px;
}
.wz-with b {
  color: var(--nl-ink);
}

/* Step 3 (user 2026-11-05, reference): What goes' row spacing; 16px
   SemiBold headings (line height normal); hairlines under every row */
/* Heading to list as Ship forms (20px): the row's first text sits 12px
   inside it, so 8px of margin leaves 20px between heading and label */
.rp-heading.tg-heading {
  margin-bottom: 8px;
}
.tg-rows {
  margin: 0;
}
.tg-row {
  gap: 16px;
  border-top: 0;
  border-bottom: 1px solid var(--blue-500);
}
.tg-row__body {
  gap: 4px;
  padding: 6px 0;
}
/* Mobile and tablet (user 2026-11-06): 58px rows, easy to tap, the 28px
   Add missing data button and the text centred in them */
@media (max-width: 1023px) {
  .rp-row,
  .rp-row--quiet {
    min-height: var(--nl-row-mobile-min-height);
  }
  .tg-row,
  .tg-row__body {
    padding: 0;
  }
}
.tg-row__label {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: normal;
  letter-spacing: 0.14px;
  color: var(--text-100);
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
.tg-ledger {
  margin-top: 12px;
  scroll-margin-top: 16px;
}
/* 3 · sent (green: NEMO has it) and what is next */
.wz-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 16px 8px 20px;
}
.wz-done__check {
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
.wz-done__title {
  font-size: 20px;
  font-weight: 600;
  color: var(--nl-ink);
}
.wz-done__sub {
  font-size: 14px;
  color: var(--nl-ink-2);
  margin-top: 4px;
}
.wz-next {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wz-next__title {
  font-size: 16px;
  font-weight: 600;
}
.wz-next__due {
  font-size: 14px;
  color: var(--nl-ink-2);
}
.send-raw {
  font-size: 12px;
  max-height: 320px;
  overflow: auto;
  background: var(--nl-gray-bg);
  padding: 8px;
  border-radius: 6px;
}
</style>

<style>
/* White throughout, as Ship forms (user 2026-11-04): no cards inside the
   card — each section is its heading and its rows, 28px apart. The dialog
   is teleported, hence unscoped. */
.noa-wz .dlg-section {
  background: none;
  border: 0;
  border-radius: 0;
  padding: 0;
  margin-bottom: 28px;
}
.noa-wz .dlg-section:last-child {
  margin-bottom: 0;
}
.noa-wz .dlg-section__title {
  color: var(--nl-g-ink);
}
/* Back and Next as the wizard buttons elsewhere (Figma Button/Large with
   arrow 436:6719): 18px arrows 8px from the label, the two on one line */
.noa-wz .house-dialog__footer .q-btn .q-icon {
  font-size: 18px;
}
.noa-wz .house-dialog__footer .q-btn .on-left {
  margin-right: 8px;
}
.noa-wz .house-dialog__footer .q-btn .on-right {
  margin-left: 8px;
}
.noa-wz .house-dialog__footer .wz-back {
  padding: 0 16px 0 12px;
}
.noa-wz .house-dialog__footer .house-dialog__primary:has(.on-right) {
  padding: 0 12px 0 16px;
}
/* The pill's hover pop-up (user 2026-11-05): what is missing, one per line.
   Teleported, hence unscoped. */
.rp-tip.q-tooltip {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--text-300);
  color: var(--blue-100, #fff);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0.12px;
}
.rp-tip__title {
  font-weight: 600;
  margin-bottom: 4px;
}
.rp-tip__list {
  margin: 0;
  padding-left: 16px;
}
.rp-tip__hint {
  margin-top: 6px;
  opacity: 0.8;
}
</style>
