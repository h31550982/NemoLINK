<template>
  <div class="report-ready" :class="`report-ready--${tone}`" role="status" @dragover.prevent.stop @drop.prevent.stop>
    <img v-if="tone === 'ok'" :src="checkUrl" alt="" width="22" height="22" />
    <q-icon v-else :name="tone === 'error' ? 'error' : 'info'" size="22px" />
    <span><slot>Everything NEMO asks for is here.</slot></span>
  </div>
</template>

<script setup lang="ts">
import checkUrl from '../assets/figma/check-circle-filled.svg';
withDefaults(defineProps<{ tone?: 'ok' | 'check' | 'error' }>(), { tone: 'ok' });
</script>

<style scoped>
.report-ready { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 12px 32px 12px 24px; margin-block-end: 26px; border-radius: 10px; background: var(--nl-g-head-surface); color: var(--nl-g-ink); font-size: 14px; font-weight: 600; line-height: normal; letter-spacing: .14px; }
.report-ready img { flex: none; }
.report-ready--check { background: var(--orange-100); color: var(--orange-500); }
.report-ready--error { background: var(--red-100); color: var(--red-300); }
.report-ready--error .q-icon { color: var(--red-200); }
.report-ready .q-icon { flex: none; }
</style>
