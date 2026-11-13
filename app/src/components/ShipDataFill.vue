<template>
  <!-- The missing basic data, typed straight into the list (user 2026-11-13):
       a ship field is saved to the ship's own data and the EORI to the
       organisation settings, so the next report and the next port call
       have them too. Filled rows stay in the list as Ready until the
       report is left. -->
  <div v-if="shown" class="sdf">
    <p class="sdf__lead">
      Fill in what is missing here. Ship fields are saved to the ship data<template v-if="hasOrg">,
      your EORI to the organisation settings</template> — the next port call has them too.
    </p>
    <FormalityLedger
      code-on-hover
      :rows="rows"
      :all-details="false"
      hide-ready
      :busy-key="savingKey"
      @save="saveField"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useAuth, type LedgerRow, type PortCall } from '../auth/auth';
import FormalityLedger from './NodFormalityLedger.vue';

const props = withDefaults(
  defineProps<{
    call: PortCall;
    /** The reports whose ship fields are listed, in this order. */
    codes?: string[];
    /** No EORI on the organisation: its row is added. */
    declarantMissing?: boolean;
    /** False for a reviewing platform admin: shown, not typed in. */
    editable?: boolean;
  }>(),
  { codes: () => ['VID', 'SID', 'SHP', 'NOA'], declarantMissing: false, editable: true },
);
const emit = defineEmits<{ (e: 'saved'): void }>();
const $q = useQuasar();
const auth = useAuth();

/** How each ship field is typed: a day, a number, a pick from a list. */
const SHAPES: Record<string, Pick<LedgerRow, 'kind' | 'codelist'>> = {
  buildDate: { kind: 'date' },
  keelLayingDate: { kind: 'date' },
  iceClass: { kind: 'code', codelist: 'iceClass' },
  inertGasSystem: { kind: 'code', codelist: 'yesNo' },
  mainEnginePower: { kind: 'number' },
  openWaterSpeedMeasure: { kind: 'number' },
  length: { kind: 'number' },
  width: { kind: 'number' },
  grossWeight: { kind: 'number' },
  netWeight: { kind: 'number' },
  dwt: { kind: 'number' },
  typeCode: { kind: 'code', codelist: 'shipType' },
  flagState: { kind: 'code', codelist: 'country' },
  registryCode: { kind: 'code', codelist: 'registry' },
  registryPort: { kind: 'code', codelist: 'locode' },
};
const PARTY = new Set(['ownerName', 'operatorName']);

const rows = computed<LedgerRow[]>(() => {
  const obligations = props.call.obligations ?? [];
  const items = (code: string) => obligations.find((o) => o.code === code)?.items ?? [];
  // Owner or lessee: either one will do (NR-SHP-001)
  const partyOk = items('SHP').some((i) => i.shipKey && PARTY.has(i.shipKey) && i.ok);
  const out = new Map<string, LedgerRow>();
  for (const code of props.codes) {
    for (const i of items(code)) {
      if (i.from !== 'ship' || !i.shipKey || i.de === null || out.has(i.shipKey)) continue;
      // The other party is not needed once one is there: no row for it
      if (!i.ok && partyOk && PARTY.has(i.shipKey)) continue;
      const ok = i.ok;
      out.set(i.shipKey, {
        key: `ship:${i.shipKey}`,
        label: i.label,
        de: i.de,
        kind: 'text',
        ...SHAPES[i.shipKey],
        owner: 'ship',
        editable: props.editable && !!props.call.shipId,
        externals: i.value !== null ? [{ value: i.value, source: 'ship data', at: null }] : [],
        entered: null,
        toNemo: i.value,
        ok,
        differs: false,
      });
    }
  }
  const list = [...out.values()];
  if (props.declarantMissing) {
    list.push({
      key: 'org:eori', label: 'Your EORI (declarant)', de: null, kind: 'text', owner: 'org',
      editable: props.editable, externals: [], entered: null, toNemo: null, ok: false, differs: false,
    });
  }
  return list;
});
const hasOrg = computed(() => rows.value.some((r) => r.owner === 'org' && !r.ok));

/** Shown once something was missing, and kept while this port call is open. */
const shown = ref(false);
watch(() => props.call.id, () => { shown.value = false; });
watch(() => rows.value.some((r) => !r.ok), (missing) => { if (missing) shown.value = true; }, { immediate: true });

const savingKey = ref<string | null>(null);
async function saveField(key: string, value: string | number | null): Promise<void> {
  savingKey.value = key;
  try {
    await auth.saveNoaField(props.call.id, key, value);
    emit('saved');
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not save', timeout: 8000 });
  } finally {
    savingKey.value = null;
  }
}
</script>

<style scoped>
.sdf { margin-top: 16px; }
.sdf__lead { margin: 0 0 8px; font-size: 14px; color: var(--text-200); }
</style>
