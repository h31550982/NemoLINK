<template>
  <div class="report-attachments" :class="{ 'report-attachments--page': page, 'report-attachments--open': visible, 'report-attachments--present': present, 'report-attachments--inline': !hasHeaderTrigger }" :style="{ '--attachment-duration': open ? '300ms' : '200ms' }" @dragover.prevent.stop @drop.prevent.stop>
    <Transition name="attachments" @after-enter="afterOpen" @after-leave="afterClose">
      <aside
        v-if="open"
        :id="panelId"
        class="attachments-panel"
        :aria-labelledby="titleId"
        @keydown.esc.stop.prevent="close"
        @dragenter.prevent.stop="onDragEnter"
        @dragover.prevent.stop
        @dragleave.prevent.stop="dragDepth = Math.max(0, dragDepth - 1)"
        @drop.prevent.stop="onDrop"
      >
        <header class="attachments-head">
          <div class="attachments-heading">
            <h2 :id="titleId">Attachments</h2>
            <p class="attachments-context">{{ context }}</p>
          </div>
          <button ref="closeButton" type="button" class="attachments-icon-button" aria-label="Close attachments" @click="close">
            <q-icon name="close" size="22px" />
          </button>
        </header>
        <div class="attachments-scroll">
          <div class="attachments-files-head">
            <h3>Files <span>({{ docs.length }})</span></h3>
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
                <a class="attachment-file__name" :data-clip-key="doc.id" :href="auth.callDocumentFileUrl(callId, doc.id)" :download="doc.fileName">
                  {{ doc.fileName }}
                  <q-tooltip v-if="clipped[doc.id]" anchor="top middle" self="bottom middle" :offset="[0, 6]" max-width="320px">{{ doc.fileName }}</q-tooltip>
                </a>
              </div>
              <button v-if="canRemove(doc)" type="button" class="attachment-file__remove" :disabled="uploading" :aria-label="`Remove ${doc.fileName}`" @click="requestRemove(doc)">
                <q-icon name="delete" size="24px" />
              </button>
            </li>
          </ul>
          <div
            v-if="canUpload"
            class="attachments-upload"
            :class="{ 'attachments-upload--over': dragDepth > 0, 'attachments-upload--busy': uploading }"
            :aria-busy="uploading"
          >
            <q-btn unelevated no-caps color="primary" icon="upload" label="Upload files" :loading="uploading" :disable="uploading" @click="input?.click()">
              <q-tooltip>PDF, Excel, XML, JPG, PNG · max 15 MB each</q-tooltip>
            </q-btn>
            <span class="attachments-upload__hint">{{ uploading ? 'Uploading files…' : 'or drop files here' }}</span>
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
        </div>
      </aside>
    </Transition>
    <Teleport :to="triggerTarget ?? 'body'" :disabled="!triggerTarget">
      <button
        ref="trigger"
        type="button"
        class="attachments-trigger"
        :class="{ 'attachments-trigger--active': open }"
        :aria-label="`${open ? 'Close' : 'Open'} attachments (${docs.length})`"
        :aria-expanded="open"
        :aria-controls="open ? panelId : undefined"
        @click="open ? close() : show()"
      >
        <q-icon name="attach_file" size="20px" class="attachments-trigger__clip" />
        <span>Files</span>
        <span class="attachments-trigger__count" aria-hidden="true">{{ docs.length }}</span>
        <span class="attachments-trigger__divider" aria-hidden="true" />
        <svg class="attachments-trigger__drawer-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path v-if="open" d="M11 3h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3V3Z" fill="currentColor" />
          <rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.5" />
          <path d="M11 3v12" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, onUpdated, reactive, ref, useId } from 'vue';
import { useAuth, type PortCallDocument } from '../auth/auth';
import { reportAttachmentMovingKey, reportAttachmentTriggerKey, reportAttachmentVisibleKey } from '../lib/report-attachment-trigger';

