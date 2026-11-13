<template>
  <!-- One value as a ledger (the ship dialog's and FormalityLedger's words):
       External (what the ship's forms say, and which form), NEMOLink (the
       slot: what is entered here), To NEMO (what goes). The NEMO code is the
       dialog's subtitle (Figma 401:8083, user 2026-11-02). -->
  <div class="vl" :class="{ 'vl--no-ext': externals.length === 0 }">
    <!-- On the phone, the facts' layout (user 2026-11-06): a tag first —
         Missing, or the blue To NEMO — then the source's value and the
         field; no line heads and no To NEMO line -->
    <span class="vl__tag" :class="{ 'vl__tag--nemo': !!toNemo }">{{ toNemo ? 'To NEMO' : 'Missing' }}</span>
    <div class="vl__label prov-head prov-head--ext">External</div>
    <div class="vl__value vl__value--ext">
      <template v-if="externals.length > 0">
        <div v-for="(e, i) in externals" :key="i" class="vl__source">
          <span class="vl__ext tnum">{{ e.value || '—' }}</span>
          <span v-if="e.source" class="vl__from">{{ e.source }}</span>
        </div>
      </template>
      <span v-else class="vl__none">— no form has it</span>
    </div>

    <div class="vl__label vl__label--edit prov-head prov-head--nl">NEMOLink</div>
    <div class="vl__value">
      <slot />
    </div>

    <!-- To NEMO in NEMO's own colours (2026-10-06, option A); its note under
         the lane, spaced as a field's hint (user 2026-11-02) -->
    <div class="vl__label prov-head prov-head--nemo">To NEMO</div>
    <div class="vl__value">
      <div class="vl__nemo prov-lane prov-lane--flat vl__phone-off" :class="{ 'prov-lane--missing': !toNemo }">
        <span v-if="toNemo" class="tnum prov-value">{{ toNemo }}</span>
        <span v-else class="prov-missing"><q-icon name="error_outline" size="15px" />Missing</span>
      </div>
      <div v-if="toNemoNote" class="vl__note" :class="{ 'vl__note--missing': !toNemo }">{{ toNemoNote }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The ledger lines for one checked or typed value (specs 0064, 0090,
 * 0096): shared by the correction and table entry dialogs so a value reads
 * the same wherever it is fixed.
 */
defineProps<{
  externals: { value: string; source?: string | undefined }[];
  toNemo: string;
  toNemoNote?: string | undefined;
}>();
</script>

<style scoped>
/* Figma 401:8083 (user 2026-11-02): lines 32px apart, the names SemiBold
   with round source dots */
.vl {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 32px 14px;
  align-items: baseline;
}
.vl__label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--nl-ink-3);
}
.vl__label.prov-head::before {
  border-radius: 50%;
}
/* The editor sits in the NEMOLink line; its label aligns with the field */
.vl__label--edit {
  align-self: start;
  padding-top: 12px;
}
.vl__value {
  font-size: 14px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.vl__nemo {
  padding-block: 6px;
  border-radius: 0 6px 6px 0;
}
/* External: the form's value, then the form under it */
.vl__source {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vl__source + .vl__source {
  margin-top: 16px;
}
.vl__ext {
  color: var(--nl-g-ink);
}
.vl__from {
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.02em;
  color: var(--nl-g-secondary);
}
/* To NEMO's note: under the lane as a hint under its field */
.vl__note {
  margin-top: 11px;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.02em;
  color: var(--nl-g-secondary);
}
.vl__note--missing {
  color: var(--nl-missing-text);
}
/* The field's hint: under the field's edge, 11px down, 12/16 Text/100 */
.vl :deep(.q-field__bottom) {
  padding: 11px 0 0;
}
.vl :deep(.q-field__messages) {
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.02em;
  color: var(--nl-g-secondary);
}
.vl__meta {
  font-size: 12px;
  color: var(--nl-ink-3);
  margin-left: 6px;
}
div.vl__meta {
  margin-left: 0;
}
.vl__none {
  color: var(--nl-ink-3);
  font-size: 14px;
}
.vl__tag {
  display: none;
}
@media (max-width: 640px) {
  .vl {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .vl__tag {
    display: inline-flex;
    justify-self: start;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--nl-g-yellow);
    color: var(--nl-g-on-yellow);
    font-size: 12px;
    font-weight: 600;
  }
  .vl__tag--nemo {
    background: var(--nl-g-blue);
    color: var(--nl-on-fill);
  }
  .vl__label,
  .vl__phone-off,
  .vl--no-ext .vl__value--ext {
    display: none;
  }
  .vl__note {
    margin-top: 0;
  }
}
.vl__missing {
  color: var(--nl-ink-3);
  font-style: italic;
}
</style>
