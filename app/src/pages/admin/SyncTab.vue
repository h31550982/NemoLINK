<template>
  <div>
    <div class="tab-title q-mb-md row items-center">
      <span>Reference data sync</span>
      <HelpTip topic="admin.sync" />
    </div>

    <div v-if="loading && datasets.length === 0" class="row justify-center q-pa-lg">
      <q-spinner size="32px" color="primary" />
    </div>

    <template v-else>
      <q-table
        :rows="datasets"
        :columns="datasetColumns"
        row-key="job"
        flat
        bordered
        dense
        hide-bottom
        :pagination="{ rowsPerPage: 0 }"
        class="ref-table rounded-borders q-mb-lg"
      >
        <template #body="props">
          <q-tr
            :props="props"
            :class="{ 'run-row': props.row.job === 'schemas' }"
            @click="props.row.job === 'schemas' && openContracts()"
          >
            <q-td key="dataset" :props="props" class="text-weight-semibold">
              {{ datasetName(props.row.job) }}
              <q-icon
                v-if="props.row.job === 'schemas'"
                name="list"
                color="grey-6"
                size="16px"
                class="q-ml-xs"
              >
                <q-tooltip>Show the watched files</q-tooltip>
              </q-icon>
            </q-td>
            <q-td key="rows" :props="props">{{ props.row.rows }}</q-td>
            <q-td key="lastOk" :props="props">
              {{ props.row.lastOk ? fmtTime(props.row.lastOk) : 'never' }}
            </q-td>
            <q-td key="state" :props="props">
              <StatusPill
                v-if="!props.row.available"
                tone="amber"
                icon="hourglass_empty"
                label="waiting for configuration"
              />
              <StatusPill
                v-else-if="props.row.lastOk"
                tone="green"
                icon="check_circle"
                label="synced"
              />
              <StatusPill v-else tone="gray" icon="schedule" label="not synced yet" />
              <div v-if="props.row.reason" class="text-caption text-grey-7">
                {{ props.row.reason }}
              </div>
            </q-td>
            <q-td key="actions" :props="props" class="actions-cell" @click.stop>
              <q-btn
                unelevated
                dense
                no-caps
                color="primary"
                label="Run now"
                class="q-px-md"
                :disable="!props.row.available"
                :loading="running === props.row.job"
                @click="runNow(props.row.job)"
              />
            </q-td>
          </q-tr>
        </template>
      </q-table>

      <div class="tab-title q-mb-sm">Recent runs</div>
      <q-table
        :rows="runs"
        :columns="runColumns"
        row-key="id"
        flat
        bordered
        dense
        hide-bottom
        :pagination="{ rowsPerPage: 0 }"
        class="ref-table rounded-borders"
        no-data-label="No sync runs yet."
      >
        <template #body="props">
          <q-tr :props="props" class="run-row" @click="openDetails(props.row)">
            <q-td key="started" :props="props">{{ fmtTime(props.row.started) }}</q-td>
            <q-td key="job" :props="props">{{ datasetName(props.row.job) }}</q-td>
            <q-td key="status" :props="props">
              <StatusPill
                :tone="statusOf(props.row).tone"
                :icon="statusOf(props.row).icon"
                :label="statusOf(props.row).words"
              />
            </q-td>
            <q-td key="result" :props="props" class="result-cell">
              {{ summarize(props.row) }}
            </q-td>
            <q-td key="author" :props="props">{{ props.row.author ?? '—' }}</q-td>
          </q-tr>
        </template>
      </q-table>
    </template>

    <!-- The exact vendored contract versions the system runs against -->
    <HouseDialog v-model="contractsDialog" title="Watched NEMO contracts" :max-width-px="620">
      <div v-if="contracts.length === 0" class="row justify-center q-pa-md">
        <q-spinner size="24px" color="primary" />
      </div>
      <template v-else>
        <div class="text-caption text-grey-7 q-mb-sm">
          {{ contracts.length }} vendored files — the reviewed copies every
          declaration is validated against. The daily check compares each one
          with the published version.
        </div>
        <div v-for="c in contracts" :key="c.file" class="contract-row">
          <span class="contract-file">{{ c.file }}</span>
          <span class="contract-sha">{{ c.sha256.slice(0, 12) }}</span>
        </div>
      </template>
    </HouseDialog>

    <HouseDialog
      v-model="detailsDialog"
      :title="details ? `${datasetName(details.job)} sync` : ''"
      :max-width-px="520"
    >
      <template v-if="details">
        <div class="detail-row" v-for="f in detailFacts" :key="f.label">
          <span class="detail-label">{{ f.label }}</span>
          <span class="detail-value">{{ f.value }}</span>
        </div>
        <div v-if="details.error" class="error-box q-mt-sm">{{ details.error }}</div>
        <q-expansion-item
          v-if="Object.keys(details.stats).length > 0"
          dense
          label="Run statistics"
          header-class="text-grey-7"
          class="q-mt-sm"
        >
          <pre class="detail-json">{{ JSON.stringify(details.stats, null, 2) }}</pre>
        </q-expansion-item>
      </template>
    </HouseDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar, type QTableColumn } from 'quasar';
