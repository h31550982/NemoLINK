<template>
  <div class="mobile-file-actions" :class="$attrs.class">
    <q-btn outline no-caps color="primary" icon="upload" label="Upload files" aria-haspopup="dialog" @click="open('Upload files')" />
    <q-btn outline no-caps color="primary" icon="description" label="Review files" aria-haspopup="dialog" @click="open('Review files')" />
  </div>
  <HouseDialog v-model="opened" :title="title" :sheet-breakpoint="1024" close-label="Done" no-shortcut-hint>
    <p class="mobile-files-context">{{ context }}</p>
    <UploadButton label="Upload files" :uploading="uploading" @upload="emit('upload', $event)" />
    <p v-if="!docs.length" class="mobile-files-empty">No files in this section yet.</p>
    <ul v-else class="mobile-files-list">
      <li v-for="doc in docs" :key="doc.id">
        <q-icon name="description" size="24px" aria-hidden="true" />
        <a :href="auth.callDocumentFileUrl(callId, doc.id)" :download="doc.fileName">{{ doc.fileName }}</a>
        <q-btn v-if="auth.isOperator.value || doc.uploadedBy === auth.user.value?.username" flat round icon="delete" :aria-label="`Remove ${doc.fileName}`" :disable="uploading" @click="emit('remove', doc)" />
      </li>
    </ul>
    <q-btn v-if="docs.length" flat no-caps color="primary" icon="download" label="Download all files" type="a" :href="auth.callDocumentsOriginalZipUrl(callId, docs.map(doc => doc.id))" />
  </HouseDialog>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useAuth, type PortCallDocument } from '../auth/auth';
import HouseDialog from './HouseDialog.vue';
import UploadButton from './UploadButton.vue';
defineProps<{ callId: string; docs: PortCallDocument[]; uploading: boolean; context: string }>();
const emit = defineEmits<{ upload: [files: File[]]; remove: [doc: PortCallDocument] }>();
defineOptions({ inheritAttrs: false });
const auth = useAuth();
const opened = ref(false);
const title = ref('Review files');
function open(label: string): void { title.value = label; opened.value = true; }
</script>
<style scoped>
.mobile-file-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-block-end: 24px; }
.mobile-file-actions :deep(.q-btn) { min-height: 44px; font-size: 14px; }
.mobile-files-context { margin: 0 0 20px; color: var(--text-200); font-size: 16px; }
.mobile-files-empty { margin: 24px 0; color: var(--text-100); }
.mobile-files-list { list-style: none; padding: 0; margin: 24px 0 12px; }
.mobile-files-list li { display: flex; align-items: center; gap: 12px; padding-block: 16px; border-bottom: 1px solid var(--blue-600); }
.mobile-files-list li > .q-icon { flex: none; color: var(--blue-800); }
.mobile-files-list a { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--text-300); text-underline-offset: 3px; }
.mobile-files-list a:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 3px; }
</style>
