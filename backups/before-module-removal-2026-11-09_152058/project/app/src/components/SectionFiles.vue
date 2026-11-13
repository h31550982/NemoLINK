<template>
  <!-- One Ship forms section's files (Figma 420:12165, user 2026-11-03): the
       section's status message heads a list that opens and closes. Files drop
       anywhere on it or come from Upload; each one downloads or is removed, no
       preview; the whole section downloads as one zip from the list's foot.
       Every piece of the head has a fixed size, so it never moves on open/close. -->
  <div
    class="sf"
    :class="[`sf--${tone}`, { 'sf--open': open, 'sf--over': dragDepth > 0 }]"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="sf-head">
      <img v-if="tone === 'ok'" :src="checkUrl" alt="" width="22" height="22" class="sf-head__icon" />
      <q-icon v-else :name="tone === 'error' ? 'error' : 'info'" size="22px" class="sf-head__icon" />
      <div class="sf-head__words"><slot /></div>
      <div class="sf-head__tools">
        <span class="sf-head__drop">{{ uploading ? 'Uploading…' : 'Drop files here or' }}</span>
        <span class="sf-head__act">
          <q-spinner v-if="uploading" size="20px" color="primary" />
          <button v-else type="button" class="sf-upload" @click="input?.click()">
            <img :src="uploadUrl" alt="" width="20" height="20" />
            <span>Upload</span>
          </button>
        </span>
        <button
          type="button"
          class="sf-toggle"
          :aria-expanded="open"
          :aria-label="open ? 'Hide files' : `Show files (${docs.length})`"
          @click="open = !open"
        >
          <img :src="chevronUrl" alt="" width="26" height="26" class="sf-toggle__chevron" />
          <q-tooltip>{{ open ? 'Hide files' : `Show files (${docs.length})` }}</q-tooltip>
        </button>
      </div>
      <input
        ref="input"
        type="file"
        multiple
        accept=".pdf,.xls,.xlsx,.xml,.jpg,.jpeg,.png,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/xml,text/xml,image/jpeg,image/png"
        class="sf-hidden"
        @change="onPicked"
      />
    </div>

    <template v-if="open">
      <div class="sf-body">
        <div v-if="docs.length === 0" class="sf-empty">No files in this section yet.</div>
        <div v-for="d in docs" :key="d.id" class="sf-file">
          <div class="sf-file__name">{{ d.fileName }}</div>
          <a class="sf-link sf-file__download" :href="auth.callDocumentFileUrl(callId, d.id)" target="_blank">Download</a>
          <span class="sf-file__gap" />
          <button
            v-if="canRemove(d)"
            type="button"
            class="sf-link sf-file__remove"
            :aria-label="`Remove ${d.fileName}`"
            @click="emit('remove', d)"
          >Remove</button>
          <span v-else class="sf-file__remove" />
        </div>
      </div>
      <!-- Every file of the section in one zip -->
      <div v-if="docs.length > 0" class="sf-all">
        <a
          class="sf-all__link"
          :href="auth.callDocumentsOriginalZipUrl(callId, docs.map((d) => d.id))"
          target="_blank"
        >
          <img :src="downloadUrl" alt="" width="20" height="20" /><span>Download all files</span>
        </a>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAuth, type PortCallDocument } from '../auth/auth';
import checkUrl from '../assets/figma/check-circle-filled.svg';
import uploadUrl from '../assets/figma/upload-white.svg';
import chevronUrl from '../assets/figma/expand-less-26.svg';
import downloadUrl from '../assets/figma/download-blue.svg';

defineProps<{
  callId: string;
  /** The files on this section: the forms that feed its table and the files dropped on it. */
  docs: PortCallDocument[];
  uploading: boolean;
  /** The section's status, shown in the head: all there, something to fill in, or a fix needed. */
  tone: 'ok' | 'check' | 'error';
}>();
const emit = defineEmits<{ upload: [files: File[]]; remove: [doc: PortCallDocument] }>();

const auth = useAuth();
const input = ref<HTMLInputElement | null>(null);
const open = ref(false);
const dragDepth = ref(0);

