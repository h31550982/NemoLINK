<template>
  <div>
    <div class="tab-title q-mb-md row items-center">
      <span>Locations</span>
      <HelpTip topic="admin.locations" />
      <q-space />
      <SearchBox v-model="search" placeholder="Search locations" />
    </div>

    <div v-if="loading && locations.length === 0" class="row justify-center q-pa-lg">
      <q-spinner size="32px" color="primary" />
    </div>

    <template v-else>
      <q-table
        :rows="locations"
        :columns="columns"
        row-key="locode"
        flat
        bordered
        dense
        hide-bottom
        :pagination="{ rowsPerPage: 0 }"
        class="ref-table rounded-borders"
        :no-data-label="emptyLabel"
      >
        <template #body="props">
          <q-tr :props="props" class="ref-row" @click="openDetails(props.row)">
            <q-td key="locode" :props="props" class="text-weight-semibold">
              {{ props.row.locode }}
            </q-td>
            <q-td key="name" :props="props">{{ props.row.name ?? '—' }}</q-td>
            <q-td key="country" :props="props">{{ props.row.countryCode ?? '—' }}</q-td>
            <q-td key="updated" :props="props">{{ fmtDate(props.row.updated) }}</q-td>
          </q-tr>
        </template>
      </q-table>

      <div v-if="total > locations.length" class="text-caption text-grey-7 q-mt-sm">
        Showing the first {{ locations.length }} of {{ total }} — refine your search to
        narrow down.
      </div>
    </template>

    <HouseDialog
      v-model="detailsDialog"
      :title="details ? `${details.locode}${details.name ? ' · ' + details.name : ''}` : ''"
      :max-width-px="560"
    >
      <template v-if="details">
        <div class="detail-row" v-for="f in detailFacts" :key="f.label">
          <span class="detail-label">{{ f.label }}</span>
          <span class="detail-value">{{ f.value }}</span>
        </div>
        <template v-if="portAreas.length > 0">
          <div class="section-title q-mt-md q-mb-xs">Port areas</div>
          <div v-for="area in portAreas" :key="area.code ?? area.portAreaName" class="facility-row column items-start">
            <div class="row items-center q-gutter-x-sm">
              <span class="text-weight-semibold">{{ area.portAreaName || area.code || '—' }}</span>
              <span class="text-grey-7">{{ area.code }}</span>
              <q-chip v-if="area.isps" dense outline color="primary" class="isps-chip">ISPS</q-chip>
            </div>
            <div v-if="area.berths && area.berths.length > 0" class="text-caption text-grey-7">
              Berths: {{ area.berths.map((b) => b.code).join(', ') }}
            </div>
          </div>
        </template>
        <template v-if="facilities.length > 0">
          <div class="section-title q-mt-md q-mb-xs">Security (ISPS) facilities</div>
          <div v-for="f in facilities" :key="f.code" class="text-caption">
            <span :class="f.retired ? 'text-strike text-grey-6' : ''">
              {{ f.code }}<template v-if="f.name"> — {{ f.name }}</template>
            </span>
            <span v-if="f.retired" class="text-grey-7"> · retired</span>
          </div>
        </template>
        <q-expansion-item
          dense
          label="Raw location data"
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
import { fmtDay, fmtStamp } from '../../lib/time';
import { useQuasar, type QTableColumn } from 'quasar';
import { useAuth, type PortFacility, type RefLocation } from '../../auth/auth';
import HelpTip from '../../components/HelpTip.vue';
import HouseDialog from '../../components/HouseDialog.vue';
import SearchBox from '../../components/SearchBox.vue';

const $q = useQuasar();
const auth = useAuth();

const locations = ref<RefLocation[]>([]);
const total = ref(0);
const loading = ref(true);
// Server-side search (spec 0021): the dataset is far too large for the client.
const search = ref('');
// Sync-aware empty state (spec 0025): an empty table says WHY it is empty
const emptyLabel = ref('No locations yet.');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 350);
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

const detailsDialog = ref(false);
const details = ref<RefLocation | null>(null);

const columns: QTableColumn<RefLocation>[] = [
  { name: 'locode', label: 'LOCODE', align: 'left', field: 'locode', sortable: true },
  { name: 'name', label: 'Name', align: 'left', field: (r) => r.name ?? '', sortable: true },
  {
    name: 'country',
    label: 'Country',
    align: 'left',
    field: (r) => r.countryCode ?? '',
    sortable: true,
  },
  { name: 'updated', label: 'Updated', align: 'left', field: 'updated', sortable: true },
];

function fmtDate(iso: string): string {
  return fmtDay(iso);
}

const detailFacts = computed(() => {
  const d = details.value;
  if (!d) return [];
  return [
    { label: 'LOCODE', value: d.locode },
    { label: 'Name', value: d.name ?? '—' },
    { label: 'Country', value: d.countryCode ?? '—' },
    { label: 'Updated', value: fmtStamp(d.updated) },
  ];
});

// Hub dataset shape (spec 0027): rich detail only where the source has it
interface HubPortArea {
  code?: string;
  portAreaName?: string;
  isps?: boolean;
  berths?: { code?: string; name?: string }[];
}

const portAreas = computed<HubPortArea[]>(() => {
  const list = details.value?.data.portAreas;
  return Array.isArray(list) ? (list as HubPortArea[]) : [];
});

// GISIS names for the facility codes (spec 0053), fetched per dialog open;
// the row's bare codes are the graceful fallback while loading or on failure.
const namedFacilities = ref<PortFacility[] | null>(null);

const facilities = computed<PortFacility[]>(() => {
  if (namedFacilities.value) return namedFacilities.value;
  const list = details.value?.data.portFacilityCodes;
  return Array.isArray(list)
    ? (list as string[]).map((code) => ({ code, name: null, description: null }))
    : [];
});

function openDetails(row: RefLocation): void {
  details.value = row;
  detailsDialog.value = true;
  namedFacilities.value = null;
  void auth
    .portInfo(row.locode)
    .then((port) => {
      if (details.value?.locode === row.locode && port.facilities.length > 0) {
        namedFacilities.value = port.facilities;
      }
    })
    .catch(() => undefined);
}

// Locations need no NEMO connection (spec 0027): the worldwide list syncs
// from the published dataset, so an empty table only means "not synced yet".
function updateEmptyLabel(): void {
  emptyLabel.value = search.value.trim()
    ? 'No locations match your search.'
    : 'No locations yet — the first sync will fill this automatically.';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const page = await auth.listLocations(search.value.trim() || undefined);
    locations.value = page.locations;
    total.value = page.total;
    if (page.total === 0) updateEmptyLabel();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load locations.' });
  } finally {
    loading.value = false;
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
.ref-row {
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
.section-title {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 12px;
  font-weight: 600;
  color: var(--nl-ink-2);
}
.facility-row {
  display: flex;
  gap: 10px;
  padding: 4px 0;
  font-size: 14px;
  border-bottom: 1px solid var(--nl-line-row);
}
.facility-row:last-child {
  border-bottom: none;
}
.isps-chip {
  font-size: 12px;
  height: 20px;
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
