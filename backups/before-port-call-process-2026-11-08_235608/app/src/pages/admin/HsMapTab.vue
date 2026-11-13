<template>
  <div>
    <div class="tab-title q-mb-md row items-center">
      <span>Cargo HS map</span>
      <HelpTip topic="admin.hsmap" />
      <q-space />
      <SearchBox v-model="search" placeholder="Search cargo types" />
    </div>

    <div v-if="loading" class="row justify-center q-pa-lg">
      <q-spinner size="32px" color="primary" />
    </div>

    <q-table
      v-else
      :rows="filtered"
      :columns="columns"
      row-key="key"
      flat
      bordered
      dense
      hide-bottom
      :pagination="{ rowsPerPage: 0 }"
      class="ref-table rounded-borders"
      :no-data-label="search
        ? 'No cargo types match your search.'
        : 'No HS map yet — it arrives via sync (see the Sync tab).'"
    >
      <template #body="props">
        <q-tr :props="props">
          <q-td key="group" :props="props">
            <div class="text-weight-semibold">{{ props.row.groupLabel ?? props.row.groupCode }}</div>
            <div class="text-caption text-grey-7">Group {{ props.row.groupCode }}</div>
          </q-td>
          <q-td key="refinement" :props="props">{{ props.row.refinement }}</q-td>
          <q-td key="hs" :props="props">
            <div class="text-weight-semibold">{{ props.row.hs6 }}</div>
            <div v-if="props.row.hsName" class="text-caption text-grey-7 hs-name">
              {{ props.row.hsName }}
            </div>
          </q-td>
        </q-tr>
      </template>
    </q-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar, type QTableColumn } from 'quasar';
import { useAuth, type HsMapRow } from '../../auth/auth';
import HelpTip from '../../components/HelpTip.vue';
import SearchBox from '../../components/SearchBox.vue';

const $q = useQuasar();
const auth = useAuth();

const rows = ref<HsMapRow[]>([]);
const loading = ref(true);
const search = ref('');

type KeyedRow = HsMapRow & { key: string };

// ~46 rows — client-side filtering is fine here (spec 0023)
const filtered = computed<KeyedRow[]>(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value
    .filter(
      (r) =>
        !q ||
        r.groupCode.toLowerCase().includes(q) ||
        (r.groupLabel ?? '').toLowerCase().includes(q) ||
        r.refinement.toLowerCase().includes(q) ||
        r.hs6.includes(q) ||
        (r.hsName ?? '').toLowerCase().includes(q),
    )
    .map((r) => ({ ...r, key: `${r.groupCode}\t${r.refinement}` }));
});

const columns: QTableColumn<KeyedRow>[] = [
  {
    name: 'group',
    label: 'Cargo type',
    align: 'left',
    field: (r) => `${r.groupCode} ${r.groupLabel ?? ''}`,
    sortable: true,
  },
  { name: 'refinement', label: 'Refinement', align: 'left', field: 'refinement', sortable: true },
  { name: 'hs', label: 'HS code', align: 'left', field: 'hs6', sortable: true },
];

onMounted(async () => {
  try {
    rows.value = await auth.listHsMap();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load the HS map.' });
  } finally {
    loading.value = false;
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
.hs-name {
  max-width: 420px;
}
</style>
