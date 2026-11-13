<template>
  <component :is="page ? ModulePage : HouseDialog"
    :model-value="modelValue"
    :context="page ? `${call.shipName ?? 'Ship'} · ${call.portName ?? call.portLocode ?? 'Port not set'}` : undefined"
    class="nemo-wz"
    :title="page ? reportLinkLabel(step === 'vid' ? 'VID' : stepCode) : 'Send to NEMO'"
    :sheet-title="sheetTitle"
    :step-label="stepLabel"
    :sheet-main-label="sheetMainLabel"
    :ready="page && !allDetails && reportReady"
    title-style="detail"
    :help-topic="step === 'vid' ? 'call.reports' : 'ships.sendToNemo'"
    help-beside-title
    :max-width-px="874"
    full-height
    :main-label="mainLabel"
    :main-icon="mainIcon"
    :main-icon-right="mainIconRight"
    :main-disable="mainDisable"
    :main-loading="busy"
    @main="onMain"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- The steps in the band under the title, as Pre-arrival and Ship forms
         (user 2026-11-05): white throughout, passed steps look like the ones
         ahead, only the current one stands out. Ctrl+Enter walks them -->
    <template v-if="page" #tools><q-toggle v-model="allDetails" dense size="sm" label="All details" left-label class="wz-details" /></template>
    <template v-if="!page" #band>
      <div class="wz-head">
        <ol class="wz-steps" aria-label="Steps">
          <li
            v-for="s in steps"
            :key="s.key"
            class="wz-step"
            :class="`wz-step--${s.state}`"
            :aria-current="s.at ? 'step' : undefined"
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

    <!-- As Ship forms (user 2026-11-05): no Close in the footer — Close stays
         at the top right. Back to the step before; SID, SHP and CRT each go
         on their own (user 2026-11-13), so a report can also be passed by
         with Skip and come back to with Back -->
    <template #secondary>
      <div v-if="canGoBack || canSkip || canResend" class="wz-nav">
        <q-btn
          v-if="canGoBack"
          outline no-caps color="primary" icon="arrow_back" label="Back"
          class="wz-back"
          :disable="busy"
          @click="goBack"
        />
        <q-btn
          v-if="canSkip"
          outline no-caps color="primary" :label="step === 'crt' ? 'Skip and finish' : 'Skip'"
          class="wz-back"
          :disable="busy"
          @click="advance"
        />
        <!-- A report NEMO already has: Next is the main action, sending it
             again (an update) stays at hand here (user 2026-11-13) -->
        <q-btn
          v-if="canResend"
          outline no-caps color="primary" label="Send again"
          class="wz-back"
          :disable="busy"
          @click="send"
        />
      </div>
      <!-- An empty slot would bring the footer's own Close back -->
      <span v-else aria-hidden="true" />
    </template>

    <!-- 1 · the port call: the VID, then the visit id. No cards inside the
         card (user 2026-11-05): each part is its heading and its rows, the
         rows as Pre-arrival's Confirm and send — label over value between
         Blue/500 hairlines, the state pill on the right -->
    <template v-if="step === 'vid'">
      <div class="rp">
        <section class="rp-block">
          <template v-if="!visitId">
            <h3 class="rp-heading">The port call</h3>
            <p v-if="allDetails" class="rp-lead">
              NEMOLink creates the port call in NEMO — the VID — and NEMO answers with the visit
              id every other report of this call goes under.
            </p>
            <FormalityItems
              v-if="allDetails"
              code-on-hover
              :items="vidItems"
              :ship-link="shipLink"
              :show-in-nemo="false"
              @ship-changed="emit('sent')"
            />
            <div v-else class="tg-rows">
              <div class="tg-row">
                <div class="tg-row__body">
                  <div class="tg-row__label">Port call (VID)</div>
                  <div class="tg-row__value">{{ blocker ?? 'Everything the VID needs is here.' }}</div>
                </div>
                <StatusPill v-if="blocker" tone="amber" label="Data missing" />
                <StatusPill v-else tone="green" label="Ready" />
              </div>
            </div>
            <div v-if="allDetails && blocker" class="wz-warn q-mt-sm">{{ blocker }}</div>
            <!-- The times are fixed right here, in the ETA / ETD pop-up (user 2026-11-13) -->
            <div v-if="timesGap" class="rp-note">
              <a href="#" class="wz-link" @click.prevent="emit('edit-schedule')">Set the ETA and ETD</a>
              — the check updates when you save them.
            </div>
          </template>
          <!-- No In NEMO heading over the visit id (user 2026-11-07) -->
          <template v-else>
            <div class="tg-rows">
              <div class="tg-row">
                <div class="tg-row__body">
                  <div class="tg-row__label">Visit id</div>
                  <div class="tg-row__value tnum">{{ visitId }}</div>
                </div>
                <StatusPill tone="violet" icon="check" label="In NEMO" />
              </div>
            </div>
          </template>
        </section>
        <!-- What NEMO answered to the VID just now (spec 0081) -->
        <NemoResultView v-if="vidExchange" :exchanges="[vidExchange]" :expanded="allDetails" />

        <!-- The ship data that follows — checked here, before anything is
             sent, so a gap is fixed first (user rule 2026-09-25) -->
        <section v-if="!visitId" class="rp-block">
          <!-- "Ship data", no paragraph under it, on every width (user 2026-11-07) -->
          <h3 class="rp-heading">Ship data</h3>
          <div v-if="shpBlocked" class="wz-warn q-mb-sm">
            NEMO refuses the ship particulars (SHP) without the registered owner
            or the lessee (operator) name (NR-SHP-001) — the SHP would not go.
          </div>
          <div class="tg-rows">
            <div class="tg-row">
              <div class="tg-row__body">
                <div class="tg-row__label">Ship data</div>
                <div class="tg-row__value">
                  {{ shipGaps.length > 0 ? `Missing: ${shipGaps.join(', ')}` : 'The ship data Finland requires is complete.' }}
                </div>
              </div>
              <StatusPill v-if="shipGaps.length > 0 || shpBlocked" tone="amber" label="Data missing" />
              <StatusPill v-else tone="green" label="Ready" />
            </div>
            <div v-if="certGaps.length > 0 || certsGoing.length > 0 || preview" class="tg-row">
              <div class="tg-row__body">
                <div class="tg-row__label">Certificates</div>
                <div v-if="certGaps.length > 0" class="tg-row__value">
                  <div v-for="g in certGaps" :key="g.certKey">{{ g.words }}</div>
                </div>
                <div v-else-if="certsGoing.length > 0" class="tg-row__value">{{ certsGoing.join(', ') }}</div>
                <div v-else class="tg-row__value">No certificates on file — add them in the ship data.</div>
              </div>
              <StatusPill v-if="certGaps.length > 0 || certsGoing.length === 0" tone="amber" label="Data missing" />
              <StatusPill v-else tone="green" label="Ready" />
            </div>
          </div>
          <!-- Missing basic data typed right here (user 2026-11-13), saved to the ship data / organisation -->
          <ShipDataFill
            :call="call"
            :declarant-missing="!!preview && !preview.declarant"
            :editable="!reviewOnly"
            @saved="onFilled"
          />
          <div v-if="(shipGaps.length > 0 || shpBlocked || certGaps.length > 0) && shipLink" class="rp-note">
            <a :href="shipLink" class="wz-link" @click.prevent="editShip">Edit the ship data</a>
            — every field, certificates and files; it opens right here, and this check updates when you close it.
          </div>
        </section>
      </div>
    </template>

    <!-- 2–4 · SID, SHP and CRT, one report per step, each sent on its own
         (user 2026-11-13): what goes, then NEMO's answer -->
    <template v-else>
      <div v-if="loadingPreview && !preview" class="row justify-center q-pa-lg">
        <q-spinner color="primary" size="32px" />
      </div>
      <div v-else-if="previewError" class="wz-warn">{{ previewError }}</div>

      <!-- As Pre-arrival's This goes to NEMO (user 2026-11-07): label over
           value between Blue/500 hairlines, Ready or Data missing right -->
      <div v-else-if="preview && !stepReceipt" class="rp rp--ship-reports">
        <section class="rp-block">
          <div v-if="!preview.declarant" class="wz-warn q-mb-sm">
            Set the EORI in NEMO declarant details first — it names your organisation on every
            report.
          </div>
          <div v-if="step === 'shp' && shpBlocked" class="wz-warn q-mb-sm">
            NEMO refuses the ship particulars (SHP) without the registered owner
            or the lessee (operator) name (NR-SHP-001) — the SHP would not go.
          </div>
          <h3 class="rp-overview-heading">Overview</h3>
          <dl class="tg-rows tg-rows--reports">
            <ReportListRow v-for="fm in stepFormalities" :key="fm.type + (fm.certKey ?? '')" :simple="reportIsSimple(fm)">
                <dt class="tg-row__label">{{ reportTitle(fm) }}</dt>
                <!-- No "Goes now" nor the ice-class line (user 2026-11-07): Ready says it -->
                <dd v-if="fm.willSend && fm.previously?.formalityId" class="tg-row__value">
                  Updates the report sent {{ fmtStamp(fm.previously.sentAt) }}
                </dd>
                <dd v-if="!fm.willSend && fm.reason" class="tg-row__value">Not sent: {{ fm.reason }}</dd>
                <dd v-if="fm.problems.length" class="tg-row__value">
                  <ul class="send-problems">
                    <li v-for="(p, i) in fm.problems" :key="i" class="tnum">{{ p.pointer || '/' }} — {{ p.message }}</li>
                  </ul>
                </dd>
              <template #status>
                <StatusPill v-if="fm.willSend" tone="green" label="Ready" />
                <StatusPill v-else-if="fm.previously?.accepted && !fm.gaps?.length && !fm.problems.length" tone="violet" icon="check" label="In NEMO" />
                <StatusPill v-else-if="fm.gaps?.length || fm.problems.length" tone="amber" label="Data missing" />
                <StatusPill v-else tone="gray" label="Not sent" />
              </template>
            </ReportListRow>
            <!-- A step with no report of its own: the CRT with no certificate on file -->
            <ReportListRow v-if="stepFormalities.length === 0">
              <dt class="tg-row__label">{{ STEP_TITLES[step] }}</dt>
              <dd class="tg-row__value">
                {{ step === 'crt' ? 'No certificates on file — add them in the ship data.' : 'Nothing to send.' }}
              </dd>
              <template #status><StatusPill tone="amber" label="Data missing" /></template>
            </ReportListRow>
          </dl>
          <!-- The ship's own gaps for this report, fixed in the ship data -->
          <div v-if="stepShipGaps.length > 0" class="wz-warn q-mt-sm">Missing in the ship data: {{ stepShipGaps.join(', ') }}</div>
          <!-- …typed right here (user 2026-11-13): this report's ship fields, and the EORI -->
          <ShipDataFill
            :call="call"
            :codes="step === 'crt' ? [] : [stepCode]"
            :declarant-missing="!preview.declarant"
            :editable="!reviewOnly"
            @saved="onFilled"
          />
          <div v-if="(stepShipGaps.length > 0 || (step === 'shp' && shpBlocked) || (step === 'crt' && (certGaps.length > 0 || stepFormalities.length === 0))) && shipLink" class="rp-note">
            <a :href="shipLink" class="wz-link" @click.prevent="editShip">Edit the ship data</a>
            — it opens right here, and this check updates when you close it.
          </div>
        </section>

        <!-- All details: the declarant, every field (the list table), the raw JSON -->
        <section v-if="allDetails" class="rp-block">
          <h3 class="rp-heading">All fields</h3>
          <!-- The policy and the sender behind Read more (user 2026-11-07) -->
          <button
            type="button"
            class="st-more"
            :aria-expanded="policyOpen"
            @click="policyOpen = !policyOpen"
          >
            {{ policyOpen ? 'Read less' : 'Read more' }}
          </button>
          <p v-if="policyOpen" class="rp-lead st-lead">
            {{ preview.policy }}<template v-if="preview.declarant">
              Sent by {{ preview.declarant.name ?? preview.declarant.id }}
              <span class="tnum">({{ preview.declarant.id }}, role {{ preview.declarant.roleCode }})</span>
              — {{ preview.declarantNote }}.</template
            >
          </p>
          <!-- As the NOD list table (user 2026-11-07): Report before NEMO ID -->
          <div v-if="stepFields.length > 0" class="st" role="table" aria-label="Fields that go to NEMO">
            <div class="st-row st-head" role="row">
              <span role="columnheader">Field</span>
              <span role="columnheader">Value</span>
              <span role="columnheader">Report</span>
              <span role="columnheader">NEMO ID</span>
            </div>
            <div v-for="f in stepFields" :key="f.key" class="st-row" :class="{ 'st-row--kept': !f.sent }" role="row">
              <span class="st-cell st-label" role="cell">{{ labels[f.key] ?? FALLBACK_LABELS[f.key] ?? f.key }}</span>
              <span class="st-cell prov-lane st-value" role="cell"><span class="tnum prov-value">{{ fmtValue(f) }}</span></span>
              <span class="st-cell" role="cell">{{ reportWords(f) }}</span>
              <span class="st-cell tnum st-code" role="cell">{{ f.de }}</span>
            </div>
          </div>
          <template v-for="fm in stepFormalities" :key="`raw-${fm.type}-${fm.certKey ?? ''}`">
            <q-expansion-item
              v-if="fm.envelope"
              dense
              dense-toggle
              expand-icon-class="text-grey-6"
              :label="`Raw JSON — ${fm.type === 'CRT' ? certWords({ ...fm, files: [] }) : fm.type}`"
              header-class="send-raw-head"
              class="q-mt-sm"
            >
              <pre class="send-raw">{{ pretty(fm.envelope) }}</pre>
            </q-expansion-item>
          </template>
        </section>
        <div v-if="reviewOnly" class="wz-warn">{{ PLATFORM_ADMIN_SEND_WORDS }}</div>
      </div>

      <template v-else-if="stepReceipt">
        <!-- NEMO's answer to this step's report, its dropdowns closed (user 2026-11-07) -->
        <NemoResultView :exchanges="stepReceipt.results.map((r) => r.exchange)" :expanded="false" />
        <div v-if="step === 'crt' && nextReport && stepReceipt.results.every((r) => r.accepted)" class="dlg-section q-mt-md">
          <div class="dlg-section__title">Next for this call</div>
          <div class="text-body2">
            <b>{{ nextReport.code }}</b> — {{ nextReport.title }}<template v-if="dueLine(nextReport)">.
              {{ dueLine(nextReport) }}</template
            >
          </div>
        </div>
      </template>
    </template>
  </component>
