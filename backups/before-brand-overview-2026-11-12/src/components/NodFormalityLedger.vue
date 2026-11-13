<template>
  <!-- A formality as ledger rows (spec 0090): the ship dialog's columns for
       every element — External (each source, with where and when), NEMOLink
       (edited in place, saved to the row's owner), To NEMO, NEMO code.
       All details off: only what is missing or disagrees, full width.
       On a phone each row is a card: the name and code on top, then one line
       per source with its dot, the NEMOLink line and the To NEMO line
       (spec 0092); agreeing rows fold to one line each. -->
  <div ref="rootEl" class="fl" :class="{ 'fl--cards': compact, 'fl--code-hover': codeOnHover && !compact }">
    <!-- All details: count-first filters (tap to filter, concept §3.5) -->
    <!-- The facts' tab bar on every width (user 2026-11-07) -->
    <div v-if="filterBar" class="fl-filters" role="group" aria-label="Show">
      <button
        v-for="f in filters"
        :key="f.key"
        type="button"
        class="fl-filter"
        :class="{ 'fl-filter--on': view === f.key }"
        :aria-pressed="view === f.key"
        :disabled="f.count === 0 && view !== f.key"
        @click="changeView(f.key)"
      >
        <!-- One span round both: the pill is a flex box, which drops a bare space -->
        <span><span class="tnum">{{ f.count || (f.key === 'missing' ? 0 : '–') }}</span> {{ f.words }}</span>
      </button>
    </div>
    <div v-if="shown.length && !compact" class="fl-row fl-head">
      <span>Field</span>
      <template v-if="!codeOnHover">
        <span class="prov-head prov-head--ext">External</span>
        <span class="prov-head prov-head--nl">NEMOLink</span>
      </template>
      <span class="prov-head prov-head--nemo" :class="{ 'prov-lane': !codeOnHover }">To NEMO</span>
      <span>{{ codeOnHover ? 'From' : 'NEMO code' }}</span>
    </div>
    <template v-for="r in shown" :key="r.key">
    <!-- The place in the port, together: the port, then its area and berth -->
    <div v-if="r.key === placeHead" class="fl-group">
      <q-icon name="place" size="16px" />
      <span>Port <b>{{ portWords }}</b></span>
      <span class="fl-meta">— the area and berth come from its list; a berth sets its area</span>
    </div>
    <div
      class="fl-row"
      :data-row-key="r.key"
      :class="{
        'fl-row--missing': !r.ok,
        'fl-row--differs': r.ok && r.differs,
        'fl-row--edit': codeOnHover && !compact && editing(r),
      }"
    >
      <span class="fl-cell fl-label" data-col="Field">
        <span :class="{ 'fl-label__hover': codeOnHover && !compact && r.de }">{{ r.label }}</span>
        <q-tooltip v-if="codeOnHover && !compact && r.de" anchor="top middle" self="bottom middle" :offset="[0, 6]">NEMO code {{ r.de }}</q-tooltip>
        <!-- Missing: the tag under the name, on the wide table too (user 2026-11-07) -->
        <span v-if="!r.ok && (compact || codeOnHover)" class="fl-tag fl-tag--missing">Missing</span>
        <span v-else-if="compact && r.differs" class="fl-tag fl-tag--differs">Sources differ</span>
        <!-- What goes: a green Ready tag under the name (user 2026-11-07,
             was the blue To NEMO tag) -->
        <span v-else-if="compact || retained.has(r.key)" class="fl-tag fl-tag--ready">Ready</span>
      </span>

      <!-- A missing field on the phone as on the NOA facts (user 2026-11-06):
           the name, the Missing tag under it, the field — no empty External
           line and no To NEMO line -->
      <span v-if="!(compact && !r.externals.length)" class="fl-cell" data-col="External">
        <template v-if="r.externals.length">
          <span v-for="(e, i) in r.externals" :key="i" class="fl-source">
            <span class="tnum" :class="{ 'fl-struck': r.ok && !sameValue(e.value, r.toNemo) }">{{ words(r, e.value) }}</span>
            <span class="fl-meta">{{ e.source }}<template v-if="e.at"> · {{ fmtWhen(e.at) }}</template></span>
            <!-- Several sources, or a value other than To NEMO: one click takes it -->
            <q-btn
              v-if="r.editable && !sameValue(e.value, r.toNemo)"
              flat dense no-caps size="12px" color="primary" label="Use"
              class="fl-use"
              :loading="busyKey === r.key"
              @click="useSource(r, e.value)"
            >
              <q-tooltip>Send this value to NEMO</q-tooltip>
            </q-btn>
          </span>
        </template>
        <span v-else class="fl-none">—</span>
      </span>

      <span class="fl-cell" data-col="NEMOLink">
        <template v-if="editing(r)">
          <div class="fl-edit">
            <!-- A handful of choices: radio buttons side by side, not a dropdown -->
            <q-option-group
              v-if="r.codelist && fewChoices(r)"
              :model-value="draftOf(r)"
              :options="choicesFor(r)"
              type="radio" inline color="primary"
              class="fl-choice"
              :disable="busyKey === r.key"
              @update:model-value="(v: unknown) => save(r, v)"
            />
            <q-select
              v-else-if="r.codelist"
              :model-value="draftOf(r)"
              :options="optionsFor(r)"
              emit-value map-options dense outlined options-dense
              popup-content-class="fl-select-options"
              use-input fill-input hide-selected input-debounce="0"
              :placeholder="selectPlaceholder(r)"
              :loading="busyKey === r.key"
              class="fl-input"
              :disable="busyKey === r.key || (isPlace(r) && placeOptions(r).length === 0)"
              @filter="(q: string, update: FilterUpdate, abort: () => void) => (r.codelist === 'locode' ? filterPorts(r, q, update, abort) : filter(r, q, update))"
              @update:model-value="(v: unknown) => save(r, v)"
            >
              <q-tooltip v-if="overrides(r)">Entered here — overrides the source</q-tooltip>
            </q-select>
            <q-input
              v-else
              :model-value="inputOf(r)"
              :type="r.kind === 'number' ? 'number' : 'text'"
              dense outlined
              :placeholder="placeholderOf(r)"
              :loading="busyKey === r.key"
              :disable="busyKey === r.key"
              class="fl-input"
              @update:model-value="(v: unknown) => (drafts[r.key] = v)"
              @blur="save(r, drafts[r.key])"
              @keyup.enter="save(r, drafts[r.key])"
            >
              <q-tooltip v-if="overrides(r)">Entered here — overrides the source</q-tooltip>
            </q-input>
          </div>
        </template>
        <span v-else-if="r.editable" class="fl-completed">
          <span class="tnum prov-value">{{ words(r, r.toNemo) }}</span>
          <button type="button" class="fl-edit-link" :aria-label="`Edit ${r.label}`" @click="beginEdit(r)">Edit</button>
        </span>
        <span v-else-if="r.owner === 'callCore'" class="fl-meta"
          >on the port call<template v-if="canEditCall">
            — <a href="#" class="fl-link" @click.prevent="emit('edit-call')">Edit details</a></template
          ><template v-else> — Edit details</template></span
        >
        <span v-else class="fl-meta">always, by rule</span>
      </span>

      <!-- To NEMO in NEMO's own colours, with a dot for where the value came from (2026-10-06, option A) -->
      <span v-if="!(compact && (!r.ok || r.editable))" class="fl-cell prov-lane" :class="{ 'prov-lane--missing': !r.ok }" data-col="To NEMO">
        <template v-if="r.ok">
          <span class="fl-completed">
            <span class="tnum prov-value">{{ words(r, r.toNemo) }}</span>
            <button v-if="codeOnHover && r.editable && !editing(r)" type="button" class="fl-edit-link" :aria-label="`Edit ${r.label}`" @click="beginEdit(r)">Edit</button>
          </span>
          <span
            v-if="sourceOf(r)"
            class="prov-from"
            :class="{ 'prov-from--nl': r.entered !== null || r.owner === 'org', 'prov-from--none': r.owner === 'fixed' }"
            >{{ sourceOf(r) }}</span
          >
          <span v-if="r.differs" class="fl-meta fl-amber">the sources disagree — check</span>
        </template>
        <template v-else>
          <span class="prov-missing"><q-icon name="error_outline" size="15px" />Missing</span>
          <span class="prov-note">NEMO requires it</span>
        </template>
      </span>

      <!-- The VID table's third column (Figma 500:7424): where the value comes from -->
      <!-- One line; what does not fit shows on hover (Send to NEMO rule, user 2026-11-06) -->
      <span v-if="codeOnHover && !compact" class="fl-cell fl-from" data-col="From">
        <!-- The call's own fields open its Edit port call pop-up where the host allows -->
        <span v-if="r.owner === 'callCore' && canEditCall" class="fl-from__text"
          >this call — <a href="#" class="fl-link" @click.prevent="emit('edit-call')">Edit details</a></span
        >
        <span v-else class="fl-from__text" :data-clip-key="r.key">{{ fromWords(r) }}</span>
        <q-tooltip v-if="clipped[r.key]" anchor="top middle" self="bottom middle" :offset="[0, 6]">{{ fromWords(r) }}</q-tooltip>
      </span>
      <span v-if="!codeOnHover || compact" class="fl-cell tnum fl-code" data-col="NEMO code">{{ r.de ?? '—' }}</span>
    </div>
    </template>

    <div v-if="hidden > 0 && !hideReady" class="fl-ready">
      <q-icon name="check" size="15px" /> {{ hidden }} more {{ hidden === 1 ? 'field' : 'fields' }} ready
      <span class="fl-meta">— All details shows every one</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One formality's rows (spec 0090), for any wizard: the server resolves each
 * element (sources, what was entered, what goes, who owns it); this renders
 * them and hands every edit back as `save(key, value)` — the wizard saves it
 * to the owner and reloads. A source's value is taken with Use.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type LedgerRow, type PortAreaOption } from '../auth/auth';
