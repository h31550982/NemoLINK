<template>
  <!-- A long form as a card centred on the page (Figma "New port call
       card"): the title with Close at the top right, the form, the main
       button in a footer that stays in view.
       Ctrl/⌘+Enter runs the main button, as in every dialog (spec 0073). -->
  <section class="fcard" :aria-labelledby="titleId" @keydown.capture="onKeydown">
    <header class="fcard__head">
      <h1 :id="titleId" class="fcard__title" tabindex="-1">{{ title }}</h1>
      <button type="button" class="nl-close-x fcard__close" aria-label="Close" @click="emit('close')">
        <q-icon name="close" />
      </button>
    </header>

    <div class="fcard__form">
      <slot />
    </div>

    <footer class="fcard__foot">
      <!-- The main button with its shortcut under it (Figma 444:6937) -->
      <div class="fcard__main-wrap">
        <q-btn
          unelevated
          no-caps
          color="primary"
          class="fcard__main"
          :label="mainLabel"
          :loading="mainLoading"
          :disable="mainDisable"
          @click="emit('main')"
        />
        <div class="fcard__hint" aria-hidden="true">{{ shortcut }}</div>
      </div>
      <!-- Why the main button is off (user 2026-11-13): the gaps in words -->
      <p v-if="mainNote" class="fcard__note" role="status">{{ mainNote }}</p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, useId } from 'vue';
import { useQuasar } from 'quasar';
import { isMainShortcut, useMainShortcut } from '../lib/main-shortcut';

const props = defineProps<{
  title: string;
  mainLabel: string;
  mainLoading?: boolean | undefined;
  mainDisable?: boolean | undefined;
  /** Beside the main button: what still stops it, in words. */
  mainNote?: string | null | undefined;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'main'): void }>();

const titleId = useId();
const $q = useQuasar();
const shortcut = computed(() => ($q.platform.is.mac ? '⌘ + Enter' : 'Ctrl + Enter'));

/** Ctrl/⌘+Enter: commit the field being typed in first (blur), then run
    the main button if it is live — the same shortcut as HouseDialog. */
// Also when focus has dropped out of the card (a click on its blank space)
useMainShortcut(() => true, (e) => void onKeydown(e));
async function onKeydown(e: KeyboardEvent): Promise<void> {
  if (!isMainShortcut(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  focused?.blur();
  await nextTick();
  if (!props.mainDisable && !props.mainLoading) emit('main');
  await nextTick();
  if (focused?.isConnected) focused.focus();
}
</script>

<style scoped>
/* The card's corner radius: change it here and on .fcard__foot below.
   The page may set the size (--fcard-width, --fcard-height); the form then
   scrolls between the fixed title and footer. */
.fcard {
  display: flex;
  flex-direction: column;
  /* Figma 444:6905: 560px, fields 512px wide inside 24px padding */
  max-width: var(--fcard-width, 560px);
  height: var(--fcard-height, auto);
  margin: 0 auto;
  background: var(--nl-card);
  border-radius: 12px;
}
/* The title over a Blue/600 divider, 24px in, 18px under it */
.fcard__head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 24px 18px;
  border-bottom: 1px solid var(--nl-g-line-base);
}
.fcard__title {
  margin: 0;
  min-width: 0;
  color: var(--nl-g-ink);
  /* Heading/22 */
  font-size: 22px;
  line-height: normal;
  font-weight: 600;
  letter-spacing: 0.22px;
}
/* Close: the shared X, centred on the title line by the head's own alignment */
.fcard__close {
  margin: 0;
}
.fcard__form {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  gap: 32px;
  padding: 24px;
}
/* The action bar: Blue/200 over a Blue/600 line */
.fcard__foot {
  flex: none;
  display: flex;
  align-items: flex-start;
  padding: 24px 24px 16px;
  background: var(--nl-g-subtle);
  border-top: 1px solid var(--nl-g-line-base);
  border-radius: 0 0 12px 12px; /* the card's bottom corners */
}
.fcard__main-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
/* Button/Large: 44px, Heading/14 label; disabled at 70% */
.fcard__main {
  min-height: 44px;
  padding: 0 16px;
  font-size: 14px;
  line-height: normal;
  letter-spacing: 0.14px;
}
.fcard__main.disabled {
  opacity: 0.7 !important;
}
/* What still stops the main button: Body/14 Medium in Text/200, centred on it */
.fcard__note {
  flex: 1 1 0;
  min-width: 0;
  margin: 0 0 0 16px;
  min-height: 44px;
  display: flex;
  align-items: center;
  color: var(--text-200);
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0.14px;
}
/* Body text/12 in Text/100 */
.fcard__hint {
  color: var(--nl-g-secondary);
  font-size: 12px;
  line-height: normal;
  font-weight: 500;
  letter-spacing: 0.12px;
  white-space: nowrap;
}
/* Form sections (Figma): a dotted capitals title 14px above the fields,
   the fields 20px apart */
.fcard__form :slotted(.fcard-section) {
  display: flex;
  flex-direction: column;
  gap: 20px;
  /* The fields keep their 512px in a wider card */
  max-width: 512px;
}
.fcard__form :slotted(.fcard-section__title) {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 -6px;
  color: var(--nl-g-secondary);
  font-size: 14px;
  line-height: normal;
  font-weight: 600;
  letter-spacing: 0.48px;
  text-transform: uppercase;
}
/* The 7px Blue/800 dot before the title */
.fcard__form :slotted(.fcard-section__title)::before {
  content: '';
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--nl-g-blue);
}
@media (max-width: 599.98px) {
  /* The title 20px from the top, as in every phone pop-up (grabber 14 + 6) */
  .fcard__head {
    padding: 20px 16px 14px;
  }
  .fcard__form {
    padding: 24px 16px;
  }
  /* The phone action bar: a fixed 90px — 12px, the 44px button, then 34px */
  .fcard__foot {
    height: 90px;
    padding: 12px 16px 34px;
  }
  /* No keyboard shortcut on a phone */
  .fcard__hint {
    display: none;
  }
}
</style>
