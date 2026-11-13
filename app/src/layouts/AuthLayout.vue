<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container class="auth-ground">
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts"></script>

<style scoped>
.auth-ground {
  background: var(--nl-ground); /* flat: no gradients (guide p. 10) */
  /* Installed-app mode (spec 0018): clear the status bar / notch. */
  padding-top: env(safe-area-inset-top);
}
</style>
