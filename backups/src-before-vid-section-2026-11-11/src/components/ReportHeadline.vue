<template>
  <header class="report-headline" :class="{ 'report-headline--without-navigation': hideNavigation }">
    <PortCallSectionNav v-if="!hideNavigation" :call="{ id: callId }">
      <slot v-if="$q.screen.lt.md" name="tools" />
    </PortCallSectionNav>
    <div class="report-headline__row">
      <div class="report-headline__heading">
        <p class="report-headline__step" aria-live="polite">{{ stepLabel }}</p>
        <h1 :id="titleId" ref="heading" tabindex="-1">{{ title }}</h1>
        <p v-if="context" class="report-headline__context">{{ context }}</p>
        <p v-if="subtitle" class="report-headline__subtitle">{{ subtitle }}</p>
        <slot name="subtitle-extra" />
        <div v-if="!$q.screen.lt.md && $slots.tools" class="report-headline__tools">
          <slot name="tools" />
        </div>
      </div>
      <div v-if="$slots.actions" class="report-headline__actions"><slot name="actions" /></div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import PortCallSectionNav from './PortCallSectionNav.vue';

defineProps<{
  callId: string;
  titleId: string;
  title: string;
  stepLabel: string;
  context?: string | undefined;
  subtitle?: string | undefined;
  hideNavigation?: boolean;
}>();

const $q = useQuasar();
const heading = ref<HTMLElement | null>(null);
onMounted(() => heading.value?.focus({ preventScroll: true }));
</script>

<style scoped>
/* Supplied Reports headline / Desktop / updated, Figma 647:11090.
   The caller supplies tools only on sections that already use them. */
.report-headline { display: flex; flex-direction: column; gap: 24px; min-width: 0; min-height: 190px; padding-block-end: 32px; border-block-end: 1px solid var(--blue-500); }
.report-headline--without-navigation { min-height: 0; }
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
