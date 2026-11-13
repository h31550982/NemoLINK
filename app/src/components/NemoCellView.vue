<template>
  <!-- Every line stays on one line and ends in … when it is too long; the
       hover then gives it in full (user 2026-11-02) -->
  <div ref="root" class="nc">
    <div ref="valueEl" class="nc__value nc__line" :class="{ 'nc__value--empty': !cell?.value }">
      <!-- No pen mark for a typed value (user 2026-11-02): the hover says who typed it -->
      {{ shown }}
    </div>
    <div v-if="words" ref="wordsEl" class="nc__reading nc__line">{{ words }}</div>
    <div v-if="message" ref="msgEl" class="nc__msg nc__line" :class="`nc__msg--${cell?.flag}`">
      {{ message }}
    </div>
    <q-tooltip v-if="tip" :delay="400" max-width="360px">{{ tip }}</q-tooltip>
  </div>
</template>

<script setup lang="ts">
/** One NEMO table cell: the value, NEMO's words for a code, the flag, where it came from. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { NemoCell, NemoColumn } from '../auth/auth';

const props = defineProps<{ cell: NemoCell | undefined; column: NemoColumn }>();

/** Yes / no reads as words; everything else as NEMO gets it. */
const shown = computed(() => {
  const c = props.cell;
  if (!c?.value) return c?.flag === 'missing' ? 'missing' : '';
  return props.column.kind === 'yesno' ? (c.value === '1' ? 'Yes' : 'No') : c.value;
});

/** "10110 — Chief Mate …" → "Chief Mate …" under the code, on one line. */
const words = computed(() => {
  const r = props.cell?.reading;
  if (!r || props.column.kind !== 'code') return '';
  return r.split(' — ').slice(1).join(' — ');
});

const message = computed(() =>
  props.cell?.message && props.cell.flag !== 'missing' ? props.cell.message : '',
);

/** Which lines the column cut short — measured, so the hover can give them in full. */
const root = ref<HTMLElement | null>(null);
const valueEl = ref<HTMLElement | null>(null);
const wordsEl = ref<HTMLElement | null>(null);
const msgEl = ref<HTMLElement | null>(null);
const cut = ref({ value: false, words: false, msg: false });
const isCut = (el: HTMLElement | null) => !!el && el.scrollWidth > el.clientWidth + 1;
function measure(): void {
  cut.value = { value: isCut(valueEl.value), words: isCut(wordsEl.value), msg: isCut(msgEl.value) };
}
let observer: ResizeObserver | null = null;
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    observer = new ResizeObserver(measure);
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
watch([shown, words, message], () => void nextTick(measure));

const tip = computed(() => {
  const c = props.cell;
  if (!c) return '';
  const parts: string[] = [];
  const reading = c.reading && c.reading !== c.value ? c.reading : '';
  // A cut line first, in full: the reading already holds the code's words
  if (cut.value.value && !reading) parts.push(shown.value);
  if (cut.value.words && !reading) parts.push(words.value);
  if (reading) parts.push(reading);
  if (cut.value.msg) parts.push(message.value);
  if (c.entered) parts.push(`Typed by ${c.entered.author}`);
  if (c.source) parts.push(`From ${c.source.formName} (${c.source.fileName})`);
  else if (c.origin) parts.push(`From the ${c.origin}`);
  for (const o of c.others ?? []) parts.push(`${o.fileName || 'A form'} says ${o.value}`);
  return parts.join(' · ');
});
</script>

<style scoped>
/* Values and NEMO's words for a code: Body/14, the body colour */
.nc__value {
  color: var(--nl-g-body);
  font-variant-numeric: tabular-nums;
}
/* "missing": the missing-field text colour */
.nc__value--empty {
  color: var(--orange-500);
}
.nc__reading {
  color: var(--nl-g-body);
}
/* What is wrong with the value: Body/12 */
.nc__msg {
  font-size: 12px;
  line-height: 16px;
  color: var(--orange-500);
}
/* One line each; too long ends in … (the table sets how wide a line may be) */
.nc__line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nc__msg--error {
  color: var(--red-300);
}
</style>
