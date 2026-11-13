<template>
  <!-- On a phone every dialog is a bottom sheet (spec 0092): pinned to the
       bottom, full width, rounded on top, with a grabber; a swipe down on the
       header closes it like the × does. -->
  <q-dialog
    :model-value="modelValue"
    persistent
    no-shake
    :position="sheet ? 'bottom' : 'standard'"
    :full-width="sheet"
        @update:model-value="emit('update:modelValue', $event)"
    @keydown.capture="onKeydown"
  >
    <!-- The shortcut listens on the dialog, not the card: on open Quasar
         focuses the dialog's own wrapper, outside the card (spec 0073) -->
    <q-card
      class="house-dialog"
      :class="{
        'house-dialog--sheet': sheet,
        'house-dialog--full-height': fullHeight && !sheet,
        'house-dialog--snug': snug,
      }"
      :style="sheet ? undefined : { maxWidth }"
    >
      <div
        v-if="sheet"
        class="house-dialog__grab"
        aria-hidden="true"
        @touchstart.passive="onGrabStart"
        @touchend.passive="onGrabEnd"
      ><span class="house-dialog__grab-bar" /></div>
      <q-card-section
        class="house-dialog__header row items-center no-wrap"
        :class="{ 'house-dialog__header--banded': banded }"
        @touchstart.passive="onGrabStart"
        @touchend.passive="onGrabEnd"
      >
        <!-- The phone header is Figma "popup header / mobile" (546:4306, user
             2026-11-06): the title and the X, nothing else -->
        <div v-if="sheet" class="col house-dialog__title house-dialog__title--sheet">{{ shownTitle }}</div>
        <div v-else class="col">
          <!-- The help tip beside the title instead of by Close (Ship forms, user 2026-11-02) -->
          <div v-if="helpBesideTitle && helpTopic" class="house-dialog__title-row">
            <div class="house-dialog__title" :class="`house-dialog__title--${titleStyle}`">{{ shownTitle }}</div>
            <HelpTip :topic="helpTopic" />
          </div>
          <div v-else class="house-dialog__title" :class="`house-dialog__title--${titleStyle}`">{{ shownTitle }}</div>
          <div v-if="subtitle" class="house-dialog__subtitle">{{ subtitle }}</div>
          <!-- A second quiet line, for a dialog that needs more than words there -->
          <slot name="subtitle-extra" />
        </div>
        <HelpTip v-if="helpTopic && !helpBesideTitle && !sheet" :topic="helpTopic" />
        <!-- Close: the 24px X, top right of every dialog (guide p. 11) -->
        <button
          v-if="!noX"
          type="button"
          class="house-dialog__close nl-close-x"
          aria-label="Close"
          v-close-popup
        >
          <q-icon name="close" />
        </button>
      </q-card-section>
      <!-- A band under the title that stays put while the body scrolls
           (the Ship forms steps). Never on the phone: the step is in the
           title and the counter sits in the action bar -->
      <div v-if="banded" class="house-dialog__band">
        <slot name="band" />
      </div>

      <div class="house-dialog__workspace" :class="{ 'house-dialog__workspace--attachments': $slots.attachments }">
        <q-card-section
          class="house-dialog__body"
          :class="{ 'house-dialog__body--sectioned': sectioned }"
        >
          <slot />
        </q-card-section>
        <slot name="attachments" />
      </div>

      <!-- The house footer (spec 0073): Close on the left, always; extra
           actions in the middle; the main action on the right, filled,
           with its Ctrl+Enter hint underneath -->
      <q-card-actions
        class="house-dialog__footer"
        :class="{ 'house-dialog__footer--main-first': mainFirst }"
      >
        <!-- A wizard puts its Back here instead of the footer's Close -->
        <slot name="secondary">
          <q-btn
            v-if="!noClose"
            outline
            no-caps
            color="primary"
            class="house-dialog__secondary"
            :label="closeLabel"
            :disable="closeDisable"
            v-close-popup
          />
        </slot>
        <q-space />
        <!-- The phone's progress, in the band's place. Centred on the bar
             itself, not between the buttons: it must not shift as their
             labels change from step to step -->
        <div v-if="sheet && stepLabel" class="house-dialog__step">{{ stepLabel }}</div>
        <slot name="actions" />
        <div v-if="shownMainLabel" class="house-dialog__main">
          <q-btn
            unelevated
            no-caps
            class="house-dialog__primary"
            :color="mainColor"
            :icon="shownMainIcon"
            :icon-right="shownMainIconRight"
            :label="shownMainLabel"
            :loading="mainLoading"
            :disable="mainDisable"
            @click="emit('main')"
          />
          <div v-if="!noShortcutHint" class="house-dialog__hint" aria-hidden="true">{{ shortcut }}</div>
        </div>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, useSlots } from 'vue';
