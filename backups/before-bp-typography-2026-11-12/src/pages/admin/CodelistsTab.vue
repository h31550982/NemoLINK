<template>
  <div>
    <div class="tab-title q-mb-md row items-center q-gutter-sm">
      <span>Codelists</span>
      <HelpTip topic="admin.codelists" />
      <q-space />
      <q-select
        v-model="selected"
        :options="listOptions"
        emit-value
        map-options
        dense
        outlined
        class="list-select"
        label="Codelist"
      />
      <SearchBox v-model="search" placeholder="Search codes" />
    </div>

    <div v-if="loading && entries.length === 0" class="row justify-center q-pa-lg">
      <q-spinner size="32px" color="primary" />
    </div>

    <template v-else>
      <q-table
        :rows="entries"
        :columns="columns"
        row-key="code"
        flat
        bordered
        dense
        hide-bottom
        :pagination="{ rowsPerPage: 0 }"
        class="ref-table rounded-borders"
        :no-data-label="noDataLabel"
      >
        <template #body="props">
          <q-tr :props="props">
            <q-td key="code" :props="props" class="text-weight-semibold">
              {{ props.row.code }}
            </q-td>
            <q-td key="en" :props="props">{{ props.row.en ?? '—' }}</q-td>
            <q-td key="fi" :props="props">{{ props.row.fi ?? '—' }}</q-td>
            <q-td key="sv" :props="props">{{ props.row.sv ?? '—' }}</q-td>
            <q-td key="national" :props="props">
              <q-chip v-if="props.row.fiPreferred" dense outline color="primary">
                FI preferred
              </q-chip>
              <q-chip v-if="props.row.national" dense outline color="grey-7">
                national
              </q-chip>
            </q-td>
          </q-tr>
        </template>
      </q-table>

      <div v-if="total > entries.length" class="text-caption text-grey-7 q-mt-sm">
        Showing the first {{ entries.length }} of {{ total }} — refine your search to
        narrow down.
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useQuasar, type QTableColumn } from 'quasar';
import { useAuth, type CodelistEntry, type CodelistSummary } from '../../auth/auth';
import HelpTip from '../../components/HelpTip.vue';
import SearchBox from '../../components/SearchBox.vue';

const $q = useQuasar();
const auth = useAuth();

const codelists = ref<CodelistSummary[]>([]);
const selected = ref<string | null>(null);
const entries = ref<CodelistEntry[]>([]);
const total = ref(0);
const loading = ref(true);
const search = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void loadEntries(), 350);
});

watch(selected, () => void loadEntries());

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

const listOptions = computed(() =>
  codelists.value.map((c) => ({
    label: `${c.codelist.replaceAll('_', ' ')} (${c.entries})`,
    value: c.codelist,
  })),
);

const noDataLabel = computed(() => {
  if (codelists.value.length === 0) {
    return 'No codelists yet — they arrive via sync (see the Sync tab).';
  }
  return search.value ? 'No entries match your search.' : 'This codelist is empty.';
});

const columns: QTableColumn<CodelistEntry>[] = [
  { name: 'code', label: 'Code', align: 'left', field: 'code', sortable: true },
  { name: 'en', label: 'English', align: 'left', field: (r) => r.en ?? '', sortable: true },
  { name: 'fi', label: 'Finnish', align: 'left', field: (r) => r.fi ?? '', sortable: true },
  { name: 'sv', label: 'Swedish', align: 'left', field: (r) => r.sv ?? '', sortable: true },
  { name: 'national', label: '', align: 'left', field: 'national' },
];

async function loadEntries(): Promise<void> {
  if (!selected.value) {
    entries.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const page = await auth.listCodelistEntries(
      selected.value,
      search.value.trim() || undefined,
    );
    entries.value = page.entries;
    total.value = page.total;
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load the codelist.' });
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    codelists.value = await auth.listCodelists();
    // Pick the first list by default; its watch triggers the entry load.
    selected.value = codelists.value[0]?.codelist ?? null;
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load codelists.' });
  } finally {
    if (!selected.value) loading.value = false;
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
.list-select {
  min-width: 240px;
  background: white;
  border-radius: 10px;
}
.list-select :deep(.q-field__control):before {
  border-color: var(--nl-line-2);
}
</style>
