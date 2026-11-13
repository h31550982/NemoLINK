<template>
  <!-- Groups of columns (user 2026-11-02): one numbered tab each, the
       group's name for screen readers (no hover tooltip); circles, the chosen
       one ringed 2px Blue/800 with a Blue/800 SemiBold number, a dot where a
       value needs a person; too many for the room and it folds into "‹ 1 of 7 ›" -->
  <div v-if="!compact" class="ct" role="tablist" aria-label="Columns" @keydown="onKey">
    <button
      v-for="(s, i) in segments"
      :key="s.id"
      type="button"
      role="tab"
      class="ct__tab"
      :class="{ 'ct__tab--on': s.id === modelValue }"
      :aria-selected="s.id === modelValue"
      :tabindex="s.id === modelValue ? 0 : -1"
      :aria-label="s.mark ? `${s.label} ${MARK_WORDS[s.mark]}` : s.label"
      @click="choose(i)"
    >
      <span class="ct__n" :data-n="i + 1">{{ i + 1 }}</span>
      <span v-if="s.mark" class="ct__dot" :class="`ct__dot--${s.mark}`" />
    </button>
  </div>
  <div v-else class="ct-pager">
    <button type="button" class="ct-pager__step" :disabled="at === 0" aria-label="Previous columns" @click="choose(at - 1)">
      <q-icon name="chevron_left" size="20px" />
    </button>
    <span class="ct-pager__words" aria-live="polite">
      <span class="sr-only">{{ segments[at]?.label }},</span>
      <strong class="ct-pager__n">{{ at + 1 }}</strong> of {{ segments.length }}
      <span v-if="segments[at]?.mark" class="ct__dot" :class="`ct__dot--${segments[at]?.mark}`" />
    </span>
    <button
      type="button"
      class="ct-pager__step"
      :disabled="at === segments.length - 1"
      aria-label="Next columns"
      @click="choose(at + 1)"
    >
      <q-icon name="chevron_right" size="20px" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick } from 'vue';
import type { ColumnSegment } from '../lib/column-groups';

const props = defineProps<{ segments: ColumnSegment[]; modelValue: string; compact: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [id: string] }>();

const MARK_WORDS = { error: '— a value needs a fix', check: '— a value is missing or to check' } as const;

const at = computed(() => Math.max(0, props.segments.findIndex((s) => s.id === props.modelValue)));
function choose(i: number): void {
  const s = props.segments[i];
  if (s) emit('update:modelValue', s.id);
}

function onKey(event: KeyboardEvent): void {
  const last = props.segments.length - 1;
  const to =
    event.key === 'ArrowRight' ? Math.min(at.value + 1, last)
    : event.key === 'ArrowLeft' ? Math.max(at.value - 1, 0)
    : event.key === 'Home' ? 0
    : event.key === 'End' ? last
    : null;
  if (to === null) return;
  event.preventDefault();
  choose(to);
  const list = event.currentTarget as HTMLElement;
  void nextTick(() => list.querySelector<HTMLElement>('.ct__tab--on')?.focus());
}
</script>

<style scoped>
/* Circles, 30px as the Ship forms steps are tall, 8px apart (user 2026-11-02):
   white with the Full screen button's line (the outlined buttons' 1.5px
   Blue/700), numbers Text/200; the chosen one stays white, ringed 2px
   Blue/800 with its number Blue/800 SemiBold (user 2026-11-02) */
.ct {
  display: inline-flex;
  flex: none;
  gap: 8px;
}
.ct__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1.5px solid var(--nl-g-field-line);
  border-radius: 50%;
  background: var(--nl-g-white);
  font: inherit;
  font-size: 16px;
  line-height: 21px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--nl-g-body);
  cursor: pointer;
}
.ct__tab--on {
  border: 2px solid var(--nl-g-blue);
  color: var(--nl-g-blue);
  font-weight: 600;
}
/* The number holds its SemiBold width, so choosing a tab moves none of them */
.ct__n {
  display: inline-grid;
  font-variant-numeric: tabular-nums;
}
.ct__n::after {
  content: attr(data-n);
  height: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: 600;
}
.ct__tab:focus-visible {
  outline: 2px solid var(--nl-g-blue);
  outline-offset: 2px;
}
.ct-pager__step:focus-visible {
  outline: 2px solid var(--nl-g-blue);
  outline-offset: -2px;
}
/* A value to look at in the tab's columns: red to fix, orange missing or to check */
.ct__dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  vertical-align: middle;
}
/* On a circle the dot sits on its top right edge, ringed in white */
.ct__tab .ct__dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  box-shadow: 0 0 0 2px var(--nl-g-white);
}
.ct__dot--error {
  background: var(--red-200);
}
.ct__dot--check {
  background: var(--orange-300);
}
/* The folded control: ‹ the tab's name · n of N › */
.ct-pager {
  display: inline-flex;
  align-items: center;
  flex: none;
  height: 36px;
  gap: 4px;
}
.ct-pager__words {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  font-size: 16px;
  line-height: 21px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--nl-g-ink);
}
.ct-pager__n {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ct-pager__step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--nl-g-ink);
  cursor: pointer;
}
.ct-pager__step:disabled {
  color: var(--nl-g-line-white);
  cursor: default;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
/* Phones: 16px is for SemiBold headings only (user 2026-11-06) */
@media (max-width: 599px) {
  .ct__tab,
  .ct-pager__words {
    font-size: 14px;
    letter-spacing: 0.14px;
  }
}
</style>
