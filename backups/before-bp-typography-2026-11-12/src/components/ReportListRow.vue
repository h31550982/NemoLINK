<template>
  <div class="report-list-row" :class="{ 'report-list-row--simple': simple }">
    <slot v-if="simple" name="status" />
    <div class="report-list-row__body"><slot /></div>
    <slot v-if="!simple" name="status" />
  </div>
</template>

<script setup lang="ts">
// A leading badge is reserved for a row containing just its status and text.
// Rows with values or supporting details keep their status on the right.
withDefaults(defineProps<{ simple?: boolean }>(), { simple: true });
</script>

<style scoped>
.report-list-row { display: flex; align-items: center; gap: 16px; min-height: 48px; padding-block: 6px; border-block-end: 1px solid var(--blue-500); }
.report-list-row__body { display: flex; flex: 1 1 0; flex-direction: column; gap: 4px; min-width: 0; padding-block: 6px; overflow-wrap: anywhere; }
.report-list-row > :slotted(.pill), .report-list-row > :slotted(.rp-pill-info) { flex: none; }
.report-list-row--simple { min-height: 56px; border: 0; }
.report-list-row--simple .report-list-row__body { padding: 0; }
@media (max-width: 1023px) {
  .report-list-row { min-height: var(--nl-row-mobile-min-height); padding-block: 0; }
  .report-list-row__body { padding-block: 0; }
}
</style>
