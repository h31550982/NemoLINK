<template>
  <!-- One time of the schedule (Figma 440:6767): the month on the left, the
       half-hour slots of half a day on the right. Day and time pick apart;
       the dialog around it decides what happens next. -->
  <div class="sp" :class="{ 'sp--compact': compact }">
    <div v-if="part !== 'time'" class="sp-col">
      <div class="sp-panel">
        <div class="sp-nav">
          <button
            type="button"
            class="sp-nav__btn"
            :disabled="!canPrevMonth"
            aria-label="Previous month"
            @click="shiftMonth(-1)"
          >
            <q-icon name="arrow_back_ios" size="24px" />
          </button>
          <div class="sp-nav__title" aria-live="polite">{{ monthTitle }}</div>
          <button type="button" class="sp-nav__btn" aria-label="Next month" @click="shiftMonth(1)">
            <q-icon name="arrow_forward_ios" size="24px" />
          </button>
        </div>
        <div class="sp-weekdays" aria-hidden="true">
          <span v-for="w in WEEKDAYS" :key="w">{{ w }}</span>
        </div>
        <div class="sp-days" role="group" :aria-label="monthTitle">
          <template v-for="c in cells" :key="c.iso">
            <span v-if="c.outside" class="sp-day sp-day--muted" aria-hidden="true">{{ c.day }}</span>
            <button
              v-else
              type="button"
              class="sp-day"
              :class="{
                'sp-day--muted': c.disabled,
                'sp-day--today': c.today && !c.selected,
                'sp-day--selected': c.selected,
              }"
              :disabled="c.disabled"
              :aria-pressed="c.selected"
              :aria-label="c.label"
              @click="emit('update:date', c.iso)"
            >{{ c.day }}</button>
          </template>
        </div>
      </div>
    </div>

    <div v-if="part !== 'date'" class="sp-col">
      <div class="sp-panel sp-panel--times">
        <div class="sp-nav">
          <button
            type="button"
            class="sp-nav__btn"
            :disabled="page === 0"
            aria-label="Earlier times"
            @click="page = 0"
          >
            <q-icon name="arrow_back_ios" size="24px" />
          </button>
          <div class="sp-nav__title" aria-live="polite">{{ page === 0 ? '00:00-11:30' : '12:00-23:30' }}</div>
          <button
            type="button"
            class="sp-nav__btn"
            :disabled="page === 1"
            aria-label="Later times"
            @click="page = 1"
          >
            <q-icon name="arrow_forward_ios" size="24px" />
          </button>
        </div>
        <div class="sp-slots" role="group" aria-label="Time">
          <button
            v-for="t in slots"
            :key="t"
            type="button"
            class="sp-slot"
            :class="{ 'sp-slot--selected': t === time, 'sp-slot--muted': slotDisabled(t) }"
            :disabled="slotDisabled(t)"
            :aria-pressed="t === time"
            @click="emit('update:time', t)"
          >{{ t }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  /** A single panel for a field popover; omitted for the full picker. */
  part?: 'date' | 'time';
  compact?: boolean;
  /** 'YYYY-MM-DD' or ''. */
  date: string;
  /** 'HH:mm' or ''. */
  time: string;
  /** Today, 'YYYY-MM-DD' — ringed in the month. */
  today: string;
  /** The first pickable day, 'YYYY-MM-DD'; earlier days are muted. */
  minDate: string;
  /** For the departure: the arrival, 'YYYY-MM-DDTHH:mm'. On its day the
      slots up to it are muted. */
  after?: string | undefined;
  /** The month and half-day to open on when nothing is picked yet. */
  startDate?: string | undefined;
  startTime?: string | undefined;
  /** An actual time (ATA / ATD), 'YYYY-MM-DDTHH:mm': nothing after it —
      later days and, on its day, later slots are muted. */
  notAfter?: string | undefined;
}>();
const emit = defineEmits<{
  (e: 'update:date', value: string): void;
  (e: 'update:time', value: string): void;
}>();

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const p2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

// The month in view: the picked day's, else where the dialog says, else today's
const opening = props.date || props.startDate || props.today;
const view = ref({ y: Number(opening.slice(0, 4)), m: Number(opening.slice(5, 7)) - 1 });
const openingTime = props.time || props.startTime || '';
const page = ref(openingTime >= '12:00' ? 1 : 0);

const monthTitle = computed(() => `${MONTHS[view.value.m]} ${view.value.y}`);
const canPrevMonth = computed(
  () => `${view.value.y}-${p2(view.value.m + 1)}` > props.minDate.slice(0, 7),
);

function shiftMonth(delta: number): void {
  const d = new Date(view.value.y, view.value.m + delta, 1);
  view.value = { y: d.getFullYear(), m: d.getMonth() };
}

