<template>
  <article class="port-process" :aria-labelledby="`process-title-${call.id}`">
    <header class="process-head">
      <div class="process-head__top">
        <div class="process-head__titles">
          <p class="process-head__eyebrow">Port call</p>
          <h1 :id="`process-title-${call.id}`">{{ call.shipName ?? 'Ship' }} <span class="process-head__sep" aria-hidden="true">·</span> {{ call.portName ?? 'Port not set' }}</h1>
        </div>
      </div>
      <dl class="process-route">
        <div class="process-route__item">
          <dt>Route</dt>
          <dd>{{ routeLabel || call.portLocode || 'Not set' }}</dd>
        </div>
        <div class="process-route__item">
          <dt>ETA</dt>
          <dd :class="{ 'process-route__unset': !etaLabel }">{{ etaLabel || 'Not set' }}</dd>
        </div>
        <div class="process-route__item">
          <dt>ETD</dt>
          <dd :class="{ 'process-route__unset': !etdLabel }">{{ etdLabel || 'Not set' }}</dd>
        </div>
      </dl>
      <!-- The same report badges as on the port call card, under the route card (user 2026-11-12) -->
      <slot name="badges" />
    </header>

    <input ref="fileInput" type="file" multiple accept=".pdf,.xls,.xlsx" class="file-input" aria-label="Upload port call documents" @change="chooseFiles" />
    <ol class="process-sections">
      <li v-for="section in sections" :key="section.id" class="process-section" :class="{ 'process-section--upload': section.upload }">
        <h2 class="process-section__title">{{ section.title }}</h2>
        <template v-if="section.upload">
          <div
            class="process-upload"
            :class="{ 'process-upload--over': dragging }"
            @dragover.prevent.stop="dragging = canUpload"
            @dragleave.prevent.stop="dragging = false"
            @drop.prevent.stop="dropFiles"
          >
            <p class="process-upload__intro">Add the ship’s filled forms.</p>
            <ol class="process-upload-steps" aria-label="Upload status">
              <li v-for="step in uploadSteps" :key="step.key" class="process-upload-step" :class="{ 'process-upload-step--complete': step.documents.length }">
                <!-- A status mark only: uploading happens from the Upload files button (user 2026-11-12) -->
                <span class="process-upload-step__marker" aria-hidden="true">
                  <q-icon :name="step.documents.length ? 'check' : 'add'" size="18px" />
                </span>
                <div class="process-upload-step__content">
                  <h3>{{ step.title }}</h3>
                  <p v-for="document in step.documents" :key="document.id">{{ document.fileName }} · {{ fileSize(document.byteSize) }}</p>
                  <p v-if="!step.documents.length">{{ documents === null ? 'Loading files…' : step.optional ? 'Optional' : 'Not uploaded yet' }}</p>
                </div>
              </li>
            </ol>
            <div class="process-upload-actions">
              <p v-if="!uploadsReady" :id="`upload-hint-${call.id}`">Review opens when both documents are uploaded.</p>
              <div class="process-upload-actions__buttons">
                <button v-if="canUpload" type="button" class="process-secondary" @click="fileInput?.click()">
                  <q-icon name="upload" size="20px" aria-hidden="true" />
                  Upload files
                </button>
                <button
                  type="button"
                  class="process-primary"
                  :disabled="!uploadsReady || !canUpload"
                  :aria-describedby="!uploadsReady ? `upload-hint-${call.id}` : undefined"
                  @click="emit('action', { kind: 'review' })"
                >Review documents</button>
              </div>
            </div>
          </div>
          <div class="process-files">
            <h3 class="process-files-heading">
              <button type="button" class="process-files-toggle" :aria-expanded="filesOpen" :aria-controls="`process-files-${call.id}`" @click="filesOpen = !filesOpen">
                <span>Your files <span class="process-files-count">({{ documents?.length ?? 0 }})</span></span>
                <img :src="chevronDownUrl" alt="" width="12" height="8" class="process-files-toggle__chevron" :class="{ 'process-files-toggle__chevron--open': filesOpen }" />
              </button>
            </h3>
            <div v-show="filesOpen" :id="`process-files-${call.id}`">
              <p v-if="!documents?.length" class="process-files-empty" role="status">{{ documents === null ? 'Loading files…' : 'No files uploaded yet.' }}</p>
              <ul v-else class="process-file-list">
                <li v-for="document in documents" :key="document.id" class="process-file">
                  <span class="process-file__type" :class="{ 'process-file__type--sheet': isSpreadsheet(document) }" aria-hidden="true">
                    <q-icon :name="isSpreadsheet(document) ? 'grid_on' : 'description'" size="18px" />
                    <span>{{ fileExtension(document) }}</span>
                  </span>
                  <div class="process-file__details">
                    <a class="process-file__name" :href="auth.callDocumentFileUrl(call.id, document.id)" :download="document.fileName" :aria-label="`Download ${document.fileName}`">{{ document.fileName }}</a>
                    <p>{{ fileSize(document.byteSize) }}</p>
                  </div>
                  <q-btn flat round dense icon="more_vert" class="process-file__menu" :aria-label="`Actions for ${document.fileName}`">
                    <q-menu anchor="bottom right" self="top right">
                      <q-list>
                        <q-item v-close-popup clickable @click="emit('action', { kind: 'document', id: document.id })"><q-item-section>Open document</q-item-section></q-item>
                        <q-item v-close-popup clickable tag="a" :href="auth.callDocumentFileUrl(call.id, document.id)" :download="document.fileName"><q-item-section>Download</q-item-section></q-item>
                        <q-item v-if="canRemoveDocument?.(document)" v-close-popup clickable @click="emit('remove', document)"><q-item-section>Remove</q-item-section></q-item>
                      </q-list>
                    </q-menu>
                  </q-btn>
                </li>
              </ul>
            </div>
          </div>
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
        <ul v-if="!section.upload && section.rows.length" class="process-rows">
          <li v-for="row in section.rows" :key="row.id" class="process-row" :class="{ 'process-row--file': row.action.kind === 'document', 'process-row--action': !isCompletedReportLocked(row) && !rowDisabled(row) && !(row.state === 'completed' && !moored) }">
            <span v-if="isCompletedReportLocked(row)" class="process-row__link process-row__label">{{ row.label }}</span>
            <button
              v-else
              type="button"
              class="process-row__link"
              :class="{ 'process-row__link--completed': row.state === 'completed' && !moored && row.action.kind !== 'edit' }"
              :disabled="rowDisabled(row)"
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
import { useAuth, type PortCall, type PortCallDocument } from '../auth/auth';
import { buildProcessSections, requiredUploadsPresent, uploadDocumentGroup, type ProcessAction, type ProcessRow } from '../lib/port-call-process';
import ProgressPill from './ProgressPill.vue';
import chevronDownUrl from '../assets/figma/chevron-down.svg';

