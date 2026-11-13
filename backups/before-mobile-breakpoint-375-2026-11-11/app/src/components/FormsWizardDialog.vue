<template>
  <!-- Ship forms (Figma "Ship forms card" 341:5783): white throughout, the
       steps in a band under the title, Close top right, Back and Next below -->
  <component :is="page ? ModulePage : HouseDialog"
    :model-value="modelValue"
    :context="page ? `${call.shipName ?? 'Ship'} · ${call.portName ?? call.portLocode ?? 'Port not set'}` : undefined"
    :title="uploadOnly ? 'Upload files' : 'Review ship forms'"
    :sheet-title="sheetTitle"
    :step-label="uploadOnly ? '1 of 1' : stepLabel"
    title-style="detail"
    help-topic="call.documents"
    help-beside-title
    :max-width-px="1240"
    full-height
    :main-label="mainLabel"
    :main-icon-right="step === 'done' ? undefined : 'arrow_forward'"
    :main-disable="mainDisable"
    @main="onMain"
    @update:model-value="onClose"
  >
    <!-- The steps (spec 0093 §4): the files, one step per form, the downloads.
         In the band under the title, above its line (Figma 341:5783, user 2026-11-02) -->
    <template v-if="page" #tools><q-toggle v-if="currentTable" v-model="allDetails" dense size="sm" label="All details" left-label class="wz-details" /></template>
    <template v-if="$q.screen.gt.sm && currentTable" #attachments>
      <ReportAttachments
        :call-id="call.id"
        :docs="sectionDocs"
        :uploading="sectionUploading"
        :context="currentTable.label"
        :page="!!page"
        @upload="uploadToSection"
        @remove="askRemove"
      />
    </template>
    <template v-if="!page && !uploadOnly" #band>
      <div class="wz-head">
        <ol class="wz-steps" aria-label="Steps">
          <li
            v-for="s in steps"
            :key="s.key"
            class="wz-step"
            :class="`wz-step--${s.state}`"
            :aria-current="s.state === 'current' ? 'step' : undefined"
          >
            <q-icon v-if="s.n > 1" name="chevron_right" size="16px" class="wz-step__sep" />
            <span class="wz-step__pill">
              <!-- Passed steps look like the ones ahead: no inactive look (user 2026-11-02) -->
              <span class="wz-step__n">{{ s.n }}</span>
              <span>{{ s.label }}</span>
            </span>
          </li>
        </ol>
        <q-toggle
          v-if="currentTable"
          v-model="allDetails"
          dense
          size="sm"
          label="All details"
          left-label
          class="wz-details"
        />
      </div>
    </template>

    <template #secondary>
      <!-- No Back on the first step: Close at the top right is the way out -->
      <q-btn v-if="step !== 'files'" outline no-caps color="primary" label="Back" class="fw-back" @click="onBack" />
      <!-- An empty slot would bring the footer's own Close back -->
      <span v-else aria-hidden="true" />
    </template>

    <!-- 1 · the files: what each one is, or why it was not taken -->
    <div v-if="step === 'files'" class="fw-section">
      <!-- Opened from Add missing data for a form the call does not have
           yet: the banner first, above the files and Upload (user 2026-11-07) -->
      <div v-if="missingForm" class="wz-banner wz-banner--check fw-missing">
        <q-icon name="info" size="22px" />
        <span>There is no {{ missingForm }} on this call yet. Upload the ship's form and it opens here.</span>
      </div>
      <div class="fw-form-head fw-form-head--files">
        <div class="fw-form-name">Files</div>
        <!-- Upload on every width (user 2026-11-06): the missing form added here -->
        <UploadButton :uploading="uploading" @upload="uploadMore" />
      </div>
      <div v-for="(e, i) in entries" :key="i" class="fw-file">
        <q-icon :name="FILE_ICONS[e.status]" :class="`fw-file__icon fw-file__icon--${e.status}`" size="20px" />
        <div class="col fw-file__content">
          <a
            v-if="e.doc"
            class="fw-file__name ellipsis"
            :href="auth.callDocumentFileUrl(call.id, e.doc.id)"
            :download="e.name"
            :title="e.name"
          >{{ e.name }}</a>
          <div v-else class="fw-file__name ellipsis" :title="e.name">{{ e.name }}</div>
          <div class="text-caption text-grey-7">
            <template v-if="e.status === 'waiting'">Waiting…</template>
            <template v-else-if="e.status === 'uploading'">Reading…</template>
            <template v-else-if="e.status === 'refused'">{{ e.message }}</template>
            <template v-else-if="e.doc">
              {{ docWords(e.doc) }}<template v-if="e.status === 'duplicate'"> · already on this call</template>
            </template>
          </div>
          <!-- D4 (spec 0093): a form that names no IMO counts once confirmed -->
          <div v-if="e.doc?.shipConfirmNeeded" class="fw-ask">
            <div>
              This form names no IMO — is it
              <b>{{ shipWords }}</b>’s?
            </div>
            <div class="row q-gutter-sm q-mt-xs">
              <q-btn
                unelevated
                no-caps
                dense
                color="primary"
                label="Yes, it is"
                class="q-px-sm"
                :loading="e.busy"
                @click="confirmShip(e)"
              />
              <q-btn
                flat
                no-caps
                dense
                color="negative"
                label="Remove it"
                class="q-px-sm"
                :disable="e.busy"
                @click="e.doc && askRemove(e.doc)"
              />
            </div>
          </div>
        </div>
        <StatusPill
          v-if="e.doc && problems(e.doc) > 0"
          tone="amber"
          icon="rule"
          :label="`${problems(e.doc)} to check`"
        />
      </div>
      <div v-if="!uploading && entries.length > 0 && reviewable.length === 0" class="wz-banner wz-banner--check q-mt-md">
        <q-icon name="info" size="22px" />
        <span>
          None of these could be read as a ship form. PDFs and other files are kept
          on the call as they are.
        </span>
      </div>
      <slot v-if="uploadOnly" name="applicable" />
    </div>

    <!-- 2 · one NEMO table per step (spec 0096): every column NEMO asks for -->
    <template v-else-if="currentTable">
      <div class="fw-form-head">
        <div class="fw-form-name">{{ currentTable.label }}</div>
        <div class="fw-form-from">
          From {{ currentTable.sources.map((s) => s.formName).join(', ') }}<template v-if="currentTable.key !== 'cargo'"> · the National Spreadsheet’s
          “{{ currentTable.sheet }}”</template>
        </div>
      </div>
      <!-- Desktop file actions live in the right-hand drawer; the report
           always keeps a passive status banner, with either detail setting. -->
      <ReportReadyBanner v-if="$q.screen.gt.sm" :tone="sectionTone">{{ sectionWords }}</ReportReadyBanner>
      <SectionFiles
        v-else-if="allDetails"
        :call-id="call.id"
        :docs="sectionDocs"
        :uploading="sectionUploading"
        :tone="sectionTone"
        @upload="uploadToSection"
        @remove="askRemove"
      >
        {{ sectionWords }}
      </SectionFiles>
      <!-- All details off: the card's head on its own, no outline (user 2026-11-03) -->
      <div v-else class="wz-banner fw-status" :class="`wz-banner--${sectionTone}`">
        <img v-if="sectionTone === 'ok'" :src="checkUrl" alt="" width="22" height="22" class="fw-status__icon" />
        <q-icon v-else :name="sectionTone === 'error' ? 'error' : 'info'" size="22px" />
        <span class="fw-status__words">{{ sectionWords }}</span>
        <!-- Upload with All details off too, on every width (user 2026-11-06) -->
        <UploadButton :uploading="sectionUploading" @upload="uploadToSection" />
      </div>
      <NemoTable
        :table="currentTable"
        :all-details="allDetails"
        tabs-to="#fw-coltabs-card"
        :anchor="colAnchors[currentTable.key] ?? null"
        @update:anchor="setAnchor"
        @pick="onPick"
      >
        <!-- Desktop keeps column tabs; mobile browses individual categories. -->
        <template #head>
          <div class="fw-details-head">
            <div v-if="allDetails" class="fw-heading">{{ detailsTitle }}</div>
            <div id="fw-coltabs-card" class="fw-coltabs" />
            <q-btn
              v-if="allDetails && $q.screen.gt.sm"
              :outline="$q.screen.lt.md"
              :flat="$q.screen.gt.sm"
              :color="$q.screen.lt.md ? 'primary' : undefined"
              icon="crop_free"
              aria-label="Full screen"
              class="fw-full-btn"
              @click="fullOpen = true"
            >
              <q-tooltip>Full screen</q-tooltip>
            </q-btn>
          </div>
        </template>
      </NemoTable>
    </template>
    <div v-else-if="step !== 'files' && step !== 'done'" class="row justify-center q-pa-lg">
      <q-spinner color="primary" size="28px" />
    </div>

    <!-- 3 · done: the forms feed the call; each back in NEMO codes -->
    <div v-else-if="step === 'done'" class="fw-section">
      <div class="wz-banner wz-banner--ok">
        <q-icon name="check_circle" size="22px" />
        <span>
          {{ reviewable.length === 1 ? 'The form is' : `${reviewable.length} forms are` }} saved on this call<template
            v-if="waitingConfirm > 0"
          > — {{ waitingConfirm }} still waiting for the ship to be confirmed</template>
        </span>
      </div>
      <div class="fw-form-name q-mt-lg q-mb-sm">Download in NEMO codes and units</div>
      <div v-for="r in reviewable" :key="r.doc!.id" class="fw-file">
        <q-icon name="task" size="20px" class="fw-file__icon fw-file__icon--done" />
        <div class="col fw-file__content">
          <div class="fw-file__name ellipsis">{{ r.doc!.fileName }}</div>
          <div class="text-caption text-grey-7">{{ r.doc!.summary?.formName ?? '' }}</div>
        </div>
        <q-btn
          flat
          dense
          no-caps
          color="primary"
          icon="download"
          label="NEMO file"
          type="a"
          :href="auth.callDocumentCorrectedUrl(call.id, r.doc!.id)"
          target="_blank"
        />
      </div>
      <div v-if="nationalTables.length" class="fw-form-name q-mt-lg q-mb-sm">NEMO’s own workbook</div>
      <div v-if="nationalTables.length" class="fw-file">
        <q-icon name="grid_on" size="20px" class="fw-file__icon fw-file__icon--done" />
        <div class="col fw-file__content">
          <div class="fw-file__name">National Spreadsheet, prefilled</div>
          <div class="text-caption text-grey-7">
            The {{ nationalTables.map(t => t.label).join(', ') }} tables in NEMO’s own Excel.
            <template v-if="tables?.some(t => t.key === 'cargo')">Cargo is available in its individual file above.</template>
          </div>
        </div>
        <q-btn
          flat
          dense
          no-caps
          color="primary"
          icon="download"
          label="Download"
          type="a"
          :href="auth.nationalSpreadsheetUrl(call.id)"
          target="_blank"
        />
      </div>
      <q-btn
        v-if="reviewable.length > 1"
        outline
        no-caps
        color="primary"
        icon="folder_zip"
        label="Download all as one zip"
        class="q-mt-md"
        type="a"
        :href="auth.callDocumentsCorrectedZipUrl(call.id, reviewable.map((r) => r.doc!.id))"
        target="_blank"
      />
    </div>
  </component>

  <CorrectionDialog
    v-model="correctionOpen"
    :call-id="call.id"
    :doc-id="correctionDocId"
    :info="correctionTarget"
    :can-upload="true"
    @saved="onCorrected"
  />
  <TableEntryDialog class="nl-v1" v-model="entryOpen" :call-id="call.id" :target="entryTarget" @saved="onEntered" />

  <!-- The section's table full screen (user 2026-11-02): the same table, the
       whole window; no heading or line over it, only the column tabs and the
       way back, where the line was -->
  <q-dialog v-model="fullOpen" maximized transition-show="fade" transition-hide="fade">
    <q-card v-if="currentTable" class="fw-full" role="region" :aria-label="detailsTitle">
      <div class="fw-full__head">
        <div id="fw-coltabs-full" class="fw-coltabs" />
        <q-btn
          :outline="$q.screen.lt.md"
          :flat="$q.screen.gt.sm"
          :color="$q.screen.lt.md ? 'primary' : undefined"
          icon="fullscreen_exit"
          aria-label="Exit full screen"
          class="fw-full-btn"
          v-close-popup
        >
          <q-tooltip>Exit full screen</q-tooltip>
        </q-btn>
      </div>
      <div class="fw-full__body">
        <NemoTable
          :table="currentTable"
          :all-details="allDetails"
          tabs-to="#fw-coltabs-full"
          :anchor="colAnchors[currentTable.key] ?? null"
          @update:anchor="setAnchor"
          @pick="onPick"
        />
      </div>
    </q-card>
  </q-dialog>

  <RemovalDialog
    v-model="removeOpen"
    title="Are you sure you want to remove this file?"
    :loading="removing"
    @confirm="doRemove"
  >
    <p v-if="removeTarget">
      “{{ removeTarget.fileName }}” will be permanently removed from this call<template v-if="removeFeedsTable">
        and its values will leave the {{ currentTable?.label }} table</template>. The upload stays in the audit log.
    </p>
  </RemovalDialog>