</template>

<script setup lang="ts">
import { useAllDetails } from '../composables/useAllDetails';
/**
 * The NEMO wizard (spec 0079): one dialog walks a port call through NEMO's
 * order — 1 the port call (the VID, spec 0075), then the ship data one
 * report at a time (user 2026-11-13): 2 SID, 3 SHP, 4 CRT, each sent on its
 * own with Back and Skip between them; only after the CRT does the port
 * call page come back. Before anything is sent it flags what is missing or
 * wrong — a send never goes with a gap. The plain view shows only the
 * outcome and what needs attention; "All details" reveals every field, the
 * declarant, the policy and the raw JSON (user rules 2026-09-25). The sends
 * are `POST /portcalls/:id/nemo-create` and `POST /ships/:id/nemo-send`
 * with the step's report; every exchange lands on the call's chain (spec 0078).
 */
import { computed, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import {
  useAuth,
  type Obligation,
  NemoExchangeError,
  type NemoExchange,
  type PortCall,
  type ShipNemoPreview,
  type ShipNemoReceipt,
} from '../auth/auth';
import { iceClassName } from '../generated/ice-classes';
import FormalityItems from './FormalityItems.vue';
import { certificateName } from '../generated/certificate-types';
import { openShipEditor } from '../lib/ship-editor';
import NemoResultView from './NemoResultView.vue';
import HouseDialog from './HouseDialog.vue';
import ModulePage from './ModulePage.vue';
import ReportListRow from './ReportListRow.vue';
import ShipDataFill from './ShipDataFill.vue';
import { sendWasAccepted } from '../lib/port-call-sections';
import { reportLinkLabel } from '../lib/port-call-process';
import StatusPill from './StatusPill.vue';
import { PLATFORM_ADMIN_SEND_WORDS, dueLine } from '../lib/obligations';
import { fmtStamp } from '../lib/time';

type StepKey = 'vid' | 'sid' | 'shp' | 'crt';
type ShipStep = Exclude<StepKey, 'vid'>;
type Formality = ShipNemoPreview['formalities'][number];

const props = withDefaults(
  defineProps<{
    modelValue: boolean; page?: boolean;
    call: PortCall;
    /** Where to open: the VID chip starts at 1, the SID, SHP and CRT chips at the ship data. */
    startAt?: 'vid' | 'ship';
    /** The ship-data report that opened the page: its own step (SID, SHP or CRT). */
    shipReportCode?: string;
  }>(),
  { startAt: 'vid' },
);
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  /** Something reached NEMO — the list reloads. */
  (e: 'sent'): void;
  (e: 'completed', step: 'vid' | 'ship'): void;
  /** Add missing data on the port call's own gaps: the call's edit form. */
  (e: 'edit-call'): void;
  /** The ETA or ETD is missing or wrong: the ETA / ETD pop-up. */
  (e: 'edit-schedule'): void;
}>();