import { useAuth, type ContractFile, type SyncDataset, type SyncRun } from '../../auth/auth';
import HelpTip from '../../components/HelpTip.vue';
import HouseDialog from '../../components/HouseDialog.vue';
import StatusPill, { type PillTone } from '../../components/StatusPill.vue';
import { fmtWhen } from '../../lib/time';

const $q = useQuasar();
const auth = useAuth();

const datasets = ref<SyncDataset[]>([]);
const runs = ref<SyncRun[]>([]);
const loading = ref(true);
const running = ref<string | null>(null);

const detailsDialog = ref(false);
const details = ref<SyncRun | null>(null);

const contractsDialog = ref(false);
const contracts = ref<ContractFile[]>([]);

function openContracts(): void {
  contractsDialog.value = true;
  if (contracts.value.length > 0) return;
  void auth
    .listContracts()
    .then((list) => {
      contracts.value = list;
    })
    .catch(() => {
      contractsDialog.value = false;
      $q.notify({ type: 'negative', message: 'Could not load the contract list.' });
    });
}

const NAMES: Record<string, string> = {
  schemas: 'NEMO contracts',
  codelists: 'Codelists',
  hsmap: 'Cargo HS map',
  locations: 'Locations',
  hazmat: 'Dangerous goods',
  ships: 'Ship master list',
};

function datasetName(job: string): string {
  return NAMES[job] ?? job;
}

const datasetColumns: QTableColumn<SyncDataset>[] = [
  { name: 'dataset', label: 'Dataset', align: 'left', field: 'job' },
  { name: 'rows', label: 'Rows', align: 'left', field: 'rows' },
  { name: 'lastOk', label: 'Last synced', align: 'left', field: (r) => r.lastOk ?? '' },
  { name: 'state', label: 'State', align: 'left', field: 'available' },
  { name: 'actions', label: '', align: 'right', field: 'job' },
];

const runColumns: QTableColumn<SyncRun>[] = [
  { name: 'started', label: 'Started', align: 'left', field: 'started', sortable: true },
  { name: 'job', label: 'Dataset', align: 'left', field: 'job', sortable: true },
  { name: 'status', label: 'Status', align: 'left', field: 'status', sortable: true },
  { name: 'result', label: 'Result', align: 'left', field: (r) => summarize(r) },
  { name: 'author', label: 'Started by', align: 'left', field: (r) => r.author ?? '' },
];

function fmtTime(iso: string): string {
  return fmtWhen(iso);
}

function statusOf(run: SyncRun): { tone: PillTone; icon: string; words: string } {
  switch (run.status) {
    case 'ok':
      return { tone: 'green', icon: 'check_circle', words: 'Succeeded' };
    case 'failed':
      return { tone: 'red', icon: 'error', words: 'Failed' };
    default:
      // Teal marks in-progress (concept §2 rule 2)
      return { tone: 'teal', icon: 'autorenew', words: 'Running' };
  }
}

