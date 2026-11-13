<template>
  <section v-if="modelValue" class="module-page" :class="$attrs.class" :style="{ '--module-action-height': `${actionHeight}px`, '--module-attachments-space': attachmentsVisible ? '384px' : '0px', '--attachment-duration': attachmentsVisible ? '300ms' : '200ms' }" :aria-labelledby="titleId" @keydown.capture="onKeydown">
    <PortCallSectionNav v-if="$slots.attachments" :call="{ id: callId }" class="module-page__nav" />
    <div class="module-page__workspace" :class="{ 'module-page__workspace--attachments': $slots.attachments }">
      <div class="module-page__content">
        <ReportHeadline
          class="module-page__header"
          :call-id="callId"
          :title-id="titleId"
          :title="title"
          :step-label="progressLabel"
          :context="context"
          :subtitle="subtitle"
          :hide-navigation="!!$slots.attachments"
        >
          <template v-if="$slots.tools" #tools><slot name="tools" /></template>
          <template v-if="$slots['subtitle-extra']" #subtitle-extra><slot name="subtitle-extra" /></template>
          <template v-if="$slots.attachments" #actions><div ref="attachmentTrigger" /></template>
        </ReportHeadline>
        <div v-if="$slots.band" class="module-page__band"><slot name="band" /></div>
        <div class="module-page__body">
          <ReportReadyBanner v-if="ready" />
          <slot v-else />
        </div>
      </div>
      <slot name="attachments" />
    </div>
    <footer v-if="mainLabel || $slots.actions || $slots.secondary" ref="actionBar" class="module-page__actions">
      <div class="module-page__action-content">
      <slot name="secondary" />
      <div class="module-page__extra"><slot name="actions" /></div>
      <div v-if="mainLabel" class="module-page__main">
        <q-btn unelevated no-caps :color="mainColor" :label="mainLabel" :icon="mainIcon" :icon-right="mainIconRight" :loading="mainLoading" :disable="mainDisable" @click="emit('main')" />
        <span v-if="!noShortcutHint" class="module-page__hint" aria-hidden="true">{{ shortcut }}</span>
      </div>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, provide, ref, useId, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useRoute } from 'vue-router';
import ReportHeadline from './ReportHeadline.vue';
import PortCallSectionNav from './PortCallSectionNav.vue';
import ReportReadyBanner from './ReportReadyBanner.vue';
import { reportAttachmentMovingKey, reportAttachmentTriggerKey, reportAttachmentVisibleKey } from '../lib/report-attachment-trigger';

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{
  modelValue: boolean;
  title: string;
  context?: string | undefined;
  stepLabel?: string | undefined;
  ready?: boolean;
  subtitle?: string | undefined;
  helpTopic?: string | undefined;
  mainLabel?: string | undefined;
  mainIcon?: string | undefined;
  mainIconRight?: string | undefined;
  mainColor?: 'primary' | 'negative' | 'positive';
  mainLoading?: boolean | undefined;
  mainDisable?: boolean | undefined;
  noShortcutHint?: boolean;
}>(), { mainColor: 'primary' });
const emit = defineEmits<{ main: []; 'update:modelValue': [value: boolean] }>();
const titleId = useId();
const attachmentTrigger = ref<HTMLElement | null>(null);
provide(reportAttachmentTriggerKey, attachmentTrigger);
const attachmentsVisible = ref(false);
provide(reportAttachmentVisibleKey, attachmentsVisible);
provide(reportAttachmentMovingKey, ref(false));
const route = useRoute();
const callId = computed(() => String(route.params.callId ?? ''));
const actionBar = ref<HTMLElement | null>(null);
const actionHeight = ref(0);
let actionObserver: ResizeObserver | null = null;
watch(actionBar, element => {
  actionObserver?.disconnect();
  if (!element) { actionHeight.value = 0; return; }
  const measure = () => { actionHeight.value = Math.ceil(element.getBoundingClientRect().height); };
  measure();
  actionObserver = new ResizeObserver(measure);
  actionObserver.observe(element);
}, { flush: 'post' });
onBeforeUnmount(() => actionObserver?.disconnect());
const $q = useQuasar();
const shortcut = computed(() => $q.platform.is.mac ? '⌘ + Enter' : 'Ctrl + Enter');
const progressLabel = computed(() => `Step ${(props.stepLabel ?? '1 of 1').replace(/\s+of\s+/, '/')}`);
async function onKeydown(event: KeyboardEvent): Promise<void> {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || !props.mainLabel) return;
  event.preventDefault();
  event.stopPropagation();
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  focused?.blur();
  await nextTick();
  if (!props.mainDisable && !props.mainLoading) emit('main');
  await nextTick();
  if (focused?.isConnected) focused.focus();
}
</script>

<style scoped>
.module-page { width: 100%; min-width: 0; padding-block-end: calc(var(--module-action-height, 0px) + 40px); color: var(--text-300); }
.module-page__header { margin-block-end: var(--nl-report-headline-content-gap); }
.module-page__nav { margin-block-end: 24px; }
.module-page__band { padding-inline-start: var(--nl-report-content-inset); padding-block-end: 24px; margin-block-end: 32px; border-block-end: 1px solid var(--blue-500); }
.module-page__workspace { min-width: 0; }
.module-page__workspace--attachments { display: flex; align-items: stretch; }
.module-page__workspace--attachments > :deep(.report-attachments--open) { margin-inline-start: 24px; }
.module-page__content { min-width: 0; }
.module-page__workspace--attachments > .module-page__content { flex: 1; }
.module-page__body { min-width: 0; padding-inline-start: var(--nl-report-content-inset); }
.module-page__body :deep(.rp), .module-page__body :deep(.wz-sum) { width: 100%; max-width: none; }
.module-page__body :deep(.ata-body) { min-height: 0; }
.module-page__actions { position: fixed; inset-inline: 0; inset-block-end: 0; z-index: 1900; background: var(--blue-100); }
.module-page__action-content { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; width: 100%; max-width: 1272px; margin-inline: auto; padding: 24px 16px calc(24px + env(safe-area-inset-bottom)); padding-inline-start: calc(16px + var(--nl-report-content-inset)); padding-inline-end: calc(16px + var(--module-attachments-space, 0px)); }
.module-page__extra { display: flex; flex: 1; flex-wrap: wrap; gap: 12px; }
.module-page__main { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.module-page__actions :deep(.q-btn) { min-height: 44px; }
.module-page__hint { color: var(--text-100); font-size: 12px; }
@media (max-width: 1023px) {
  .module-page__header { margin-block-end: 32px; }
  .module-page__body { padding-inline-start: 0; }
  .module-page__band { padding-inline-start: 0; }
  .module-page__action-content { padding-inline-start: 16px; }
}
@media (max-width: 599px) {
  .module-page__hint { display: none; }
  .module-page__action-content { gap: 12px; }
  .module-page__actions :deep(.q-btn__content) { white-space: normal; }
}
@media (prefers-reduced-motion: no-preference) {
  .module-page__action-content { transition: padding-inline-end var(--attachment-duration, 300ms) cubic-bezier(0.2, 0, 0, 1); }
}
</style>
