<template>
  <!-- Upload (SectionFiles' button, user 2026-11-06): a 36px blue button
       that opens the file picker; the files go to the parent -->
  <span class="ub">
    <q-spinner v-if="uploading" size="20px" color="primary" />
    <button v-else type="button" class="ub-btn" @click="input?.click()">
      <img :src="uploadUrl" alt="" width="20" height="20" />
      <span>{{ label }}</span>
    </button>
    <input
      ref="input"
      type="file"
      multiple
      accept=".pdf,.xls,.xlsx,.xml,.jpg,.jpeg,.png,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/xml,text/xml,image/jpeg,image/png"
      class="ub-hidden"
      @change="onPicked"
    />
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import uploadUrl from '../assets/figma/upload-white.svg';

withDefaults(defineProps<{ uploading?: boolean; label?: string }>(), { uploading: false, label: 'Upload' });
const emit = defineEmits<{ upload: [files: File[]] }>();

const input = ref<HTMLInputElement | null>(null);
function onPicked(event: Event): void {
  const el = event.target as HTMLInputElement;
  const files = Array.from(el.files ?? []);
  el.value = '';
  if (files.length > 0) emit('upload', files);
}
</script>

<style scoped>
.ub {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: 36px;
}
.ub-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px 0 6px;
  border: 0;
  border-radius: 8px;
  background: var(--nl-g-blue);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  letter-spacing: 0.14px;
  color: var(--nl-g-white);
  white-space: nowrap;
  cursor: pointer;
}
.ub-btn:focus-visible {
  outline: 2px solid var(--blue-800);
  outline-offset: 2px;
}
.ub-hidden {
  display: none;
}
</style>