import { useQuasar } from 'quasar';
import HelpTip from './HelpTip.vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    /** One quiet line under the title — what the dialog is about (spec 0079). */
    subtitle?: string | undefined;
    /** Phone only: the title to show instead of `title` — the current step. */
    sheetTitle?: string | undefined;
    /** A caller can retain the bottom sheet below a wider breakpoint. */
    sheetBreakpoint?: number;
    /** Phone only: "2 of 7", centred in the action bar in the band's place. */
    stepLabel?: string | undefined;
    helpTopic?: string;
    /** The help tip right after the title rather than beside Close. */
    helpBesideTitle?: boolean;
    persistent?: boolean;
    maxWidthPx?: number;
    /** modal: Heading/26, a pop-up's title. detail: Heading/22, the title of
        a large full-page card such as Ship forms (Figma text styles). */
    titleStyle?: 'modal' | 'detail';
    /** Tinted body for dialogs built from .dlg-section cards (spec 0044). */
    sectioned?: boolean;
    /** The footer's left button (spec 0073) — "Close" unless the words
        carry meaning ("Later", "Done"). */
    closeLabel?: string;
    closeDisable?: boolean;
    /** No close button in the footer — the header × still closes. */
    noClose?: boolean;
    /** No × in the header — the footer's close button still closes. */
    noX?: boolean;
    /** Mirror the footer: the main action on the left, close on the right. */
    mainFirst?: boolean;
    /** As tall as the screen allows, whatever the content: the card keeps
        one size from step to step (Ship forms with All details, user 2026-11-02). */
    fullHeight?: boolean;
    /** 24px sides instead of 34, Close level with the titles: the value
        dialogs (Figma 401:8083, user 2026-11-02). */
    snug?: boolean;
    /** The main action (spec 0073): rendered filled on the right, and
        Ctrl+Enter (⌘+Enter on a Mac) anywhere in the dialog does the same.
        No label, no main action and no shortcut. */
    mainLabel?: string | undefined;
    /** Phone only: a short label for the main button, which then drops its
        icons — "Send to NEMO: NOD" is just "Send" on a phone. */
    sheetMainLabel?: string | undefined;
    mainColor?: 'primary' | 'negative' | 'positive';
    mainIcon?: string | undefined;
    /** An icon after the main label, e.g. the arrow on a wizard's Next. */
    mainIconRight?: string | undefined;
    mainLoading?: boolean;
    mainDisable?: boolean;
    /** The shortcut still works, but no hint under the main button (Set
        schedule, Figma 440:6767). */
    noShortcutHint?: boolean;
  }>(),
  {
    subtitle: undefined,
    sheetTitle: undefined,
    sheetBreakpoint: 600,
    stepLabel: undefined,
    sheetMainLabel: undefined,
    persistent: false,
    maxWidthPx: 440,
    titleStyle: 'modal',
    sectioned: false,
    closeLabel: 'Close',
    closeDisable: false,
    noClose: false,
    noX: false,
    mainFirst: false,
    fullHeight: false,
    mainLabel: undefined,
    mainColor: 'primary',
    mainIcon: undefined,
    mainIconRight: undefined,
    mainLoading: false,
    mainDisable: false,
    noShortcutHint: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'main'): void;
}>();

const $q = useQuasar();
const slots = useSlots();
const maxWidth = computed(() => `${props.maxWidthPx}px`);
/** Below the phone breakpoint the dialog is a bottom sheet (spec 0092). */
const sheet = computed(() => $q.screen.width < props.sheetBreakpoint);

/** The band is a wide-screen thing: a phone carries the step in the title
    and the counter in the action bar, so the header keeps its own line. */
const banded = computed(() => !!slots.band && !sheet.value);
const shownTitle = computed(() => (sheet.value && props.sheetTitle ? props.sheetTitle : props.title));
/** A short phone label means a bare button: no send or arrow icon with it. */
const shortMain = computed(() => sheet.value && !!props.sheetMainLabel);
const shownMainLabel = computed(() => (shortMain.value ? props.sheetMainLabel : props.mainLabel));
const shownMainIcon = computed(() => (shortMain.value ? undefined : props.mainIcon));
const shownMainIconRight = computed(() => (shortMain.value ? undefined : props.mainIconRight));