const $q = useQuasar();
const auth = useAuth();

const FORMALITY_WORDS: Record<string, string> = {
  SID: 'ship identity',
  SHP: 'ship particulars',
};
/** Labels the checklists do not carry. */
const FALLBACK_LABELS: Record<string, string> = { imoNumber: 'IMO number' };

const step = ref<StepKey>('vid');
const visitId = ref<string | null>(null);
const creating = ref(false);
const loadingPreview = ref(false);
const previewError = ref<string | null>(null);
const sending = ref(false);
const preview = ref<ShipNemoPreview | null>(null);
/** NEMO's answer per ship-data step, sent in this dialog. */
const receipts = reactive<Record<ShipStep, ShipNemoReceipt | null>>({ sid: null, shp: null, crt: null });
/** NEMO's answer to the VID made in this dialog (spec 0081). */
const vidExchange = ref<NemoExchange | null>(null);
/** The policy text, folded behind Read more. */
const policyOpen = ref(false);

const { allDetails, autoDetails } = useAllDetails();

/** Every open starts afresh — also the first, when the dialog mounts open. */
watch(
  () => props.modelValue,
  (open) => {
    if (open) start();
  },
  { immediate: true },
);

function start(): void {
  visitId.value = props.call.visitId;
  preview.value = null;
  previewError.value = null;
  receipts.sid = null;
  receipts.shp = null;
  receipts.crt = null;
  vidExchange.value = null;
  policyOpen.value = false;
  const code = (props.shipReportCode ?? 'SID').toLowerCase();
  const shipStep: ShipStep = code === 'shp' || code === 'crt' ? code : 'sid';
  step.value = props.startAt === 'ship' && visitId.value ? shipStep : 'vid';
  // The ship steps show it; step 1 checks the certificates with it (spec 0084)
  void loadPreview();
}

