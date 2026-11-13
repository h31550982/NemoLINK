<template>
  <div>
    <div class="tab-title q-mb-md row items-center">
      <span>Audit log</span>
      <HelpTip topic="admin.audit" />
      <q-space />
      <SearchBox v-model="search" placeholder="Search events" />
      <q-toggle v-model="nemoOnly" dense size="sm" label="NEMO only" left-label class="q-ml-md" />
    </div>

    <div v-if="loading && events.length === 0" class="row justify-center q-pa-lg">
      <q-spinner size="32px" color="primary" />
    </div>

    <template v-else>
      <q-list bordered separator class="rounded-borders bg-white">
        <q-item
          v-for="e in events"
          :key="`${e.chain}-${e.seq}`"
          clickable
          @click="openDetails(e)"
        >
          <q-item-section avatar>
            <q-icon :name="categoryOf(e).icon" :color="categoryOf(e).color" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ describe(e) }}</q-item-label>
            <q-item-label caption>{{ e.category }}</q-item-label>
          </q-item-section>
          <!-- Log-view meta (docs/07 law 12): time right edge, author below -->
          <q-item-section side class="audit-meta">
            <q-item-label caption class="tnum">{{ fmtWhen(e.created) }}</q-item-label>
            <q-item-label caption class="ellipsis">
              {{ e.actorId ?? 'system' }}
            </q-item-label>
          </q-item-section>
        </q-item>
      </q-list>

      <div v-if="events.length === 0" class="text-center text-grey-7 q-pa-lg">
        {{ search ? 'No events match your search.' : 'Nothing logged yet.' }}
      </div>

      <div v-if="nextBefore" class="row justify-center q-mt-md">
        <q-btn
          flat
          color="primary"
          no-caps
          label="Load more"
          :loading="loading"
          @click="loadMore"
        />
      </div>
    </template>

    <HouseDialog v-model="detailsDialog" :title="details ? describe(details) : ''">
      <template v-if="details">
        <div class="detail-row" v-for="f in detailFacts" :key="f.label">
          <span class="detail-label">{{ f.label }}</span>
          <span class="detail-value">{{ f.value }}</span>
        </div>
        <!-- Field-level diff for master-data edits (docs/specs/0032) -->
        <template v-if="changeRows.length">
          <div class="tab-title q-mt-md q-mb-sm">What changed</div>
          <div class="detail-row" v-for="c in changeRows" :key="c.label">
            <span class="detail-label">{{ c.label }}</span>
            <span class="detail-value tnum">{{ c.from }} → {{ c.to }}</span>
          </div>
        </template>
        <div v-else-if="hasEmptyChanges" class="text-caption text-grey-7 q-mt-sm">
          Saved with no changes.
        </div>
        <q-expansion-item
          dense
          label="Raw event data"
          header-class="text-grey-7"
          class="q-mt-sm"
        >
          <pre class="detail-json">{{ JSON.stringify(details.data, null, 2) }}</pre>
        </q-expansion-item>
      </template>
    </HouseDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type AuditEvent } from '../../auth/auth';
import { fmtStamp, fmtWhen } from '../../lib/time';
import HelpTip from '../../components/HelpTip.vue';
import HouseDialog from '../../components/HouseDialog.vue';
import SearchBox from '../../components/SearchBox.vue';

const $q = useQuasar();
const auth = useAuth();

const events = ref<AuditEvent[]>([]);
const nextBefore = ref<string | null>(null);
const loading = ref(true);
// Server-side search (spec 0019) — the list is cursor-paginated, so a
// client-side filter would silently miss unloaded rows. Debounced restart.
const search = ref('');
/** The NEMO log (spec 0078): only the exchanges with NEMO. */
const nemoOnly = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch([search, nemoOnly], () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    events.value = [];
    nextBefore.value = null;
    void load(null);
  }, 350);
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

const detailsDialog = ref(false);
const details = ref<AuditEvent | null>(null);

function categoryOf(e: AuditEvent): { icon: string; color: string } {
  switch (e.category) {
    case 'content':
      return { icon: 'edit_note', color: 'primary' };
    case 'email':
      return { icon: 'mail_outline', color: 'secondary' };
    default:
      return { icon: 'visibility', color: 'grey-7' };
  }
}

/** The NEMO log in plain words (spec 0078). */
const NEMO_WORDS: Record<string, string> = {
  nemo_port_call_created: 'NEMO: port call created',
  nemo_port_call_refused: 'NEMO: port call refused',
  nemo_formality_sent: 'NEMO: report sent',
  nemo_snapshot: 'NEMO: ship database read',
};