import { CALL_PURPOSES, SHIP_REGISTRIES, VOYAGE_TYPES } from '../generated/noa-codes';
import { COUNTRIES } from '../generated/countries';
import { SHIP_TYPES } from '../generated/ship-types';
import { LANGUAGES, ledgerWords, placeNames, portNames } from '../lib/ledger-words';
import { fmtWhen } from '../lib/time';

const props = defineProps<{
  rows: LedgerRow[];
  /** The call's port: its areas and berths are the place rows' choices. */
  portLocode?: string | null;
  portName?: string | null;
  /** Every row; off shows only what is missing or disagrees. */
  allDetails: boolean;
  /** The row being saved. */
  busyKey?: string | null;
  /** Leave out the "✓ N more fields ready" line where the host says it itself. */
  hideReady?: boolean;
  /** As the Send to NEMO VID table (Figma 500:7424, user 2026-11-05): no
      NEMO code column — the code shows on a hover on the field's name —
      and rows at least 48px tall. */
  codeOnHover?: boolean;
  /** "Edit details" on the call's own fields opens the Edit port call pop-up (NOA). */
  canEditCall?: boolean;
}>();
const emit = defineEmits<{
  (e: 'save', key: string, value: string | number | null): void;
  /** "Edit details" on a port call's own field: open the port call's edit pop-up. */
  (e: 'edit-call'): void;
}>();