</template>

<script setup lang="ts">
import { useAutoDetails } from '../composables/useAutoDetails';
/**
 * The forms wizard (spec 0093 §4): drop the ship's forms on a port call and
 * walk them — the files (what each is, the ship gate, D4's "is it our
 * ship's?"), one step per form showing only what needs a person, then the
 * files back in NEMO codes and units, one by one or as a zip. The forms are
 * saved on the call as they upload; the wizard is where they are made right.
 */
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import {
  useAuth,
  type NemoCell,
  type NemoColumn,
  type NemoTable as NemoTableData,
  type PortCall,
  type PortCallDocument,
} from '../auth/auth';
import CorrectionDialog, { type CorrectionTarget } from './CorrectionDialog.vue';
import HouseDialog from './HouseDialog.vue';
import RemovalDialog from './RemovalDialog.vue';
import ModulePage from './ModulePage.vue';
import NemoTable from './NemoTable.vue';
import SectionFiles from './SectionFiles.vue';
import ReportAttachments from './ReportAttachments.vue';
import ReportReadyBanner from './ReportReadyBanner.vue';
import checkUrl from '../assets/figma/check-circle-filled.svg';
import StatusPill from './StatusPill.vue';
import TableEntryDialog, { type EntryTarget } from './TableEntryDialog.vue';
import UploadButton from './UploadButton.vue';

