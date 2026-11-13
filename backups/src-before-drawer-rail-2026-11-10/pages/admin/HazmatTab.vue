<template>
  <div>
    <div class="tab-title q-mb-md row items-center">
      <span>Dangerous goods</span>
      <HelpTip topic="admin.hazmat" />
      <q-space />
      <SearchBox v-model="search" placeholder="Search dangerous goods" />
    </div>

    <div v-if="loading && items.length === 0" class="row justify-center q-pa-lg">
      <q-spinner size="32px" color="primary" />
    </div>

    <template v-else>
      <q-table
        :rows="items"
        :columns="columns"
        row-key="hazmatId"
        flat
        bordered
        dense
        hide-bottom
        :pagination="{ rowsPerPage: 0 }"
        class="ref-table rounded-borders"
        :no-data-label="emptyLabel"
      >
        <template #body="props">
          <q-tr :props="props">
            <q-td key="undg" :props="props" class="text-weight-semibold">
              {{ props.row.undgNumber ?? '—' }}
            </q-td>
            <q-td key="name" :props="props">{{ props.row.properShippingName ?? '—' }}</q-td>
            <q-td key="class" :props="props">{{ props.row.hazardClass ?? '—' }}</q-td>
            <q-td key="updated" :props="props">{{ fmtDate(props.row.updated) }}</q-td>
          </q-tr>
        </template>
      </q-table>

      <div v-if="total > items.length" class="text-caption text-grey-7 q-mt-sm">
        Showing the first {{ items.length }} of {{ total }} — refine your search to
        narrow down.
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { fmtDay } from '../../lib/time';
import { useQuasar, type QTableColumn } from 'quasar';
import { useAuth, type HazmatItem } from '../../auth/auth';
import HelpTip from '../../components/HelpTip.vue';
import SearchBox from '../../components/SearchBox.vue';

const $q = useQuasar();
const auth = useAuth();

const items = ref<HazmatItem[]>([]);
const total = ref(0);
const loading = ref(true);
const search = ref('');
// Sync-aware empty state (spec 0025): an empty table says WHY it is empty
const emptyLabel = ref('No dangerous goods data yet.');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 350);
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

const columns: QTableColumn<HazmatItem>[] = [
  { name: 'undg', label: 'UN number', align: 'left', field: (r) => r.undgNumber ?? '', sortable: true },
  {
    name: 'name',
    label: 'Proper shipping name',
    align: 'left',
    field: (r) => r.properShippingName ?? '',
    sortable: true,
  },
  { name: 'class', label: 'Class', align: 'left', field: (r) => r.hazardClass ?? '', sortable: true },
  { name: 'updated', label: 'Updated', align: 'left', field: 'updated', sortable: true },
];

function fmtDate(iso: string): string {
  return fmtDay(iso);
}

async function updateEmptyLabel(): Promise<void> {
  if (search.value.trim()) {
    emptyLabel.value = 'No dangerous goods match your search.';
    return;
  }
  try {
    const status = await auth.syncStatus();
    const dataset = status.datasets.find((d) => d.job === 'hazmat');
    emptyLabel.value = dataset && !dataset.available
      ? 'Waiting for the NEMO connection — dangerous-goods data arrives automatically once the service is configured (see the Sync tab).'
      : 'No dangerous goods data yet — the first sync will fill this automatically.';
  } catch {
    emptyLabel.value = 'No dangerous goods data yet.';
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const page = await auth.listHazmat(search.value.trim() || undefined);
    items.value = page.items;
    total.value = page.total;
    if (page.total === 0) await updateEmptyLabel();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load dangerous goods.' });
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
</style>
