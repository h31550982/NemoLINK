<template>
  <div class="report-attachments" :class="{ 'report-attachments--page': page, 'report-attachments--open': open }" @dragover.prevent.stop @drop.prevent.stop>
    <Transition name="attachments">
      <aside
        v-if="open"
        :id="panelId"
        class="attachments-panel"
        :aria-labelledby="titleId"
        @keydown.esc.stop.prevent="close"
      >
        <header class="attachments-head">
          <q-icon name="attach_file" size="22px" color="primary" />
          <h2 :id="titleId">Attachments</h2>
          <button ref="closeButton" type="button" class="attachments-icon-button" aria-label="Close attachments" @click="close">
            <q-icon name="close" size="22px" />
          </button>
        </header>
        <div class="attachments-scroll">
          <p class="attachments-context">{{ context }}</p>
          <div
            v-if="canUpload"
            class="attachments-upload"
            :class="{ 'attachments-upload--over': dragDepth > 0, 'attachments-upload--busy': uploading }"
            :aria-busy="uploading"
            @dragenter.prevent.stop="onDragEnter"
            @dragover.prevent.stop
            @dragleave.prevent.stop="dragDepth = Math.max(0, dragDepth - 1)"
            @drop.prevent.stop="onDrop"
          >
            <q-icon name="cloud_upload" size="30px" color="primary" />
            <span class="attachments-upload__title">{{ uploading ? 'Uploading files…' : 'Upload files or drop here' }}</span>
            <span class="attachments-upload__hint">PDF, Excel, XML, JPG, PNG · max 15 MB each</span>
            <q-btn unelevated no-caps color="primary" icon="upload" label="Upload files" :loading="uploading" :disable="uploading" @click="input?.click()" />
            <input
              ref="input"
              type="file"
              multiple
              accept=".pdf,.xls,.xlsx,.xml,.jpg,.jpeg,.png,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/xml,text/xml,image/jpeg,image/png"
              class="attachments-input"
              aria-label="Upload attachments"
              :disabled="uploading"
              @change="onPicked"
            />
          </div>
          <div class="attachments-files-head">
            <h3>Files <span>({{ docs.length }})</span></h3>
            <a v-if="docs.length" class="attachments-download-all" :href="auth.callDocumentsOriginalZipUrl(callId, docs.map(d => d.id))" target="_blank" rel="noopener">
              <q-icon name="download" size="18px" />
              Download all
            </a>
          </div>
          <div v-if="!docs.length" class="attachments-empty">
            <q-icon name="insert_drive_file" size="28px" />
            <span>No files yet</span>
            <p>{{ canUpload ? 'Files you add to this section will appear here.' : 'Uploaded files will appear here.' }}</p>
          </div>
          <ul v-else class="attachments-files">
            <li v-for="doc in docs" :key="doc.id" class="attachment-file">
              <span class="attachment-file__type" :class="`attachment-file__type--${fileKind(doc)}`" aria-hidden="true">
                <q-icon :name="fileIcon(doc)" size="24px" />
                <span>{{ fileExtension(doc) }}</span>
              </span>
              <div class="attachment-file__details">
                <a class="attachment-file__name" :href="auth.callDocumentFileUrl(callId, doc.id)" :download="doc.fileName" :title="doc.fileName">{{ doc.fileName }}</a>
                <span class="attachment-file__size">{{ formatSize(doc.byteSize) }}</span>
              </div>
              <q-btn flat round dense icon="more_vert" class="attachment-file__menu" :aria-label="`Actions for ${doc.fileName}`">
                <q-menu auto-close>
                  <q-list dense>
                    <q-item v-if="inspect" clickable @click="emit('inspect', doc)">
                      <q-item-section avatar><q-icon name="description" size="20px" /></q-item-section>
                      <q-item-section>View details</q-item-section>
                    </q-item>
                    <q-item clickable tag="a" :href="auth.callDocumentFileUrl(callId, doc.id)" :download="doc.fileName">
                      <q-item-section avatar><q-icon name="download" size="20px" /></q-item-section>
                      <q-item-section>Download</q-item-section>
                    </q-item>
                    <q-item v-if="canRemove(doc)" clickable :disable="uploading" @click="requestRemove(doc)">
                      <q-item-section avatar><q-icon name="delete_outline" size="20px" /></q-item-section>
                      <q-item-section>Remove</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </li>
          </ul>
        </div>
      </aside>
    </Transition>
    <div class="attachments-rail">
      <button
        ref="trigger"
        type="button"
        class="attachments-trigger"
        :class="{ 'attachments-trigger--active': open }"
        :aria-label="`${open ? 'Close' : 'Open'} attachments (${docs.length})`"
        :aria-expanded="open"
        :aria-controls="panelId"
        @click="open ? close() : show()"
      >
        <q-icon name="attach_file" size="26px" />
        <q-tooltip>{{ open ? 'Close attachments' : `Attachments (${docs.length})` }}</q-tooltip>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
