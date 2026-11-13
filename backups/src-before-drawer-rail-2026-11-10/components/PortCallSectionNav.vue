<template>
  <nav class="section-pagination" aria-label="Port call overview">
    <router-link :to="{ name: 'port-call', params: { callId: call.id } }" class="section-pagination__link">
      <img :src="arrowBackUrl" alt="" width="20" height="20" />
      <span>Port call overview</span>
    </router-link>
    <div class="section-pagination__tools"><slot /></div>
  </nav>
</template>

<script setup lang="ts">
import type { PortCall } from '../auth/auth';
import arrowBackUrl from '../assets/figma/report-headline-arrow-back.svg';

defineProps<{ call: Pick<PortCall, 'id'> }>();
</script>

<style scoped>
.section-pagination { display: flex; align-items: center; justify-content: space-between; gap: 24px; height: 27px; margin: 0; }
.section-pagination__tools { flex: none; margin-inline-start: auto; }
.section-pagination__link { display: flex; align-items: center; gap: 8px; min-height: 48px; max-width: 100%; color: var(--text-300); font-size: 14px; font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
.section-pagination__link span { min-width: 0; }
.section-pagination__link img { flex: none; }
.section-pagination__link:hover > span { text-decoration: underline; text-underline-offset: 3px; }
.section-pagination a:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 4px; }
@media (max-width: 1023px) {
  .section-pagination { flex-wrap: wrap; height: auto; min-height: 48px; padding-block-end: 24px; border-block-end: 1px solid var(--blue-500); }
  .section-pagination__link { gap: 12px; }
}
@media (max-width: 599px) {
  .section-pagination { gap: 16px; }
  .section-pagination__link { flex: 1; }
}
</style>