const props = defineProps<{
  /** The upload phase precedes the separate document review page. */
  uploadOnly?: boolean;
  modelValue: boolean; page?: boolean;
  call: PortCall;
  /** New files to upload — or none, to walk the forms already on the call. */
  files: File[];
  /** Resume (a closed wizard, a browser that died): the call's saved forms. */
  docs?: PortCallDocument[];
  /** Open straight at this table (a report pill in Send to NEMO, user
      2026-11-05); without that table the wizard stays on the files. */
  startAt?: string | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: []; review: [] }>();

const auth = useAuth();
const $q = useQuasar();

type EntryStatus = 'waiting' | 'uploading' | 'done' | 'duplicate' | 'refused' | 'stored';

interface Entry {
  /** The file's name: dropped now, or as saved on the call. */
  name: string;
  file?: File;
  status: EntryStatus;
  doc?: PortCallDocument;
  message?: string;
  busy?: boolean;
}

const FILE_ICONS: Record<EntryStatus, string> = {
  waiting: 'schedule',
  uploading: 'hourglass_top',
  done: 'description',
  duplicate: 'description',
  refused: 'block',
  stored: 'attach_file',
};

/** The download list's order: crew first, then what they carry, then the ship's matters. */
const FORM_ORDER = ['nsw-crew', 'fal5', 'fal4', 'fal3', 'nsw-waste', 'nsw-security', 'nmsw-mdh', 'fal1', 'nsw-pax', 'fal6', 'fal2', 'fal7'];

