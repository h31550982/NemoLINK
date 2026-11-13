<template>
  <q-input
    ref="input"
    :model-value="text"
    :label="label"
    outlined
    dense
    :stack-label="!!label"
    clearable
    mask="####-##-## ##:##"
    placeholder="YYYY-MM-DD HH:mm"
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
        <q-popup-proxy ref="dateProxy" transition-show="scale" transition-hide="scale">
          <q-date
            :model-value="raw"
            mask="YYYY-MM-DD HH:mm"
            today-btn
            class="house-picker"
            :options="dateAllowed"
            @update:model-value="onDatePick"
          />
        </q-popup-proxy>
      </q-icon>
      <q-icon name="schedule" class="cursor-pointer" aria-label="Pick a time">
        <q-popup-proxy ref="timeProxy" transition-show="scale" transition-hide="scale">
          <q-time
            :model-value="raw"
            mask="YYYY-MM-DD HH:mm"
            format24h
            class="house-picker"
            :minute-options="MINUTE_OPTIONS"
            @update:model-value="onTimePick"
          >
            <div class="row items-center justify-end">
              <q-btn v-close-popup label="OK" color="primary" unelevated no-caps />
            </div>
          </q-time>
        </q-popup-proxy>
      </q-icon>
    </template>
  </q-input>
</template>

<script setup lang="ts">
/**
 * House date-time field (docs/specs/0044, spec 0071). Model: '' or
 * 'YYYY-MM-DDTHH:mm' (the datetime-local shape, so callers keep their ISO
 * conversion untouched). Same behaviour as DateField: type it (the mask
 * turns 202612311430 into 2026-12-31 14:30, a complete valid stamp applies
 * at once), pick it (the calendar applies on select; the clock closes once
 * the minute lands), or step it (arrow up/down moves the part under the
 * caret — year, month, day, hour or minute — by one; an empty field starts
 * from now). Enter or leaving the field also applies; an incomplete entry
 * falls back to the last good value. A keystroke that could no longer
 * become a real date and time (2026-33, 25:.., 23:6.) is taken back at once.
 */
import { computed, nextTick, ref, watch } from 'vue';
import type { QInput, QPopupProxy } from 'quasar';
import { isoDateTimePrefixOk, isoDateTimeValid, stepIsoDateTime } from '../lib/time';
import { useTypeOver } from '../lib/type-over';

const input = ref<QInput | null>(null);
const dateProxy = ref<QPopupProxy | null>(null);
const timeProxy = ref<QPopupProxy | null>(null);

const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => i * 5);

const props = defineProps<{
    modelValue?: string | null | undefined;
    /** Inside the field; left out when the label sits above it. */
    label?: string | undefined;
    disable?: boolean | undefined;
    hint?: string | undefined;
    /** Inline validation (docs/07 law 4): red state + message below. */
    error?: boolean | undefined;
    errorMessage?: string | undefined;
    /** Earliest allowed date for the picker, 'YYYY-MM-DD'. */
    minDate?: string | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const value = computed(() => props.modelValue ?? '');
/** The pickers' shape ('YYYY-MM-DD HH:mm'); null when empty. */
const raw = computed(() => (value.value ? value.value.replace('T', ' ') : null));
/** What the box shows while typing (the pickers' shape); follows the model. */
const text = ref(raw.value ?? '');
watch(raw, (v) => {
  text.value = v ?? '';
});

function dateAllowed(d: string): boolean {
  return !props.minDate || d >= props.minDate.replaceAll('-', '/');
}

/** `shown` is 'YYYY-MM-DD HH:mm'; the model keeps the 'T'. */
function apply(shown: string): void {
  const next = shown ? shown.replace(' ', 'T') : '';
  if (next !== value.value) emit('update:modelValue', next);
  text.value = shown;
}

function onType(rawText: string | number | null): void {
  const typed = rawText === null || rawText === undefined ? '' : String(rawText);
  if (!isoDateTimePrefixOk(typed)) {
    void takeBack(typed);
    return;
  }
  text.value = typed;
  if (typed === '') {
    apply('');
    return;
  }
  if (isoDateTimeValid(typed)) apply(typed);
}

/** Refuse an entry: let the model follow for one tick, then set it back so the masked input redraws. */
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
const typeOver = useTypeOver(text, true, (next, partDone) => {
  if (partDone && isoDateTimeValid(next)) apply(next);
});

function commit(): void {
  if (text.value === '') {
    apply('');
    return;
  }
  if (isoDateTimeValid(text.value)) apply(text.value);
  else text.value = raw.value ?? '';
}

function onDatePick(picked: string | null): void {
  apply(picked ?? '');
  dateProxy.value?.hide();
}

// Direct submit: the clock's final act is picking a minute — when the
// minute component changes, apply and close. (Picking only an hour keeps
// it open for the minute; Close/outside still works for edge cases.)
function onTimePick(picked: string | null): void {
  const prevMinute = raw.value ? raw.value.slice(14, 16) : undefined;
  apply(picked ?? '');
  const nextMinute = picked?.slice(14, 16);
  if (picked && prevMinute !== undefined && nextMinute !== prevMinute) {
    timeProxy.value?.hide();
  }
}

/** Arrow up/down: the part under the caret (year, month, day, hour, minute) moves by one. */
function step(delta: number): void {
  const el = input.value?.nativeEl as HTMLInputElement | undefined;
  const caret = el?.selectionStart ?? 16;
  const part =
    caret <= 4 ? 'year' : caret <= 7 ? 'month' : caret <= 10 ? 'day' : caret <= 13 ? 'hour' : 'minute';
  const base = isoDateTimeValid(text.value) ? text.value : (raw.value ?? '');
  apply(stepIsoDateTime(base, part, delta));
  if (el) {
    requestAnimationFrame(() => {
      el.setSelectionRange(caret, caret);
    });
  }
}
</script>
