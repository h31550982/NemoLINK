<template>
  <!-- What a report would carry (spec 0075): one line per element, the
       value NEMOLink would send, where it comes from, and — for ship
       fields — how it compares with NEMO's ship database -->
  <div ref="rootEl" class="fi" :class="{ 'fi--no-nemo': !hasInNemo, 'fi--roomy': codeOnHover }">
    <div class="fi-row fi-head">
      <span>Field</span>
      <span class="prov-head prov-head--nemo">To NEMO</span>
      <span>From</span>
      <span v-if="hasInNemo">In NEMO</span>
    </div>
    <div v-for="(item, i) in items" :key="i" class="fi-row" :class="{ 'fi-row--gap': !item.ok }">
      <span class="fi-label">
        <template v-if="codeOnHover">
          <span :class="{ 'fi-label__hover': item.de }">{{ item.label }}</span>
          <q-tooltip v-if="item.de" anchor="top middle" self="bottom middle" :offset="[0, 6]">NEMO code {{ item.de }}</q-tooltip>
          <!-- Missing: the tag under the name, as in Send to NEMO: NOD (user 2026-11-07) -->
          <span v-if="!item.ok && item.value === null && item.from !== 'nemo' && item.de !== null" class="fi-tag">Missing</span>
        </template>
        <template v-else>
          {{ item.label }}
          <span v-if="item.de" class="fi-de tnum">{{ item.de }}</span>
        </template>
      </span>
      <span class="fi-value tnum prov-lane prov-lane--flat" :class="{ 'fi-value--missing': !item.ok, 'prov-lane--missing': !item.ok }">
        <template v-if="item.value !== null"><span class="prov-value">{{ valueWords(item) }}</span></template>
        <template v-else-if="item.from === 'nemo' || item.de === null">
          <q-icon :name="item.ok ? 'check' : 'close'" size="15px" />
          {{ item.ok ? 'yes' : 'not yet' }}
        </template>
        <span v-else class="prov-missing"><q-icon name="error_outline" size="14px" />Missing</span>
      </span>
      <span class="fi-from">
        <!-- In place (spec 0085): the ship dialog opens over this page -->
        <a
          v-if="item.from === 'ship' && shipLink"
          :href="shipLink"
          class="fi-link"
          @click.prevent="editShip"
        >ship data</a>
        <!-- Send to NEMO: one line, what does not fit on hover (user 2026-11-06) -->
        <template v-else-if="codeOnHover">
          <span class="fi-from__text" :data-clip-key="i">{{ FROM_WORDS[item.from] }}</span>
          <q-tooltip v-if="clipped[i]" anchor="top middle" self="bottom middle" :offset="[0, 6]">{{ FROM_WORDS[item.from] }}</q-tooltip>
        </template>
        <template v-else>{{ FROM_WORDS[item.from] }}</template>
      </span>
      <span v-if="hasInNemo" class="fi-nemo" :class="item.inNemo ? `fi-nemo--${item.inNemo.state}` : ''">
        <template v-if="item.inNemo">{{ inNemoWords(item) }}</template>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, reactive, ref } from 'vue';
import type { ObligationItem } from '../auth/auth';
import { openShipEditor } from '../lib/ship-editor';
import { countryName } from '../generated/countries';
import { shipTypeName } from '../generated/ship-types';
import { callPurposeName, registryName, voyageTypeName } from '../generated/noa-codes';
import { fmtDay, fmtStamp } from '../lib/time';

const emit = defineEmits<{ (e: 'shipChanged'): void }>();

/** Opens the ship dialog in place; the caller refreshes when it was changed (spec 0085). */
async function editShip(): Promise<void> {
  const id = props.shipLink ? new URL(props.shipLink, window.location.origin).searchParams.get('ship') : null;
  if (!id) return;
  if (await openShipEditor(id)) emit('shipChanged');
}

const props = defineProps<{
  items: ObligationItem[];
  /** The ship dialog's five columns, where ship rows are edited (admins). */
  shipLink?: string | null;
  /** false hides the In NEMO column. */
  showInNemo?: boolean;
  /** The NEMO code behind a hover on the field's name, and rows 48px tall
      (Send to NEMO, Figma 500:7424, user 2026-11-05). */
  codeOnHover?: boolean;
}>();

/** From texts cut to one line, by row: those get the whole text on hover. */
const clipped = reactive<Record<number, boolean>>({});
const rootEl = ref<HTMLElement | null>(null);
/** Measured after every render and on resize, so the first hover already knows. */
function measureClips(): void {
  rootEl.value?.querySelectorAll<HTMLElement>('[data-clip-key]').forEach((el) => {
    const k = Number(el.dataset.clipKey);
    const cut = el.scrollWidth > el.clientWidth;
    if (clipped[k] !== cut) clipped[k] = cut;
  });
}
onMounted(() => {
  measureClips();
  window.addEventListener('resize', measureClips);
});
onUpdated(measureClips);
onBeforeUnmount(() => window.removeEventListener('resize', measureClips));

const DUES_LANGUAGE_WORDS: Record<string, string> = { FI: 'Finnish (FI)', SV: 'Swedish (SV)', EN: 'English (EN)' };

const FROM_WORDS: Record<ObligationItem['from'], string> = {
  call: 'this call',
  ship: 'ship data',
  org: 'your organisation',
  nemo: 'NEMO',
};

/** The port call's report views drop the column: NEMO's API cannot be read back (spec 0079 amendment 2026-09-26). */
const hasInNemo = computed(() => props.showInNemo !== false && props.items.some((i) => i.inNemo));