function nemoWordsOf(e: AuditEvent): string | null {
  const head = e.action ? NEMO_WORDS[e.action] : undefined;
  if (!head) return null;
  const d = e.data;
  if (e.action === 'nemo_formality_sent') {
    return `${head} — ${String(d['formalityType'] ?? '')} ${d['accepted'] ? 'accepted' : 'rejected'}`;
  }
  if (e.action === 'nemo_port_call_created' && d['visitId']) return `${head} — ${String(d['visitId'])}`;
  if (e.action === 'nemo_port_call_refused' && d['shipUnknown'] === true) return `${head} — NEMO does not know the ship`;
  return head;
}

function describe(e: AuditEvent): string {
  const nemo = nemoWordsOf(e);
  if (nemo) return nemo;
  const action = e.action ? e.action.replaceAll('_', ' ') : e.category;
  const entity = e.entityType ? e.entityType.replaceAll('_', ' ') : '';
  return entity ? `${entity}: ${action}` : action;
}

function formatTime(iso: string): string {
  return fmtStamp(iso);
}

// Request forensics stamped by the server (docs/specs/0033)
function forensicsOf(e: AuditEvent): string | null {
  const req = e.data?.['request'];
  if (!req || typeof req !== 'object' || Array.isArray(req)) return null;
  const { ip, userAgent } = req as { ip?: unknown; userAgent?: unknown };
  const parts = [ip, userAgent].filter((v): v is string => typeof v === 'string' && !!v);
  return parts.length ? parts.join(' · ') : null;
}

const detailFacts = computed(() => {
  const e = details.value;
  if (!e) return [];
  const facts = [
    { label: 'When', value: formatTime(e.created) },
    { label: 'Who', value: e.actorId ?? 'system' },
    { label: 'Category', value: e.category },
    { label: 'Entity', value: `${e.entityType ?? '—'} ${e.entityId ?? ''}`.trim() },
    { label: 'Chain', value: e.chain === 'org' ? 'organization' : 'platform' },
    { label: 'Sequence', value: String(e.seq) },
  ];
  const from = forensicsOf(e);
  if (from) facts.push({ label: 'From', value: from });
  // The NEMO log (spec 0078): what NEMO said, in words; the bodies are under Raw event data
  if (typeof e.data['httpStatus'] === 'number') facts.push({ label: 'NEMO answered', value: `HTTP ${e.data['httpStatus']}` });
  if (typeof e.data['words'] === 'string' && e.data['words']) facts.push({ label: 'NEMO said', value: String(e.data['words']) });
  return facts;
});

// Plain-word labels for diffed fields (docs/07 law 2); unknown keys pass
// through so future entities render without a code change here.
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  imoNumber: 'IMO number',
  mmsi: 'MMSI',
  callSign: 'Call sign',
  certificates: 'Certificates',
};

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function changesOf(e: AuditEvent | null): Record<string, unknown> | null {
  const changes = e?.data?.['changes'];
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null;
  return changes as Record<string, unknown>;
}

const changeRows = computed(() => {
  const changes = changesOf(details.value);
  if (!changes) return [];
  return Object.entries(changes).flatMap(([key, v]) => {
    if (!v || typeof v !== 'object') return [];
    const { from, to } = v as { from?: unknown; to?: unknown };
    return [{ label: FIELD_LABELS[key] ?? key, from: fmtVal(from), to: fmtVal(to) }];
  });
});

const hasEmptyChanges = computed(() => {
  const changes = changesOf(details.value);
  return !!changes && Object.keys(changes).length === 0;
});

function openDetails(e: AuditEvent): void {
  details.value = e;
  detailsDialog.value = true;
}

async function load(before: string | null): Promise<void> {
  loading.value = true;
  try {
    const page = await auth.listAudit(before, search.value.trim() || undefined, nemoOnly.value ? 'nemo' : undefined);
    events.value = before ? [...events.value, ...page.events] : page.events;
    nextBefore.value = page.nextBefore;
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load the audit log.' });
  } finally {
    loading.value = false;
  }
}

function loadMore(): void {
  void load(nextBefore.value);
}

onMounted(() => void load(null));
</script>

<style scoped>
/* Log-view meta column (docs/07 law 12): right edge, right-aligned */
.audit-meta {
  align-items: flex-end;
  max-width: 45%;
}
.detail-row {
  display: flex;
  gap: 12px;
  padding: 4px 0;
  font-size: 14px;
}
.detail-label {
  color: var(--nl-ink-2);
  min-width: 90px;
}
.detail-value {
  color: var(--nl-ink);
  word-break: break-all;
}
.detail-json {
  margin: 0;
  padding: 10px 12px;
  background: var(--nl-gray-bg);
  border-radius: 10px;
  font-size: 12px;
  overflow-x: auto;
}
</style>
