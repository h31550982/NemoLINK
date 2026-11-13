<template>
  <div class="schedule-fields">
    <FormField
      v-for="part in PARTS"
      :key="part"
      :name="part === 'date' ? name : `${name}-time`"
      :label="`${name.toUpperCase()} ${part === 'date' ? 'day' : 'time'}`"
      :for-id="`${id}-${part}`"
      :error="part === 'date' ? error : undefined"
    >
      <button
        :id="`${id}-${part}`"
        type="button"
        class="schedule-field"
        :class="{ 'schedule-field--error': !!error }"
        :aria-invalid="!!error"
        aria-haspopup="dialog"
        :aria-expanded="open === part"
        @click="open = open === part ? null : part"
      >
        <span :class="{ 'schedule-field__empty': !draft[part] }">
          {{ part === 'date' ? displayDate : draft.time || 'Set time' }}
        </span>
        <q-icon :name="part === 'date' ? 'calendar_month' : 'schedule'" size="20px" />
        <q-menu
          no-parent-event
          :model-value="open === part"
          :anchor="$q.screen.lt.sm ? 'bottom left' : popupSide === 'left' ? 'top left' : 'top right'"
          :self="!$q.screen.lt.sm && popupSide === 'left' ? 'top right' : 'top left'"
          :offset="$q.screen.lt.sm ? [0, 8] : [16, 0]"
          class="schedule-field-popup"
          @update:model-value="open = $event ? part : null"
        >
          <div :id="`${id}-${part}-picker`" role="dialog" :aria-label="`${name.toUpperCase()} ${part === 'date' ? 'day' : 'time'}`" @click.stop>
            <SchedulePicker
              :key="part"
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
      </button>
    </FormField>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import FormField from './FormField.vue';
import SchedulePicker from './SchedulePicker.vue';

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
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'incomplete', value: boolean): void;
}>();
const PARTS = ['date', 'time'] as const;
const open = ref<'date' | 'time' | null>(null);

// Also dismiss presses in the form's blank area, inside its persistent dialog.
function dismissOutside(event: PointerEvent): void {
  if (!open.value || !(event.target instanceof Node)) return;
  const picker = document.getElementById(`${props.id}-${open.value}-picker`);
  const field = document.getElementById(`${props.id}-${open.value}`);
  if (picker?.contains(event.target) || field?.contains(event.target)) return;
  open.value = null;
}
onMounted(() => document.addEventListener('pointerdown', dismissOutside, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismissOutside, true));
const draft = reactive({ date: props.modelValue.slice(0, 10), time: props.modelValue.slice(11, 16) });
const value = computed(() => draft.date && draft.time ? `${draft.date}T${draft.time}` : '');
const displayDate = computed(() => draft.date
  ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${draft.date}T12:00`))
  : 'Set day');

watch(() => props.modelValue, (next) => {
  if (next === value.value) return;
  draft.date = next.slice(0, 10);
  draft.time = next.slice(11, 16);
});
watch(() => !!draft.date !== !!draft.time, (incomplete) => emit('incomplete', incomplete), { immediate: true });

function pick(part: 'date' | 'time', next: string): void {
  draft[part] = next;
  // A departure moved onto the arrival day needs a later time.
  if (part === 'date' && props.after && value.value && value.value <= props.after) draft.time = '';
  emit('update:modelValue', value.value);
  open.value = null;
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
  padding: 0 14px;
  border: 1.5px solid var(--nl-g-field-line);
  border-radius: 6px;
  background: var(--nl-g-white);
  color: var(--nl-g-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.schedule-field__empty { color: var(--nl-g-secondary); }
.schedule-field:focus-visible,
.schedule-field[aria-expanded='true'] {
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
