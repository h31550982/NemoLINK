<template>
  <Teleport to="body">
    <Transition appear name="port-call-drawer" @after-enter="emit('show')" @after-leave="restoreFocus">
      <aside
        v-if="modelValue"
        ref="panel"
        class="call-edit-drawer"
        :aria-label="ariaLabel ?? 'Edit port call'"
        @keydown.esc.stop.prevent="emit('update:modelValue', false)"
      >
        <slot />
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{ modelValue: boolean; ariaLabel?: string }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'show'): void;
}>();
const panel = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;

watch(() => props.modelValue, async (open) => {
  if (!open) return;
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  panel.value?.querySelector<HTMLElement>('.fcard__title')?.focus({ preventScroll: true });
}, { immediate: true });
function restoreFocus(): void {
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
}
onBeforeUnmount(restoreFocus);
</script>

<style>
:root {
  --nl-call-drawer-width: clamp(380px, 40vw, 560px);
}
.call-edit-drawer {
  position: fixed;
  inset-block-start: 0;
  inset-block-end: 0;
  right: 0;
  z-index: 3000;
  width: var(--nl-call-drawer-width);
  background: var(--nl-card);
  border-left: 1px solid var(--nl-g-line-base);
}
.port-call-drawer-enter-active {
  transition: transform 300ms cubic-bezier(0.2, 0, 0, 1);
}
.port-call-drawer-leave-active {
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
}
.port-call-drawer-enter-from,
.port-call-drawer-leave-to {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .port-call-drawer-enter-active,
  .port-call-drawer-leave-active {
    transition: opacity 150ms ease-out;
  }
  .port-call-drawer-enter-from,
  .port-call-drawer-leave-to {
    transform: none;
    opacity: 0;
  }
}
</style>
