<template>
  <!-- The result viewer (spec 0081): one card per exchange with NEMO — the
       outcome, the visit id always, NEMO's answer in plain words, the raw
       request and response, and the way to NEMOLink support -->
  <div class="nr">
    <div v-for="(x, i) in exchanges" :key="i" class="nr-card" :class="`nr-card--${x.outcome}`">
      <div class="row items-center no-wrap q-gutter-x-sm">
        <StatusPill :tone="TONES[x.outcome]" :icon="ICONS[x.outcome]" :label="WORDS[x.outcome]" />
        <b>{{ x.operation }}</b>
        <q-space />
        <span class="nr-visit tnum">
          {{ x.visitId ? `Visit id ${x.visitId}` : 'No visit id yet' }}
        </span>
      </div>
      <div class="nr-headline">{{ x.headline }}</div>
      <div v-if="x.explanation" class="nr-explanation">{{ x.explanation }}</div>
      <ul v-if="x.errors.length" class="nr-errors">
        <li v-for="(e, j) in x.errors" :key="j">
          <span v-if="e.code" class="tnum">{{ e.code }}</span> {{ e.message ?? '' }}
          <span v-if="e.path" class="nr-meta tnum">{{ e.path }}</span>
        </li>
      </ul>
      <div class="nr-meta q-mt-xs">
        NEMO answered {{ statusWords(x.httpStatus) }}<template v-if="x.frmStatus">
          · acknowledgement status {{ x.frmStatus }} ({{ x.frmStatus === '1' ? 'accepted' : 'rejected' }})</template
        >
        · {{ fmtStamp(x.at) }}
      </div>
      <!-- NEMO's copy, read back after the send (spec 0089) -->
      <div v-if="x.readBack" class="nr-readback" :class="`nr-readback--${x.readBack.state}`">
        <q-icon :name="x.readBack.state === 'same' ? 'verified' : x.readBack.state === 'differs' ? 'error_outline' : 'help_outline'" size="16px" />
        <span>{{ READ_BACK_WORDS[x.readBack.state] }}</span>
        <ul v-if="x.readBack.differences.length" class="nr-errors">
          <li v-for="(d, j) in x.readBack.differences.slice(0, 10)" :key="j" class="tnum">
            {{ d.path }}: sent {{ JSON.stringify(d.sent) }}, NEMO holds {{ d.held === null ? 'nothing' : JSON.stringify(d.held) }}
          </li>
        </ul>
      </div>
      <q-expansion-item
        dense
        dense-toggle
        expand-icon-class="text-grey-6"
        label="Raw request"
        header-class="nr-raw-head"
        :default-opened="expanded"
      >
        <pre class="nr-raw">{{ pretty(x.request) }}</pre>
      </q-expansion-item>
      <q-expansion-item
        dense
        dense-toggle
        expand-icon-class="text-grey-6"
        label="Raw response"
        header-class="nr-raw-head"
        :default-opened="expanded"
      >
        <pre class="nr-raw">{{ x.response === null || x.response === undefined ? '(no answer — NEMO was not reached)' : pretty(x.response) }}</pre>
      </q-expansion-item>
    </div>

    <div class="row items-center q-mt-sm">
      <q-btn
        flat
        dense
        no-caps
        color="primary"
        icon="support_agent"
        :label="reported ? 'Sent to NEMOLink support' : 'Send to NEMOLink support'"
        :disable="!!reported"
        :loading="reporting"
        @click="noteOpen = true"
      />
      <span v-if="reported" class="nr-meta q-ml-sm">{{ reported }}</span>
    </div>

    <HouseDialog
      v-model="noteOpen"
      title="Send to NEMOLink support"
      :max-width-px="480"
      main-label="Send to support"
      main-icon="send"
      :main-loading="reporting"
      @main="report"
    >
      <p class="text-body2 q-mb-sm">
        NEMOLink support gets this result — what was sent, NEMO's answer and the raw request and
        response — by email. You are in copy.
      </p>
      <q-input v-model="note" type="textarea" autogrow outlined dense label="What happened (optional)" maxlength="2000" />
    </HouseDialog>
  </div>
</template>

<script setup lang="ts">
/**
 * The result viewer (spec 0081). Shown after every call to NEMO a user
 * starts — inline in the Send to NEMO wizard, and as NemoResultDialog after
 * a cancel. Every exchange shows its visit id, NEMO's HTTP answer decoded
 * into words, the raw request and response, and "Send to NEMOLink support",
 * which emails the lot to support@nauticai.com with the user in cc.
 */
import { ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type NemoExchange } from '../auth/auth';
import { fmtStamp } from '../lib/time';
import HouseDialog from './HouseDialog.vue';
import StatusPill, { type PillTone } from './StatusPill.vue';

const props = withDefaults(defineProps<{ exchanges: NemoExchange[]; expanded?: boolean }>(), { expanded: false });

const $q = useQuasar();
const auth = useAuth();

const TONES: Record<NemoExchange['outcome'], PillTone> = {
  success: 'green',
  rejected: 'red',
  unavailable: 'amber',
  error: 'red',
};
const ICONS: Record<NemoExchange['outcome'], string> = {
  success: 'check_circle',
  rejected: 'error',
  unavailable: 'cloud_off',
  error: 'error',
};
/** The read-back verdict in words (spec 0089). */
const READ_BACK_WORDS: Record<string, string> = {
  same: 'NEMO holds what we sent — read back just now',
  differs: 'NEMO holds something else than we sent:',
  missing: 'NEMO does not list this report yet — look again in a moment',
  unread: 'NEMO’s copy could not be read back — the send itself went through',
};

const WORDS: Record<NemoExchange['outcome'], string> = {
  success: 'Success',
  rejected: 'Rejected',
  unavailable: 'NEMO unavailable',
  error: 'Error',
};

/** HTTP statuses in words (the server's table, spec 0081). */
const STATUS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};
function statusWords(status: number | null): string {
  if (status === null) return 'nothing — no connection';
  return STATUS[status] ? `${status} ${STATUS[status]}` : `HTTP ${status}`;
}

function pretty(v: unknown): string {
  if (v === null || v === undefined) return '(nothing)';
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

// ---- support ----------------------------------------------------------------

const noteOpen = ref(false);
const note = ref('');
const reporting = ref(false);
const reported = ref<string | null>(null);

watch(
  () => props.exchanges,
  () => {
    reported.value = null;
    note.value = '';
  },
);

async function report(): Promise<void> {
  reporting.value = true;
  try {
    // One report per result: the first exchange carries the visit id and
    // the subject's flag; the others travel in its note
    const [first, ...rest] = props.exchanges;
    if (!first) return;
    const extra = rest.map((x) => `${x.operation}: ${x.headline}${x.explanation ? ` — ${x.explanation}` : ''}`);
    const words = [note.value.trim(), ...extra].filter(Boolean).join('\n');
    const worst = props.exchanges.find((x) => x.outcome !== 'success') ?? first;
    const out = await auth.reportToSupport(worst, words || undefined);
    reported.value = `to ${out.sentTo}, you in copy`;
    noteOpen.value = false;
    $q.notify({ type: 'positive', message: `Sent to NEMOLink support — you are in copy (${out.cc})` });
  } catch (e) {
    $q.notify({ type: 'negative', message: (e as Error).message, timeout: 10000 });
  } finally {
    reporting.value = false;
  }
}
</script>

<style scoped>
.nr-card {
  background: #fff;
  border: 1px solid var(--nl-line);
  border-left-width: 4px;
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 10px;
}
.nr-card--success {
  border-left-color: var(--nl-green);
}
.nr-card--rejected,
.nr-card--error {
  border-left-color: var(--nl-red);
}
.nr-card--unavailable {
  border-left-color: var(--nl-amber);
}
.nr-visit {
  font-size: 14px;
  font-weight: 600;
  color: var(--nl-ink);
}
.nr-headline {
  margin-top: 6px;
  font-weight: 600;
  color: var(--nl-ink);
}
.nr-explanation {
  margin-top: 2px;
  font-size: 14px;
  color: var(--nl-ink-2);
}
.nr-readback {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  margin-top: 6px;
  font-size: 14px;
}
.nr-readback > ul {
  flex-basis: 100%;
}
.nr-readback--same {
  color: var(--nl-green-text);
}
.nr-readback--differs {
  color: var(--nl-red-text);
}
.nr-readback--missing,
.nr-readback--unread {
  color: var(--nl-amber-text);
}
.nr-errors {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 14px;
  color: var(--nl-red-text);
}
.nr-meta {
  font-size: 12px;
  color: var(--nl-ink-3);
}
.nr-raw {
  font-size: 12px;
  line-height: 1.4;
  margin: 0;
  padding: 8px;
  background: var(--nl-gray-bg);
  border-radius: 6px;
  max-height: 320px;
  overflow: auto;
}
</style>