function obligation(code: string): Obligation | null {
  return props.call.obligations.find((o) => o.code === code) ?? null;
}

// ---- the steps ---------------------------------------------------------------

/* Four steps, each its own send (user 2026-11-13): the port call, then the
   three ship-data reports one by one. */
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'vid', label: 'Port call (VID)' },
  { key: 'sid', label: 'SID' },
  { key: 'shp', label: 'SHP' },
  { key: 'crt', label: 'CRT' },
];
/** What the step is called where there is room for a sentence, not a code. */
const STEP_TITLES: Record<StepKey, string> = {
  vid: 'Port call (VID)',
  sid: 'Ship identity (SID)',
  shp: 'Ship particulars (SHP)',
  crt: 'Certificates (CRT)',
};

const position = computed(() => STEPS.findIndex((s) => s.key === step.value));
const steps = computed(() =>
  STEPS.map((s, i) => {
    const state = i === position.value ? 'current' : i < position.value ? 'done' : 'todo';
    return { ...s, n: i + 1, done: state === 'done', state, at: state === 'current' };
  }),
);
/** SID, SHP or CRT — the report this step sends. */
const stepCode = computed(() => step.value.toUpperCase() as 'SID' | 'SHP' | 'CRT');

// ---- 1 · the port call (VID) ---------------------------------------------------

/** The VID's lines — empty when an older server sends no items. */
const vidItems = computed(() => obligation('VID')?.items ?? []);