/** Swipe down on the grabber or the header: close, unless a save is running. */
let grabY: number | null = null;
function onGrabStart(e: TouchEvent): void {
  grabY = e.touches[0]?.clientY ?? null;
}
function onGrabEnd(e: TouchEvent): void {
  const endY = e.changedTouches[0]?.clientY;
  // Only Close closes a pop-up (user 2026-11-04): the swipe no longer does
  void endY;
  grabY = null;
}
const shortcut = computed(() => ($q.platform.is.mac ? '⌘ + Enter' : 'Ctrl + Enter'));

/** Ctrl/⌘+Enter = the main action, exactly as a click would: nothing
    while it is disabled or already running. Caught on the way down —
    toggles, selects and the like swallow Enter themselves. The focused
    field is blurred first so a half-typed value commits (a typed date
    applies on blur, spec 0071), then the action runs and focus returns. */
async function onKeydown(e: KeyboardEvent): Promise<void> {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  if (!props.mainLabel) return;
  e.preventDefault();
  e.stopPropagation();
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  focused?.blur();
  await nextTick();
  if (props.mainDisable || props.mainLoading) {
    focused?.focus();
    return;
  }
  emit('main');
  await nextTick();
  if (focused?.isConnected) focused.focus();
}
</script>

<style scoped>
/* Dialog (style guide p. 8): white card, radius 12, on the see-through
   backdrop, as every pop-up (user 2026-11-04); header and action
   bar stay put, only the body scrolls */
