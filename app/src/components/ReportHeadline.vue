<template>
  <header class="report-headline">
    <!-- Always a way back to the port call's own list, however the report was opened (user 2026-11-12).
         Phones have the same link as the arrow in the app header. -->
    <nav v-if="callId" class="report-headline__nav" aria-label="Port call overview">
      <router-link :to="{ name: 'port-call', params: { callId } }" class="report-headline__back">
        <img :src="arrowBackUrl" alt="" width="20" height="20" />
        <span>Port call overview</span>
      </router-link>
    </nav>
    <div class="report-headline__row">
      <div class="report-headline__heading">
        <p class="report-headline__step" aria-live="polite">{{ stepLabel }}</p>
        <h1 :id="titleId" ref="heading" tabindex="-1">{{ title }}</h1>
        <p v-if="context" class="report-headline__context">{{ context }}</p>
        <p v-if="subtitle" class="report-headline__subtitle">{{ subtitle }}</p>
        <slot name="subtitle-extra" />
        <div v-if="$slots.tools" class="report-headline__tools">
          <slot name="tools" />
        </div>
      </div>
      <div v-if="$slots.actions" class="report-headline__actions"><slot name="actions" /></div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import arrowBackUrl from '../assets/figma/report-headline-arrow-back.svg';

defineProps<{
  titleId: string;
  title: string;
  stepLabel: string;
  context?: string | undefined;
  subtitle?: string | undefined;
}>();

const route = useRoute();
const callId = computed(() => (typeof route.params.callId === 'string' && route.name !== 'port-call' ? route.params.callId : ''));
const heading = ref<HTMLElement | null>(null);
onMounted(() => heading.value?.focus({ preventScroll: true }));
</script>

<style scoped>
/* Supplied Reports headline / Desktop / updated, Figma 647:11090.
   The caller supplies tools only on sections that already use them. */
.report-headline { display: flex; flex-direction: column; gap: 24px; min-width: 0; min-height: 106px; padding-block-end: 32px; border-block-end: 1px solid var(--blue-500); }
.report-headline__nav { display: flex; margin-block-end: -8px; padding-inline-start: var(--nl-report-content-inset); }
.report-headline__back { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; color: var(--text-300); font-size: 14px; font-weight: 600; line-height: 20px; letter-spacing: 0.14px; text-decoration: none; }
.report-headline__back img { flex: none; }
.report-headline__back:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 4px; border-radius: 4px; }
@media (hover: hover) { .report-headline__back:hover > span { text-decoration: underline; text-underline-offset: 3px; } }
@media (max-width: 599.98px) { .report-headline__nav { display: none; } }
.report-headline__row { display: flex; align-items: flex-start; gap: 24px; min-width: 0; }
.report-headline__heading { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 106px; padding-inline-start: var(--nl-report-content-inset); }
.report-headline__actions { flex: none; padding-block-start: 12px; }
.report-headline__tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-block-start: 12px; }
.report-headline__step { display: flex; align-items: center; min-height: 20px; margin: 0; color: var(--text-100); font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: 0.6px; text-transform: uppercase; }
.report-headline h1 { margin: 0; color: var(--text-300); font-size: 22px; font-weight: 600; line-height: 28px; letter-spacing: 0.22px; overflow-wrap: anywhere; }
.report-headline h1:focus { outline: none; }
.report-headline__context { margin: 0; color: var(--text-200); font-size: 14px; font-weight: 500; line-height: 22px; letter-spacing: 0.14px; overflow-wrap: anywhere; }
.report-headline__subtitle { margin: 10px 0 0; color: var(--text-200); font-size: 14px; }
@media (max-width: 1023px) {
  .report-headline { gap: 32px; min-height: 0; padding: 0; border: 0; }
  .report-headline__heading { min-height: 0; padding: 0; }
  .report-headline__step { margin-bottom: 12px; font-size: 14px; font-weight: 500; line-height: 20px; letter-spacing: 0.01em; }
  .report-headline h1 { line-height: normal; }
  .report-headline__context { margin-top: 8px; font-size: 16px; letter-spacing: 0.16px; }
}
</style>