function summarize(run: SyncRun): string {
  if (run.error) return run.error;
  const s = run.stats;
  // schema watch (spec 0024): drift is the headline
  if (Array.isArray(s.changed)) {
    const drift =
      s.changed.length +
      ((s.newUpstream as string[] | undefined)?.length ?? 0) +
      ((s.removedUpstream as string[] | undefined)?.length ?? 0);
    return drift > 0
      ? `${drift} upstream change(s) — re-vendoring needed`
      : `${String(s.checked)} sources match the published versions`;
  }
  const parts: string[] = [];
  if (typeof s.hubLists === 'number') parts.push(`${s.hubLists} web lists`);
  if (typeof s.spreadsheetLists === 'number') parts.push(`${s.spreadsheetLists} spreadsheet lists`);
  if (typeof s.entries === 'number') parts.push(`${s.entries} entries`);
  if (typeof s.upserted === 'number') parts.push(`${s.upserted} rows`);
  // guarded upsert (spec 0027): inserted / updated / unchanged tell the truth
  if (typeof s.inserted === 'number' && s.inserted !== 0) parts.push(`${s.inserted} new`);
  if (typeof s.updated === 'number' && s.updated !== 0) parts.push(`${s.updated} updated`);
  if (typeof s.unchanged === 'number' && s.unchanged !== 0) parts.push(`${s.unchanged} unchanged`);
  if (typeof s.superseded === 'number' && s.superseded !== 0) parts.push(`${s.superseded} superseded`);
  if (typeof s.skipped === 'number' && s.skipped !== 0) parts.push(`${s.skipped} skipped`);
  return parts.join(' · ') || '—';
}

const detailFacts = computed(() => {
  const r = details.value;
  if (!r) return [];
  return [
    { label: 'Dataset', value: datasetName(r.job) },
    { label: 'Status', value: statusOf(r).words },
    { label: 'Started', value: fmtTime(r.started) },
    { label: 'Finished', value: r.finished ? fmtTime(r.finished) : '—' },
    { label: 'Started by', value: r.author ?? '—' },
  ];
});

function openDetails(run: SyncRun): void {
  details.value = run;
  detailsDialog.value = true;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const status = await auth.syncStatus();
    datasets.value = status.datasets;
    runs.value = status.runs;
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load the sync status.' });
  } finally {
    loading.value = false;
  }
}

async function runNow(job: string): Promise<void> {
  running.value = job;
  try {
    const run = await auth.runSync(job);
    if (run.status === 'ok') {
      $q.notify({ type: 'positive', message: `${datasetName(job)} synced.` });
    } else {
      $q.notify({
        type: 'negative',
        message: `${datasetName(job)} sync failed${run.error ? ': ' + run.error : ''}.`,
      });
    }
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: error instanceof Error ? error.message : 'Could not run the sync.',
    });
  } finally {
    running.value = null;
    await load();
  }
}

onMounted(() => void load());
</script>

<style scoped>
.ref-table {
  background: white;
}
.ref-table :deep(th) {
  font-weight: 600;
  color: var(--nl-ink-2);
}
.run-row {
  cursor: pointer;
}
.actions-cell {
  white-space: nowrap;
}
.contract-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px solid var(--nl-line-row);
  font-size: 14px;
}
.contract-row:last-child {
  border-bottom: none;
}
.contract-file {
  color: var(--nl-ink);
  word-break: break-all;
}
.contract-sha {
  color: var(--nl-ink-2);
  font-family: monospace;
  white-space: nowrap;
}
.result-cell {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
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
}
.error-box {
  padding: 10px 12px;
  background: var(--nl-red-bg);
  border-radius: 10px;
  color: var(--nl-red-text);
  font-size: 14px;
  word-break: break-word;
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
