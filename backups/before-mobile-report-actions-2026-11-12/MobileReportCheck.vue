<template><main class="nl-v1" style="padding: 24px 20px"><FormsWizardDialog :model-value="true" page :call="call" :files="[]" :docs="[]" start-at="crew" /></main></template>
<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import FormsWizardDialog from '../components/FormsWizardDialog.vue';
import type { NemoTable, PortCall } from '../auth/auth';
const call = { id: 'mobile-report-check', shipName: 'Black Pearl', portName: 'Dragsfjärd' } as PortCall;
const table: NemoTable = {
  key: 'crew', label: 'Crew and effects', rowNoun: 'crew members', sheet: 'Crew list', sources: [], fields: [], header: {},
  columns: [{ key: 'familyName', label: 'Family name', kind: 'text', required: true, de: null }, { key: 'documentExpiry', label: 'Document expiry date', kind: 'date', required: true, de: null }],
  rows: [{ key: 'jack', label: 'SPARROW, JACK', cells: { familyName: { value: 'SPARROW' }, documentExpiry: { value: null, flag: 'missing' } } }, { key: 'gibbs', label: 'GIBBS, JOSHAMEE', cells: { familyName: { value: null, flag: 'missing' }, documentExpiry: { value: null, flag: 'missing' } } }],
  counts: { missing: 3, error: 0, warning: 0, conflict: 0 },
};
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('/portcalls/mobile-report-check')) {
    if (url.endsWith('/entry') && init?.body) {
      const entry = JSON.parse(String(init.body));
      const cell = table.rows.find(row => row.key === entry.rowKey)!.cells[entry.column]!;
      if (cell.flag === 'missing') table.counts.missing--;
      cell.value = entry.value; delete cell.flag;
    }
    return new Response(JSON.stringify(url.endsWith('/documents') ? { documents: [] } : { tables: [table] }), { headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(input, init);
};
onBeforeUnmount(() => { window.fetch = originalFetch; });
</script>
