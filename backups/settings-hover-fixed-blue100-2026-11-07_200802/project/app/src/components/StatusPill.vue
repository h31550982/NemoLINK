<template>
  <span class="pill" :class="[`pill--${tone}`, `pill--${size}`]">
    <!-- ✓ for In NEMO, ! for Needs you (guide p. 12): on cards the drawn
         marks, at table size the glyphs; any other icon stays an icon -->
    <template v-if="glyph && size === 'card'">
      <img v-if="glyph === 'check'" :src="checkUrl" alt="" width="16.3" height="12.025" class="pill__mark" />
      <img v-else :src="exclamationUrl" alt="" width="2" height="14" class="pill__mark" />
    </template>
    <span v-else-if="glyph" class="pill__glyph" aria-hidden="true">{{ glyph === 'check' ? '✓' : '!' }}</span>
    <q-icon v-else-if="icon" :name="icon" :size="size === 'card' ? '16px' : '13px'" />
    <span>{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * The status pill (style guide p. 4, 12): a fill from the fixed status pairs
 * and a word — never colour alone. Cards use 25px pills with 14px text,
 * tables 24px pills with 12px text. Wording follows the count-first
 * grammar ("Pre-arr 22"); verdict states are words only ("Ready to send").
 */
import { computed } from 'vue';
import checkUrl from '../assets/figma/pill-check.svg';
import exclamationUrl from '../assets/figma/pill-exclamation.svg';

export type PillTone = 'red' | 'amber' | 'green' | 'teal' | 'blue' | 'slate' | 'gray' | 'violet';

const props = withDefaults(
  defineProps<{ tone: PillTone; label: string; icon?: string | undefined; size?: 'table' | 'card' }>(),
  { size: 'table', icon: undefined },
);

/** The two marks the guide draws: the check on blue, the ! on yellow. */
const glyph = computed<'check' | 'bang' | null>(() => {
  if (props.icon === 'check' && props.tone !== 'amber' && props.tone !== 'gray') return 'check';
  if (props.icon === 'priority_high' && props.tone === 'amber') return 'bang';
  return null;
});
</script>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  border-radius: 999px;
}
/* In tables · 24px, 12px text (guide p. 12) */
.pill--table {
  height: 24px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 16px;
}
/* On cards · 25px, 14px text */
.pill--card {
  height: 25px;
  padding: 0 15px;
  font-size: 14px;
  line-height: 17px;
  letter-spacing: -0.01em;
}
.pill--card:has(.pill__mark),
.pill--card:has(.q-icon) {
  padding: 0 10px;
}
.pill__mark {
  display: block;
  flex: none;
}
.pill__glyph {
  margin-right: -2px;
}
/* The fixed pairs: white on blue, green and red; Orange/500 on Orange/200 */
.pill--red {
  background: var(--nl-g-red);
  color: var(--nl-on-fill);
}
.pill--amber {
  background: var(--nl-g-yellow);
  color: var(--nl-g-on-yellow);
}
.pill--green,
.pill--teal {
  background: var(--nl-g-green);
  color: var(--nl-on-fill);
}
.pill--blue,
.pill--violet {
  background: var(--nl-g-blue);
  color: var(--nl-on-fill);
}
.pill--slate {
  background: var(--nl-g-secondary);
  color: var(--nl-on-fill);
}
/* Not started: white with a hairline (the legend's first swatch) */
.pill--gray {
  background: var(--nl-card);
  color: var(--nl-g-body);
  border: 1px solid var(--nl-g-line-white);
}
</style>
