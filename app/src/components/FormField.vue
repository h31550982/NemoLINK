<template>
  <!-- One form field (Figma "New port call – form", guide p. 11): the label,
       then the hint, then the error, all above the input; an error also
       draws a red bar down the field's left edge -->
  <div
    class="ff"
    :class="{ 'ff--error': !!error }"
    :data-field="name"
    @pointerdown.capture="roomForMenu"
    @keydown.capture="roomForMenu"
  >
    <div class="ff__labels">
      <div class="ff__label-row">
        <label class="ff__label" :for="forId">{{ label }}</label>
        <span v-if="optional" class="ff__optional">(optional)</span>
      </div>
      <p v-if="hint" class="ff__hint">{{ hint }}</p>
      <p v-if="error" class="ff__error" role="alert">{{ error }}</p>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** The field's key: the steps panel finds and focuses it by this. */
  name: string;
  label: string;
  /** The id of the input inside, for the label. */
  forId?: string | undefined;
  hint?: string | null | undefined;
  error?: string | null | undefined;
  optional?: boolean | undefined;
}>();

/** Air left between a dropdown list and the window's bottom edge. */
/** The list's 8px gap under its field (Figma 557:7884) plus 8px of air. */
const MENU_GAP = 16;

/** Dropdown lists open downwards: Quasar flips a list up when it does not
    fit below its field, so just before one opens the room below the field
    goes into --nl-menu-room, and the list (class nl-field-menu, app.scss)
    is never taller than that — a long list gets shorter and scrolls inside.
    Capture phase, so it runs ahead of the opening click or key. */
function roomForMenu(e: Event): void {
  const field = (e.target as HTMLElement).closest<HTMLElement>('.q-select');
  if (!field) return;
  const room = document.documentElement.clientHeight - field.getBoundingClientRect().bottom - MENU_GAP;
  document.documentElement.style.setProperty('--nl-menu-room', `${Math.max(0, Math.floor(room))}px`);
}
</script>

<style scoped>
.ff {
  position: relative;
  display: flex;
  flex-direction: column;
  /* The labels 11px over the box (Figma 557:7884, user 2026-11-06) */
  gap: 11px;
}
.ff--error::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -19px;
  width: 3px;
  background: var(--nl-g-red);
}
.ff__labels {
  display: flex;
  flex-direction: column;
  /* The description 3px under the label */
  gap: 3px;
}
.ff__label-row {
  display: flex;
  gap: 6px;
  font-size: 14px;
  line-height: 18px;
}
.ff__label {
  color: var(--text-200);
  font-weight: 600;
}
.ff__optional {
  color: var(--text-100);
  font-weight: 500;
}
.ff__hint,
.ff__error {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
}
.ff__hint {
  color: var(--text-100);
  font-weight: 500;
}
.ff__error {
  color: var(--nl-g-red);
  font-weight: 600;
}
/* Inputs 44px high, text 14px from the edge; the message sits above, so
   Quasar's own line below the field goes */
.ff :deep(.q-field--dense .q-field__control),
.ff :deep(.q-field--dense .q-field__marginal) {
  height: 44px;
}
.ff :deep(.q-field--dense .q-field__native) {
  min-height: 44px;
}
.ff :deep(.q-field--auto-height.q-field--dense .q-field__control) {
  height: auto;
  min-height: 44px;
}
.ff :deep(.q-field--outlined .q-field__control) {
  padding: 0 14px;
}
/* A dropdown's chevron sits 9px from the box's right edge */
.ff :deep(.q-select.q-field--outlined .q-field__control) {
  padding-right: 9px;
}
/* Icons in a field: 20px Material Symbols in ink, the same in every field —
   a field waiting on another (no port yet) keeps its chevron at full colour */
.ff :deep(.q-field__marginal) {
  font-size: 20px;
  color: var(--nl-g-ink);
}
.ff :deep(.q-field--disabled .q-field__control > .q-field__marginal) {
  opacity: 1 !important;
}
.ff :deep(.q-field__marginal .q-icon + .q-icon) {
  margin-left: 6px;
}
.ff :deep(.q-field__bottom) {
  display: none;
}
/* The red border, value and message say it already: no error icon */
.ff :deep(.q-field--error .q-field__append .q-icon.text-negative) {
  display: none;
}
.ff :deep(.q-field--with-bottom) {
  padding-bottom: 0;
}
</style>