const props = withDefaults(defineProps<{ callId: string; docs: PortCallDocument[]; uploading: boolean; context: string; page?: boolean; canUpload?: boolean; inspect?: boolean }>(), { canUpload: true });
const emit = defineEmits<{ upload: [files: File[]]; remove: [doc: PortCallDocument]; inspect: [doc: PortCallDocument] }>();
const auth = useAuth();
const headerTrigger = inject(reportAttachmentTriggerKey, null);
const hasHeaderTrigger = headerTrigger !== null;
const triggerTarget = computed(() => headerTrigger?.value ?? null);
const open = ref(false);
const visible = inject(reportAttachmentVisibleKey, ref(false));
const moving = inject(reportAttachmentMovingKey, ref(false));
const present = ref(false);
const input = ref<HTMLInputElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const panelId = useId();
const titleId = useId();
const dragDepth = ref(0);
/** File names cut to one line, by document id: those get the whole name on hover. */
const clipped = reactive<Record<string, boolean>>({});
function measureClips(): void {
  document.querySelectorAll<HTMLElement>(`#${CSS.escape(panelId)} [data-clip-key]`).forEach((el) => {
    const k = el.dataset.clipKey!;
    const cut = el.scrollWidth > el.clientWidth;
    if (clipped[k] !== cut) clipped[k] = cut;
  });
}
onMounted(() => window.addEventListener('resize', measureClips));
onUpdated(measureClips);

async function show(): Promise<void> {
  moving.value = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  present.value = true;
  visible.value = true;
  open.value = true;
  await nextTick();
  measureClips();
  closeButton.value?.focus({ preventScroll: true });
}
async function close(): Promise<void> {
  moving.value = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  visible.value = false;
  open.value = false;
  dragDepth.value = 0;
  await nextTick();
  trigger.value?.focus({ preventScroll: true });
}
function afterOpen(): void {
  if (open.value) moving.value = false;
}
function afterClose(): void {
  if (!open.value) {
    present.value = false;
    moving.value = false;
  }
}
onBeforeUnmount(() => { visible.value = false; moving.value = false; window.removeEventListener('resize', measureClips); });
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
</script>

<style scoped>
.report-attachments { display: flex; flex: none; align-self: stretch; width: 0; min-height: 0; margin-inline-start: 0; overflow: clip; color: var(--text-300); }
.report-attachments--open { width: 360px; }
.attachments-trigger, .attachments-icon-button { display: inline-flex; justify-content: center; align-items: center; flex: none; padding: 0; border: 1px solid transparent; font: inherit; cursor: pointer; }
.attachments-trigger { gap: 8px; min-height: 44px; padding: 0 12px; border: 1.5px solid var(--blue-700); border-radius: 8px; background: var(--blue-100); color: var(--text-300); font-size: 14px; font-weight: 600; line-height: 20px; white-space: nowrap; }
.attachments-trigger--active { border-color: var(--blue-800); background: var(--blue-150); }
.attachments-trigger--active > :deep(.q-icon) { color: var(--blue-800); }
.attachments-trigger__clip { rotate: 35deg; }
.attachments-trigger__count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding-inline: 5px; border-radius: 10px; background: var(--blue-800); color: var(--blue-100); font-size: 12px; font-weight: 600; line-height: 20px; font-variant-numeric: tabular-nums; }
.attachments-trigger__divider { width: 1px; height: 22px; margin-inline: 2px; background: var(--blue-600); }
.attachments-trigger__drawer-icon { color: var(--text-100); }
.attachments-trigger--active .attachments-trigger__drawer-icon { color: var(--blue-800); }
.attachments-trigger:focus-visible, .attachments-icon-button:focus-visible, .attachment-file__name:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 3px; }
.attachments-panel { display: flex; flex-direction: column; flex: none; width: 360px; min-height: 0; background: var(--blue-100); border-inline: 1px solid var(--blue-600); }
.attachments-head { position: relative; flex: none; padding: 20px 56px 0 20px; }
.attachments-heading { min-width: 0; }
.attachments-head h2 { margin: 0; font-size: 22px; font-weight: 600; line-height: 28px; letter-spacing: .22px; }
/* Close glyph's top edge on the cap top of "Attachments": 22px Instrument Sans in a 28px line puts the
   cap 6px under the line top; the 22px close glyph starts 15.5px into the 44px button (11px + 4.5px),
   so 4.5px from the edge puts its right side on the 20px side padding. */
