<template>
  <button
    type="button"
    class="chip-btn"
    :class="{ 'chip-btn--open': open }"
    :aria-expanded="open"
    :aria-label="`${obligation.code} — ${stateWords(obligation, vidSent)}`"
    @click="emit('pick', obligation.code)"
  >
    <StatusPill
      :tone="chipTone(obligation, vidSent)"
      :icon="chipIcon(obligation, vidSent)"
      :label="codeLabel(obligation)"
    />
    <q-tooltip>{{ obligation.title }} — {{ stateWords(obligation, vidSent) }}</q-tooltip>
  </button>
</template>

<script setup lang="ts">
/**
 * One reporting obligation as a compact NEMO-code chip (docs/specs/0048).
 * Tapping it asks the block to show what is still missing.
 */
import type { Obligation } from '../auth/auth';
import { chipIcon, chipTone, codeLabel, stateWords } from '../lib/obligations';
import StatusPill from './StatusPill.vue';

withDefaults(defineProps<{ obligation: Obligation; open?: boolean; vidSent?: boolean }>(), {
  vidSent: true,
});
const emit = defineEmits<{ (e: 'pick', code: string): void }>();
</script>

<style scoped>
.chip-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  border-radius: 12px;
  line-height: 1;
}
.chip-btn:focus-visible {
  outline: 2px solid var(--nl-teal-dark);
  outline-offset: 1px;
}
.chip-btn--open {
  box-shadow: 0 0 0 2px var(--nl-teal-dark);
}
.chip-btn :deep(.pill span) {
  font-size: 12px;
}
</style>