const $q = useQuasar();
/** The phone layout: one card per row (matches the 640 px CSS breakpoint). */
const compact = computed(() => $q.screen.width <= 640);

// Keep successful completions in this Missing visit, while counts use live data.
const retained = ref(new Set<string>());
const editingKeys = reactive(new Set<string>());
const editing = (r: LedgerRow): boolean => r.editable && (!r.ok || editingKeys.has(r.key));
watch(() => props.rows, (rows, previous) => {
  const before = new Map(previous?.map(r => [r.key, r]));
  const keep = new Set([...retained.value].filter(key => rows.some(r => r.key === key && r.ok)));
  for (const r of rows) {
    const old = before.get(r.key);
    if (r.ok && old && !old.ok && (!props.allDetails || view.value === 'missing')) keep.add(r.key);
    if (r.ok && old && !sameValue(old.entered, r.entered)) editingKeys.delete(r.key);
  }
  retained.value = keep;
});

async function beginEdit(r: LedgerRow): Promise<void> {
  drafts[r.key] = firstOf(r.entered ?? r.toNemo);
  editingKeys.add(r.key);
  await nextTick();
  const row = [...(rootEl.value?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [])]
    .find(el => el.dataset.rowKey === r.key);
  row?.querySelector<HTMLElement>('input, [role="radio"]')?.focus();
}

/** Area and berth are one decision: when one shows, both do. */
const isPlace = (r: LedgerRow): boolean => r.codelist === 'portArea' || r.codelist === 'berth';
const visible = computed(() => {
  if (props.allDetails) return props.rows;
  const needs = (r: LedgerRow): boolean => !r.ok || r.differs || retained.value.has(r.key);
  const placeShown = props.rows.some((r) => isPlace(r) && needs(r));
  return props.rows.filter((r) => needs(r) || (placeShown && isPlace(r)));
});
const hidden = computed(() => props.rows.length - visible.value.length);