const entries = ref<Entry[]>([]);
/** Seed the drawer immediately; the opening table load refreshes this list. */
const callDocs = ref<PortCallDocument[]>(props.docs ?? []);
/** The table Add missing data opened the wizard for, while the call lacks it. */
const missingKey = ref<string | undefined>(undefined);
const MISSING_WORDS: Record<string, string> = {
  crew: 'crew list',
  passengers: 'passenger list',
  cargo: 'cargo declaration',
  stores: 'stores list',
  waste: 'waste form',
  security: 'security form',
  health: 'health declaration',
};
/** Said on the files step once the tables show the call lacks that form. */
const missingForm = computed(() => {
  const key = missingKey.value;
  if (!key || tables.value === null || tables.value.some((t) => t.key === key)) return null;
  return MISSING_WORDS[key] ?? 'form';
});
const uploading = ref(false);
const changed = ref(false);
const step = ref<string>('files');
/** The table to open at once the tables load (props.startAt). */
let pendingStart: string | undefined;
const allDetails = ref(false);
/** The call's forms in NEMO's tables (spec 0096) — loaded after the files step. */
const tables = ref<NemoTableData[] | null>(null);
const nationalTables = computed(() => (tables.value ?? []).filter(t => t.key !== 'cargo'));
/** Loads may overlap (upload end, confirm, Next): only the latest one counts.
 *  Declared before the opening watch, which loads at once on resume. */
let tablesLoad = 0;

const shipWords = computed(() =>
  [props.call.shipName ?? 'this ship', props.call.imoNumber ? `(${props.call.imoNumber})` : null]
    .filter(Boolean)
    .join(' '),
);

// ---- the files --------------------------------------------------------------

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    step.value = 'files';
    tables.value = null;
    changed.value = false;
    pendingStart = props.startAt;
    missingKey.value = props.startAt;
    if (props.files.length === 0) {
      // Resume: everything is saved already — pick up where it was left
      entries.value = (props.docs ?? []).map((doc) => ({
        name: doc.fileName,
        doc,
        status: doc.parseStatus === 'parsed' ? 'done' : 'stored',
      }));
      // The step bar names every table from the start, not only after Next
      void loadTables();
      return;
    }
    entries.value = props.files.map((file) => ({ name: file.name, file, status: 'waiting' }));
    void uploadAll();
  },
  { immediate: true },
);

async function uploadAll(): Promise<void> {
  uploading.value = true;
  for (const e of entries.value) {
    if (!e.file) continue;
    e.status = 'uploading';
    try {
      const doc = await auth.uploadCallDocument(props.call.id, e.file);
      e.doc = doc;
      e.status = doc.duplicate ? 'duplicate' : doc.parseStatus === 'parsed' ? 'done' : 'stored';
      if (!doc.duplicate) changed.value = true;
    } catch (err) {
      e.status = 'refused';
      e.message = err instanceof Error ? err.message : 'The file could not be uploaded.';
    }
  }
  uploading.value = false;
  void loadTables();
}

/** Files added on the files step: uploaded as the dropped ones were, filed
 *  under the table the wizard was opened for when there is one. */
async function uploadMore(files: File[]): Promise<void> {
  if (uploading.value || sectionUploading.value) return;
  uploading.value = true;
  const section = missingKey.value as NemoTableData['key'] | undefined;
  for (const file of files) {
    const e: Entry = { name: file.name, file, status: 'uploading' };
    entries.value.push(e);
    const entry = entries.value[entries.value.length - 1]!;
    try {
      const doc = await auth.uploadCallDocument(props.call.id, file, section);
      entry.doc = doc;
      entry.status = doc.duplicate ? 'duplicate' : doc.parseStatus === 'parsed' ? 'done' : 'stored';
      if (!doc.duplicate) changed.value = true;
    } catch (err) {
      entry.status = 'refused';
      entry.message = err instanceof Error ? err.message : 'The file could not be uploaded.';
    }
  }
  uploading.value = false;
  void loadTables();
}