function onDragEnter(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes('Files')) return;
  dragDepth.value++;
}
function onDragLeave(): void {
  if (dragDepth.value > 0) dragDepth.value--;
}
function onDrop(event: DragEvent): void {
  dragDepth.value = 0;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length > 0) emit('upload', files);
}
function onPicked(event: Event): void {
  const el = event.target as HTMLInputElement;
  const files = Array.from(el.files ?? []);
  el.value = '';
  if (files.length > 0) emit('upload', files);
}

/** Operators remove any file; others only what they uploaded (as on the call card). */
function canRemove(d: PortCallDocument): boolean {
  return auth.isOperator.value || d.uploadedBy === auth.user.value?.username;
}
</script>


<style scoped>
/* One card (Figma 420:12165): the status head, then the files when open */
.sf {
  margin-bottom: 26px;
  border: 1px solid var(--nl-g-line-white);
  border-radius: 10px;
  overflow: hidden;
  background: var(--nl-g-white);
  transition: border-color 0.15s;
}
.sf--over {
  border-color: var(--nl-g-blue);
}
/* Head: 12 / 32 / 12 / 24, everything in it a fixed size so open/close never moves it */
.sf-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 32px 12px 24px;
  background: var(--nl-g-head-surface);
  font-size: 14px;
  line-height: normal;
  letter-spacing: 0.14px;
  color: var(--nl-g-ink);
}
.sf--check .sf-head {
  background: var(--orange-100);
  color: var(--orange-500);
}
.sf--error .sf-head {
  background: var(--red-100);
  color: var(--red-300);
}
.sf--error .sf-head__icon {
  color: var(--red-200);
}
.sf-head__icon {
  flex: none;
  width: 22px;
  height: 22px;
}
.sf-head__words {
  flex: 1 1 0;
  min-width: 0;
  font-weight: 600;
}
.sf-head__tools {
  flex: none;
  display: flex;
  align-items: center;
}
.sf-head__drop {
  margin-right: 11px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--nl-g-ink);
}
/* Upload: a 93px slot, 114px from the chevron */
.sf-head__act {
  display: flex;
  align-items: center;
  width: 93px;
  height: 36px;
  margin-right: 114px;
}
.sf-upload {
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
  cursor: pointer;
}
.sf-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
/* The design's chevron points up (open); turned over when closed */
.sf-toggle__chevron {
  width: 26px;
  height: 26px;
}
.sf:not(.sf--open) .sf-toggle__chevron {
  transform: rotate(180deg);
}
.sf-hidden {
  display: none;
}

/* The files: name, then Download (128) and Remove (140), both right-aligned */
.sf-body {
  background: var(--nl-g-white);
}
.sf-empty {
  padding: 16px 24px;
  font-size: 14px;
  color: var(--nl-g-secondary);
}
.sf-file {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 72px;
  padding: 12px 24px;
  font-size: 14px;
  line-height: normal;
  letter-spacing: 0.14px;
  font-weight: 600;
  color: var(--nl-g-ink);
}
/* Not a guideline colour: #E9ECEB as drawn in Figma 420:12182 */
.sf-file + .sf-file {
  border-top: 1px solid #e9eceb;
}
.sf-file__name {
  flex: 1 1 0;
  min-width: 0;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sf-file__download {
  flex: none;
  width: 128px;
}
.sf-file__gap {
  flex: none;
  width: 1px;
}
.sf-file__remove {
  flex: none;
  width: 140px;
}
.sf-link {
  display: block;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  letter-spacing: inherit;
  text-align: right;
  color: var(--nl-g-ink);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
/* Download all, at the foot of the open list. Not a guideline colour:
   #D5DDDA as drawn in Figma 420:12183 */
.sf-all {
  display: flex;
  align-items: center;
  height: 53px;
  padding: 16px 24px;
  border-top: 1px solid #d5ddda;
}
.sf-all__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  line-height: normal;
  letter-spacing: 0.14px;
  font-weight: 600;
  color: var(--nl-g-blue);
  text-decoration: none;
}
.sf-all__link span {
  text-decoration: underline;
  text-underline-offset: 3px;
}
@media (max-width: 760px) {
  .sf-head {
    flex-wrap: wrap;
  }
  .sf-head__tools {
    margin-left: auto;
  }
  .sf-head__act {
    margin-right: 16px;
  }
  .sf-file__download,
  .sf-file__remove {
    width: auto;
  }
}
</style>