/** All details' filters, count-first; a filter with nothing in it is not offered. */
/** No All fields (user 2026-11-07): missing and ready together are every row. */
type FilterKey = 'missing' | 'ready' | 'entered';
const TESTS: Record<FilterKey, (r: LedgerRow) => boolean> = {
  missing: (r) => !r.ok,
  // Ready (user 2026-11-07): every filled field — no separate differ button;
  // a row whose sources differ still says so with its own tag
  ready: (r) => r.ok,
  // An organisation setting is not an override of a source; it is counted with the rest
  entered: (r) => r.entered !== null && r.owner !== 'org',
};
const FILTER_WORDS: { key: FilterKey; words: string }[] = [
  { key: 'missing', words: 'missing' },
  { key: 'ready', words: 'ready' },
  { key: 'entered', words: 'entered here' },
];
/** Entered here stays in the bar with a – when nothing is entered (user 2026-11-07). */
const filters = computed(() =>
  FILTER_WORDS.map((f) => ({ ...f, count: props.rows.filter(TESTS[f.key]).length })).filter(
    (f) => f.count > 0 || f.key === 'entered' || (f.key === 'missing' && retained.value.size > 0),
  ),
);
/** The buttons that have something to show. */
const usable = computed(() => filters.value.filter((f) => f.count > 0));
/** Missing is on by default whenever something is missing (user 2026-11-06);
    otherwise the first button there is. */
const startView = (): FilterKey => usable.value[0]?.key ?? 'missing';
const view = ref<FilterKey>(startView());
function changeView(key: FilterKey): void {
  if (key === view.value) return;
  retained.value = new Set();
  view.value = key;
}
watch(
  () => props.allDetails,
  (on) => {
    retained.value = new Set();
    if (on) view.value = startView();
  },
);
watch(usable, (list) => {
  if (view.value === 'missing' && retained.value.size) return;
  if (list.length && !list.some((f) => f.key === view.value)) view.value = list[0]!.key;
});
/** The filter bar, on every width with All details (user 2026-11-07):
    opens on Missing, so the missing fields get filled first. */
const filterBar = computed(() => props.allDetails && props.rows.length > 0);
/** A value entered here that replaces a source's: said on hover over the field. */
const overrides = (r: LedgerRow): boolean => r.entered !== null && r.externals.length > 0;
const shown = computed(() => (filterBar.value ? visible.value.filter(r => TESTS[view.value](r) || (view.value === 'missing' && retained.value.has(r.key))) : visible.value));
/** The first place row shown carries the port above it. */
const placeHead = computed(() => shown.value.find(isPlace)?.key ?? null);
const portWords = computed(() =>
  props.portName && props.portLocode ? `${props.portName} · ${props.portLocode}` : (props.portLocode ?? props.portName ?? '—'),
);

/** Where the value that goes comes from, in a word or two. */
/** From texts cut to one line, by row: those get the whole text on hover. */
const clipped = reactive<Record<string, boolean>>({});
const rootEl = ref<HTMLElement | null>(null);
function leaveCompletedMissing(event: Event): void {
  if (!retained.value.size || props.rows.some(r => !r.ok)) return;
  // Quasar renders dropdown choices outside the ledger in a portal.
  if (event.target instanceof Element && event.target.closest('.fl-select-options')) return;
  if (event.target instanceof Node && !rootEl.value?.contains(event.target)) retained.value = new Set();
}
/** Measured after every render and on resize, so the first hover already knows. */
function measureClips(): void {
  rootEl.value?.querySelectorAll<HTMLElement>('[data-clip-key]').forEach((el) => {
    const k = el.dataset.clipKey!;
    const cut = el.scrollWidth > el.clientWidth;
    if (clipped[k] !== cut) clipped[k] = cut;
  });
}
onMounted(() => {
  measureClips();
  window.addEventListener('resize', measureClips);
  document.addEventListener('pointerdown', leaveCompletedMissing);
  document.addEventListener('focusin', leaveCompletedMissing);
});
onUpdated(measureClips);
onBeforeUnmount(() => {
  window.removeEventListener('resize', measureClips);
  document.removeEventListener('pointerdown', leaveCompletedMissing);
  document.removeEventListener('focusin', leaveCompletedMissing);
});

/** The From column of the VID-style table: the call, here, or the source. */
function fromWords(r: LedgerRow): string {
  if (r.owner === 'callCore') return 'this call';
  if (!r.ok && r.editable) return 'enter it here';
  return sourceOf(r) || '—';
}

