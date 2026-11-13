<template>
  <span class="progress-pill" :class="`progress-pill--${state}`">{{ words[state] }}</span>
</template>

<script setup lang="ts">
import type { ProgressState } from '../lib/port-call-process';
defineProps<{ state: ProgressState }>();
const words: Record<ProgressState, string> = {
  completed: 'Completed', 'in-progress': 'In progress', 'not-started': 'Not started yet', blocked: 'Cannot start yet',
};
</script>

<style scoped>
/* Figma 587:8885. These progress states are separate from NEMO report status. */
.progress-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.12px;
  white-space: nowrap;
  background: var(--nl-progress-neutral-fill);
  color: var(--nl-progress-neutral-text);
}
.progress-pill--completed { background: var(--blue-800); color: var(--blue-100); }
.progress-pill--in-progress { background: var(--nl-progress-active-fill); color: var(--blue-800); }
</style>