.attachments-icon-button { position: absolute; inset-block-start: 10.5px; inset-inline-end: 4.5px; width: 44px; height: 44px; border-radius: 8px; background: transparent; color: var(--text-100); }
.attachments-scroll { flex: 1; min-height: 0; padding: 32px 20px 20px; overflow-y: auto; overscroll-behavior: contain; }
.attachments-context { margin: 0; color: var(--text-200); font-size: 14px; font-weight: 500; line-height: 22px; letter-spacing: .14px; overflow-wrap: anywhere; }
.attachments-upload { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-block-start: 32px; padding: 0; text-align: center; }
.attachments-upload--over { outline: 2px dashed var(--blue-800); outline-offset: 6px; border-radius: 8px; background: var(--blue-150); }
.attachments-upload__hint { color: var(--text-100); font-size: 12px; font-weight: 500; line-height: 18px; }
.attachments-upload :deep(.q-btn) { align-self: stretch; min-height: 36px; border-radius: 8px; font-size: 14px; font-weight: 600; }
.attachments-input { display: none; }
.attachments-files-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0; }
.attachments-files-head h3 { margin: 0; font-size: 16px; font-weight: 600; line-height: 22px; }
.attachments-files-head h3 span { color: var(--text-100); }
.attachments-files { margin: 0; padding: 0; list-style: none; }
.attachment-file { display: flex; align-items: center; gap: 12px; padding: 22px 0; border-bottom: 1px solid var(--blue-600); }
.attachment-file:only-child { border-bottom: 0; }
.attachment-file__type { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: none; gap: 2px; width: 40px; height: 40px; border-radius: 8px; background: var(--blue-150); color: var(--blue-800); }
.attachment-file__type :deep(.q-icon) { font-size: 20px !important; }
.attachment-file__type span { font-size: 10px; font-weight: 700; line-height: 12px; }
.attachment-file__type--pdf { background: var(--red-100); color: var(--red-300); }
.attachment-file__type--sheet, .attachment-file__type--image { background: var(--green-100); color: var(--green-400); }
.attachment-file__details { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.attachment-file__name { color: var(--text-300); font-size: 16px; font-weight: 500; line-height: 21px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }
/* 40px target; the 24px delete glyph's right edge (8px button inset + 4px glyph inset) sits on the 20px side padding. */
.attachment-file__remove { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; margin-inline-end: -12px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--text-100); font: inherit; cursor: pointer; }
.attachment-file__remove :deep(.q-icon) { display: block; line-height: 1; }
.attachment-file__remove:disabled { cursor: default; opacity: .5; }
.attachment-file__remove:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 0; }
.attachments-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 12px; color: var(--text-100); text-align: center; font-size: 14px; }
.attachments-empty p { margin: 0; font-size: 12px; line-height: 18px; }
.report-attachments--page { position: sticky; top: 80px; align-self: flex-start; margin-block-start: 20px; height: calc(100dvh - 100px - var(--module-action-height, 0px)); }
.report-attachments--page .attachments-head { padding-block-start: 0; }
.report-attachments--page { overflow-x: clip; overflow-y: visible; }
.report-attachments--page .attachments-icon-button { inset-block-start: -9.5px; }
.report-attachments--page:not(.report-attachments--present) { height: 0; }
.report-attachments--inline:not(.report-attachments--present) { width: auto; height: auto; }
@media (hover: hover) {
  .attachments-trigger:not(.attachments-trigger--active):hover, .attachments-icon-button:hover { background: var(--blue-300); }
  .attachment-file__name:hover { text-decoration: underline; text-underline-offset: 3px; }
}
@media (prefers-reduced-motion: no-preference) {
  .report-attachments { transition: width var(--attachment-duration, 300ms) cubic-bezier(0.2, 0, 0, 1), margin-inline-start var(--attachment-duration, 300ms) cubic-bezier(0.2, 0, 0, 1); }
  .attachments-enter-active { transition: transform 300ms cubic-bezier(0.2, 0, 0, 1); }
  .attachments-leave-active { transition: transform 200ms cubic-bezier(0.2, 0, 0, 1); }
  .attachments-enter-from, .attachments-leave-to { transform: translateX(100%); }
  .attachments-trigger, .attachments-icon-button { transition: scale 150ms ease-out; }
  .attachments-trigger:active, .attachments-icon-button:active { scale: .96; }
}
@media (prefers-reduced-motion: reduce) {
  .attachments-enter-active, .attachments-leave-active { transition: opacity 150ms ease-out; }
  .attachments-enter-from, .attachments-leave-to { opacity: 0; }
}
</style>