function sourceOf(r: LedgerRow): string {
  if (r.owner === 'org') return 'organisation settings';
  if (r.entered !== null) return 'entered here';
  if (r.owner === 'fixed') return 'by rule';
  const src = r.externals.find((e) => sameValue(e.value, r.toNemo)) ?? r.externals[0];
  return src?.source ?? (r.owner === 'callCore' ? 'port call' : '');
}

type Option = { label: string; value: string };
const toOptions = (list: { code: string; name: string }[]): Option[] =>
  list.map((c) => ({ label: `${c.name} (${c.code})`, value: c.code }));
const ALL: Record<string, Option[]> = {
  purpose: toOptions(CALL_PURPOSES),
  voyage: toOptions(VOYAGE_TYPES),
  country: toOptions(COUNTRIES),
  registry: toOptions(SHIP_REGISTRIES),
  shipType: toOptions(SHIP_TYPES),
  language: toOptions(LANGUAGES),
};
/** The buttons carry the name alone; the code shows in To NEMO. */
function choicesFor(r: LedgerRow): Option[] {
  const list: Record<string, { code: string; name: string }[]> = { voyage: VOYAGE_TYPES, language: LANGUAGES };
  return (list[r.codelist ?? ''] ?? []).map((c) => ({ label: c.name, value: c.code }));
}
/** Four or fewer choices render as buttons (voyage type: International / National). */
function fewChoices(r: LedgerRow): boolean {
  const n = (ALL[r.codelist ?? ''] ?? []).length;
  return n > 0 && n <= 4;
}
const filtered = reactive<Record<string, Option[]>>({});
function optionsFor(r: LedgerRow): Option[] {
  return filtered[r.key] ?? (isPlace(r) ? placeOptions(r) : ALL[r.codelist ?? '']) ?? [];
}
const auth = useAuth();

/**
 * The port's areas and berths (the home page's list, spec 0048): the area
 * offers the port's areas; the berth offers the chosen area's berths, or
 * every berth of the port with its area when none is chosen yet.
 */
const areas = ref<PortAreaOption[]>([]);
watch(
  () => (props.rows.some(isPlace) ? props.portLocode : null),
  async (locode) => {
    areas.value = [];
    if (!locode) return;
    try {
      const list = await auth.listPortAreas(locode);
      for (const a of list) {
        placeNames[a.code] = nameOf(a);
        for (const b of a.berths) placeNames[b.code] = nameOf(b);
      }
      areas.value = list;
    } catch {
      areas.value = [];
    }
  },
  { immediate: true },
);
/** A published name, when it says more than the code (many berths are named by their code). */
function nameOf(p: { code: string; name: string | null }): string | null {
  return p.name && p.name !== p.code ? p.name : null;
}
/** The area the berth list follows: the one being picked, else the call's. */
function areaNow(): string | null {
  const row = props.rows.find((r) => r.codelist === 'portArea');
  return row ? ((drafts[row.key] as string | null) ?? null) : null;
}
function placeOptions(r: LedgerRow): Option[] {
  const named = (code: string, name: string | null): string => (name && name !== code ? `${name} (${code})` : code);
  if (r.codelist === 'portArea') return areas.value.map((a) => ({ label: named(a.code, a.name), value: a.code }));
  const area = areas.value.find((a) => a.code === areaNow());
  if (area) return area.berths.map((b) => ({ label: named(b.code, b.name), value: b.code }));
  return areas.value.flatMap((a) =>
    a.berths.map((b) => ({ label: `${named(b.code, b.name)} · ${a.name ?? a.code}`, value: b.code })),
  );
}
function selectPlaceholder(r: LedgerRow): string {
  if (r.codelist === 'locode' && !placeholderOf(r)) return 'Type a port name or code';
  if (isPlace(r) && !draftOf(r)) {
    if (placeOptions(r).length === 0) return r.codelist === 'portArea' ? 'No published areas for this port' : 'No published berths';
    return r.codelist === 'portArea' ? 'Pick the port area' : areaNow() ? 'Pick a berth of the area' : 'Pick a berth';
  }
  return placeholderOf(r);
}

/**
 * Ports come from our port list (platform.location, worldwide, spec 0051):
 * a lookup from two letters, by name or UN/LOCODE.
 */
