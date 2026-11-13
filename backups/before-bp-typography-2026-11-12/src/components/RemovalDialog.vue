<template>
  <q-dialog :model-value="modelValue" persistent no-shake @update:model-value="updateOpen">
    <q-card class="removal-dialog" role="alertdialog" :aria-labelledby="titleId" :aria-describedby="descriptionId">
      <div class="removal-dialog__content">
        <div class="removal-dialog__copy">
          <h2 :id="titleId" class="removal-dialog__title">{{ title }}</h2>
          <div :id="descriptionId" class="removal-dialog__description"><slot /></div>
        </div>
        <div v-if="$slots.details" class="removal-dialog__details"><slot name="details" /></div>
        <div v-if="kind === 'port-call'" class="removal-dialog__verification">
          <label :for="inputId">Type “delete” to confirm.</label>
          <q-input
            :for="inputId"
            v-model="confirmation"
            outlined
            dense
            :disable="loading"
            autocomplete="off"
            autocapitalize="off"
            :spellcheck="false"
            @keydown.enter.prevent="confirm"
          />
        </div>
      </div>
      <div class="removal-dialog__actions">
        <q-btn outline no-caps class="removal-dialog__close" label="Close" :disable="loading" @click="updateOpen(false)" />
        <q-btn unelevated no-caps color="negative" class="removal-dialog__confirm" label="Confirm" :loading="loading" :disable="blocked" @click="confirm" />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  title: string;
  /** The typed confirmation is reserved for removing a port call. */
  kind?: 'item' | 'port-call';
  loading?: boolean;
  disable?: boolean;
}>(), { kind: 'item', loading: false, disable: false });
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
}>();
const id = useId();
const titleId = `${id}-title`;
const descriptionId = `${id}-description`;
const inputId = `${id}-confirmation`;
const confirmation = ref('');
const blocked = computed(() => props.disable || (props.kind === 'port-call' && confirmation.value !== 'delete'));
watch(() => props.modelValue, () => { confirmation.value = ''; });
function updateOpen(value: boolean): void {
  if (!props.loading) emit('update:modelValue', value);
}
function confirm(): void {
  if (props.modelValue && !props.loading && !blocked.value) emit('confirm');
}
</script>

<style scoped>
/* Figma Critical Module, 638:13174. QDialog uses the shared ink-at-40% backdrop. */
.q-card.removal-dialog {
  width: 561px;
  max-width: calc(100vw - 32px);
  padding: 24px;
  border-radius: 8px;
  background: var(--blue-100);
  display: flex;
  flex-direction: column;
  gap: 48px;
  overflow-y: auto;
}
.removal-dialog__content {
  display: flex;
  flex-direction: column;
  gap: 34px;
}
.removal-dialog__copy {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.removal-dialog__title {
  margin: 0;
  color: var(--text-300);
  font-size: 22px;
  font-weight: 600;
  line-height: normal;
  letter-spacing: 0.22px;
  overflow-wrap: anywhere;
}
.removal-dialog__description,
.removal-dialog__details {
  color: var(--text-200);
  font-size: 14px;
  font-weight: 500;
  line-height: normal;
  letter-spacing: 0.14px;
  overflow-wrap: anywhere;
}
.removal-dialog__description :deep(p) { margin: 0; }
.removal-dialog__verification {
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--text-300);
  font-size: 14px;
  font-weight: 600;
  line-height: normal;
  letter-spacing: 0.14px;
}
.removal-dialog__verification :deep(.q-field__control),
.removal-dialog__verification :deep(.q-field__marginal) { height: 36px; }
.removal-dialog__verification :deep(.q-field__control) { padding: 0 14px; }
.removal-dialog__verification :deep(.q-field__control:before) { border-width: 1.5px; }
.removal-dialog__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.removal-dialog__actions .q-btn {
  height: 44px;
  min-height: 44px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}
.removal-dialog__close { width: 70px; color: var(--text-200); }
.removal-dialog__confirm { width: 162px; }
@media (max-width: 359px) {
  .removal-dialog__confirm { flex: 1; min-width: 0; }
}
</style>
