<template>
  <q-page padding>
    <q-tabs
      v-model="tab"
      dense
      no-caps
      align="left"
      active-color="tealdark"
      indicator-color="secondary"
      class="text-grey-7 q-mb-md"
    >
      <q-tab name="customers" label="Customers" />
      <q-tab name="ships" label="Ships" />
      <q-tab name="gisis" label="GISIS facilities" />
      <q-tab name="audit" label="Platform audit log" />
    </q-tabs>

    <div v-if="tab === 'customers'">
      <div class="tab-title q-mb-md row items-center">
        <span>Customers</span>
        <HelpTip topic="platform.customers" />
        <q-space />
        <SearchBox v-model="orgSearch" placeholder="Search customers" />
      </div>

      <div v-if="orgsLoading" class="row justify-center q-pa-lg">
        <q-spinner size="32px" color="primary" />
      </div>
      <q-table
        v-else
        :rows="filteredOrgs"
        :columns="orgColumns"
        row-key="slug"
        flat
        bordered
        dense
        hide-bottom
        :pagination="{ rowsPerPage: 0 }"
        class="ref-table rounded-borders"
        no-data-label="No customers found."
      >
        <template #body="props">
          <q-tr :props="props" class="org-row" @click="openOrg(props.row)">
            <q-td key="name" :props="props" class="text-weight-semibold">
              {{ props.row.name }}
            </q-td>
            <q-td key="slug" :props="props">{{ props.row.slug }}</q-td>
            <q-td key="status" :props="props">
              <StatusPill
                :tone="props.row.isActive ? 'green' : 'gray'"
                :icon="props.row.isActive ? 'check_circle' : 'block'"
                :label="props.row.isActive ? 'Active' : 'Inactive'"
              />
            </q-td>
            <q-td key="created" :props="props">{{ fmtDate(props.row.created) }}</q-td>
            <q-td key="actions" :props="props">
              <q-btn
                v-if="props.row.isActive"
                flat
                dense
                no-caps
                color="primary"
                label="Open"
                @click.stop="openOrg(props.row)"
              />
            </q-td>
          </q-tr>
        </template>
      </q-table>
    </div>

    <!-- The master list (spec 0068): every ship NEMOLink knows, unmasked -->
    <div v-else-if="tab === 'ships'">
      <div class="tab-title q-mb-md row items-center q-gutter-sm">
        <span>Master list</span>
        <HelpTip topic="platform.ships" />
        <span class="text-caption text-grey-7">Fed by customer systems, NEMO's ship database and Digitraffic</span>
        <q-space />
        <SearchBox v-model="shipSearch" placeholder="Search ships" />
      </div>
      <div v-if="shipsLoading && platformShips.length === 0" class="row justify-center q-pa-lg">
        <q-spinner size="32px" color="primary" />
      </div>
      <q-table
        v-else
        :rows="filteredShips"
        :columns="shipColumns"
        row-key="id"
        flat
        bordered
        dense
        hide-bottom
        :pagination="{ rowsPerPage: 0 }"
        class="ref-table rounded-borders"
        no-data-label="No ships yet — the daily sync and the customers' pushes fill this list."
      >
        <template #body="props">
          <q-tr :props="props" :class="{ 'inactive-row': !props.row.isActive }">
            <q-td key="name" :props="props" class="text-weight-semibold">{{ props.row.name ?? '—' }}</q-td>
            <q-td key="imo" :props="props">{{ props.row.imoNumber ?? '—' }}</q-td>
            <q-td key="mmsi" :props="props">{{ props.row.mmsi ?? '—' }}</q-td>
            <q-td key="callSign" :props="props">{{ props.row.callSign ?? '—' }}</q-td>
            <q-td key="fleets" :props="props">{{ props.row.fleets.join(', ') || '—' }}</q-td>
            <q-td key="sources" :props="props">{{ sourcesOf(props.row) }}</q-td>
            <q-td key="nemo" :props="props">
              <StatusPill :tone="nemoPill(props.row).tone" :icon="nemoPill(props.row).icon" :label="nemoPill(props.row).label" />
            </q-td>
            <q-td key="updated" :props="props">{{ fmtWhen(props.row.updated) }}</q-td>
            <q-td key="actions" :props="props" @click.stop>
              <q-btn
                flat round dense
                color="primary"
                icon="sync"
                :loading="shipBusy === props.row.id + ':nemo'"
                :aria-label="`Refresh ${props.row.name} from NEMO`"
                @click="refreshShip(props.row)"
              >
                <q-tooltip>Refresh from NEMO</q-tooltip>
              </q-btn>
              <q-btn
                flat round dense
                :color="props.row.isActive ? 'grey-8' : 'positive'"
                :icon="props.row.isActive ? 'pause' : 'play_arrow'"
                :loading="shipBusy === props.row.id + ':active'"
                :aria-label="(props.row.isActive ? 'Deactivate ' : 'Activate ') + props.row.name + ' for every organisation'"
                @click="toggleShip(props.row)"
              >
                <q-tooltip>{{ props.row.isActive ? 'Deactivate' : 'Activate' }} for every organisation</q-tooltip>
              </q-btn>
            </q-td>
          </q-tr>
        </template>
      </q-table>
    </div>

    <!-- GISIS port-facility list (spec 0053): status + hand-carried upload -->
    <div v-else-if="tab === 'gisis'">
      <div class="tab-title q-mb-md row items-center">
        <span>GISIS port facilities</span>
        <HelpTip topic="platform.gisis" />
        <q-space />
        <q-btn
          unelevated
          color="primary"
          no-caps
          label="Upload GISIS export"
          :loading="gisisUploading"
          @click="gisisFileInput?.click()"
        />
        <input
          ref="gisisFileInput"
          type="file"
          accept=".csv,text/csv"
          style="display: none"
          @change="onGisisFile"
        />
      </div>

      <div v-if="gisisLoading && !gisis" class="row justify-center q-pa-lg">
        <q-spinner size="32px" color="primary" />
      </div>
      <q-card v-else-if="gisis" flat bordered class="ref-table rounded-borders q-pa-md">
        <div class="q-mb-sm">
          <StatusPill
            :tone="gisis.stale ? 'amber' : 'green'"
            :icon="gisis.stale ? 'schedule' : 'check_circle'"
            :label="gisisFreshness"
          />
        </div>
        <div class="detail-row">
          <span class="detail-label">Facilities</span>
          <span class="detail-value tnum">{{ gisis.facilities }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Retired codes</span>
          <span class="detail-value tnum">{{ gisis.retired }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Countries</span>
          <span class="detail-value tnum">{{ gisis.countries }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Last upload</span>
          <span class="detail-value">
            <template v-if="gisis.lastImport">
              {{ fmtWhen(gisis.lastImport.finished) }}
              <span class="text-grey-7"> · {{ gisis.lastImport.author ?? '—' }}</span>
            </template>
            <template v-else>never</template>
          </span>
        </div>
        <q-expansion-item
          v-if="gisis.lastImport"
          dense
          label="Last import details"
          header-class="text-grey-7"
          class="q-mt-sm"
        >
          <pre class="detail-json">{{ JSON.stringify(gisis.lastImport.stats, null, 2) }}</pre>
        </q-expansion-item>
        <div v-else class="text-caption text-grey-7 q-mt-sm">
          No GISIS export uploaded yet — facility codes stay bare codes until
          one is.
        </div>
      </q-card>
    </div>

    <div v-else>
      <div class="tab-title q-mb-md row items-center">
        <span>Platform audit log</span>
        <HelpTip topic="platform.audit" />
        <q-space />
        <SearchBox v-model="auditSearch" placeholder="Search events" />
      </div>

      <div v-if="auditLoading && events.length === 0" class="row justify-center q-pa-lg">
        <q-spinner size="32px" color="primary" />
      </div>
      <template v-else>
        <q-table
          :rows="events"
          :columns="auditColumns"
          row-key="seq"
          flat
          bordered
          dense
          hide-bottom
          :pagination="{ rowsPerPage: 0 }"
          class="ref-table rounded-borders"
          no-data-label="No events match."
        >
          <template #body="props">
            <q-tr :props="props" class="org-row" @click="openEvent(props.row)">
              <q-td key="created" :props="props">{{ fmtWhen(props.row.created) }}</q-td>
              <q-td key="category" :props="props">{{ props.row.category }}</q-td>
              <q-td key="actor" :props="props">
                {{ props.row.actorId ?? '—' }}
                <span v-if="actorOrgOf(props.row)" class="text-grey-7">· {{ actorOrgOf(props.row) }}</span>
              </q-td>
              <q-td key="entity" :props="props">
                {{ props.row.entityType ?? '—' }}
                <span v-if="props.row.entityId" class="text-grey-7">
                  · {{ shortId(props.row.entityId) }}
                </span>
              </q-td>
              <q-td key="action" :props="props">{{ actionOf(props.row) }}</q-td>
            </q-tr>
          </template>
        </q-table>
        <div class="q-mt-sm">
          <q-btn
            v-if="nextBefore"
            flat
            no-caps
            color="primary"
            label="Load older events"
            :loading="auditLoading"
            @click="void loadAudit(false)"
          />
        </div>
      </template>
    </div>

    <HouseDialog
      v-model="eventDialog"
      :title="eventDetails ? `${eventDetails.category} · ${actionOf(eventDetails)}` : ''"
      :max-width-px="560"
    >
      <template v-if="eventDetails">
        <div class="detail-row">
          <span class="detail-label">Time</span>
          <span class="detail-value">{{ fmtTime(eventDetails.created) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Actor</span>
          <span class="detail-value">
            {{ eventDetails.actorId ?? '—' }}
            <template v-if="actorOrgOf(eventDetails)"> · {{ actorOrgOf(eventDetails) }}</template>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Entity</span>
          <span class="detail-value">
            {{ eventDetails.entityType ?? '—' }}
            <template v-if="eventDetails.entityId"> · {{ eventDetails.entityId }}</template>
          </span>
        </div>
        <div v-if="eventFrom" class="detail-row">
          <span class="detail-label">From</span>
          <span class="detail-value">{{ eventFrom }}</span>
        </div>
        <q-expansion-item dense label="Event data" header-class="text-grey-7" class="q-mt-sm">
          <pre class="detail-json">{{ JSON.stringify(eventDetails.data, null, 2) }}</pre>
        </q-expansion-item>
      </template>
    </HouseDialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar, type QTableColumn } from 'quasar';
import {
  useAuth,
  type GisisStatus,
  type PlatformAuditEvent,
  type PlatformOrg,
  type PlatformShip,
} from '../auth/auth';
import HelpTip from '../components/HelpTip.vue';
import HouseDialog from '../components/HouseDialog.vue';
import SearchBox from '../components/SearchBox.vue';
import { fmtDay, fmtStamp, fmtWhen } from '../lib/time';
import StatusPill, { type PillTone } from '../components/StatusPill.vue';

const $q = useQuasar();
const auth = useAuth();
const router = useRouter();

const tab = ref<'customers' | 'ships' | 'gisis' | 'audit'>('customers');

// -- the master list (spec 0068) ---------------------------------------------
const platformShips = ref<PlatformShip[]>([]);
const shipsLoading = ref(false);
const shipSearch = ref('');
const shipBusy = ref<string | null>(null);

const filteredShips = computed(() => {
  const q = shipSearch.value.trim().toLowerCase();
  if (!q) return platformShips.value;
  return platformShips.value.filter((s) =>
    [s.name ?? '', s.imoNumber ?? '', s.mmsi ?? '', s.callSign ?? '', s.fleets.join(' '), sourcesOf(s)]
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
});

const shipColumns: QTableColumn<PlatformShip>[] = [
  { name: 'name', label: 'Ship', align: 'left', field: (r) => (r.name ?? '').toLowerCase(), sortable: true },
  { name: 'imo', label: 'IMO', align: 'left', field: (r) => r.imoNumber ?? '', sortable: true },
  { name: 'mmsi', label: 'MMSI', align: 'left', field: (r) => r.mmsi ?? '' },
  { name: 'callSign', label: 'Call sign', align: 'left', field: (r) => r.callSign ?? '' },
  { name: 'fleets', label: 'In fleets', align: 'left', field: (r) => r.fleets.join(', '), sortable: true },
  { name: 'sources', label: 'Sources', align: 'left', field: (r) => sourcesOf(r) },
  { name: 'nemo', label: 'In NEMO', align: 'left', field: (r) => nemoPill(r).label, sortable: true },
  { name: 'updated', label: 'Updated', align: 'left', field: 'updated', sortable: true },
  { name: 'actions', label: '', align: 'right', field: 'id' },
];

function sourcesOf(s: PlatformShip): string {
  const names = Object.values(s.lanes ?? {}).map((l) => l.by);
  return names.length ? [...new Set(names)].join(', ') : s.addedBy;
}

function nemoPill(s: PlatformShip): { tone: PillTone; icon: string; label: string } {
  if (!s.nemo) return { tone: 'gray', icon: 'help_outline', label: 'not read' };
  return s.nemo.shipId
    ? { tone: 'green', icon: 'check_circle', label: 'in NEMO' }
    : { tone: 'amber', icon: 'error_outline', label: 'not in NEMO' };
}

async function loadShips(): Promise<void> {
  shipsLoading.value = true;
  try {
    platformShips.value = await auth.listPlatformShips();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load the master list.' });
  } finally {
    shipsLoading.value = false;
  }
}

async function refreshShip(s: PlatformShip): Promise<void> {
  shipBusy.value = s.id + ':nemo';
  try {
    await auth.refreshPlatformShipFromNemo(s.id);
    await loadShips();
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not read the ship from NEMO.' });
  } finally {
    shipBusy.value = null;
  }
}

async function toggleShip(s: PlatformShip): Promise<void> {
  shipBusy.value = s.id + ':active';
  try {
    await auth.setPlatformShipActive(s.id, !s.isActive);
    await loadShips();
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not change the ship.' });
  } finally {
    shipBusy.value = null;
  }
}

// -- customers ---------------------------------------------------------------
const orgs = ref<PlatformOrg[]>([]);
const orgsLoading = ref(true);
const orgSearch = ref('');

const filteredOrgs = computed(() => {
  const q = orgSearch.value.trim().toLowerCase();
  if (!q) return orgs.value;
  return orgs.value.filter(
    (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
  );
});

const orgColumns: QTableColumn<PlatformOrg>[] = [
  { name: 'name', label: 'Customer', align: 'left', field: 'name', sortable: true },
  { name: 'slug', label: 'Slug', align: 'left', field: 'slug', sortable: true },
  { name: 'status', label: 'Status', align: 'left', field: 'isActive' },
  { name: 'created', label: 'Created', align: 'left', field: 'created', sortable: true },
  { name: 'actions', label: '', align: 'right', field: 'slug' },
];

async function openOrg(org: PlatformOrg): Promise<void> {
  if (!org.isActive) return;
  try {
    await auth.setActingOrg(org.slug);
    await router.push('/');
  } catch {
    $q.notify({ type: 'negative', message: 'Could not open the customer.' });
  }
}

// -- GISIS facilities (spec 0053) --------------------------------------------
const gisis = ref<GisisStatus | null>(null);
const gisisLoading = ref(false);
const gisisUploading = ref(false);
const gisisFileInput = ref<HTMLInputElement | null>(null);

// Verdicts in words (docs/07 badge grammar): the pill says what stands
const gisisFreshness = computed(() => {
  const s = gisis.value;
  if (!s) return '';
  if (!s.stale) return 'Up to date';
  return s.lastImport ? 'Older than 3 months' : 'No upload yet';
});

async function loadGisis(): Promise<void> {
  gisisLoading.value = true;
  try {
    gisis.value = await auth.gisisStatus();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load the GISIS status.' });
  } finally {
    gisisLoading.value = false;
  }
}

async function onGisisFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  gisisUploading.value = true;
  try {
    const stats = await auth.uploadGisisCsv(file);
    const n = (key: string): number =>
      typeof stats[key] === 'number' ? (stats[key] as number) : 0;
    $q.notify({
      type: 'positive',
      message:
        `GISIS import done — ${n('inserted')} new, ${n('updated')} updated, ` +
        `${n('unchanged')} unchanged, ${n('retired')} retired` +
        (n('skipped') ? `, ${n('skipped')} skipped` : ''),
    });
    await loadGisis();
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: error instanceof Error ? error.message : 'The upload failed.',
    });
  } finally {
    gisisUploading.value = false;
  }
}

// -- platform audit ----------------------------------------------------------

/** The org an actor acted for, on events that carry it (ship events, spec 0067). */
function actorOrgOf(e: PlatformAuditEvent): string | null {
  const org = e.data?.['actorOrg'];
  return typeof org === 'string' ? org : null;
}
const events = ref<PlatformAuditEvent[]>([]);
const nextBefore = ref<string | null>(null);
const auditLoading = ref(false);
const auditSearch = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(auditSearch, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void loadAudit(true), 350);
});
watch(tab, (t) => {
  if (t === 'audit' && events.value.length === 0) void loadAudit(true);
  if (t === 'ships' && platformShips.value.length === 0) void loadShips();
  if (t === 'gisis' && gisis.value === null) void loadGisis();
});
onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

const auditColumns: QTableColumn<PlatformAuditEvent>[] = [
  { name: 'created', label: 'Time', align: 'left', field: 'created' },
  { name: 'category', label: 'Category', align: 'left', field: 'category' },
  { name: 'actor', label: 'Actor', align: 'left', field: (r) => r.actorId ?? '' },
  { name: 'entity', label: 'Entity', align: 'left', field: (r) => r.entityType ?? '' },
  { name: 'action', label: 'Action', align: 'left', field: (r) => actionOf(r) },
];

const eventDialog = ref(false);
const eventDetails = ref<PlatformAuditEvent | null>(null);

function openEvent(event: PlatformAuditEvent): void {
  eventDetails.value = event;
  eventDialog.value = true;
}

function actionOf(event: PlatformAuditEvent): string {
  const action = event.data['action'];
  return typeof action === 'string' ? action : '—';
}

// Request forensics stamped by the server (docs/specs/0033)
const eventFrom = computed(() => {
  const req = eventDetails.value?.data['request'];
  if (!req || typeof req !== 'object' || Array.isArray(req)) return null;
  const { ip, userAgent } = req as { ip?: unknown; userAgent?: unknown };
  const parts = [ip, userAgent].filter((v): v is string => typeof v === 'string' && !!v);
  return parts.length ? parts.join(' · ') : null;
});

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function fmtDate(iso: string): string {
  return fmtDay(iso);
}

function fmtTime(iso: string): string {
  return fmtStamp(iso);
}

async function loadAudit(reset: boolean): Promise<void> {
  auditLoading.value = true;
  try {
    const before = reset ? null : nextBefore.value;
    const page = await auth.listPlatformAudit(
      before,
      auditSearch.value.trim() || undefined,
    );
    events.value = reset ? page.events : [...events.value, ...page.events];
    nextBefore.value = page.nextBefore;
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load the audit log.' });
  } finally {
    auditLoading.value = false;
  }
}

onMounted(async () => {
  try {
    orgs.value = await auth.listPlatformOrgs();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load customers.' });
  } finally {
    orgsLoading.value = false;
  }
});
</script>

<style scoped>
.ref-table {
  background: white;
}
.ref-table :deep(th) {
  font-weight: 600;
  color: var(--nl-ink-2);
}
.org-row {
  cursor: pointer;
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
.detail-json {
  margin: 0;
  padding: 10px 12px;
  background: var(--nl-ground);
  border-radius: 10px;
  font-size: 12px;
  overflow-x: auto;
}
</style>