async function filterPorts(r: LedgerRow, q: string, update: FilterUpdate, abort: () => void): Promise<void> {
  const term = q.trim();
  if (term.length < 2) {
    update(() => {
      filtered[r.key] = [];
    });
    return;
  }
  try {
    const ports = await auth.searchPorts(term);
    update(() => {
      for (const p of ports) portNames[p.locode] = p.name;
      filtered[r.key] = ports.map((p) => ({ label: p.name ? `${p.name} (${p.locode})` : p.locode, value: p.locode }));
    });
  } catch {
    abort();
  }
}

/** q-select's filter callback: the options are set inside it, or the list keeps spinning. */
type FilterUpdate = (fn: () => void) => void;
function filter(r: LedgerRow, q: string, update: FilterUpdate): void {
  const all = (isPlace(r) ? placeOptions(r) : ALL[r.codelist ?? '']) ?? [];
  const needle = q.trim().toLowerCase();
  update(() => {
    filtered[r.key] = needle ? all.filter((o) => o.label.toLowerCase().includes(needle)) : all;
  });
}

/** What the NEMOLink cell holds: what was entered, else empty with the source as placeholder. */
const drafts = reactive<Record<string, unknown>>({});
watch(
  () => props.rows,
  (rows) => {
    for (const r of rows) {
      if (!editingKeys.has(r.key)) drafts[r.key] = firstOf(valueOf(r));
    }
  },
  { immediate: true },
);
/** What the cell holds: entered here, or the call's own value for its record's rows. */
function valueOf(r: LedgerRow): unknown {
  return r.owner === 'callCore' ? r.toNemo : r.entered;
}
function firstOf(v: unknown): unknown {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
function draftOf(r: LedgerRow): unknown {
  return drafts[r.key] ?? null;
}
/** The text box's value: a string or a number, empty as null. */
function inputOf(r: LedgerRow): string | number | null {
  const v = drafts[r.key];
  return typeof v === 'number' || typeof v === 'string' ? v : null;
}
function placeholderOf(r: LedgerRow): string {
  return r.externals.length ? words(r, r.externals[0]!.value) : '';
}

function norm(r: LedgerRow, v: unknown): string | number | null {
  if (v === undefined || v === null || v === '') return null;
  if (r.kind === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(v).trim();
  return r.codelist === 'locode' ? s.toUpperCase() : s;
}
function save(r: LedgerRow, v: unknown): void {
  if (props.busyKey === r.key) return;
  const next = norm(r, v);
  // The berth list follows the area at once; the server clears a berth outside it
  if (r.codelist === 'portArea') drafts[r.key] = next;
  const current = norm(r, firstOf(editingKeys.has(r.key) && r.entered === null ? r.toNemo : valueOf(r)));
  if (next === current) {
    if (r.ok) editingKeys.delete(r.key);
    return;
  }
  emit('save', r.key, next);
}
function useSource(r: LedgerRow, v: unknown): void {
  emit('save', r.key, norm(r, firstOf(v)));
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A value in words (lib/ledger-words, shared with the wizards' summary). */
function words(r: LedgerRow, v: unknown): string {
  return ledgerWords(r, v);
}
</script>

<style scoped>
.fl {
  font-size: 14px;
}
.fl-row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.4fr) minmax(200px, 1.6fr) minmax(0, 1.1fr) minmax(0, 0.6fr);
  gap: 8px;
  padding: 6px 4px;
  align-items: start;
  border-top: 1px dashed var(--nl-line-row);
}
.fl-head {
  border-top: none;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--nl-ink-3);
}
.fl-row--missing {
  background: var(--nl-red-bg);
}
/* The Send to NEMO VID table (Figma 500:7424, components 500:7353):
   Field 278 · To NEMO 258 · From; 12px gaps, rows at least 48px between
   dashed Blue/700 lines; the To NEMO value in its Blue/150 box with the
   3px Blue/800 bar, SemiBold at its top. A missing value is typed right in
   that box, which turns orange (missing). External and NEMOLink stay out. */
.fl--code-hover .fl-row {
  grid-template-columns: 278px 258px minmax(0, 1fr);
  gap: 12px;
  padding: 6px 0 5px;
  /* Every cell's text in the middle of the cell (user 2026-11-06) */
  align-items: stretch;
  border-top: 0;
  border-bottom: 1px dashed var(--blue-700);
}
.fl--code-hover .fl-row:not(.fl-head) {
  min-height: 48px;
}
.fl--code-hover .fl-row--missing,
.fl--code-hover .fl-row--differs {
  background: none;
}
.fl--code-hover .fl-head {
  padding-top: 0;
  font-size: 12px;
  font-weight: 600; /* every list head SemiBold (user 2026-11-06) */
  letter-spacing: 0.72px;
  color: var(--text-100);
}
.fl--code-hover .fl-row:not(.fl-head) > [data-col='External'] {
  display: none;
}
.fl--code-hover .fl-row:not(.fl-head) > [data-col='NEMOLink'] {
  display: none;
}
.fl--code-hover .fl-row:not(.fl-head) > .fl-cell {
  justify-content: center;
}
.fl--code-hover .fl-label {
  font-weight: 500;
  color: var(--text-300); /* the darkest text (user 2026-11-07) */
}
.fl--code-hover .fl-row > .prov-lane {
  grid-column: 2;
  grid-row: 1;
  align-self: stretch;
  margin: 0;
  padding: 6px 8px 6px 10px;
  min-height: 37px;
}
.fl--code-hover .prov-lane .prov-value {
  font-weight: 600;
  color: var(--text-200);
}
/* A missing value that is typed here: the field sits in the To NEMO box */
.fl--code-hover .fl-row--edit:not(.fl-head) > [data-col='NEMOLink'] {
  display: flex;
  grid-column: 2;
  grid-row: 1;
  z-index: 1;
  justify-content: center;
  padding: 4px 8px 4px 13px;
}
.fl--code-hover .fl-row--edit > .prov-lane > * {
  visibility: hidden;
}
/* A missing row (user 2026-11-07): the Missing tag under the name says
   it; the field is the app's own — white, the usual solid line — with no
   orange box or bar around it */
.fl--code-hover .fl-label:has(.fl-tag) {
  align-items: flex-start;
  gap: 8px;
}
.fl--code-hover .fl-row--edit > .prov-lane {
  background: none;
  box-shadow: none;
}
.fl--code-hover .fl-row--edit:not(.fl-head) > [data-col='NEMOLink'] {
  padding: 4px 0;
}
.fl--code-hover .fl-row--edit :deep(.q-field__control) {
  background: var(--nl-g-white);
  box-shadow: none;
}
.fl--code-hover .fl-row--edit :deep(.q-field__control:before) {
  border-style: solid;
  border-color: var(--nl-g-field-line);
}
/* The source is the From column's: not again in the box */
.fl--code-hover .prov-lane .prov-from {
  display: none;
}
.fl-from__text {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fl--code-hover .fl-from {
  grid-column: 3;
  font-weight: 500;
  color: var(--text-200);
}
.fl-label__hover {
  cursor: help;
}
.fl-link {
  color: var(--nl-g-blue);
  font-weight: 600;
  text-decoration: none;
}
.fl-link:hover {
  text-decoration: underline;
}
.fl-row--differs {
  background: var(--nl-amber-bg);
}
.fl-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}
.fl-label {
  color: var(--nl-ink);
}
.fl-source {
  display: flex;
  flex-direction: column;
}
.fl-source + .fl-source {
  margin-top: 4px;
}
.fl-use {
  align-self: flex-start;
  margin-top: 1px;
}
.fl-meta {
  font-size: 12px;
  color: var(--nl-ink-3);
}
.fl-amber {
  color: var(--nl-amber-text);
}
.fl-none {
  color: var(--nl-ink-3);
}
.fl-missing {
  color: var(--nl-red-text);
  font-weight: 600;
}
.fl-code {
  color: var(--nl-ink-3);
}
.fl-edit {
  display: flex;
  align-items: center;
  gap: 4px;
}
.fl-completed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-width: 0;
}
.fl-completed .prov-value {
  min-width: 0;
}
.fl-edit-link {
  flex: none;
  border: 0;
  padding: 0;
  background: none;
  color: var(--text-200);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.fl-edit-link:focus-visible {
  outline: 2px solid var(--blue-800);
  outline-offset: 4px;
}
.fl-input {
  flex: 1;
  min-width: 0;
}
.fl-input :deep(.q-field__control),
.fl-input :deep(.q-field__native),
.fl-input :deep(.q-field__marginal) {
  min-height: 44px;
  height: 44px;
}
/* The dropdown component's box (Figma 557:7884), as in New port call:
   44px, the text 14px in, the chevron 9px from the right edge */
.fl-input.q-field--outlined :deep(.q-field__control) {
  padding: 0 14px;
}
.fl-input.q-select.q-field--outlined :deep(.q-field__control) {
  padding-right: 9px;
}
.fl-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 4px 4px;
  border-top: 1px solid var(--nl-line);
  color: var(--nl-ink);
  font-size: 14px;
}
.fl-ready {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--nl-green-text);
  font-size: 14px;
}
.fl-choice {
  flex: 1;
}
/* The radio buttons' words as the other values: 14px Medium, Text/200 */
.fl-choice :deep(.q-radio__label) {
  font-size: 14px;
  font-weight: 500;
  color: var(--nl-g-body);
}
.fl-struck {
  text-decoration: line-through;
  color: var(--nl-ink-3);
}