function docWords(d: PortCallDocument): string {
  if (d.parseStatus !== 'parsed') return d.parseNote ?? 'Kept on the call, not read.';
  const s = d.summary;
  const parts = [s?.formName ?? 'Form'];
  if (s?.rowsLabel !== undefined) parts.push(`${s.rowCount ?? 0} ${s.rowsLabel}`);
  return parts.join(' · ');
}

function problems(d: PortCallDocument): number {
  return (d.summary?.errorCount ?? 0) + (d.summary?.warningCount ?? 0);
}

async function confirmShip(e: Entry): Promise<void> {
  if (!e.doc) return;
  e.busy = true;
  try {
    e.doc = await auth.confirmCallDocumentShip(props.call.id, e.doc.id);
    changed.value = true;
    void loadTables();
  } catch (err) {
    $q.notify({ type: 'negative', message: err instanceof Error ? err.message : 'Could not confirm the ship.' });
  } finally {
    e.busy = false;
  }
}

/** The forms to walk: read ones, in the order a person checks them. */
const reviewable = computed(() =>
  entries.value
    .filter((e) => e.doc && e.doc.parseStatus === 'parsed')
    .sort((a, b) => rank(a.doc!.formType) - rank(b.doc!.formType)),
);
const rank = (t: string | null) => {
  const i = FORM_ORDER.indexOf(t ?? '');
  return i === -1 ? FORM_ORDER.length : i;
};
const waitingConfirm = computed(() => entries.value.filter((e) => e.doc?.shipConfirmNeeded).length);

// ---- the steps --------------------------------------------------------------

const steps = computed(() => {
  const keys = [
    { key: 'files', label: 'Files' },
    ...(tables.value ?? []).map((t) => ({ key: t.key, label: t.label })),
    { key: 'done', label: 'Download' },
  ];
  const at = keys.findIndex((k) => k.key === step.value);
  return keys.map((k, i) => ({
    ...k,
    n: i + 1,
    state: i < at ? 'done' : i === at ? 'current' : 'todo',
  }));
});

const currentTable = computed(() => (tables.value ?? []).find((t) => t.key === step.value) ?? null);
useAutoDetails(allDetails, () => {
  const table = currentTable.value;
  if (!table) return null;
  return Object.values(table.counts).some(count => count > 0);
});

/** The phone has no band: the step names the title, its number the action bar. */
const currentStep = computed(() => steps.value.find((s) => s.state === 'current') ?? null);
const sheetTitle = computed(() => currentStep.value?.label);
const stepLabel = computed(() =>
  currentStep.value ? `${currentStep.value.n} of ${steps.value.length}` : undefined,
);

// ---- a section's own files (user 2026-11-02) --------------------------------

/** Every document on the call — a section lists the ones that are its own. */
async function loadDocs(): Promise<void> {
  try {
    callDocs.value = await auth.listCallDocuments(props.call.id);
  } catch {
    /* the list stays as it was; the table still loads */
  }
}

/** The forms that feed this section's table, then the files dropped on it
 *  that no other table reads (a PDF, an unread file). */
const sectionDocs = computed(() => {
  const t = currentTable.value;
  if (!t) return [];
  const feeding = new Set(t.sources.map((x) => x.docId));
  const elsewhere = new Set(
    (tables.value ?? []).filter((x) => x.key !== t.key).flatMap((x) => x.sources.map((y) => y.docId)),
  );
  return callDocs.value.filter((d) => feeding.has(d.id) || (d.section === t.key && !elsewhere.has(d.id)));
});

const sectionUploading = ref(false);
async function uploadToSection(files: File[]): Promise<void> {
  const t = currentTable.value;
  if (!t || sectionUploading.value || uploading.value) return;
  sectionUploading.value = true;
  for (const file of files) {
    try {
      const doc = await auth.uploadCallDocument(props.call.id, file, t.key);
      if (doc.duplicate) {
        $q.notify({ type: 'info', message: `“${doc.fileName}” is already on this call.` });
        continue;
      }
      changed.value = true;
      entries.value.push({ name: doc.fileName, doc, status: doc.parseStatus === 'parsed' ? 'done' : 'stored' });
    } catch (err) {
      $q.notify({
        type: 'negative',
        message: err instanceof Error ? err.message : `“${file.name}” could not be uploaded.`,
      });
    }
  }
  sectionUploading.value = false;
  await loadTables();
}

