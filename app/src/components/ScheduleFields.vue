<template>
  <div class="schedule-fields">
    <FormField
      v-for="part in PARTS"
      :key="part"
      :name="part === 'date' ? name : `${name}-time`"
      :label="`${name.toUpperCase()} ${part === 'date' ? 'day' : 'time'}`"
      :for-id="`${id}-${part}`"
      :optional="optional"
      :error="partError(part)"
    >
      <!-- Typed or picked (user 2026-11-13): the day and the time are text
           boxes — Tab goes from one to the next, Enter applies what was
           typed; a click or Alt+↓ opens the picker under it as before -->
      <div
        :ref="(el) => (boxes[part] = el as HTMLElement | null)"
        class="schedule-field"
        :class="{
          'schedule-field--error': !!partError(part) || (part === 'time' && !!error),
          'schedule-field--open': open === part,
        }"
        @click="openPicker(part)"
      >
        <input
          :id="`${id}-${part}`"
          v-model="typed[part]"
          type="text"
          class="schedule-field__input"
          :class="{ 'schedule-field__input--empty': !typed[part] }"
          :placeholder="part === 'date' ? 'dd.mm.yyyy' : 'hh:mm'"
          :inputmode="part === 'time' ? 'numeric' : 'text'"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="!!partError(part) || (part === 'time' && !!error)"
          aria-haspopup="dialog"
          :aria-expanded="open === part"
          :aria-controls="`${id}-${part}-picker`"
          @input="onTyping(part)"
          @blur="commitTyped(part)"
          @keydown.enter.exact.prevent="commitTyped(part, true)"
          @keydown.esc="open === part && (open = null, $event.stopPropagation())"
          @keydown.alt.down.prevent="openPicker(part)"
        />
        <button
          type="button"
          class="schedule-field__icon"
          tabindex="-1"
          :aria-label="part === 'date' ? `Pick the ${name.toUpperCase()} day` : `Pick the ${name.toUpperCase()} time`"
          @click.stop="togglePicker(part)"
        >
          <q-icon :name="part === 'date' ? 'calendar_month' : 'schedule'" size="20px" />
        </button>
        <q-menu
          no-parent-event
          no-focus
          no-refocus
          :model-value="open === part"
          :anchor="$q.screen.lt.sm ? 'bottom left' : popupSide === 'left' ? 'top left' : 'top right'"
          :self="!$q.screen.lt.sm && popupSide === 'left' ? 'top right' : 'top left'"
          :offset="$q.screen.lt.sm ? [0, 8] : [16, 0]"
          class="schedule-field-popup"
          @update:model-value="open = $event ? part : null"
        >
          <div :id="`${id}-${part}-picker`" role="dialog" :aria-label="`${name.toUpperCase()} ${part === 'date' ? 'day' : 'time'}`" @click.stop>
            <SchedulePicker
              :key="`${part}-${draft[part]}`"
              :part="part"
              compact
              :date="draft.date"
              :time="draft.time"
              :today="today"
              :min-date="minDate"
              :after="after"
              :not-after="notAfter"
              :start-date="minDate || today"
              :start-time="after?.slice(11, 16)"
              @update:date="pick('date', $event)"
              @update:time="pick('time', $event)"
            />
          </div>
        </q-menu>
      </div>
    </FormField>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import FormField from './FormField.vue';
import SchedulePicker from './SchedulePicker.vue';
import { parseTypedDay, parseTypedTime } from '../lib/time';

const props = defineProps<{
  modelValue: string;
  name: 'eta' | 'etd' | 'ata' | 'atd';
  id: string;
  today: string;
  minDate: string;
  after?: string | undefined;
  notAfter?: string | undefined;
  popupSide?: 'left' | 'right' | undefined;
  error?: string | null | undefined;
  /** "(optional)" after both labels — the actual times (user 2026-11-13). */
  optional?: boolean | undefined;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'incomplete', value: boolean): void;
}>();
type Part = 'date' | 'time';
const PARTS = ['date', 'time'] as const;
const open = ref<Part | null>(null);
const boxes: Record<Part, HTMLElement | null> = { date: null, time: null };

