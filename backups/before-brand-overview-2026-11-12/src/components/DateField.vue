<template>
  <q-input
    ref="input"
    :model-value="text"
    :label="label"
    outlined
    dense
    stack-label
    clearable
    mask="####-##-##"
    placeholder="YYYY-MM-DD"
    inputmode="numeric"
    :disable="disable"
    :hint="hint"
    :error="error ?? null"
    :error-message="errorMessage"
    @update:model-value="onType"
    @blur="commit"
    @keydown.enter.prevent="commit"
    @keydown="typeOver.onKeydown"
    @beforeinput="typeOver.onBeforeInput"
    @keydown.up.prevent="step(1)"
    @keydown.down.prevent="step(-1)"
  >
    <template #append>
      <q-icon name="calendar_month" class="cursor-pointer" aria-label="Pick a date">
        <q-popup-proxy ref="proxy" transition-show="scale" transition-hide="scale">
          <q-date
            :model-value="value || null"
            mask="YYYY-MM-DD"
            today-btn
            class="house-picker"
            :options="dateAllowed"
            @update:model-value="onPick"
          />
        </q-popup-proxy>
      </q-icon>
    </template>
  </q-input>
</template>

<script setup lang="ts">
/**
 * House date field (docs/specs/0044, spec 0071). Model: '' or 'YYYY-MM-DD'.
 * One behaviour everywhere: type it (the mask turns 20261231 into
 * 2026-12-31, a complete valid date applies at once), pick it (the calendar
 * applies on select and closes), or step it (arrow up/down moves the part
 * under the caret — year, month or day — by one; an empty field starts
 * from today). Enter or leaving the field also applies; an incomplete
 * entry falls back to the last good value. A keystroke that could no
 * longer become a real date (2026-3…, 2026-02-30) is taken back at once.
 */
import { computed, nextTick, ref, watch } from 'vue';
import type { QInput, QPopupProxy } from 'quasar';
import { isoDatePrefixOk, isoDateValid, stepIsoDate } from '../lib/time';
import { useTypeOver } from '../lib/type-over';

const input = ref<QInput | null>(null);
const proxy = ref<QPopupProxy | null>(null);

const props = defineProps<{
    modelValue?: string | null | undefined;
    label: string;
    disable?: boolean | undefined;
    hint?: string | undefined;
    /** Inline validation (docs/07 law 4): red state + message below. */
    error?: boolean | undefined;
    errorMessage?: string | undefined;
    /** Earliest allowed date for the picker, 'YYYY-MM-DD'. */
    minDate?: string | undefined;
    /** Latest allowed date for the picker, 'YYYY-MM-DD'. */
    maxDate?: string | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const value = computed(() => props.modelValue ?? '');
/** What the box shows while typing; follows the model when it changes from outside. */
const text = ref(value.value);
watch(value, (v) => {
  text.value = v;
});

function dateAllowed(d: string): boolean {
  if (props.minDate && d < props.minDate.replaceAll('-', '/')) return false;
  return !props.maxDate || d <= props.maxDate.replaceAll('-', '/');
}

function apply(next: string): void {
  if (next !== value.value) emit('update:modelValue', next);
  text.value = next;
}

function onType(raw: string | number | null): void {
  const typed = raw === null || raw === undefined ? '' : String(raw);
  if (!isoDatePrefixOk(typed)) {
    void takeBack(typed);
    return;
  }
  text.value = typed;
  if (typed === '') {
    apply('');
    return;
  }
  if (isoDateValid(typed)) apply(typed);
}

/**
 * Refuse an entry: the box already shows it, so let the model follow for
 * one tick and then set it back — that second change is what makes the
 * masked input redraw the previous text.
 */
async function takeBack(typed: string): Promise<void> {
  const keep = text.value;
  text.value = typed;
  await nextTick();
  text.value = keep;
}

/**
 * Typing over the entry (spec 0071 amendment 2): a digit replaces the one at
 * the caret; a real value applies once the part being typed is complete.
 */
const typeOver = useTypeOver(text, false, (next, partDone) => {
  if (partDone && isoDateValid(next)) apply(next);
});

/** Enter or blur: a complete date applies, anything else falls back to the last good value. */
function commit(): void {
  if (text.value === '') {
    apply('');
    return;
  }
  if (isoDateValid(text.value)) apply(text.value);
  else text.value = value.value;
}

function onPick(picked: string | null): void {
  apply(picked ?? '');
  proxy.value?.hide();
}

/** Arrow up/down: the part under the caret (year, month, day) moves by one. */
function step(delta: number): void {
  const el = input.value?.nativeEl as HTMLInputElement | undefined;
  const caret = el?.selectionStart ?? 10;
  const part = caret <= 4 ? 'year' : caret <= 7 ? 'month' : 'day';
  const base = isoDateValid(text.value) ? text.value : value.value;
  const next = stepIsoDate(base, part, delta);
  apply(next);
  if (el) {
    requestAnimationFrame(() => {
      el.setSelectionRange(caret, caret);
    });
  }
}
</script>
