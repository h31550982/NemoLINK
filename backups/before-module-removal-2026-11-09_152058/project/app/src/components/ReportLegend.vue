<template>
  <!-- What the report chips' colours mean (user decision 2026-10-06): one
       line, chip-shaped swatches with words; wraps on a phone. Each line's
       hint is its tooltip and its accessible description. -->
  <div class="legend" role="list" aria-label="What the report colours mean">
    <span class="legend__title">Reports</span>
    <span v-for="l in LEGEND" :key="l.tone" class="legend__item" role="listitem" :aria-label="`${l.words}: ${l.hint}`">
      <span class="legend__swatch" :class="`legend__swatch--${l.tone}`" aria-hidden="true" />
      <span>{{ l.words }}</span>
      <q-tooltip>{{ l.hint }}</q-tooltip>
    </span>
  </div>
</template>

<script setup lang="ts">
import { LEGEND } from '../lib/obligations';
</script>

<style scoped>
/* The footer legend (guide p. 4, 8): REPORTS, then the five states — a
   24×12 swatch and its word, 24px apart; a phone wraps it */
.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 24px;
  font-size: 14px;
  line-height: normal;
  color: var(--nl-g-secondary);
}
.legend__title {
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--nl-g-ink);
  margin-right: 4px; /* 28px to the first item */
}
.legend__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  cursor: default;
}
.legend__swatch {
  display: inline-block;
  width: 24px;
  height: 12px;
  border-radius: 6px;
}
.legend__swatch--gray {
  background: var(--nl-card);
  border: 1px solid var(--nl-g-line-base);
}
.legend__swatch--amber {
  background: var(--nl-g-yellow);
}
.legend__swatch--green {
  background: var(--nl-g-green);
}
.legend__swatch--violet {
  background: var(--nl-g-blue);
}
.legend__swatch--red {
  background: var(--nl-g-red);
}
</style>