function valueWords(item: ObligationItem): string {
  const v = item.value;
  if (v === null) return '';
  if (item.kind === 'time') return fmtStamp(String(v));
  if (item.kind === 'date') return fmtDay(String(v));
  if (item.shipKey === 'typeCode') return `${shipTypeName(String(v))} (${v})`;
  if (item.shipKey === 'flagState') return `${countryName(String(v))} (${v})`;
  // NOA codes in words (spec 0088)
  if (item.de === 'DE-014-10') return String(v).split(', ').map((c) => `${callPurposeName(c)} (${c})`).join(', ');
  if (item.de === 'DE-014-22') return `${voyageTypeName(String(v))} (${v})`;
  if (item.de === 'DE-005-10') return `${registryName(String(v))} (${v})`;
  if (item.label === 'Fairway dues decision language') return DUES_LANGUAGE_WORDS[String(v)] ?? String(v);
  return String(v);
}

/** The ledger's words (spec 0064 rule 2). */
function inNemoWords(item: ObligationItem): string {
  const n = item.inNemo!;
  switch (n.state) {
    case 'same':
      return 'same';
    case 'differs':
      return `differs: ${n.value ?? ''}`;
    case 'notInNemo':
      return 'not in NEMO';
    default:
      return 'not read yet';
  }
}
</script>

<style scoped>
.fi {
  font-size: 14px;
  margin-top: 8px;
}
.fi-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.3fr) minmax(0, 0.8fr) minmax(0, 0.8fr);
  gap: 4px 12px;
  padding: 5px 0;
  align-items: baseline;
}
.fi--no-nemo .fi-row {
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.3fr) minmax(0, 0.8fr);
}
.fi-row + .fi-row {
  border-top: 1px dashed var(--nl-line-2);
}
.fi-head {
  font-size: 12px;
  font-weight: 600; /* every list head SemiBold (user 2026-11-06) */
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--nl-ink-3);
  padding-top: 0;
}
.fi-label {
  color: var(--nl-ink);
}
.fi-de {
  display: block;
  font-size: 12px;
  color: var(--nl-ink-3);
}
.fi-value {
  font-weight: 600;
  color: var(--nl-ink);
  overflow-wrap: anywhere;
}
.fi-value--missing {
  font-weight: 600;
  color: var(--nl-amber-text);
}
.fi-from {
  color: var(--nl-ink-2);
}
.fi-link {
  color: var(--nl-teal-dark);
  text-decoration: none;
  font-weight: 600;
}
.fi-link:hover {
  text-decoration: underline;
}
.fi-nemo {
  color: var(--nl-ink-2);
}
.fi-nemo--differs {
  color: var(--nl-amber-text);
  font-weight: 600;
}
.fi-nemo--notInNemo {
  color: var(--nl-amber-text);
}
.fi-nemo--notRead {
  color: var(--nl-ink-3);
}
/* Send to NEMO (Figma 500:7424): the NEMO code on hover, rows 48px tall,
   the To NEMO lane down the row; every cell's text in the middle of the
   cell (user 2026-11-06) */
.fi--roomy .fi-row:not(.fi-head) {
  min-height: 48px;
  padding: 6px 0 5px;
  align-items: stretch;
}
.fi--roomy .fi-row:not(.fi-head) > span {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.fi--roomy .fi-value.prov-lane--flat {
  padding: 6px 8px 6px 10px;
}
/* Field and From in Text/200 (user 2026-11-06); the ship data link stays blue */
.fi--roomy .fi-label,
.fi--roomy .fi-from {
  color: var(--text-200);
}
.fi-from__text {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fi--roomy .fi-from .fi-link {
  white-space: nowrap;
}
.fi-label__hover {
  cursor: help;
}
/* Every list table as Send to NEMO: NOD (Figma 500:7424, user 2026-11-07):
   Field 278 · To NEMO 258 · From, 12px gaps, dashed Blue/700 under every
   row, the heads Text/100, the field's name Text/300 */
.fi--roomy.fi--no-nemo .fi-row {
  grid-template-columns: 278px 258px minmax(0, 1fr);
}
.fi--roomy .fi-row {
  gap: 12px;
  border-top: 0;
  border-bottom: 1px dashed var(--blue-700);
}
.fi--roomy .fi-row + .fi-row {
  border-top: 0;
}
.fi--roomy .fi-head {
  padding: 0 0 6px;
  letter-spacing: 0.72px;
  color: var(--text-100);
}
.fi--roomy .fi-label {
  font-weight: 500;
  color: var(--text-300);
}
.fi--roomy .fi-row--gap .fi-label {
  justify-content: flex-start;
  align-items: flex-start;
  gap: 8px;
}
.fi--roomy .fi-value .prov-value {
  font-weight: 600;
  color: var(--text-200);
}
.fi--roomy .fi-from {
  font-weight: 500;
}
.fi-tag {
  align-self: flex-start;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  padding: 1px 8px;
  background: var(--nl-g-yellow);
  color: var(--nl-g-on-yellow);
}
/* Phones: the label on its own line, the three readings under it */
@media (max-width: 599.98px) {
  .fi-head {
    display: none;
  }
  .fi .fi-row,
  .fi--no-nemo .fi-row,
  .fi--roomy.fi--no-nemo .fi-row {
    grid-template-columns: 1fr 1fr;
  }
  .fi-label {
    grid-column: 1 / -1;
  }
}
</style>
