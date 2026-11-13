<template>
  <article class="port-process" :aria-labelledby="`process-title-${call.id}`">
    <header class="process-head">
      <h1 :id="`process-title-${call.id}`">{{ call.shipName ?? 'Ship' }} – {{ call.portName ?? 'Port not set' }}</h1>
      <dl class="process-route">
        <div class="process-route__item">
          <dt>Route</dt>
          <dd>{{ routeLabel || call.portLocode || 'Not set' }}</dd>
        </div>
        <div class="process-route__item">
          <dt>ETA</dt>
          <dd>{{ etaLabel || 'Not set' }}</dd>
        </div>
        <div class="process-route__item">
          <dt>ETD</dt>
          <dd>{{ etdLabel || 'Not set' }}</dd>
        </div>
      </dl>
    </header>

    <div class="process-summary" role="status" aria-live="polite">
      <h2>{{ completed === sections.length ? 'Reports filling complete' : 'Reports filling incomplete' }}</h2>
    </div>

    <input ref="fileInput" type="file" multiple accept=".pdf,.xls,.xlsx" class="file-input" aria-label="Upload port call documents" @change="chooseFiles" />
    <ol class="process-sections">
      <li v-for="section in sections" :key="section.id" class="process-section">
        <h2 class="process-section__title">{{ section.title }}</h2>
        <template v-if="section.upload">
          <div
            class="process-upload"
            :class="{ 'process-upload--over': dragging }"
            @dragover.prevent.stop="dragging = canUpload"
            @dragleave.prevent.stop="dragging = false"
            @drop.prevent.stop="dropFiles"
          >
            <button v-if="canUpload" type="button" class="process-secondary" @click="fileInput?.click()">
              <span class="process-upload-icon" aria-hidden="true" />
              Upload files
            </button>
            <p>{{ canUpload ? 'Or drop them here.' : 'Uploaded files appear here.' }}</p>
          </div>
          <p class="process-files-status" aria-live="polite">
            <button
              v-if="filesCollapsible"
              type="button"
              class="process-files-toggle"
              :aria-expanded="filesOpen"
              :aria-controls="`process-files-${call.id}`"
              @click="filesOpen = !filesOpen"
            >
              {{ documents?.length }} files uploaded
              <img :src="chevronDownUrl" alt="" width="12" height="8" class="process-files-toggle__chevron" :class="{ 'process-files-toggle__chevron--open': filesOpen }" />
            </button>
            <template v-else>{{ documents === null ? 'Loading files…' : documents.length ? `${documents.length} ${documents.length === 1 ? 'file' : 'files'} uploaded` : 'No files uploaded yet.' }}</template>
          </p>
        </template>
        <div v-if="section.cta" class="process-review">
          <button
            type="button"
            class="process-secondary"
            :disabled="(section.cta.state === 'blocked' && !moored) || !canUpload"
            @click="emit('action', section.cta.action)"
          >{{ section.cta.label }}</button>
          <ProgressPill :state="section.cta.state" />
        </div>
        <ul v-if="section.rows.length" v-show="!section.upload || !filesCollapsible || filesOpen" :id="section.upload ? `process-files-${call.id}` : undefined" class="process-rows">
          <li v-for="row in section.rows" :key="row.id" class="process-row" :class="{ 'process-row--file': row.action.kind === 'document' }">
            <span v-if="isCompletedReportLocked(row)" class="process-row__link process-row__label">{{ row.label }}</span>
            <button
              v-else
              type="button"
              class="process-row__link"
              :class="{ 'process-row__link--completed': row.state === 'completed' && !moored && row.action.kind !== 'edit' }"
              :disabled="(row.state === 'blocked' && !moored) || (row.action.kind === 'edit' ? !canEdit : (!canReport && row.action.kind !== 'document' && row.action.kind !== 'forms'))"
              @click="openRow(row)"
            >{{ row.label }}</button>
            <ProgressPill v-if="row.action.kind !== 'document'" :state="row.state" />
            <p v-if="row.reason" class="process-row__reason">{{ row.reason }}</p>
          </li>
        </ul>
        <slot v-if="section.upload" name="applicable" />
      </li>
    </ol>
    <footer v-if="canEdit" class="process-actions">
      <button type="button" class="process-cancel" :disabled="cannotCancel" @click="emit('cancel')">Cancel port call</button>
    </footer>
    <slot name="audit" />
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PortCall, PortCallDocument } from '../auth/auth';
import { buildProcessSections, type ProcessAction, type ProcessRow } from '../lib/port-call-process';
import ProgressPill from './ProgressPill.vue';
import chevronDownUrl from '../assets/figma/chevron-down.svg';