.house-dialog {
  width: 100%;
  border-radius: 12px;
  /* Scroll lives in the body only — header and footer stay put when a
     long dialog scrolls (docs/specs/0041). Quasar caps the card height
     to the viewport; the flex column + overflow body do the rest. */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.house-dialog--full-height {
  /* Quasar's own cap for a dialog card, used as its height */
  height: calc(var(--q-dialog-viewport-height, 100dvh) - 48px);
}
.house-dialog__header {
  background: var(--nl-card);
  padding: 24px 34px 16px;
  border-bottom: 1px solid var(--nl-g-line-base);
  gap: 8px;
}
/* Modal title: Heading/26 (Figma text styles), one per modal */
.house-dialog__title-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.house-dialog__title {
  color: var(--nl-g-ink);
  font-size: 26px;
  line-height: normal;
  font-weight: 600;
  letter-spacing: 0.26px;
}
/* A large full-page card's title: Heading/22 */
.house-dialog__title--detail {
  font-size: 22px;
  letter-spacing: 0.22px;
}
/* With a band under it the header ends at the band's divider instead */
.house-dialog__header--banded {
  border-bottom: none;
  padding-bottom: 0;
}
.house-dialog__band {
  flex: none;
  padding: 20px 34px;
  border-bottom: 1px solid var(--nl-g-line-base);
  background: var(--nl-card);
}
/* Under the band's line: 26px before the content (user 2026-11-02) */
.house-dialog__band + .house-dialog__body {
  padding-top: 26px;
}
.house-dialog__subtitle {
  color: var(--nl-g-body);
  font-size: 14px;
  line-height: normal;
  margin-top: 2px;
}
/* Close: the shared .nl-close-x, centred on the whole header — the title
   and whatever stands above and below it */
.house-dialog__close {
  align-self: center;
  margin-top: 0;
}
/* Snug (a value's dialog, Figma 401:8083): 24px all round, 16 under the
   footer's buttons; the titles 3px apart, Close level with them */
.house-dialog--snug .house-dialog__header {
  padding: 24px 24px 18px;
}
.house-dialog--snug .house-dialog__body {
  padding: 24px;
}
.house-dialog--snug .house-dialog__footer {
  padding: 24px 24px 16px;
}
.house-dialog--snug .house-dialog__subtitle {
  margin-top: 3px;
}
.house-dialog__body {
  padding: 24px 34px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.house-dialog__workspace { display: flex; flex: 1 1 auto; min-height: 0; }
.house-dialog__workspace > .house-dialog__body { min-width: 0; }
.house-dialog__workspace--attachments > .house-dialog__body { padding-right: 24px; }
.house-dialog__band + .house-dialog__workspace > .house-dialog__body { padding-top: 26px; }
/* Sectioned anatomy (spec 0044): grouped white cards on the Blue/400 ground */
.house-dialog__body--sectioned {
  background: var(--nl-ground);
  padding: 16px 34px;
}
/* Action bar: Blue/200, the secondary action on the left, the main one on
   the right */
.house-dialog__footer {
  position: relative; /* the phone's step counter centres on this */
  background: var(--nl-g-subtle);
  padding: 24px 34px;
  border-top: 1px solid var(--nl-g-line-base);
  align-items: flex-start;
  gap: 8px;
}
.house-dialog__footer > * {
  margin-left: 0 !important;
}
.house-dialog__footer--main-first {
  flex-direction: row-reverse;
}
/* Action buttons: 44px; the label is Heading/14 (button labels) */
.house-dialog__footer :deep(.q-btn:not(.q-btn--flat):not(.q-btn--round)) {
  min-height: 44px;
  padding: 0 16px;
  font-size: 14px;
  line-height: normal;
  letter-spacing: 0.14px;
}
/* The phone's step counter: always the middle of the bar, whatever the
   buttons either side are called, and level with them */
.house-dialog__step {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  height: 44px;
  color: var(--nl-g-secondary);
  font-size: 14px;
  line-height: normal;
  font-weight: 600;
  letter-spacing: 0.14px;
  white-space: nowrap;
}
/* The main action and its shortcut hint, stacked (spec 0073) */
.house-dialog__main {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.house-dialog__hint {
  font-size: 12px;
  line-height: 16px;
  margin-top: 4px;
  color: var(--nl-ink-3);
  white-space: nowrap;
}
@media (max-width: 599px) {
  .house-dialog__header,
  .house-dialog__band,
  .house-dialog__body,
  .house-dialog__footer {
    padding-left: 16px;
    padding-right: 16px;
  }
  /* No keyboard shortcut on a phone — and the 44px button then fills the bar */
  .house-dialog__hint {
    display: none;
  }
}

/* The phone sheet (spec 0092): full width at the bottom, rounded on top,
   never taller than the visible screen; the footer clears the home bar. */
.house-dialog--sheet {
  border-radius: 12px 12px 0 0;
  max-height: 92dvh !important;
}
/* Figma "popup header / mobile" (546:4306): 13 / 11 / 13 / 16 around a
   Heading/20 title and the 22px X, a Blue/600 line under it (bottom 11 → 13,
   user 2026-11-06) */
.house-dialog--sheet .house-dialog__header {
  padding: 13px 11px 13px 16px;
  border-bottom: 1px solid var(--blue-600);
  gap: 8px;
}
.house-dialog__title--sheet {
  min-width: 0;
  color: var(--text-300);
  font-size: 20px;
  font-weight: 600;
  line-height: normal;
  letter-spacing: 0.2px;
  overflow-wrap: anywhere;
}
.house-dialog--sheet .house-dialog__close {
  width: 22px;
  height: 22px;
  color: var(--text-300);
}
.house-dialog--sheet .house-dialog__close .q-icon {
  font-size: 22px;
}
/* The content starts 42px under the header's line, in every phone pop-up
   (Figma 549:7635 Body, user 2026-11-06) */
.house-dialog--sheet .house-dialog__body {
  padding-top: 42px;
}
/* The phone action bar: a fixed 90px — 12px, the 44px button, then 34px */
.house-dialog--sheet .house-dialog__footer {
  height: 90px;
  padding-top: 12px;
  padding-bottom: 34px;
}
.house-dialog__grab {
  flex: none;
  display: flex;
  justify-content: center;
  padding: 8px 0 2px;
  background: var(--nl-card);
}
.house-dialog__grab-bar {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--blue-700);
}

/* Mobile-first dialogs (docs/specs/0041): below the phone breakpoint every
   grid column in the body stacks to one input per row — enforced here so no
   dialog needs (or can forget) per-field responsive classes. The
   :not([class*='q-field__']) keeps the rule off Quasar's field INTERNALS,
   which reuse row/col classes (.q-field__control-container is a `col`;
   stretching it pushes the clear/arrow icons outside the field). */
@media (max-width: 599.98px) {
  .house-dialog__body :deep(.row > .col:not([class*='q-field__'])),
  .house-dialog__body :deep(.row > [class*='col-']:not([class*='q-field__'])) {
    width: 100%;
    max-width: 100%;
    flex: 0 0 100%;
  }
}
</style>