const props = defineProps<{ call: PortCall; documents: PortCallDocument[] | null; canUpload: boolean; canReport: boolean; canEdit: boolean; canRemoveDocument?: (document: PortCallDocument) => boolean; etaLabel: string; etdLabel: string; routeLabel?: string }>();
const emit = defineEmits<{ action: [action: ProcessAction]; upload: [files: File[]]; remove: [document: PortCallDocument]; edit: []; cancel: [] }>();
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const auth = useAuth();
const filesOpen = ref(true);
const uploadsReady = computed(() => requiredUploadsPresent(props.documents ?? []));
const uploadSteps = computed(() => [
  { key: 'effects', title: 'IMO FAL 4 — Crew’s effects declaration', optional: false },
  { key: 'national', title: 'National Spreadsheet', optional: false },
  { key: 'other', title: 'Other documents', optional: true },
].map(step => ({ ...step, documents: (props.documents ?? []).filter(document => uploadDocumentGroup(document) === step.key) })));
function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function fileExtension(document: PortCallDocument): string { return document.fileName.split('.').pop()?.slice(0, 4).toUpperCase() ?? 'FILE'; }
function isSpreadsheet(document: PortCallDocument): boolean { return /\.(xlsx?|csv)$/i.test(document.fileName); }
const reviewed = ref<string[]>(readReviewed());
function readReviewed(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(`nemolink.process.${props.call.id}`) ?? '[]'); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; } catch { return []; }
}
const sections = computed(() => buildProcessSections(props.call, props.documents ?? [], reviewed.value));
const moored = computed(() => props.call.nemoStatus === 'Moored');
const cannotCancel = computed(() => props.call.status === 'departed' || props.call.obligations.some(o => o.code === 'ATA' && o.state === 'sent'));
function isCompletedReportLocked(row: ProcessRow): boolean {
  if (moored.value || row.id === 'VID' || row.state !== 'completed') return false;
  const code = row.action.kind === 'report' ? row.action.code : row.action.kind === 'noa' ? 'NOA' : null;
  return code !== null && props.call.obligations.some(o => o.code === code && o.state === 'sent' && !o.rejected);
}
function rowDisabled(row: ProcessRow): boolean {
  if (row.state === 'blocked' && !moored.value) return true;
  if (row.action.kind === 'edit') return !props.canEdit;
  return !props.canReport && row.action.kind !== 'document' && row.action.kind !== 'forms';
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
/* The headline, its PORT CALL label and everything after the route card start on the card's text edge (user 2026-11-12) */
.port-process { --process-inset: 12px; width: 100%; color: var(--text-300); padding-bottom: 80px; }
.process-head__top, .process-sections, .process-actions, .port-process :deep(.process-audit) { padding-inline-start: var(--process-inset); }
/* Quasar fades native disabled buttons; progress pills indicate availability here. */
.port-process button:disabled { opacity: 1 !important; }
.process-head { margin-bottom: 44px; }
/* Brand overview (design canvas "Port call overview · brand aligned", user 2026-11-12) */
.process-head__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
.process-head__titles { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.process-head__eyebrow { margin: 0; color: var(--text-100); font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: 0.48px; text-transform: uppercase; }
.process-head h1 { margin: 0; color: var(--text-300); font-size: 34px; font-weight: 600; line-height: 42px; letter-spacing: -0.3px; overflow-wrap: anywhere; }
.process-head__sep { color: var(--blue-700); font-weight: 500; }
.process-route { display: flex; flex-wrap: wrap; gap: 10px 40px; margin: 0; padding: 16px 12px; border-radius: 10px; background: var(--blue-200); }
.process-route__item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.process-route dt { color: var(--text-100); font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: 0.48px; text-transform: uppercase; }
.process-route dd { margin: 0; color: var(--text-300); font-size: 14px; font-weight: 500; line-height: 20px; letter-spacing: 0.14px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.process-route dd.process-route__unset { color: var(--text-100); }
.port-process :deep(.process-badges) { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 16px 0 0; padding: 0; padding-inline-start: var(--process-inset); list-style: none; }
.process-sections { padding-block: 0; padding-inline-end: 0; margin: 0; list-style: none; display: flex; flex-direction: column; gap: 44px; }
.process-section__title { margin: 0 0 14px; color: var(--text-300); font-size: 22px; font-weight: 600; line-height: 28px; letter-spacing: -0.1px; }
.process-rows { list-style: none; padding: 0; margin: 0; }
/* No strokes between the rows at any width (user 2026-11-12) */
.process-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 16px; align-items: center; min-height: 48px; padding: 10px 0; }
.process-row--file { grid-template-columns: minmax(0, 1fr); }
.process-row__link { min-width: 0; justify-self: start; padding: 0; border: 0; background: none; color: var(--text-200); text-align: left; font: inherit; font-size: 14px; font-weight: 500; line-height: normal; letter-spacing: 0.14px; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; overflow-wrap: anywhere; }
.process-row__link:disabled, .process-row__label { color: var(--text-300); cursor: default; text-decoration: none; }
.process-row__link--completed { text-decoration: none; }
.process-row__link:focus-visible, .process-secondary:focus-visible, .process-cancel:focus-visible, .process-files-toggle:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 4px; border-radius: 4px; }
.process-row__reason { grid-column: 1 / -1; margin: 8px 0 0; color: var(--text-300); font-size: 12px; line-height: 16px; }
.process-upload { border-radius: 8px; }
.process-upload--over { outline: 2px dashed var(--blue-800); outline-offset: 8px; }
.process-upload__intro { margin: 0 0 24px; color: var(--text-100); font-size: 14px; line-height: 20px; }
.process-upload-steps { display: flex; flex-direction: column; list-style: none; padding: 0; margin: 0 0 36px; }
.process-upload-step { position: relative; display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 14px; padding-bottom: 18px; }
.process-upload-step:last-child { min-height: 0; padding-bottom: 0; }
.process-upload-step__marker { position: relative; display: inline-flex; justify-content: center; align-items: center; box-sizing: border-box; width: 20px; height: 20px; margin-top: 1px; padding: 0; border: 1.5px dashed var(--blue-700); border-radius: 50%; background: var(--blue-100); color: var(--text-100); }
.process-upload-step--complete .process-upload-step__marker { border: 0; background: var(--blue-800); color: var(--blue-100); }
.process-upload-step__content { min-width: 0; }
.process-upload-step__marker :deep(.q-icon) { font-size: 14px !important; }
.process-upload-step h3 { margin: 0; font-size: 16px; font-weight: 600; line-height: 22px; letter-spacing: .16px; }
.process-upload-step p { margin: 4px 0 0; color: var(--text-100); font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.process-upload-actions > p { margin: 0 0 10px; color: var(--text-100); font-size: 14px; line-height: 20px; }
.process-upload-actions__buttons { display: flex; flex-wrap: wrap; gap: 10px; }
.process-secondary, .process-primary { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 48px; padding: 0 20px; border: 1.5px solid var(--blue-700); border-radius: 8px; background: var(--blue-100); color: var(--text-300); font: inherit; font-size: 14px; font-weight: 600; line-height: 20px; cursor: pointer; }
.process-secondary:disabled { color: var(--text-100); cursor: default; }
.process-primary { border-color: var(--blue-800); background: var(--blue-800); color: var(--blue-100); }
.process-primary:disabled { border-color: transparent; background: color-mix(in srgb, var(--blue-800) 45%, var(--blue-100)); cursor: default; }
.process-review { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.process-files { margin-top: 32px; }
.process-files-heading { margin: 0; }
.process-files-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 0 6px 0 0; border: 0; background: none; color: var(--text-300); font: inherit; font-size: 18px; font-weight: 600; line-height: 24px; text-align: left; cursor: pointer; }
.process-files-count { margin-left: 6px; color: var(--text-100); font-weight: 500; }
.process-files-toggle__chevron { flex: none; }
.process-files-toggle__chevron--open { transform: rotate(180deg); }
.process-file-list { list-style: none; padding: 0; margin: 4px 0 0; border-top: 1px solid var(--blue-500); }
.process-file { display: flex; align-items: flex-start; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--blue-500); }
.process-file__type { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: none; gap: 2px; width: 40px; height: 40px; border-radius: 8px; background: var(--blue-150); color: var(--blue-800); }
.process-file__type--sheet { background: var(--green-100); color: var(--green-400); }
.process-file__type > span { font-size: 10px; font-weight: 600; line-height: 12px; }
.process-file__details { flex: 1; min-width: 0; }
.process-file__name { display: block; width: fit-content; max-width: 100%; text-decoration: none; padding: 0; border: 0; background: none; color: var(--text-300); font: inherit; font-size: 14px; font-weight: 500; line-height: 20px; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.process-file__details p, .process-files-empty { margin: 4px 0 0; color: var(--text-100); font-size: 14px; line-height: 20px; }
.process-files-empty { padding: 14px 0; border-block: 1px solid var(--blue-500); }
.port-process :deep(.process-applicable) { margin-top: 32px; }
/* As applicable: the 12px caps label, as ROUTE / ETA / ETD (user 2026-11-12) */
.port-process :deep(.process-applicable .pc-sec__title) { color: var(--text-100); font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: 0.48px; text-transform: uppercase; }
.process-file__menu { flex: none; width: 28px; min-width: 28px; min-height: 40px; margin-top: -8px; margin-right: -4px; color: var(--text-200); }
.process-primary:focus-visible, .process-file__name:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 4px; }
@media (hover: hover) {
  .process-secondary:not(:disabled):hover { background: var(--blue-300); }
  .process-file__name:hover { text-decoration: underline; text-underline-offset: 3px; }
}
.file-input { display: none; }
.process-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px; margin-top: 48px; }
.process-cancel { min-height: 44px; padding: 0 16px; border: 1px solid var(--blue-700); border-radius: 8px; background: var(--blue-100); color: var(--text-300); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.process-cancel:disabled { color: var(--text-300); cursor: default; }
/* Desktop: one 676px column; rows without dividers, a tinted row on hover (nothing completed hovers, unless moored) */
@media (min-width: 1024px) {
  .port-process { max-width: 676px; }
  .process-rows { display: flex; flex-direction: column; gap: 2px; padding-top: 6px; }
  .process-row { position: relative; grid-template-columns: minmax(0, 1fr) auto; gap: 0 12px; min-height: 56px; margin: 0 -14px; padding: 8px 14px; border-bottom: 0; border-radius: 8px; }
  .process-row__reason { margin-top: 2px; color: var(--text-100); }
  /* The whole row opens the report */
  .process-row--action .process-row__link::after { content: ''; position: absolute; inset: 0; border-radius: 8px; }
}
@media (min-width: 1024px) and (hover: hover) {
  .process-row--action:hover { background: var(--blue-300); }
  .process-row--action:hover .process-row__link { color: var(--blue-800); }
}
@media (hover: hover) {
  /* Underlined links turn SemiBold on hover (user 2026-11-12) */
  .process-row--action .process-row__link:not(:disabled):not(.process-row__link--completed):hover { font-weight: 600; }
}
@media (prefers-reduced-motion: no-preference) {
  .process-row, .process-row__link { transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease, transform 0.16s ease, opacity 0.16s ease; }
}
@media (max-width: 1023px) {
  .process-row { min-height: var(--nl-row-mobile-min-height); padding: 0; }
  .process-row__link { display: flex; align-items: center; align-self: stretch; }
}
@media (max-width: 599.98px) {
  .process-upload-actions__buttons { flex-wrap: nowrap; }
  .process-upload-actions__buttons > button { flex: 1; min-width: 0; padding-inline: 10px; }
  .process-head { margin-bottom: 40px; }
  .process-head h1 { font-size: 22px; line-height: 28px; letter-spacing: -0.1px; }
  .port-process { --process-inset: 16px; }
  .process-route { flex-direction: column; gap: 14px; padding: 14px 16px; }
  .process-head__top { margin-bottom: 14px; }
  .process-route dd { font-size: 14px; line-height: 20px; letter-spacing: 0.14px; }
  .process-section__title { font-size: 16px; letter-spacing: 0.16px; }
  .process-section--upload > .process-section__title { font-size: 22px; letter-spacing: .22px; }
  .process-sections { gap: 48px; }
  .process-row { column-gap: 10px; }
}
</style>