/** Where ship rows are edited: the ship dialog's five columns (admins). */
const shipLink = computed(() =>
  auth.isAdmin.value && props.call.shipId ? `/admin/ships?ship=${props.call.shipId}` : null,
);

/** The call's own gaps in the VID, by NEMO element: the words for each. */
const CALL_NEEDS: Record<string, string> = {
  'DE-014-04': 'a port',
  'DE-022-02': 'an ETA',
  'DE-022-05': 'an ETD',
};
/** The ETA or ETD is missing or wrong: the VID cannot go yet. */
const timesGap = computed(
  () => !visitId.value && vidItems.value.some((i) => !i.ok && (i.de === 'DE-022-02' || i.de === 'DE-022-05')),
);

/** What the server requires before it asks NEMO (spec 0070 createInNemo). */
const blocker = computed(() => {
  const need = (de: string) => vidItems.value.find((i) => i.de === de && !i.ok);
  // Invariant 4 (spec 0076): sending is an org-member act
  if (auth.user.value?.platformAdmin) return PLATFORM_ADMIN_SEND_WORDS;
  if (!props.call.shipId) return 'The port call has no ship.';
  if (need('DE-005-03')) return 'The ship needs an IMO number before NEMO can identify it.';
  // A time that is there but wrong says what is wrong (user 2026-11-13)
  const wrong = vidItems.value.find((i) => !i.ok && i.problem);
  if (wrong?.problem) return `${wrong.problem}.`;
  const gaps = Object.keys(CALL_NEEDS).filter((de) => need(de)).map((de) => CALL_NEEDS[de]!);
  if (gaps.length > 0) {
    const words = gaps.length > 1 ? `${gaps.slice(0, -1).join(', ')} and ${gaps[gaps.length - 1]}` : gaps[0];
    return `The port call needs ${words}.`;
  }
  return null;
});

/** The required ship fields a report would carry but cannot: its checklist's own missing lines. */
function gapsOf(codes: readonly string[]): string[] {
  const out: string[] = [];
  const shp = obligation('SHP')?.items ?? [];
  const has = (key: string) => shp.some((i) => i.shipKey === key && i.ok);
  // Owner and lessee are one requirement (either, NR-SHP-001)
  const partyOk = has('ownerName') || has('operatorName');
  for (const code of codes) {
    for (const i of obligation(code)?.items ?? []) {
      if (i.ok) continue;
      if (code === 'NOA' && i.from !== 'ship') continue;
      if (partyOk && (i.shipKey === 'ownerName' || i.shipKey === 'operatorName')) continue;
      const words = i.de ? `${i.label} (${i.de})` : i.label;
      if (!out.includes(words)) out.push(words);
    }
  }
  return out;
}
/** Step 1's check of all the ship data — and the NOA's ship items (spec 0088 amendment). */
const shipGaps = computed(() => gapsOf(['SID', 'SHP', 'NOA']));
/** This step's own ship gaps. */
const stepShipGaps = computed(() => (step.value === 'sid' || step.value === 'shp' ? gapsOf([stepCode.value]) : []));

/** Neither owner nor lessee: NEMO refuses the SHP (NR-SHP-001). */
const shpBlocked = computed(() => {
  const shp = obligation('SHP')?.items ?? [];
  const has = (key: string) => shp.some((i) => i.shipKey === key && i.ok);
  return shp.length > 0 && !has('ownerName') && !has('operatorName');
});

async function create(): Promise<void> {
  creating.value = true;
  try {
    vidExchange.value = null;
    const out = await auth.createPortCallInNemo(props.call.id);
    visitId.value = out.visitId;
    vidExchange.value = out.exchange;
    if (props.page && out.visitId && out.exchange.outcome === 'success') emit('completed', 'vid');
    else emit('sent');
    // The ship-data reports can be built now that the visit id is there
    if (out.visitId) void loadPreview({ quiet: true });
  } catch (e) {
    // NEMO's answer — or its absence — in the result viewer (spec 0081)
    if (e instanceof NemoExchangeError && e.exchange) vidExchange.value = e.exchange;
    else $q.notify({ type: 'negative', message: (e as Error).message, timeout: 12000 });
  } finally {
    creating.value = false;
  }
}

// ---- 2–4 · SID, SHP, CRT — one at a time ------------------------------------------

/** The ship rows' own words, from the reports that carry them. */
const labels = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {};
  for (const o of props.call.obligations) {
    for (const i of o.items ?? []) if (i.shipKey) out[i.shipKey] = i.label;
  }
  return out;
});

/** This step's reports: the SID, the SHP, or every certificate's CRT. */
const stepFormalities = computed<Formality[]>(() =>
  step.value === 'vid' ? [] : (preview.value?.formalities ?? []).filter((f) => f.type === stepCode.value),
);
/** The fields this step's report carries (the CRTs carry certificates, not fields). */
const stepFields = computed(() =>
  step.value === 'sid' || step.value === 'shp' ? (preview.value?.fields ?? []).filter((f) => f.formality === stepCode.value) : [],
);
const stepReceipt = computed(() => (step.value === 'vid' ? null : receipts[step.value]));

const formalityClean = (f: Formality): boolean =>
  !f.gaps?.length && !f.problems.length && (f.willSend || !!f.previously?.accepted);