const removeOpen = ref(false);
const removeTarget = ref<PortCallDocument | null>(null);
const removing = ref(false);
/** Removing a form that feeds the table takes its values out of the table. */
const removeFeedsTable = computed(
  () => !!removeTarget.value && !!currentTable.value?.sources.some((x) => x.docId === removeTarget.value!.id),
);
function askRemove(doc: PortCallDocument): void {
  removeTarget.value = doc;
  removeOpen.value = true;
}
async function doRemove(): Promise<void> {
  const target = removeTarget.value;
  if (!target) return;
  removing.value = true;
  try {
    await auth.removeCallDocument(props.call.id, target.id);
    removeOpen.value = false;
    changed.value = true;
    entries.value = entries.value.filter((e) => e.doc?.id !== target.id);
    callDocs.value = callDocs.value.filter((d) => d.id !== target.id);
    await loadTables();
  } catch (err) {
    $q.notify({ type: 'negative', message: err instanceof Error ? err.message : 'Could not remove the file.' });
  } finally {
    removing.value = false;
  }
}

/** The table's heading: what its rows are (user 2026-11-02: "Crew details"). */
const DETAILS_TITLES: Record<NemoTableData['key'], string> = {
  crew: 'Crew details',
  passengers: 'Passenger details',
  cargo: 'Cargo details',
  stores: 'Stores details',
  waste: 'Waste details',
  security: 'Security details',
  health: 'Health details',
};
const detailsTitle = computed(() => (currentTable.value ? DETAILS_TITLES[currentTable.value.key] : ''));
const fullOpen = ref(false);

/** The chosen column tab of each section, by one of its columns: a refresh,
    All details or full screen keeps it; the tabs themselves follow the width. */
const colAnchors = ref<Partial<Record<NemoTableData['key'], string>>>({});
function setAnchor(key: string): void {
  if (currentTable.value) colAnchors.value[currentTable.value.key] = key;
}

async function loadTables(): Promise<void> {
  const mine = ++tablesLoad;
  void loadDocs();
  try {
    const fresh = await auth.formTables(props.call.id);
    if (mine !== tablesLoad) return;
    tables.value = fresh;
    // Opened for one table: go there once, if the call has it
    // (a form uploaded for it on the files step still gets there)
    if (pendingStart && step.value === 'files' && fresh.some((t) => t.key === pendingStart)) {
      step.value = pendingStart;
      pendingStart = undefined;
      missingKey.value = undefined;
    }
    // A removed file can take its section's table with it: back to the files
    if (step.value !== 'files' && step.value !== 'done' && !fresh.some((t) => t.key === step.value)) {
      step.value = 'files';
    }
  } catch {
    if (mine !== tablesLoad) return;
    tables.value = [];
    $q.notify({ type: 'negative', message: 'Could not load the NEMO tables.' });
  }
}

/** Missing and disagreeing values: shown, never holding the step (0096 decision 3). */
const softCount = (t: NemoTableData) => t.counts.missing + t.counts.conflict + t.counts.warning;
function softWords(t: NemoTableData): string {
  const parts: string[] = [];
  if (t.counts.missing) parts.push(`${t.counts.missing} required ${t.counts.missing === 1 ? 'value is' : 'values are'} missing`);
  if (t.counts.conflict) parts.push(`${t.counts.conflict} ${t.counts.conflict === 1 ? 'value differs' : 'values differ'} between forms`);
  if (t.counts.warning) parts.push(`${t.counts.warning} to check`);
  return parts.join(', ');
}

/** The open section's status message: a fix needed, values to fill in, or all there. */
const sectionTone = computed<'ok' | 'check' | 'error'>(() => {
  const t = currentTable.value;
  if (!t) return 'ok';
  if (t.counts.error > 0) return 'error';
  return softCount(t) > 0 ? 'check' : 'ok';
});
const sectionWords = computed(() => {
  const t = currentTable.value;
  if (!t) return '';
  if (sectionTone.value === 'error') {
    return `${t.counts.error === 1 ? 'One value needs' : `${t.counts.error} values need`} a NEMO code or a fix before the next step — tap it.`;
  }
  if (sectionTone.value === 'check') {
    return `${softWords(t)} — tap a cell to fill it in. It does not hold you up: the files and the National Spreadsheet come out as they are.`;
  }
  if (t.key === 'cargo') {
    return allDetails.value ? 'Cargo details from the uploaded file are shown below.' : 'Cargo items are loaded. Turn on All details to review every item.';
  }
  return 'Everything NEMO asks for is here.';
});

const mainLabel = computed(() => {
  if (props.uploadOnly) return 'Review documents';
  if (step.value === 'done') return 'Done';
  // Opened from Add missing data: always Next (user 2026-11-07)
  if (props.startAt) return 'Next';
  const at = steps.value.findIndex((s) => s.state === 'current');
  return steps.value[at + 1]?.key === 'done' ? 'Finish' : 'Next';
});

const mainDisable = computed(() => {
  if (step.value === 'files') {
    return uploading.value || tables.value === null || entries.value.some((e) => e.busy || e.doc?.shipConfirmNeeded);
  }
  if (step.value === 'done') return false;
  return !currentTable.value || currentTable.value.counts.error > 0;
});