const props = defineProps<{ call: PortCall; documents: PortCallDocument[] | null; canUpload: boolean; canReport: boolean; canEdit: boolean; etaLabel: string; etdLabel: string; routeLabel?: string }>();
const emit = defineEmits<{ action: [action: ProcessAction]; upload: [files: File[]]; edit: []; cancel: [] }>();
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const filesOpen = ref(false);
const filesCollapsible = computed(() => (props.documents?.length ?? 0) > 3);
const reviewed = ref<string[]>(readReviewed());
function readReviewed(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(`nemolink.process.${props.call.id}`) ?? '[]'); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; } catch { return []; }
}
const sections = computed(() => buildProcessSections(props.call, props.documents ?? [], reviewed.value));
const completed = computed(() => sections.value.filter(s => s.complete).length);
const moored = computed(() => props.call.nemoStatus === 'Moored');
const cannotCancel = computed(() => props.call.status === 'departed' || props.call.obligations.some(o => o.code === 'ATA' && o.state === 'sent'));
function isCompletedReportLocked(row: ProcessRow): boolean {
  if (moored.value || row.id === 'VID' || row.state !== 'completed') return false;
  const code = row.action.kind === 'report' ? row.action.code : row.action.kind === 'noa' ? 'NOA' : null;
  return code !== null && props.call.obligations.some(o => o.code === code && o.state === 'sent' && !o.rejected);
}
function openRow(row: ProcessRow): void {
  if ((row.state === 'blocked' && !moored.value) || isCompletedReportLocked(row)) return;
  if (row.action.kind === 'edit') {
    if (props.canEdit) emit('edit');
    return;
  }
  if (row.id === 'noa-reports' && !reviewed.value.includes(row.id)) {
    reviewed.value = [...reviewed.value, row.id];
    try { localStorage.setItem(`nemolink.process.${props.call.id}`, JSON.stringify(reviewed.value)); } catch { /* Storage is optional. */ }
  }
  emit('action', row.action);
}
function upload(files: File[]): void { if (props.canUpload && files.length) emit('upload', files); }
function chooseFiles(event: Event): void { const input = event.target as HTMLInputElement; upload(Array.from(input.files ?? [])); input.value = ''; }
function dropFiles(event: DragEvent): void { dragging.value = false; upload(Array.from(event.dataTransfer?.files ?? [])); }
</script>

<style scoped>
/* Align the opened call with the page gutters supplied by home-wrap. */
.port-process { width: 100%; color: var(--text-300); padding-bottom: 80px; }
/* Quasar fades native disabled buttons; progress pills indicate availability here. */
.port-process button:disabled { opacity: 1 !important; }
.process-head { margin-bottom: 64px; }
.process-head h1 { margin: 0 0 20px; color: var(--text-300); font-size: 32px; font-weight: 600; line-height: 37px; letter-spacing: 0.32px; }
.process-route { display: flex; flex-wrap: wrap; gap: 20px 24px; margin: 0; }
.process-route__item { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.process-route dt { color: var(--text-100); font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: 0.6px; text-transform: uppercase; }
.process-route dd { margin: 0; color: var(--text-200); font-size: 16px; font-weight: 500; line-height: 22px; letter-spacing: 0.16px; overflow-wrap: anywhere; }
.process-summary { margin-bottom: 48px; }
.process-summary h2 { margin: 0; color: var(--text-300); font-size: 16px; font-weight: 600; line-height: normal; letter-spacing: 0.16px; }
.process-sections { padding: 0; margin: 0; list-style: none; display: flex; flex-direction: column; gap: 64px; }
.process-section__title { margin: 0 0 20px; color: var(--text-300); font-size: 22px; font-weight: 600; line-height: normal; letter-spacing: 0.22px; }
.process-rows { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--blue-500); }
.process-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 16px; align-items: center; min-height: 48px; padding: 10px 0; border-bottom: 1px solid var(--blue-500); }
.process-row--file { grid-template-columns: minmax(0, 1fr); }
.process-row__link { min-width: 0; justify-self: start; padding: 0; border: 0; background: none; color: var(--text-200); text-align: left; font: inherit; font-size: 14px; font-weight: 500; line-height: normal; letter-spacing: 0.14px; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; overflow-wrap: anywhere; }
.process-row__link:disabled, .process-row__label { color: var(--text-300); cursor: default; text-decoration: none; }
.process-row__link--completed { text-decoration: none; }
.process-row__link:focus-visible, .process-secondary:focus-visible, .process-cancel:focus-visible, .process-files-toggle:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 4px; border-radius: 4px; }
.process-row__reason { grid-column: 1 / -1; margin: 8px 0 0; color: var(--text-300); font-size: 12px; line-height: 16px; }
.process-upload { display: flex; flex-direction: column; align-items: flex-start; border-radius: 8px; }
.process-upload--over { outline: 2px dashed var(--blue-800); outline-offset: 8px; }
.process-secondary { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; border: 1.5px solid var(--blue-700); border-radius: 8px; background: var(--blue-100); color: var(--text-300); font: inherit; font-size: 14px; font-weight: 600; line-height: 20px; cursor: pointer; }
.process-secondary:disabled { color: var(--text-100); cursor: default; }
.process-upload-icon { width: 20px; height: 20px; flex: none; background: currentColor; mask: url('../assets/figma/process-upload.svg') center / 20px 20px no-repeat; }
.process-review { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.process-upload p { margin: 14px 0 0; font-size: 14px; line-height: normal; letter-spacing: 0.14px; }
.process-files-status { margin: 24px 0 12px; color: var(--text-300); font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: 0.6px; text-transform: uppercase; }
.process-files-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; }
.process-files-toggle__chevron { flex: none; }
.process-files-toggle__chevron--open { transform: rotate(180deg); }
.file-input { display: none; }
.process-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px; margin-top: 48px; }
.process-cancel { min-height: 44px; padding: 0 16px; border: 1px solid var(--blue-700); border-radius: 8px; background: var(--blue-100); color: var(--text-300); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.process-cancel:disabled { color: var(--text-300); cursor: default; }
@media (max-width: 1023px) {
  .process-row { min-height: var(--nl-row-mobile-min-height); padding: 0; }
  .process-row__link { display: flex; align-items: center; align-self: stretch; }
}
@media (max-width: 599.98px) {
  .process-head { margin-bottom: 48px; }
  .process-head h1 { font-size: 22px; line-height: normal; letter-spacing: 0.22px; }
  .process-route { flex-direction: column; gap: 16px; }
  .process-route dd { font-size: 14px; line-height: 20px; letter-spacing: 0.14px; }
  .process-section__title { font-size: 16px; letter-spacing: 0.16px; }
  .process-sections { gap: 48px; }
  .process-row { column-gap: 10px; }
}
</style>
