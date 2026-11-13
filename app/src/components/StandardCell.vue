<template>
  <!-- One value of the standard table: tap it to fill or fix it. Missing,
       to check or disagreeing values in the missing-field orange, errors
       red, each with its 3px bar. While editing, the cell holds the field
       itself (the `editor` slot): the value is typed right in the table. -->
  <div
    class="st-cell"
    :class="[
      state ? `st-cell--${state}` : '',
      { 'st-cell--tap': interactive && !editing, 'st-cell--editing': editing },
    ]"
    :role="interactive && !editing ? 'button' : undefined"
    :tabindex="interactive && !editing ? 0 : undefined"
    :aria-label="interactive && !editing ? label : undefined"
    @click="interactive && !editing && emit('open')"
    @keydown.enter.self.prevent="interactive && !editing && emit('open')"
    @keydown.space.self.prevent="interactive && !editing && emit('open')"
  >
    <slot v-if="editing" name="editor" />
    <slot v-else />
  </div>
</template>

<script setup lang="ts">
/** A cell's state, by the table's own flag words. */
export type StandardCellState = 'missing' | 'warning' | 'conflict' | 'error' | null | undefined;

withDefaults(
  defineProps<{
    state?: StandardCellState;
    /** Tapping opens it (the editor in place, or the value's own dialog). */
    interactive?: boolean;
    /** The editor shows instead of the value. */
    editing?: boolean;
    /** What the tap does, for screen readers ("Fill Port area"). */
    label?: string | undefined;
  }>(),
  { state: null, interactive: true, editing: false, label: undefined },
);
const emit = defineEmits<{ open: [] }>();
</script>

<style scoped>
.st-cell {
  padding: 4px 6px;
  border-radius: 6px;
  border-left: 3px solid transparent;
  min-height: 28px;
  min-width: 0;
}
.st-cell--tap {
  cursor: pointer;
}
.st-cell--tap:hover {
  background: var(--nl-gray-bg);
}
.st-cell--tap:focus-visible {
  outline: 2px solid var(--blue-800);
  outline-offset: 1px;
}
.st-cell--error {
  border-left-color: var(--red-200);
  background: var(--red-100);
}
/* Missing, disagreeing or to check: the missing-field orange */
.st-cell--warning,
.st-cell--conflict,
.st-cell--missing {
  border-left-color: var(--orange-300);
  background: var(--orange-100);
}
/* Typing in the cell: the app's own white field, no orange box around it */
.st-cell--editing {
  padding: 0;
  border-left: 0;
  background: none;
}
</style>
