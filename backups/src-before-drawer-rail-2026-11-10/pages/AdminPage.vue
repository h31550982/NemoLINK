<template>
  <!-- Full width (user decision 2026-08-22): tabs run along the top and the
       master-data tables get the whole page — no centered max-width column. -->
  <q-page padding class="admin-page">
    <q-tabs
      dense
      no-caps
      align="left"
      active-color="tealdark"
      indicator-color="secondary"
      class="text-grey-7 q-mb-sm"
      mobile-arrows
      outside-arrows
    >
      <q-route-tab to="/admin/users" label="Users" icon="group" />
      <q-route-tab to="/admin/ships" label="Ships" icon="directions_boat" />
      <q-route-tab to="/admin/locations" label="Locations" icon="place" />
      <q-route-tab to="/admin/codelists" label="Codelists" icon="list_alt" />
      <q-route-tab to="/admin/hsmap" label="HS map" icon="swap_horiz" />
      <q-route-tab to="/admin/hazmat" label="Dangerous goods" icon="warning_amber" />
      <q-route-tab to="/admin/audit" label="Audit log" icon="history" />
      <q-route-tab to="/admin/sync" label="Sync" icon="sync" />
      <q-route-tab to="/admin/org" label="Organization" icon="apartment" />
    </q-tabs>
    <q-separator class="q-mb-md" />
    <router-view />
  </q-page>
</template>

<script setup lang="ts"></script>

<style scoped>
.admin-page {
  background: var(--blue-100);
}

/* Quasar paints hover on a pseudo-element above the cell's text. Our
   opaque Blue/200 would hide plain text there, so paint the cell instead. */
@media (any-hover: hover) {
  .admin-page :deep(.q-table > tbody > tr:not(.q-tr--no-hover):hover > td:not(.q-td--no-hover)) {
    background: var(--blue-200);
  }
  .admin-page :deep(.q-table > tbody > tr:not(.q-tr--no-hover):hover > td:not(.q-td--no-hover)::before) {
    content: none;
  }
}
</style>