// Also dismiss presses in the form's blank area, inside its persistent dialog.
function dismissOutside(event: PointerEvent): void {
  if (!open.value || !(event.target instanceof Node)) return;
  const picker = document.getElementById(`${props.id}-${open.value}-picker`);
  if (picker?.contains(event.target) || boxes[open.value]?.contains(event.target)) return;
  open.value = null;
}
onMounted(() => document.addEventListener('pointerdown', dismissOutside, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismissOutside, true));
const draft = reactive({ date: props.modelValue.slice(0, 10), time: props.modelValue.slice(11, 16) });
const value = computed(() => draft.date && draft.time ? `${draft.date}T${draft.time}` : '');
const dayWords = (iso: string): string => iso
  ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${iso}T12:00`))
  : '';
/** What each box shows: the value in words, or what is being typed. */
const typed = reactive<Record<Part, string>>({ date: dayWords(draft.date), time: draft.time });
/** A typed day or time that is not one, or falls outside what may be picked. */
const typedError = reactive<Record<Part, string | null>>({ date: null, time: null });

function showDraft(): void {
  typed.date = dayWords(draft.date);
  typed.time = draft.time;
}

watch(() => props.modelValue, (next) => {
  if (next === value.value) return;
  draft.date = next.slice(0, 10);
  draft.time = next.slice(11, 16);
  showDraft();
});
// Half a time, or a typed one that could not be taken, holds the form back
watch(
  () => !!typedError.date || !!typedError.time || !!draft.date !== !!draft.time,
  (incomplete) => emit('incomplete', incomplete),
  { immediate: true },
);

/**
 * A day without its time, or a time without its day, says so on the empty
 * field once its picker is shut (user 2026-11-13: the gap shows while the
 * form is filled). The caller's own error sits on the day field.
 */
const NAME = computed(() => props.name.toUpperCase());
function partError(part: Part): string | undefined {
  if (typedError[part]) return typedError[part]!;
  if (part === 'date' && props.error) return props.error;
  if (open.value !== null || !!draft.date === !!draft.time) return undefined;
  if (part === 'time' && draft.date && !draft.time) return `Set the ${NAME.value} time too`;
  if (part === 'date' && draft.time && !draft.date) return `Set the ${NAME.value} day too`;
  return undefined;
}

/** Why a typed day or time cannot be taken — the picker's own limits. */
function outOfRange(part: Part, date: string, time: string): string | null {
  if (part === 'date') {
    if (props.minDate && date < props.minDate) return `The ${NAME.value} day cannot be before ${dayWords(props.minDate)}`;
    if (props.notAfter && date > props.notAfter.slice(0, 10)) return `The ${NAME.value} cannot be in the future`;
    return null;
  }
  if (!date || !time) return null;
  if (props.notAfter && `${date}T${time}` > props.notAfter) return `The ${NAME.value} cannot be in the future`;
  return null;
}

function openPicker(part: Part): void {
  open.value = part;
}
function togglePicker(part: Part): void {
  open.value = open.value === part ? null : part;
  boxes[part]?.querySelector('input')?.focus();
}

/** Typing shuts the picker, and clears an earlier complaint until it is applied. */
function onTyping(part: Part): void {
  typedError[part] = null;
  if (open.value === part) open.value = null;
}

/**
 * Enter or leaving the box applies what was typed (24.11.2026, 24.11.,
 * 24 Nov, 14:30, 1430 …); an empty box clears the part. With Enter on a
 * day that still lacks its time, the time box is next.
 */
function commitTyped(part: Part, viaEnter = false): void {
  const text = typed[part].trim();
  if (part === 'date' && text === dayWords(draft.date) && text) {
    if (viaEnter) advance(part);
    return;
  }
  if (!text) {
    typedError[part] = null;
    if (draft[part]) {
      draft[part] = '';
      emit('update:modelValue', value.value);
    }
    return;
  }
  const parsed = part === 'date' ? parseTypedDay(text, props.today) : parseTypedTime(text);
  if (!parsed) {
    typedError[part] = part === 'date'
      ? `Type the ${NAME.value} day as dd.mm.yyyy, e.g. 24.11.2026`
      : `Type the ${NAME.value} time as hh:mm, e.g. 14:30`;
    return;
  }
  const problem = outOfRange(part, part === 'date' ? parsed : draft.date, part === 'time' ? parsed : draft.time);
  if (problem) {
    typedError[part] = problem;
    return;
  }
  typedError[part] = null;
  if (parsed !== draft[part]) {
    draft[part] = parsed;
    emit('update:modelValue', value.value);
  }
  showDraft();
  if (viaEnter) advance(part);
}

/** Enter on a day with no time yet moves on to the time box. */
function advance(part: Part): void {
  if (part === 'date' && !draft.time) boxes.time?.querySelector('input')?.focus();
}

function pick(part: Part, next: string): void {
  draft[part] = next;
  typedError[part] = null;
  // A departure moved onto the arrival day needs a later time.
  if (part === 'date' && props.after && value.value && value.value <= props.after) draft.time = '';
  emit('update:modelValue', value.value);
  showDraft();
  open.value = null;
  // A day picked with no time yet: the time picker opens next
  if (part === 'date' && !draft.time) void nextTick(() => { open.value = 'time'; boxes.time?.querySelector('input')?.focus(); });
}
</script>

<style scoped>
.schedule-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.schedule-field {
  width: 100%;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 6px 0 14px;
  border: 1.5px solid var(--nl-g-field-line);
  border-radius: 6px;
  background: var(--nl-g-white);
  color: var(--nl-g-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  cursor: text;
}
/* The box itself carries no border: the field around it does */
.schedule-field__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}
.schedule-field__input::placeholder { color: var(--nl-g-secondary); opacity: 1; }
.schedule-field__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  cursor: pointer;
}
.schedule-field:focus-within,
.schedule-field--open {
  outline: 2px solid var(--nl-g-blue);
  outline-offset: -2px;
}
.schedule-field--error { border-color: var(--nl-g-red); }
</style>

<style>
.q-menu.schedule-field-popup {
  width: 320px;
  max-width: calc(100vw - 32px);
  border-radius: 12px;
  background: var(--nl-g-white);
  overscroll-behavior: contain;
  box-shadow:
    0 1px 2px -1px oklch(0 0 0 / 0.06),
    0 2px 4px oklch(0 0 0 / 0.04) !important;
}
</style>