const reportReady = computed(() => {
  const p = preview.value;
  if (!p?.declarant || loadingPreview.value || previewError.value) return false;
  if (step.value === 'vid') {
    if (blocker.value || shipGaps.value.length || shpBlocked.value || visitId.value) return false;
    return p.formalities.length > 0 && p.formalities.every(formalityClean);
  }
  if (stepReceipt.value || stepShipGaps.value.length || (step.value === 'shp' && shpBlocked.value)) return false;
  return stepFormalities.value.length > 0 && stepFormalities.value.every(formalityClean);
});

autoDetails(() => {
  if (previewError.value) return true;
  if (loadingPreview.value || !preview.value || stepReceipt.value) return null;
  return !reportReady.value;
});


/** Invariant 4 (spec 0076): an acting platform admin reviews, never sends. */
const reviewOnly = computed(() => auth.user.value?.platformAdmin === true);
/**
 * This step's report can go: nothing missing or wrong in it (user
 * 2026-11-13) — the server says so per report, and the ship's own gaps
 * for it stop it too.
 */
const canSend = computed(
  () =>
    !reviewOnly.value &&
    !previewError.value &&
    !stepShipGaps.value.length &&
    !(step.value === 'shp' && shpBlocked.value) &&
    // A Data missing pill on any report of the step stops it (user 2026-11-13)
    !stepFormalities.value.some((f) => !f.willSend && (f.gaps?.length || f.problems.length)) &&
    stepFormalities.value.some((f) => f.willSend),
);

/** Step 1's Data missing pills (port call, ship data, certificates): any of them stops the VID (user 2026-11-13). */
const vidDataMissing = computed(
  () =>
    !!blocker.value ||
    shipGaps.value.length > 0 ||
    shpBlocked.value ||
    (!!preview.value && (certGaps.value.length > 0 || certsGoing.value.length === 0)),
);

async function loadPreview(opts: { quiet?: boolean } = {}): Promise<void> {
  if (!props.call.shipId) {
    previewError.value = 'The port call has no ship.';
    return;
  }
  // Quiet: after a send the page keeps NEMO's answer in view while it reloads
  if (!opts.quiet) loadingPreview.value = true;
  previewError.value = null;
  try {
    preview.value = await auth.shipNemoPreview(props.call.shipId, props.call.id);
  } catch (e) {
    previewError.value = (e as Error).message;
  } finally {
    loadingPreview.value = false;
  }
}

async function send(): Promise<void> {
  if (!props.call.shipId || step.value === 'vid') return;
  const at = step.value;
  sending.value = true;
  try {
    receipts[at] = await auth.sendShipToNemo(props.call.shipId, props.call.id, [stepCode.value]);
    emit('sent');
    void loadPreview({ quiet: true });
  } catch (e) {
    $q.notify({ type: 'negative', message: (e as Error).message, timeout: 12000 });
  } finally {
    sending.value = false;
  }
}