async function onMain(): Promise<void> {
  if (props.uploadOnly) {
    if (changed.value) emit('changed');
    emit('review');
    return;
  }
  if (step.value === 'done') {
    onClose(false);
    return;
  }
  if (step.value === 'files') {
    // The forms are saved; now they are read as NEMO's tables
    await loadTables();
  }
  const at = steps.value.findIndex((s) => s.state === 'current');
  const next = steps.value[at + 1];
  if (next) {
    step.value = next.key;
  }
}

/** Back: the step before, the forms kept as they are. */
function onBack(): void {
  const at = steps.value.findIndex((s) => s.state === 'current');
  const prev = steps.value[at - 1];
  if (prev) {
    step.value = prev.key;
  }
}

function onClose(open: boolean): void {
  if (open) return;
  emit('update:modelValue', false);
  if (changed.value) emit('changed');
}

// ---- a cell tapped ------------------------------------------------------------

const correctionOpen = ref(false);
const correctionTarget = ref<CorrectionTarget | null>(null);
const correctionDocId = ref('');
const entryOpen = ref(false);
const entryTarget = ref<EntryTarget | null>(null);

/**
 * A value a form gave is corrected on that form (the ship's file follows,
 * 0051); an empty, typed or disagreeing cell is typed in NEMOLink (0096).
 */
async function onPick(t: { rowKey: string; column: NemoColumn; cell: NemoCell | undefined }): Promise<void> {
  const table = currentTable.value;
  if (!table) return;
  const cell = t.cell;
  const rowLabel = table.rows.find((r) => r.key === t.rowKey)?.label ?? '';
  const fromForm = cell?.source && !cell.entered && cell.flag !== 'conflict' && cell.value !== null;
  if (fromForm && cell?.source) {
    try {
      const detail = await auth.callDocumentDetail(props.call.id, cell.source.docId);
      const path = cell.source.path;
      const [kind, a = '', b = ''] = path.split('.');
      const form = detail.parsed?.form;
      const raw = (kind === 'fields' ? form?.fields[a] : form?.rows?.[Number(a)]?.[b]) ?? '';
      correctionDocId.value = cell.source.docId;
      correctionTarget.value = {
        path,
        label: t.column.label,
        subtitle: t.rowKey === '_' ? '' : rowLabel,
        de: t.column.de,
        required: t.column.required,
        source: `${cell.source.formName} · ${cell.source.fileName}`,
        raw,
        ann: detail.checks?.annotations[path] ?? null,
        corr: detail.corrections?.[path] ?? null,
      };
      correctionOpen.value = true;
    } catch {
      $q.notify({ type: 'negative', message: 'Could not load the form.' });
    }
    return;
  }
  entryTarget.value = { table: table.key, rowKey: t.rowKey, rowLabel, column: t.column, cell };
  entryOpen.value = true;
}

function onCorrected(): void {
  changed.value = true;
  void loadTables();
}

function onEntered(fresh: NemoTableData[]): void {
  tables.value = fresh;
  changed.value = true;
}
</script>

<style scoped>
/* The steps: pills joined by chevrons, the current one on a Blue/300 tint; passed and coming steps look the same */
.wz-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 12px;
}
.wz-steps {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
}
.wz-step {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wz-step__sep {
  color: var(--nl-ink-3);
}
/* Every step's pill is the same size — 36px tall, a 24px number — only
   the colours mark the current one (user 2026-11-06) */
.wz-step__pill {
  height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 6px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid var(--nl-line);
  font-size: 14px;
  color: var(--nl-ink-2);
  white-space: nowrap;
}
.wz-step__n {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--nl-gray-bg);
  color: var(--nl-ink-2);
}
/* The current step (Figma "Form step / State=Current" 341:5794): a Blue/300
   pill 36px tall, no border, no animation; Heading/14 label in Text/300 */
.wz-step--current .wz-step__pill {
  height: 36px;
  padding: 0 12px 0 6px;
  background: var(--blue-300);
  border-color: transparent;
  line-height: 20px;
  color: var(--nl-g-ink);
  font-weight: 600;
}
.wz-step--current .wz-step__n {
  width: 24px;
  height: 24px;
  line-height: 16px;
  background: var(--nl-g-blue);
  color: var(--nl-on-fill);
}

/* The body is white (no section cards); each step opens with its name and
   where its values come from */
.fw-section {
  display: flex;
  flex-direction: column;
}
.fw-form-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 20px;
}
/* Keep Upload directly below the Files heading at every width. */
.fw-form-head--files {
  align-items: flex-start;
  gap: 12px;
}
.fw-missing {
  align-items: center;
}
.fw-status__words {
  flex: 1 1 0;
  min-width: 0;
}
/* Phone: the status words over the button, both full width */
@media (max-width: 599px) {
  .fw-status {
    flex-wrap: wrap;
    padding: 12px 16px;
  }
  .fw-status__words {
    flex-basis: calc(100% - 34px);
  }
}
.fw-form-name {
  font-size: 16px;
  line-height: 21px;
  font-weight: 600;
  color: var(--nl-g-ink);
}
.fw-form-from {
  font-size: 14px;
  line-height: 20px;
  color: var(--nl-g-body);
}