/* All details' filters (spec 0092): count-first, tap to filter */
.fl-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  /* As far from the list as step 1's heading is from its list */
  margin-bottom: 26px;
}
.fl-filter {
  /* Figma 487:8211: 36px pills, off = 2px Blue/700 ring, Medium Text/100 */
  border: 2px solid var(--nl-g-field-line);
  background: var(--nl-g-white);
  color: var(--text-100);
  border-radius: 999px;
  padding: 4px 12px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
/* Nothing entered: the – button stays as it is, it just cannot be picked */
.fl-filter:disabled {
  cursor: default;
}
.fl-filter--on {
  border-width: 1px;
  background: var(--nl-g-blue);
  border-color: var(--nl-g-blue);
  color: var(--nl-g-white);
  font-weight: 600;
}

/* The phone row as on the NOA facts (user 2026-11-06): no card surface, a
   hairline between; the name as a field label with its tag under it
   (Missing, Sources differ or To NEMO), the source's value, the field —
   white with the usual line. No line heads; the To NEMO line only where
   there is no field */
.fl--cards .fl-row {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'label code'
    'ext ext'
    'link link'
    'nemo nemo';
  gap: 8px;
  padding: 12px 0;
  margin-top: 0;
  border: none;
  border-bottom: 1px solid var(--nl-line);
  border-radius: 0;
  background: none;
}
.fl--cards .prov-lane {
  margin-block: 0;
  padding-block: 4px;
  border-radius: 6px;
}
.fl--cards .fl-row--missing,
.fl--cards .fl-row--differs {
  background: none;
}
.fl--cards .fl-label {
  grid-area: label;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
  color: var(--text-300); /* the darkest text (user 2026-11-07) */
}
.fl--cards .fl-code {
  grid-area: code;
  font-size: 12px;
}
.fl--cards [data-col='External'] {
  grid-area: ext;
}
.fl--cards [data-col='NEMOLink'] {
  grid-area: link;
}
.fl--cards [data-col='To NEMO'] {
  grid-area: nemo;
}
/* No blue To NEMO box on the phone (user 2026-11-07): the value as plain
   text, no Blue/150 lane, no bar, no source dot */
.fl--cards .fl-row > .prov-lane {
  background: none;
  box-shadow: none;
  padding: 0;
}
.fl--cards .prov-lane .prov-value {
  font-weight: 500;
  color: var(--text-200);
}
.fl--cards .prov-lane .prov-from {
  display: none;
}
.fl--cards [data-col='External'],
.fl--cards [data-col='To NEMO'] {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 8px;
}
.fl--cards .fl-source {
  flex-basis: 100%;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}
.fl--cards :deep(.q-field__control) {
  background: var(--nl-g-white);
  box-shadow: none;
}
.fl--cards :deep(.q-field__native),
.fl--cards :deep(.q-field__input) {
  font-weight: 500;
}
.fl--cards :deep(.q-field__control:before) {
  border-style: solid;
  border-color: var(--nl-g-field-line);
}
.fl--cards .fl-input :deep(.q-field__control),
.fl--cards .fl-input :deep(.q-field__native),
.fl--cards .fl-input :deep(.q-field__marginal) {
  min-height: 44px;
  height: 44px;
}
.fl-tag {
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  padding: 1px 8px;
}
.fl-tag--missing {
  background: var(--nl-g-yellow);
  color: var(--nl-g-on-yellow);
}
.fl-tag--nemo {
  background: var(--nl-g-blue);
  color: var(--nl-on-fill);
}
/* Ready: the StatusPill green (user 2026-11-07) */
.fl-tag--ready {
  background: var(--nl-g-green);
  color: var(--nl-on-fill);
}
.fl-tag--differs {
  background: var(--nl-g-yellow);
  color: var(--nl-amber-ink);
}

</style>