/** A report's row title: "Ship identity (SID)", or the certificate. */
function reportTitle(fm: Formality): string {
  if (fm.type === 'CRT') return `${certWords(fm)} (CRT)`;
  const w = FORMALITY_WORDS[fm.type] ?? fm.type;
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} (${fm.type})`;
}

function reportIsSimple(fm: Formality): boolean {
  return !fm.problems.length && !fm.gaps?.length && (fm.willSend ? !fm.previously?.formalityId : !fm.reason);
}

/** A CRT in words: which certificate and how many files (spec 0084). */
function certWords(fm: Formality): string {
  const type = fm.certKey?.split(':')[0] ?? '';
  const number = fm.certKey?.split(':').slice(1).join(':') ?? '';
  const files = fm.files?.length ? ` · ${fm.files.length} file${fm.files.length === 1 ? '' : 's'}` : '';
  return `${certificateName(type)}${number ? ` ${number}` : ''}${files}`;
}

/** Certificates that cannot go and why (spec 0084) — from the preview. */
const certGaps = computed(() =>
  (preview.value?.formalities ?? [])
    .filter((f) => f.type === 'CRT' && (f.gaps?.length ?? 0) > 0)
    .map((f) => ({ certKey: f.certKey ?? '', words: `${certWords({ ...f, files: [] })}: missing ${f.gaps!.join(', ')}` })),
);
/** Certificates with nothing missing (they go once the call is in NEMO). */
const certsGoing = computed(() =>
  (preview.value?.formalities ?? [])
    .filter((f) => f.type === 'CRT' && (f.gaps?.length ?? 0) === 0 && !/newer .* certificate goes instead/.test(f.reason ?? ''))
    .map((f) => f.certKey?.split(':')[0] ?? ''),
);

/**
 * The ship dialog, in place (spec 0085): opens over the wizard; when it
 * closes after a change, the call and the check reload.
 */
/** A missing field typed into the list was saved: the call and the check reload. */
async function onFilled(): Promise<void> {
  emit('sent');
  await loadPreview({ quiet: true });
}

async function editShip(): Promise<void> {
  if (!props.call.shipId) return;
  if (await openShipEditor(props.call.shipId)) {
    emit('sent');
    await loadPreview();
  }
}

/** After the ship data: the first report of the flow still to go. */
const nextReport = computed(
  () =>
    props.call.obligations.find(
      (o) => o.group !== 'ship' && o.code !== 'VID' && o.state !== 'sent',
    ) ?? null,
);

// ---- the footer: Back, Skip, and one main action per step ----------------------

const busy = computed(() => creating.value || sending.value || loadingPreview.value);

/** Back to the step before: from SID to the port call, from SHP to SID, from CRT to SHP. */
const canGoBack = computed(() => position.value > 0);
function goBack(): void {
  if (!canGoBack.value || busy.value) return;
  step.value = STEPS[position.value - 1]!.key;
}

/** Skip: on past a report that could go but is not sent now — Back returns to it. */
const canSkip = computed(() => step.value !== 'vid' && !stepReceipt.value && canSend.value && !alreadyInNemo.value);

/**
 * Looking at a report NEMO already has (user 2026-11-13): every report of
 * this step that would go was accepted before, so the main action is Next
 * (Done after the CRT), not Send to NEMO. Send again stays beside Back.
 */
const alreadyInNemo = computed(() => {
  const going = stepFormalities.value.filter((f) => f.willSend);
  return going.length > 0 && going.every((f) => !!f.previously?.accepted);
});
const canResend = computed(() => step.value !== 'vid' && !stepReceipt.value && canSend.value && alreadyInNemo.value);

/** On to the next step; after the CRT the port call page comes back. */
function advance(): void {
  if (busy.value) return;
  if (step.value === 'vid') {
    step.value = 'sid';
    return;
  }
  if (step.value !== 'crt') {
    step.value = STEPS[position.value + 1]!.key;
    return;
  }
  finish();
}

/**
 * The end of the ship data (user 2026-11-13): SID, SHP and CRT have each had
 * their step, and only now does the port call page come back. On the page
 * an accepted send says so there; otherwise the page simply returns.
 */
function finish(): void {
  const sent = Object.values(receipts).filter((r): r is ShipNemoReceipt => !!r);
  if (props.page && sent.length > 0 && sent.every(sendWasAccepted)) emit('completed', 'ship');
  else emit('update:modelValue', false);
}

const mainLabel = computed(() => {
  if (step.value === 'vid') return visitId.value ? 'Next' : 'Send to NEMO';
  if (stepReceipt.value || !canSend.value || alreadyInNemo.value) return step.value === 'crt' ? 'Done' : 'Next';
  return 'Send to NEMO';
});
const sendsNow = computed(() => mainLabel.value === 'Send to NEMO');
const mainIcon = computed(() => (sendsNow.value ? 'send' : mainLabel.value === 'Done' ? 'check' : undefined));
const mainIconRight = computed(() => (mainLabel.value === 'Next' ? 'arrow_forward' : undefined));

/** The phone has no band: the step names the title, its number the action bar,
    and the send button is bare — the title already says where it goes. */
const sheetTitle = computed(() => STEP_TITLES[step.value]);
const stepLabel = computed(() => `${position.value + 1} of ${STEPS.length}`);
const sheetMainLabel = computed(() => (sendsNow.value ? 'Send' : undefined));

const mainDisable = computed(() => {
  if (step.value === 'vid') return visitId.value ? false : vidDataMissing.value;
  return false;
});

async function onMain(): Promise<void> {
  if (step.value === 'vid') {
    if (visitId.value) advance();
    else await create();
    return;
  }
  if (sendsNow.value) await send();
  else advance();
}

// ---- words -------------------------------------------------------------------

function reportWords(f: ShipNemoPreview['fields'][number]): string {
  if (f.sent) return f.formality;
  if (f.formality === 'NOA') return 'with NOA / NOD';
  return `${f.formality} · stays here`;
}

function fmtValue(f: ShipNemoPreview['fields'][number]): string {
  const v = f.value;
  if (v && typeof v === 'object' && 'code' in v) {
    const code = String((v as { code: string }).code);
    return `${iceClassName(code)} (${code})`;
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v === null || v === undefined ? '—' : String(v);
}

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2);
}
</script>

<style scoped>
/* Back and Skip side by side on the left of the footer */
.wz-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
/* The head in the band, as Pre-arrival: the step strip left, All details right */
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
  font-variant-numeric: tabular-nums;
  background: var(--nl-gray-bg);
  color: var(--nl-ink-2);
}
/* The current step as Ship forms and Pre-arrival (Figma 341:5794): a
   Blue/300 pill 36px tall, no border, no animation; passed steps look like
   the ones ahead */
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

/* The parts on white, as Pre-arrival's This goes to NEMO (user 2026-11-07):
   a 16px SemiBold heading, 24px between parts; rows as its Confirm and send */
.rp {
  max-width: 806px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  color: var(--text-200);
}
.rp-block {
  display: flex;
  flex-direction: column;
}
.rp--ship-reports { gap: 40px; }
.rp-overview-heading { display: flex; align-items: center; min-height: 56px; margin: 0; color: var(--text-300); font-size: 18px; font-weight: 600; line-height: 24px; letter-spacing: 0.18px; }
.tg-rows--reports { padding-block-end: 14px; }
/* Heading to rows 20px, as Ship forms: the row's first text sits 12px
   inside it */
.rp-heading {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  line-height: normal;
  letter-spacing: 0.16px;
  color: var(--text-300);
}
.rp-lead {
  margin: 4px 0 16px;
  font-size: 14px;
  font-weight: 500;
  line-height: normal;
  letter-spacing: 0.14px;
  color: var(--text-100);
}
.rp-note {
  margin: 0;
  padding-top: 12px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.12px;
  color: var(--text-200);
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
/* Page 3's report rows: the headline Medium Text/200 (user 2026-11-07) */
.tg-rows--reports .tg-row__label {
  font-weight: 500;
  color: var(--text-200);
}
/* 24px from the text above to the field table (user 2026-11-07) */
.st-lead {
  margin: 8px 0 24px;
}
/* Read more: underlined Medium link-button, then 24px to the table */
.st-more {
  align-self: flex-start;
  margin: 0 0 24px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.14px;
  color: var(--text-200);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.st-more:focus-visible {
  outline: 2px solid var(--blue-800);
  outline-offset: 2px;
  border-radius: 4px;
}
.st-more[aria-expanded='true'] {
  margin-bottom: 0;
}
/* Mobile and tablet (user 2026-11-06): 58px rows, easy to tap, the 28px
   Add missing data button and the text centred in them */
@media (max-width: 1023px) {
  .tg-row {
    min-height: var(--nl-row-mobile-min-height);
  }
  .tg-row,
  .tg-row__body {
    padding: 0;
  }
}
.tg-row__label {
  font-size: 14px;
  font-weight: 600;
  line-height: normal;
  letter-spacing: 0.14px;
  /* The row's headline in Text/300, its body in Text/200 (user 2026-11-07) */
  color: var(--text-300);
}
.tg-row__value {
  font-size: 14px;
  font-weight: 500;
  line-height: normal;
  letter-spacing: 0.14px;
  color: var(--text-200);
  overflow-wrap: anywhere;
}

.wz-muted {
  color: var(--nl-ink-2);
}
.wz-amber {
  color: var(--nl-amber-text);
}
.wz-ok {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--nl-green-text);
}
.wz-warn {
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
}
.wz-link {
  color: var(--nl-primary);
  font-weight: 600;
}

/* The fields as the NOD list table (Figma 500:7424, user 2026-11-07):
   Field 278 · Value in its Blue/150 box 258 · Report · NEMO ID; 12px gaps,
   rows at least 48px between dashed Blue/700 lines, text centred in the
   cell, column heads 12px SemiBold caps */
.tg-rows,
.tg-row__label,
.tg-row__value {
  margin: 0;
}
.st {
  font-size: 14px;
}
.st-row {
  display: grid;
  grid-template-columns: 278px 258px minmax(0, 1fr) auto;
  gap: 12px;
  padding: 6px 0 5px;
  align-items: stretch;
  border-bottom: 1px dashed var(--blue-700);
}
.st-row:not(.st-head) {
  min-height: 48px;
}
.st-head {
  padding-top: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.72px;
  text-transform: uppercase;
  color: var(--text-100);
}
.st-cell {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 500;
  color: var(--text-200);
}
.st-label {
  color: var(--text-300);
}
.st-value.prov-lane {
  margin: 0;
  padding: 6px 8px 6px 10px;
  min-height: 37px;
}
.st-value .prov-value {
  font-weight: 600;
  color: var(--text-200);
}
.st-code {
  color: var(--text-100);
}
/* A field that stays here: quieter words, no box colour change */
.st-row--kept .st-cell {
  color: var(--text-100);
}
/* Tablet: the columns share the width */
@media (max-width: 1023px) {
  .st-row {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1fr) auto;
  }
}
/* Phone: each field its name, the value box, then report and NEMO ID */
@media (max-width: 599.98px) {
  .st-head {
    display: none;
  }
  .st-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--blue-500);
  }
  .st-label {
    grid-column: 1 / -1;
    font-weight: 600;
  }
  .st-value.prov-lane {
    grid-column: 1 / -1;
  }
}
.send-problems {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 14px;
  color: var(--nl-red-text);
}
.send-raw {
  font-size: 12px;
  line-height: 1.4;
  margin: 0;
  padding: 8px;
  background: var(--nl-gray-bg);
  border-radius: 6px;
  max-height: 320px;
  overflow: auto;
}
.send-meta {
  font-size: 12px;
  color: var(--nl-ink-3);
}
</style>

<style>
/* White throughout, as Pre-arrival and Ship forms (user 2026-11-05): no
   cards inside the card on the ship step either — each part is its heading
   and its rows, 28px apart. The dialog is teleported, hence unscoped. */
.nemo-wz .dlg-section {
  background: none;
  border: 0;
  border-radius: 0;
  padding: 0;
  margin-bottom: 28px;
}
.nemo-wz .dlg-section:last-child {
  margin-bottom: 0;
}
/* Back as the wizard buttons elsewhere (Figma Button/Large with arrow
   436:6719): an 18px arrow 8px from the label, on a white fill */
.nemo-wz .house-dialog__footer .wz-back {
  padding: 0 16px 0 12px;
  background: var(--nl-g-white) !important;
}
.nemo-wz .house-dialog__footer .wz-back .q-icon {
  font-size: 18px;
}
.nemo-wz .house-dialog__footer .wz-back .on-left {
  margin-right: 8px;
}
.nemo-wz .dlg-section__title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.16px;
  color: var(--nl-g-ink);
}
</style>