/* A section's table under its heading (16/21 SemiBold ink, as the section's
   name above, user 2026-11-02); the column tabs and Full screen
   on the right (user 2026-11-02) */
.fw-details-head {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 24px; /* 24px down to the list (user 2026-11-07) */
}
.fw-heading {
  font-size: 16px;
  line-height: 21px;
  font-weight: 600;
  color: var(--nl-g-ink);
}
@media (max-width: 1023px) {
  .fw-details-head { margin-bottom: 12px; }
  .fw-coltabs { display: none; }
}
/* Full screen and its way back (Figma 392:7100, 392:7141): an icon button,
   36px square, white with the 1.5px field line of the outlined buttons,
   radius 8, the 24px icon */
.fw-full-btn {
  width: 36px;
  height: 36px;
  min-width: 36px;
  min-height: 36px;
  padding: 0;
  border-radius: 8px;
  background: var(--nl-g-white) !important;
}
.fw-full-btn :deep(.q-icon) {
  margin: 0;
  font-size: 24px;
}
/* Full screen: white, the heading row on top, the table filling the rest */
.fw-full {
  display: flex;
  flex-direction: column;
  background: var(--nl-g-white);
}
/* The column tabs take the room between the heading and the button, on its right */
.fw-coltabs {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  justify-content: flex-end;
}
/* The tabs and the way back sit where the heading's line was (its middle at
   87px), the table 10px under them as in the card (user 2026-11-02) */
.fw-full__head {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 68px 34px 0;
}
.fw-full__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 10px 34px 26px;
}

/* Desktop navigation follows the reference: labels on the left, a shared
   baseline and the unframed full-screen control at the far right. */
@media (min-width: 1024px) {
  .fw-details-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0 24px;
    border-bottom: 1px solid var(--nl-g-line-row);
  }
  .fw-heading {
    grid-column: 1 / -1;
    margin-bottom: 12px;
  }
  .fw-coltabs {
    justify-content: flex-start;
    align-self: stretch;
    margin-bottom: -1px;
  }
  .fw-full-btn {
    align-self: center;
    flex: none;
    border-radius: 4px;
    background: transparent !important;
    color: var(--nl-g-secondary);
  }
  .fw-full-btn :deep(.q-icon) {
    font-size: 20px;
  }
  .fw-full__head {
    padding-top: 24px;
    border-bottom: 1px solid var(--nl-g-line-row);
  }
  .fw-full__body {
    padding-top: 24px;
  }
}

/* Status banners (Figma 341:5810): radius 10, a 22px icon, 14/20 SemiBold */
.wz-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 20px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}
.wz-banner .q-icon {
  flex: none;
  margin: -1px 0;
}
.wz-banner--ok {
  background: var(--green-100);
  color: var(--green-400);
}
.wz-banner--ok .q-icon {
  color: var(--green-200);
}
.wz-banner--check {
  background: var(--orange-100);
  color: var(--orange-500);
}
.wz-banner--error {
  background: var(--red-100);
  color: var(--red-300);
}
.wz-banner--error .q-icon {
  color: var(--red-200);
}
/* A section's status with All details off: the files card's head (Figma
   420:12166) on its own — same fill, spacing and type, no outline */
.fw-status {
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 12px 32px 12px 24px;
  margin-bottom: 26px;
  line-height: normal;
  letter-spacing: 0.14px;
}
.fw-status.wz-banner--ok {
  background: var(--nl-g-head-surface);
  color: var(--nl-g-ink);
}
.fw-status__icon {
  flex: none;
  width: 22px;
  height: 22px;
}

/* Back: an outline button on a white fill (user 2026-11-02); Quasar's
   outline rule forces a transparent background, hence !important */
.fw-back {
  background: var(--nl-g-white) !important;
}

/* The files: a list, rows divided by the lightest stroke */
.fw-file {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid var(--nl-g-line-row);
}
.fw-file:last-child {
  border-bottom: none;
}
.fw-file__content {
  min-width: 0;
  overflow-wrap: anywhere;
}
.fw-file__name {
  display: block;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--nl-g-ink);
}
.fw-file__name[href] {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.fw-file__name[href]:focus-visible {
  outline: 2px solid var(--blue-800);
  outline-offset: 2px;
  border-radius: 2px;
}
.fw-file__icon {
  flex: none;
  margin-top: 2px;
  color: var(--nl-g-secondary);
}
.fw-file__icon--done,
.fw-file__icon--duplicate {
  color: var(--nl-primary);
}
.fw-file__icon--refused {
  color: var(--red-200);
}
/* "Is it our ship's?" — a question to answer: the missing-value orange */
.fw-ask {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--orange-100);
  color: var(--orange-500);
  font-size: 14px;
  line-height: 20px;
}
</style>
