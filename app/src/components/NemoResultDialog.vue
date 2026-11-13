<template>
  <!-- The result viewer as a dialog (spec 0081): after a NEMO call made
       outside the wizard — the cancel (COA) -->
  <HouseDialog
    :model-value="modelValue"
    :title="title"
    :subtitle="subtitle"
    :max-width-px="720"
    sectioned
    main-label="OK"
    main-icon="check"
    @main="emit('update:modelValue', false)"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <NemoResultView :exchanges="exchanges" />
  </HouseDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { NemoExchange } from '../auth/auth';
import HouseDialog from './HouseDialog.vue';
import NemoResultView from './NemoResultView.vue';

const props = defineProps<{ modelValue: boolean; exchanges: NemoExchange[]; subtitle?: string | undefined }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const title = computed(() => {
  const x = props.exchanges;
  if (x.length === 0) return "NEMO's answer";
  if (x.every((e) => e.outcome === 'success')) return 'NEMO accepted it';
  if (x.some((e) => e.outcome === 'unavailable')) return 'NEMO is unavailable';
  return 'NEMO did not accept it';
});
</script>