import { useAuth, type PortCallDocument } from '../auth/auth';

const props = withDefaults(defineProps<{ callId: string; docs: PortCallDocument[]; uploading: boolean; context: string; page?: boolean; canUpload?: boolean; inspect?: boolean }>(), { canUpload: true });
const emit = defineEmits<{ upload: [files: File[]]; remove: [doc: PortCallDocument]; inspect: [doc: PortCallDocument] }>();
const auth = useAuth();
const open = ref(false);
const input = ref<HTMLInputElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const panelId = useId();
const titleId = useId();
const dragDepth = ref(0);

async function show(): Promise<void> {
  open.value = true;
  await nextTick();
  closeButton.value?.focus({ preventScroll: true });
}
function close(): void {
  open.value = false;
  dragDepth.value = 0;
  trigger.value?.focus({ preventScroll: true });
}
function onDragEnter(event: DragEvent): void {
  if (event.dataTransfer?.types.includes('Files')) dragDepth.value++;
}
function onDrop(event: DragEvent): void {
  dragDepth.value = 0;
  if (!props.canUpload || props.uploading) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) emit('upload', files);
}
function onPicked(event: Event): void {
  const element = event.target as HTMLInputElement;
  const files = Array.from(element.files ?? []);
  element.value = '';
  if (files.length) emit('upload', files);
}
function canRemove(doc: PortCallDocument): boolean {
  return auth.isOperator.value || (props.canUpload && doc.uploadedBy === auth.user.value?.username);
}
async function requestRemove(doc: PortCallDocument): Promise<void> {
  // The confirmation returns focus to a stable control if this row is removed.
  await nextTick();
  closeButton.value?.focus({ preventScroll: true });
  emit('remove', doc);
}
function fileExtension(doc: PortCallDocument): string {
  return doc.fileName.split('.').pop()?.slice(0, 4).toUpperCase() ?? 'FILE';
}
function fileKind(doc: PortCallDocument): string {
  if (/\.(xlsx?|csv)$/i.test(doc.fileName)) return 'sheet';
  if (/\.(jpe?g|png)$/i.test(doc.fileName)) return 'image';
  if (/\.pdf$/i.test(doc.fileName)) return 'pdf';
  return 'document';
}
function fileIcon(doc: PortCallDocument): string {
  return ({ sheet: 'table_view', image: 'image', pdf: 'picture_as_pdf', document: 'description' })[fileKind(doc)] ?? 'description';
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<style scoped>
.report-attachments { display: flex; flex: none; align-self: stretch; width: 56px; min-height: 0; color: var(--text-300); }
.report-attachments--open { width: 376px; }
.attachments-rail { width: 56px; flex: none; padding: 16px 6px; background: var(--blue-150); border-inline-start: 1px solid var(--blue-600); }
.attachments-trigger, .attachments-icon-button { display: inline-flex; justify-content: center; align-items: center; flex: none; padding: 0; border: 1px solid transparent; font: inherit; cursor: pointer; }
.attachments-trigger { position: sticky; top: 96px; width: 44px; height: 44px; border-radius: 10px; background: var(--blue-100); color: var(--blue-800); box-shadow: 0 1px 3px rgb(15 15 42 / .08), 0 2px 6px rgb(15 15 42 / .04); }
.attachments-trigger--active { background: var(--blue-800); color: var(--blue-100); }
.attachments-trigger:focus-visible, .attachments-icon-button:focus-visible, .attachment-file__name:focus-visible, .attachments-download-all:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 3px; }
.attachments-panel { display: flex; flex-direction: column; flex: none; width: 320px; min-height: 0; background: var(--blue-100); border-inline-start: 1px solid var(--blue-600); }
.attachments-head { display: flex; flex: none; align-items: center; gap: 8px; min-height: 64px; padding: 12px 16px; background: var(--blue-300); border-bottom: 1px solid var(--blue-500); }
.attachments-head h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; line-height: 22px; letter-spacing: .16px; }
.attachments-icon-button { width: 32px; height: 32px; border-radius: 8px; background: transparent; color: var(--text-100); }
.attachments-scroll { flex: 1; min-height: 0; padding: 20px 16px; overflow-y: auto; overscroll-behavior: contain; }
.attachments-context { margin: 0 0 16px; color: var(--text-100); font-size: 12px; font-weight: 500; line-height: 18px; overflow-wrap: anywhere; }
.attachments-upload { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20px 12px 16px; border: 1px dashed var(--blue-700); border-radius: 10px; background: var(--blue-200); text-align: center; }
.attachments-upload--over { border-color: var(--blue-800); background: var(--blue-150); }
.attachments-upload__title { font-size: 14px; font-weight: 600; line-height: 20px; }
.attachments-upload__hint { color: var(--text-100); font-size: 12px; line-height: 18px; }
.attachments-upload :deep(.q-btn) { align-self: stretch; min-height: 40px; border-radius: 8px; font-size: 14px; font-weight: 600; }
.attachments-input { display: none; }
.attachments-files-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 28px 0 8px; }
.attachments-files-head h3 { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
.attachments-files-head h3 span { color: var(--text-100); }
.attachments-download-all { display: inline-flex; align-items: center; gap: 4px; color: var(--blue-800); font-size: 12px; font-weight: 600; line-height: 20px; text-decoration: none; white-space: nowrap; }
.attachments-files { margin: 0; padding: 0; list-style: none; }
.attachment-file { display: flex; align-items: center; gap: 10px; min-height: 80px; padding: 16px 0; border-bottom: 1px solid var(--blue-500); }
.attachment-file__type { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: none; gap: 2px; width: 36px; height: 44px; border-radius: 6px; background: var(--blue-150); color: var(--blue-800); }
.attachment-file__type span { font-size: 8px; font-weight: 700; line-height: 10px; }
.attachment-file__type--pdf { background: var(--red-100); color: var(--red-300); }
.attachment-file__type--sheet, .attachment-file__type--image { background: var(--green-100); color: var(--green-400); }
.attachment-file__details { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 0; }
.attachment-file__name { color: var(--text-300); font-size: 12px; font-weight: 500; line-height: 18px; overflow-wrap: anywhere; text-decoration: none; }
.attachment-file__size { color: var(--text-100); font-size: 12px; line-height: 16px; }
.attachment-file__menu { flex: none; color: var(--text-100); }
.attachments-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 12px; color: var(--text-100); text-align: center; font-size: 14px; }
.attachments-empty p { margin: 0; font-size: 12px; line-height: 18px; }
.report-attachments--page { position: sticky; top: 80px; align-self: flex-start; height: calc(100dvh - 80px - var(--module-action-height, 0px)); }
.report-attachments--page .attachments-trigger { top: 16px; }
@media (hover: hover) {
  .attachments-trigger:not(.attachments-trigger--active):hover, .attachments-icon-button:hover { background: var(--blue-300); }
  .attachment-file__name:hover, .attachments-download-all:hover { text-decoration: underline; text-underline-offset: 3px; }
}
@media (prefers-reduced-motion: no-preference) {
  .report-attachments { transition: width 150ms cubic-bezier(0.2, 0, 0, 1); }
  .report-attachments--open { transition-duration: 300ms; }
  .attachments-enter-active { transition: width 300ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease-out; overflow: hidden; }
  .attachments-leave-active { transition: width 150ms cubic-bezier(0.2, 0, 0, 1), opacity 150ms ease-out; overflow: hidden; }
  .attachments-enter-from, .attachments-leave-to { width: 0; opacity: 0; }
  .attachments-trigger, .attachments-icon-button { transition: scale 150ms ease-out; }
  .attachments-trigger:active, .attachments-icon-button:active { scale: .96; }
}
@media (prefers-reduced-motion: reduce) {
  .attachments-enter-active, .attachments-leave-active { transition: opacity 150ms ease-out; }
  .attachments-enter-from, .attachments-leave-to { opacity: 0; }
}
</style>