/** Six weeks from the Monday on or before the 1st, as in the Figma month. */
const cells = computed(() => {
  const first = new Date(view.value.y, view.value.m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = isoOf(d);
    return {
      iso,
      day: d.getDate(),
      outside: d.getMonth() !== view.value.m,
      disabled: iso < props.minDate || (!!props.notAfter && iso > props.notAfter.slice(0, 10)),
      today: iso === props.today,
      selected: iso === props.date,
      label: `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    };
  });
});

const slots = computed(() =>
  Array.from({ length: 24 }, (_, i) => {
    const mins = page.value * 720 + i * 30;
    return `${p2(Math.floor(mins / 60))}:${p2(mins % 60)}`;
  }),
);

function slotDisabled(t: string): boolean {
  if (props.notAfter && props.date === props.notAfter.slice(0, 10) && t > props.notAfter.slice(11, 16)) return true;
  return !!props.after && props.date === props.after.slice(0, 10) && t <= props.after.slice(11, 16);
}
</script>

<style scoped>
/* Two columns, 24px apart; on a narrow window the times go under the month */
.sp {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}
.sp-col {
  flex: 1 1 340px;
  min-width: 0;
  display: flex;
  justify-content: center;
}
.sp-panel {
  width: 100%;
  max-width: 444px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
}
/* The month or half-day, Heading/20, between its arrows (Text/200) */
.sp-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.sp-nav__btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 16px;
  background: none;
  color: var(--nl-g-body);
  cursor: pointer;
}
.sp-nav__btn:disabled {
  color: var(--blue-700);
  cursor: default;
}
.sp-nav__title {
  width: 190px;
  text-align: center;
  color: var(--nl-g-ink);
  font-size: 20px;
  line-height: normal;
  font-weight: 600;
  letter-spacing: 0.2px;
}
/* MON … SUN: 12px SemiBold capitals in Text/100 over the lightest stroke */
.sp-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  padding-bottom: 10px;
  border-bottom: 1px solid var(--nl-g-line-row);
  color: var(--nl-g-secondary);
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.48px;
  text-transform: uppercase;
  text-align: center;
}
/* Days (Figma Schedule/Day 436:6703): 42px circles, 16px Medium */
.sp-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  row-gap: 6px;
  justify-items: center;
}
.sp-day {
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1.5px solid transparent;
  border-radius: 21px;
  background: none;
  color: var(--nl-g-ink);
  font: inherit;
  font-size: 16px;
  line-height: normal;
  font-weight: 500;
  letter-spacing: 0.16px;
  cursor: pointer;
}
/* Past days, days before the arrival, and the next / previous month */
.sp-day--muted {
  color: var(--blue-700);
  cursor: default;
}
.sp-day--today {
  border-color: var(--nl-g-blue);
  color: var(--nl-g-blue);
}
.sp-day--selected {
  background: var(--nl-g-blue);
  color: var(--nl-on-fill);
}
/* Time slots (Figma Schedule/Time slot 436:6710): five to a row, the
   picked one a Blue/800 pill */
.sp-slots {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px 8px;
  margin-top: 36px;
}
.sp-slot {
  height: 52px;
  padding: 0;
  border: none;
  border-radius: 39px;
  background: none;
  color: var(--nl-g-ink);
  font: inherit;
  font-size: 16px;
  line-height: normal;
  font-weight: 500;
  letter-spacing: 0.16px;
  cursor: pointer;
}
.sp-slot--selected {
  background: var(--nl-g-blue);
  color: var(--nl-on-fill);
  font-weight: 600;
}
.sp-slot--muted {
  color: var(--blue-700);
  cursor: default;
}
.sp-nav__btn:focus-visible,
.sp-day:focus-visible,
.sp-slot:focus-visible {
  outline: 2px solid var(--nl-g-blue);
  outline-offset: 2px;
}
.sp--compact .sp-col {
  flex-basis: 100%;
}
.sp--compact .sp-panel {
  padding: 16px;
  gap: 12px;
}
.sp--compact .sp-nav__title {
  width: 190px;
  font-size: 16px;
}
.sp--compact .sp-nav__btn .q-icon {
  font-size: 18px !important;
}
.sp--compact .sp-day {
  width: 36px;
  height: 36px;
  font-size: 14px;
}
.sp--compact .sp-days {
  row-gap: 4px;
}
.sp--compact .sp-slots {
  margin-top: 0;
  gap: 6px;
}
.sp--compact .sp-slot {
  height: 40px;
  font-size: 14px;
}
@media (hover: hover) {
  .sp--compact .sp-day:not(:disabled):not(.sp-day--selected):hover,
  .sp--compact .sp-slot:not(:disabled):not(.sp-slot--selected):hover,
  .sp--compact .sp-nav__btn:not(:disabled):hover {
    background: var(--nl-g-subtle);
  }
}
/* Phones: 16px is for SemiBold headings only (user 2026-11-06) */
@media (max-width: 599.98px) {
  .sp-day,
  .sp-slot {
    font-size: 14px;
    letter-spacing: 0.14px;
  }
}
</style>
