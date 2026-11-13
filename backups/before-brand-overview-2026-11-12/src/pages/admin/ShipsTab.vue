<template>
  <div>
    <!-- dialog-only (spec 0085): the ship editor opened in place from any page -->
    <template v-if="!dialogOnly">
    <div class="tab-title q-mb-md row items-center q-gutter-sm">
      <span>Your fleet</span>
      <HelpTip topic="admin.ships" />
      <!-- The org's shortlist of the shared master list (spec 0068) -->
      <span class="text-caption text-grey-7">Your ships, picked from the master list shared by every organisation</span>
      <span v-if="lastIngest" class="text-caption text-grey-7 last-ingest">
        Last update from integrations {{ fmtWhen(lastIngest.receivedAt) }} · {{ lastIngest.source }}
      </span>
      <q-space />
      <SearchBox v-model="search" placeholder="Search ships" />
      <q-btn
        unelevated
        color="primary"
        no-caps
        dense
        icon="add"
        label="Add ship"
        class="q-px-md"
        @click="openAdd"
      />
    </div>

    <div v-if="loading" class="row justify-center q-pa-lg">
      <q-spinner size="32px" color="primary" />
    </div>

    <q-table
      v-else
      :rows="filtered"
      :columns="columns"
      row-key="id"
      flat
      bordered
      dense
      hide-bottom
      :pagination="{ rowsPerPage: 0 }"
      class="ships-table rounded-borders"
      :no-data-label="search ? 'No ships match your search.' : 'No ships in your fleet yet — add one from the master list.'"
    >
      <template #body="props">
        <q-tr
          :props="props"
          class="ship-row"
          :class="{ 'inactive-row': !props.row.isActive }"
          @click="openDetails(props.row)"
        >
          <q-td key="ship" :props="props">
            <div class="text-weight-semibold">{{ props.row.name ?? '—' }}</div>
            <div v-if="props.row.callSign" class="text-caption text-grey-7">
              Call sign {{ props.row.callSign }}
            </div>
            <div class="text-caption text-grey-7">
              Added by {{ props.row.addedBy }}
            </div>
          </q-td>
          <q-td key="imo" :props="props">{{ props.row.imoNumber ?? '—' }}</q-td>
          <q-td key="mmsi" :props="props">{{ props.row.mmsi ?? '—' }}</q-td>
          <q-td key="status" :props="props">
            <StatusPill
              :tone="nemoPill(props.row).tone"
              :icon="nemoPill(props.row).icon"
              :label="nemoPill(props.row).label"
            />
          </q-td>
          <q-td key="certs" :props="props">
            <StatusPill
              v-if="certStatusOf(props.row)"
              :tone="certStatusOf(props.row)!.tone"
              :icon="certStatusOf(props.row)!.icon"
              :label="certStatusOf(props.row)!.words"
            />
            <span v-else class="text-grey-5">none on file</span>
          </q-td>
          <q-td key="updated" :props="props">{{ fmtDate(props.row.updated) }}</q-td>
          <q-td key="actions" :props="props" class="actions-cell" @click.stop>
            <q-btn
              flat round dense
              color="grey-7"
              icon="visibility"
              :aria-label="`Details of ${props.row.name}`"
              @click="openDetails(props.row)"
            >
              <q-tooltip>Details</q-tooltip>
            </q-btn>
            <q-btn
              flat round dense
              color="grey-8"
              icon="remove_circle_outline"
              :loading="toggling === props.row.id"
              :aria-label="`Remove ${props.row.name} from your fleet`"
              @click="removeFromFleet(props.row)"
            >
              <q-tooltip>Remove from fleet</q-tooltip>
            </q-btn>
          </q-td>
        </q-tr>
      </template>
    </q-table>
    </template>

    <!-- Details: read-only, certificates with per-certificate status -->
    <HouseDialog
      v-model="detailsDialog"
      :title="detailsTarget?.name ?? 'Ship'"
      help-topic="admin.ships"
      :max-width-px="980"
    >
      <!-- Save in Close's place (user 2026-11-04): each field already saves
           as you leave it; Save commits the one being typed in, waits for
           the saves to land, then closes -->
      <template #secondary>
        <q-btn
          unelevated no-caps color="primary" label="Save"
          class="ship-save"
          :loading="savingDetails"
          @click="saveDetails"
        />
      </template>
      <template v-if="detailsTarget">
        <div class="detail-row" v-for="f in detailFacts" :key="f.label">
          <span class="detail-label">{{ f.label }}</span>
          <span class="detail-value row items-center no-wrap">
            <span>{{ f.value }}</span>
          </span>
        </div>

        <!-- Data (specs 0061 + 0064): external · NEMOLink override · to NEMO · in NEMO -->
        <div class="row items-center q-mt-md q-mb-sm">
          <div class="cert-title col">Data</div>
          <span class="ledger-switch q-mr-md" role="group" aria-label="Which fields the data lists">
            <span
              class="ledger-switch__side"
              :class="{ 'ledger-switch__side--on': !showAllFields }"
              @click="showAllFields = false"
            >FIN fields</span>
            <q-toggle v-model="showAllFields" dense size="sm" aria-label="All fields" />
            <span
              class="ledger-switch__side"
              :class="{ 'ledger-switch__side--on': showAllFields }"
              @click="showAllFields = true"
            >All fields</span>
          </span>
          <!-- In NEMO is hidden (spec 0086): NEMO's ship record cannot be read back -->
          <template v-if="SHOW_IN_NEMO">
          <span class="ledger-meta q-mr-sm">{{ nemoReadWords }}</span>
          <q-btn
            flat
            dense
            no-caps
            size="12px"
            icon="sync"
            color="primary"
            label="Refresh from NEMO"
            :loading="busy === 'nemo'"
            @click="refreshNemo"
          />
          </template>
        </div>
        <!-- What NEMO's own screens show for this ship, from the snapshot (spec 0065) -->
        <div v-if="detailsTarget.nemoIssues?.length" class="nemo-issues q-mb-sm">
          <div
            v-for="i in detailsTarget.nemoIssues"
            :key="i.rule"
            class="nemo-issue"
            :class="`nemo-issue--${i.level}`"
          >
            <q-icon :name="i.level === 'warning' ? 'warning_amber' : 'info'" size="16px" />
            <span>
              {{ i.words }}
              <a v-if="i.link" :href="i.link" target="_blank" rel="noopener" class="nemo-issue-link">Open NEMO</a>
            </span>
          </div>
        </div>
        <div class="ledger ledger--ids">
          <div class="ledger-head">
            <span>Field</span>
            <span class="prov-head prov-head--ext">External</span>
            <span class="prov-head prov-head--nl">NEMOLink override</span>
            <span class="prov-head prov-head--nemo prov-lane">To NEMO</span>
            <span>NEMO code</span>
          </div>
          <div
            v-for="r in ledgerRows"
            :key="r.key"
            class="ledger-row"
            :class="{ 'ledger-row--differs': r.differs, 'ledger-row--missing': r.missing || !!r.problem, 'ledger-row--field': true }"
          >
            <span class="ledger-cell ledger-cell--label" data-col="Field">
              <span class="row items-center no-wrap">
                <span>{{ r.label }}</span>
                <HelpTip v-if="r.key === 'iceClass'" topic="ships.iceClass" />
              </span>
              <span v-if="r.required" class="ledger-meta">required</span>
              <!-- On the phone the Missing tag under the name (user 2026-11-06) -->
              <!-- On the phone a tag under the name (user 2026-11-06): Missing,
                   Sources differ, or the blue To NEMO for what goes -->
              <span v-if="r.missing" class="ledger-tag">Missing</span>
              <span v-else-if="r.differs" class="ledger-tag">Sources differ</span>
              <span v-else class="ledger-tag ledger-tag--nemo">To NEMO</span>
            </span>
            <span class="ledger-cell" :class="{ 'ledger-cell--empty': !r.external }" data-col="External">
              <template v-if="r.external">
                <span class="tnum" :class="{ 'prov-replaced': r.hasOverride }">{{ r.external.text }}</span>
                <span class="ledger-meta"
                  >{{ r.external.source }}<span class="ledger-when"> · {{ r.external.when }}</span></span
                >
              </template>
              <span v-else class="text-grey-5">—</span>
            </span>
            <span class="ledger-cell ledger-cell--edit" data-col="NEMOLink override">
              <div class="ledger-edit">
                <q-input
                  v-if="r.kind === 'text' || r.kind === 'number'"
                  v-model="drafts[r.key]"
                  dense
                  outlined
                  :type="r.kind === 'number' ? 'number' : 'text'"
                  :placeholder="r.external ? 'Override' : 'Add value'"
                  :disable="busy === r.key || r.locked"
                  class="ledger-input"
                  :class="r.hasOverride ? 'prov-set' : 'prov-quiet'"
                  @blur="commitField(r)"
                  @keyup.enter="commitField(r)"
                />
                <DateField
                  v-else-if="r.kind === 'date'"
                  :model-value="String(drafts[r.key] ?? '')"
                  label=""
                  class="ledger-input"
                  :class="r.hasOverride ? 'prov-set' : 'prov-quiet'"
                  @update:model-value="(v) => draftDate(r, v)"
                />
                <q-select
                  v-else
                  v-model="drafts[r.key]"
                  :options="optionsFor(r.kind)"
                  clearable
                  emit-value
                  map-options
                  dense
                  outlined
                  options-dense
                  :use-input="r.kind === 'type' || r.kind === 'country' || r.kind === 'registry' || r.kind === 'port'"
                  :fill-input="r.kind === 'type' || r.kind === 'country' || r.kind === 'registry' || r.kind === 'port'"
                  :hide-selected="r.kind === 'type' || r.kind === 'country' || r.kind === 'registry' || r.kind === 'port'"
                  input-debounce="0"
                  :placeholder="r.external ? 'Override' : 'Add value'"
                  :disable="busy === r.key"
                  class="ledger-input"
                  :class="r.hasOverride ? 'prov-set' : 'prov-quiet'"
                  @filter="filterHandlers[r.kind]"
                  @update:model-value="commitField(r)"
                />
                <q-btn
                  v-if="r.clearable"
                  flat
                  round
                  dense
                  size="sm"
                  icon="close"
                  color="grey-7"
                  :aria-label="`Clear ${r.label}`"
                  :loading="busy === r.key"
                  @click="clearField(r)"
                >
                  <q-tooltip>Remove the override — {{ r.external ? `the ${r.external.source} value goes to NEMO` : 'no value goes to NEMO' }}</q-tooltip>
                </q-btn>
                <q-tooltip v-if="r.locked">{{ r.lockedWords }}</q-tooltip>
              </div>
              <span v-if="r.overrideMeta" class="ledger-meta"
                >{{ r.overrideMeta.author }}<span class="ledger-when"> · {{ r.overrideMeta.when }}</span></span
              >
            </span>
            <span class="ledger-cell prov-lane" :class="{ 'prov-lane--missing': r.missing || !!r.problem, 'ledger-cell--phone-off': r.missing || !r.problem }" data-col="To NEMO">
              <template v-if="r.missing">
                <span class="prov-missing"><q-icon name="error_outline" size="15px" />Missing</span>
                <span class="prov-note">{{ r.problem || 'NEMO requires it' }}</span>
              </template>
              <template v-else>
                <span class="tnum prov-value">{{ r.resolved }}</span>
                <span
                  v-if="r.originWords"
                  class="prov-from"
                  :class="{ 'prov-from--nl': r.hasOverride || r.originWords === 'entered here' }"
                  >{{ r.hasOverride ? 'from your override' : r.originWords }}</span
                >
                <span v-if="r.problem" class="prov-note">{{ r.problem }}</span>
              </template>
            </span>
            <span class="ledger-cell" data-col="NEMO code">
              <span class="tnum">{{ r.nemoId }}</span>
              <span class="ledger-meta">{{ r.nemoHome }}</span>
            </span>
          </div>
        </div>
        <div class="text-body2 q-mt-sm" style="color: var(--nl-ink-3)">
          Edits in the override column save as you type. NEMO takes ship data only as part of a
          port call — the identity (SID) and the particulars (SHP) under its visit id; there is no
          other way to send it. It goes to NEMO when a port call of this ship is created in NEMO,
          and again from the SID and SHP chips of any call that is in NEMO.
        </div>

        <div class="row items-center q-mt-md q-mb-sm">
          <div class="cert-title col">Certificates</div>
          <q-btn
            flat dense no-caps size="12px" color="primary" icon="add" label="Add certificate"
            :disable="certAddOpen"
            @click="openAddCert"
          />
        </div>
        <div v-if="certAddOpen" class="cert-add q-mb-sm">
          <div class="row q-col-gutter-sm items-start">
            <q-select
              v-model="certForm.typeCode"
              :disable="!!certForm.editingKey"
              :options="certOptions"
              emit-value map-options outlined dense options-dense
              label="Type"
              class="col-12 col-sm-3"
              hint="List: NEMO ship certificate types"
            />
            <q-input v-model="certForm.certificateId" :disable="!!certForm.editingKey" label="Number" outlined dense class="col-6 col-sm-3" />
            <DateField
              v-model="certForm.issueDate" label="Issued" class="col-6 col-sm-3"
              :max-date="todayIso()"
              :error="!!issueDateProblem" :error-message="issueDateProblem"
            />
            <DateField
              v-model="certForm.expiryDate" label="Expires" class="col-6 col-sm-3"
              :min-date="certForm.issueDate || undefined"
              :error="!!expiryDateProblem" :error-message="expiryDateProblem"
            />
          </div>
          <!-- What NEMO asks of every certificate (emsw.fi, C-CRT rules; spec 0084) -->
          <div class="row q-col-gutter-sm items-start q-mt-xs">
            <q-select
              v-model="certForm.issuerTypeCode"
              :options="issuerTypeOptions"
              emit-value map-options outlined dense options-dense
              label="Issuer type"
              class="col-12 col-sm-4"
            />
            <q-select
              v-if="issuerNeeds === 'country'"
              v-model="certForm.issuerCountry"
              :options="countryOptions"
              emit-value map-options outlined dense options-dense use-input fill-input hide-selected
              input-debounce="0"
              label="Flag state"
              class="col-12 col-sm-4"
              @filter="filterCountries"
            />
            <q-select
              v-else-if="issuerNeeds === 'id'"
              v-model="certForm.issuerId"
              :options="issuerOptions"
              emit-value map-options outlined dense options-dense use-input fill-input hide-selected
              input-debounce="0"
              label="Issuer"
              hint="List: NEMO certificate issuers"
              class="col-12 col-sm-4"
              @filter="filterIssuers"
            />
            <q-input
              v-else-if="issuerNeeds === 'name'"
              v-model="certForm.issuer"
              label="Issuer name"
              outlined dense
              class="col-12 col-sm-4"
            />
            <q-input
              v-if="certForm.typeCode === 'OTHER' || certForm.issuerTypeCode === '99'"
              v-model="certForm.description"
              label="Description (required)"
              outlined dense
              class="col-12 col-sm-4"
            />
          </div>
          <div class="row justify-end q-gutter-x-sm q-mt-xs">
            <q-btn flat dense no-caps label="Cancel" :disable="busy === 'cert-add'" @click="closeCertForm" />
            <q-btn
              unelevated dense no-caps color="primary" :label="certForm.editingKey ? 'Save' : 'Add'"
              :loading="busy === 'cert-add'"
              :disable="!certForm.typeCode || !!issueDateProblem || !!expiryDateProblem"
              @click="saveNewCert"
            />
          </div>
        </div>
        <input ref="certFileInput" type="file" accept=".pdf,.xml,.jpg,.jpeg,.png,application/pdf,application/xml,text/xml,image/jpeg,image/png" class="hidden" @change="onCertFilePicked" />
        <div v-if="certRows.length === 0" class="text-grey-6 text-body2">None on file.</div>
        <div v-else class="ledger ledger--ids">
          <div class="ledger-head">
            <span>Certificate</span>
            <span class="prov-head prov-head--ext">External</span>
            <span class="prov-head prov-head--nl">NEMOLink override</span>
            <span class="prov-head prov-head--nemo prov-lane">To NEMO</span>
            <span>NEMO code</span>
          </div>
          <div
            v-for="r in certRows"
            :key="r.key"
            class="ledger-row"
            :class="{ 'ledger-row--differs': r.differs }"
          >
            <span class="ledger-cell ledger-cell--label" data-col="Certificate">
              <span class="row items-center no-wrap">
                <q-btn
                  flat round dense size="xs" color="grey-7" class="q-mr-xs"
                  :icon="openCertKey === r.key ? 'expand_less' : 'expand_more'"
                  :aria-label="`${openCertKey === r.key ? 'Close' : 'Open'} certificate ${r.typeCode}`"
                  @click="toggleCert(r)"
                >
                  <q-tooltip>{{ openCertKey === r.key ? 'Close' : 'Every field the CRT sends, with its NEMO code — edit or delete here' }}</q-tooltip>
                </q-btn>
                <span class="text-weight-semibold">{{ r.typeCode }} — {{ certificateName(r.typeCode) }}</span>
              </span>
            </span>
            <!-- Under the row, the full width (spec 0084): its details, what NEMO lacks, its files -->
            <span class="cert-extra">
              <span v-if="r.detail" class="ledger-meta">{{ r.detail }}</span>
              <span v-if="certGapsOf(r).length" class="cert-gaps">NEMO needs: {{ certGapsOf(r).join(', ') }}</span>
              <span class="cert-files">
                <span v-for="f in certFiles[certKeyOfRow(r)] ?? []" :key="f.id" class="cert-file">
                  <a :href="auth.certificateFileUrl(detailsTarget!.id, f.id)" class="cert-file__link">{{ f.fileName }}</a>
                  <q-btn flat round dense size="xs" icon="close" color="grey-6" :aria-label="`Remove ${f.fileName}`" :loading="busy === `file:${f.id}`" @click="removeCertFile(f.id)">
                    <q-tooltip>Remove the file</q-tooltip>
                  </q-btn>
                </span>
                <q-btn flat dense no-caps size="12px" color="primary" icon="attach_file" label="Attach file" :loading="busy === `attach:${certKeyOfRow(r)}`" @click="pickCertFile(r)">
                  <q-tooltip>The certificate as PDF, XML, JPG or PNG, up to 10 MB — NEMO requires it with the CRT</q-tooltip>
                </q-btn>
              </span>
            </span>
            <span class="ledger-cell" data-col="External">
              <template v-if="r.external">
                <span class="tnum" :class="{ 'prov-replaced': r.hasOverride }">expires {{ r.external.text }}</span>
                <span class="ledger-meta"
                  >{{ r.external.source }}<span class="ledger-when"> · {{ r.external.when }}</span></span
                >
              </template>
              <span v-else class="text-grey-5">—</span>
            </span>
            <span class="ledger-cell ledger-cell--edit" data-col="NEMOLink override">
              <div class="ledger-edit">
                <DateField
                  :model-value="String(drafts[r.key] ?? '')"
                  label=""
                  class="ledger-input"
                  :class="r.hasOverride ? 'prov-set' : 'prov-quiet'"
                  @update:model-value="(v) => draftCertDate(r, v)"
                />
                <q-btn
                  v-if="r.clearable"
                  flat
                  round
                  dense
                  size="sm"
                  icon="close"
                  color="grey-7"
                  :aria-label="`Clear expiry of ${r.typeCode}`"
                  :loading="busy === r.key"
                  @click="clearCert(r)"
                >
                  <q-tooltip>{{ r.hasOverride ? `Use ${r.external?.source} value` : 'Clear' }}</q-tooltip>
                </q-btn>
              </div>
              <span v-if="r.superseded" class="ledger-meta ledger-differs-text">
                disregarded — {{ r.external?.source }} has a newer date
              </span>
              <span v-else-if="r.overrideMeta" class="ledger-meta"
                >{{ r.overrideMeta.author }}<span class="ledger-when"> · {{ r.overrideMeta.when }}</span></span
              >
            </span>
            <span class="ledger-cell prov-lane" data-col="To NEMO">
              <span class="tnum prov-value" :class="`cert-expiry--${r.expiry.tone}`">{{ r.expiry.words }}</span>
              <span
                v-if="r.originWords"
                class="prov-from"
                :class="{ 'prov-from--nl': r.hasOverride }"
                >{{ r.hasOverride ? 'from your override' : r.originWords }}</span
              >
            </span>
            <span class="ledger-cell" data-col="NEMO code">
              <span class="tnum">DE-006-11</span>
              <span class="ledger-meta">CRT</span>
            </span>
            <!-- Expanded (spec 0086 amendment): every field the CRT carries, one row each -->
            <div v-if="openCertKey === r.key" class="cert-fields">
              <div v-for="x in certFieldsOf(r.cert)" :key="x.de" class="cert-field">
                <span class="ledger-cell ledger-cell--label" data-col="Field">{{ x.label }}</span>
                <span class="ledger-cell text-grey-5" data-col="External">—</span>
                <span class="ledger-cell ledger-cell--edit" data-col="NEMOLink">
                  <q-input v-if="x.edit === 'description'" v-model="certForm.description" dense outlined class="ledger-input" />
                  <q-select v-else-if="x.edit === 'issuerType'" v-model="certForm.issuerTypeCode" :options="issuerTypeOptions" emit-value map-options dense outlined options-dense class="ledger-input" />
                  <q-select
                    v-else-if="x.edit === 'issuerCountry'" v-model="certForm.issuerCountry" :options="countryOptions"
                    emit-value map-options dense outlined options-dense use-input fill-input hide-selected input-debounce="0"
                    class="ledger-input" @filter="filterCountries"
                  />
                  <q-select
                    v-else-if="x.edit === 'issuerId'" v-model="certForm.issuerId" :options="issuerOptions"
                    emit-value map-options dense outlined options-dense use-input fill-input hide-selected input-debounce="0"
                    class="ledger-input" @filter="filterIssuers"
                  />
                  <q-input v-else-if="x.edit === 'issuer'" v-model="certForm.issuer" dense outlined class="ledger-input" />
                  <DateField
                    v-else-if="x.edit === 'issueDate'" v-model="certForm.issueDate" label="" class="ledger-input"
                    :max-date="todayIso()"
                  />
                  <DateField
                    v-else-if="x.edit === 'expiryDate'" v-model="certForm.expiryDate" label="" class="ledger-input"
                    :min-date="certForm.issueDate || undefined"
                  />
                  <span v-else class="ledger-meta">{{ x.fixed }}</span>
                  <span v-if="x.edit === 'issueDate' && issueDateProblem" class="ledger-meta ledger-missing-text">{{ issueDateProblem }}</span>
                  <span v-if="x.edit === 'expiryDate' && expiryDateProblem" class="ledger-meta ledger-missing-text">{{ expiryDateProblem }}</span>
                </span>
                <span class="ledger-cell prov-lane prov-lane--flat" data-col="To NEMO">
                  <span :class="x.value ? 'prov-value' : 'text-grey-5'">{{ x.value || '—' }}</span>
                  <span v-if="x.note" class="ledger-meta">{{ x.note }}</span>
                </span>
                <span class="ledger-cell tnum" data-col="NEMO code">{{ x.de }}</span>
              </div>
              <!-- House order: the destructive action alone on the left, Cancel then Save on the right -->
              <div class="cert-actions">
                <q-btn
                  flat dense no-caps color="negative" icon="delete_outline" label="Delete certificate"
                  :disable="busy === 'cert-add'"
                  @click="removeCert(r)"
                />
                <q-space />
                <q-btn flat dense no-caps label="Cancel" :disable="busy === 'cert-add'" @click="closeOpenCert" />
                <q-btn
                  unelevated dense no-caps color="primary" label="Save" class="q-ml-sm q-px-md"
                  :loading="busy === 'cert-add'"
                  :disable="!!issueDateProblem || !!expiryDateProblem"
                  @click="saveNewCert"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </HouseDialog>

    <!-- Delete a certificate, remove a ship from the fleet: confirm -->
    <RemovalDialog
      v-model="confirmDialog"
      :title="confirmText.title"
      @confirm="confirmed"
    >{{ confirmText.message }}</RemovalDialog>

    <!-- Add from the master list (spec 0068): search by name or IMO, one tap to add -->
    <HouseDialog v-model="addDialog" title="Add ship" help-topic="admin.ships" :max-width-px="640">
      <q-input
        v-model="addQuery"
        label="Ship name or IMO number"
        outlined
        dense
        autofocus
        :loading="searching"
        class="q-mb-sm"
        hint="Searches the master list shared by every organisation using NEMOLink"
      />
      <q-list v-if="hits.length" bordered separator class="rounded-borders">
        <q-item v-for="h in hits" :key="h.id">
          <q-item-section>
            <q-item-label class="text-weight-semibold">{{ h.name ?? '—' }}</q-item-label>
            <q-item-label caption>
              IMO {{ h.imoNumber ?? '—' }}<template v-if="h.mmsi"> · MMSI {{ h.mmsi }}</template><template v-if="h.callSign"> · {{ h.callSign }}</template>
              · {{ inNemoWords(h.inNemo) }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <span v-if="h.inFleet" class="text-caption text-grey-7">in your fleet</span>
            <q-btn
              v-else
              unelevated
              dense
              no-caps
              color="primary"
              label="Add to fleet"
              :loading="adding === h.id"
              @click="addHit(h)"
            />
          </q-item-section>
        </q-item>
      </q-list>
      <div v-else-if="addQuery.trim().length >= 2 && !searching" class="text-body2 text-grey-7 q-pa-sm">
        Nothing on the master list matches. Create the ship if it is new to NEMOLink.
      </div>
      <template #actions>
        <q-btn flat no-caps color="primary" icon="add" label="Create a new ship" @click="createFromAdd" />
      </template>
    </HouseDialog>

    <!-- Create a new ship (spec 0068): identity only — everything else is edited in the ship dialog (spec 0070) -->
    <HouseDialog
      v-model="formDialog"
      title="Create a new ship"
      help-topic="admin.ships"
      :max-width-px="640"
      :close-disable="saving"
      close-label="Cancel"
      main-label="Create"
      :main-loading="saving"
      :main-disable="!form.name.trim()"
      @main="save"
    >
      <q-form @submit.prevent="save">
        <q-input
          v-model="form.name"
          label="Name"
          outlined
          dense
          class="q-mb-sm"
          :disable="saving"
        />
        <div class="row q-col-gutter-sm q-mb-sm">
          <q-input
            v-model="form.imoNumber"
            label="IMO number (7 digits)"
            outlined
            dense
            class="col"
            lazy-rules
            :rules="[imoRule]"
            :disable="saving"
          />
          <q-input
            v-model="form.mmsi"
            label="MMSI (9 digits)"
            outlined
            dense
            class="col"
            :disable="saving"
          />
          <q-input
            v-model="form.callSign"
            label="Call sign"
            outlined
            dense
            class="col"
            :disable="saving"
          />
        </div>
        <div class="text-body2" style="color: var(--nl-ink-3)">
          Particulars and certificates are added in the ship dialog once it exists.
        </div>
      </q-form>
    </HouseDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar, type QTableColumn } from 'quasar';
import {
  useAuth,
  type Ship,
  type CertificateFile,
  type ShipCertificate,
  type ShipFieldId,
  type ShipCertificateInput,
  type ShipIceClass,
  type ShipInput,
  type ShipSearchHit,
} from '../../auth/auth';
import { CERTIFICATE_TYPES, certificateName } from '../../generated/certificate-types';
import { CERTIFICATE_ISSUERS, ISSUER_TYPES, certificateIssuerName } from '../../generated/certificate-issuers';
import { ICE_CLASSES, iceClassName } from '../../generated/ice-classes';
import { COUNTRIES, countryName } from '../../generated/countries';
import { SHIP_REGISTRIES, registryName } from '../../generated/noa-codes';
import { NAVIGATION_TYPES, navigationTypeName } from '../../generated/navigation-types';
import { SHIP_TYPES, shipTypeName } from '../../generated/ship-types';
import DateField from '../../components/DateField.vue';
import HelpTip from '../../components/HelpTip.vue';
import { imoValid, imoWords } from '../../lib/imo';
import { fmtDay, fmtWhen } from '../../lib/time';
import type { ShipOverride } from '../../auth/auth';
import HouseDialog from '../../components/HouseDialog.vue';
import RemovalDialog from '../../components/RemovalDialog.vue';
import SearchBox from '../../components/SearchBox.vue';
import StatusPill, { type PillTone } from '../../components/StatusPill.vue';

const props = withDefaults(
  defineProps<{
    /** Only the ship dialog, opened on `shipId` — the in-place editor (spec 0085). */
    dialogOnly?: boolean;
    shipId?: string | null;
  }>(),
  { dialogOnly: false, shipId: null },
);
const emit = defineEmits<{
  /** The in-place editor closed; `changed` when anything was saved (spec 0085). */
  (e: 'closed', changed: boolean): void;
}>();

const $q = useQuasar();
const auth = useAuth();
const route = useRoute();
const router = useRouter();
/** Something was saved while the dialog was open — the page that opened it reloads. */
let changedInPlace = false;

const ships = ref<Ship[]>([]);
const loading = ref(true);
const saving = ref(false);
const toggling = ref<string | null>(null);
const search = ref('');

const detailsDialog = ref(false);
const detailsTarget = ref<Ship | null>(null);
// The in-place editor ends when its dialog closes (spec 0085)
watch(detailsDialog, (open) => {
  if (!open && props.dialogOnly) emit('closed', changedInPlace);
});

const formDialog = ref(false);
/** Every ledger field, empty ones too — to enter a particular nobody has sent yet (spec 0070). */
const showAllFields = ref(false);
/** Adding a certificate in the ship dialog (spec 0070). */
const certAddOpen = ref(false);
const EMPTY_CERT = { typeCode: '', certificateId: '', issueDate: '', expiryDate: '', issuer: '', issuerTypeCode: '', issuerId: '', issuerCountry: '', description: '', editingKey: null as string | null };
const certForm = reactive({ ...EMPTY_CERT });
/** The field the issuer type asks for (emsw.fi; spec 0084). */
/** The certificate dates as NEMO takes them: issued by today, expiring after the issue. */
const issueDateProblem = computed(() =>
  certForm.issueDate && certForm.issueDate > todayIso() ? 'Cannot be in the future' : '',
);
const expiryDateProblem = computed(() =>
  certForm.issueDate && certForm.expiryDate && certForm.expiryDate < certForm.issueDate
    ? 'Cannot be before the issue date'
    : '',
);
const issuerNeeds = computed(() => ISSUER_TYPES.find((t) => t.code === certForm.issuerTypeCode)?.needs ?? null);
const issuerTypeOptions = ISSUER_TYPES.map((t) => ({ label: `${t.name} (${t.code})`, value: t.code }));
const issuerAll = CERTIFICATE_ISSUERS.map((i) => ({ label: `${i.name} (${i.code})`, value: i.code }));
const issuerOptions = ref(issuerAll);
function filterIssuers(input: string, update: (fn: () => void) => void): void {
  const q = input.trim().toLowerCase();
  update(() => {
    issuerOptions.value = q ? issuerAll.filter((o) => o.label.toLowerCase().includes(q)) : issuerAll;
  });
}

// ---- adding from the master list (spec 0068) ------------------------------
const addDialog = ref(false);
const addQuery = ref('');
const hits = ref<ShipSearchHit[]>([]);
const searching = ref(false);
const adding = ref<string | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(addQuery, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  if (q.trim().length < 2) {
    hits.value = [];
    return;
  }
  searchTimer = setTimeout(() => void runSearch(q.trim()), 300);
});

async function runSearch(q: string): Promise<void> {
  searching.value = true;
  try {
    const found = await auth.searchShips(q);
    if (addQuery.value.trim() === q) hits.value = found;
  } catch {
    $q.notify({ type: 'negative', message: 'Could not search the master list.' });
  } finally {
    searching.value = false;
  }
}

function openAdd(): void {
  addQuery.value = '';
  hits.value = [];
  addDialog.value = true;
}

function createFromAdd(): void {
  addDialog.value = false;
  openCreate();
}

function inNemoWords(state: ShipSearchHit['inNemo']): string {
  return state === 'yes' ? 'in NEMO' : state === 'no' ? 'not in NEMO' : 'NEMO not read yet';
}

async function addHit(h: ShipSearchHit): Promise<void> {
  adding.value = h.id;
  try {
    await auth.addShipToFleet(h.id);
    $q.notify({ type: 'positive', message: `${h.name ?? 'The ship'} is in your fleet.` });
    hits.value = hits.value.map((x) => (x.id === h.id ? { ...x, inFleet: true } : x));
    await refresh();
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not add the ship.' });
  } finally {
    adding.value = null;
  }
}

/** The In NEMO state in a pill (spec 0064 rule 2 words). */
function nemoPill(v: Ship): { tone: PillTone; icon: string; label: string } {
  if (!v.nemo) return { tone: 'gray', icon: 'help_outline', label: 'NEMO not read' };
  return v.nemo.shipId
    ? { tone: 'green', icon: 'check_circle', label: 'In NEMO' }
    : { tone: 'amber', icon: 'error_outline', label: 'Not in NEMO' };
}

interface CertFormRow {
  typeCode: string;
  certificateId: string;
  issueDate: string;
  expiryDate: string;
  /** Fields not covered by the editor, preserved through a save */
  extendedUntil?: string;
  description?: string;
  issuer?: string;
  /**
   * The issuer elements the FI profile makes mandatory (DE-006-06/07/08).
   * Carried through every save so neither an admin edit here nor a source
   * push (spec 0036 amendment: pushes merge field by field) loses them.
   */
  issuerTypeCode?: string;
  issuerId?: string;
  issuerCountry?: string;
}

/** The create dialog: identity only (spec 0070 — one ship dialog for everything else). */
const form = reactive({ name: '', imoNumber: '', mmsi: '', callSign: '' });

// ID before name, FI-preferred types on top (user rule 2026-08-23)
const certOpt = (t: { code: string; name: string }) => ({
  label: `${t.code} — ${t.name}`,
  value: t.code,
});
// Sentinel header values — '' would map-match an empty selection
const certOptions = [
  { label: 'FI preferred', value: '__hdr-pref', disable: true },
  ...CERTIFICATE_TYPES.filter((t) => t.fiPreferred).map(certOpt),
  { label: 'All other types', value: '__hdr-other', disable: true },
  ...CERTIFICATE_TYPES.filter((t) => !t.fiPreferred).map(certOpt),
];

// ---- particulars (spec 0036): the NSD-mirror wire fields -------------------

interface PFieldDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'date' | 'boolean' | 'type' | 'nav' | 'country' | 'registry' | 'port';
}

const P_GROUPS: { title: string; fields: PFieldDef[] }[] = [
  {
    title: 'Registry & type',
    fields: [
      { key: 'typeCode', label: 'Ship type', kind: 'type' },
      { key: 'flagState', label: 'Flag state', kind: 'country' },
      { key: 'registrationCountry', label: 'Registration country', kind: 'country' },
      // The NOA's ship registry (annex V, e.g. FI00) and port of registry (spec 0088)
      { key: 'registryCode', label: 'Ship registry', kind: 'registry' },
      { key: 'registryPort', label: 'Port of registry', kind: 'port' },
      { key: 'navigationTypeCode', label: 'Type of navigation', kind: 'nav' },
      { key: 'relatedTransportMode', label: 'Related transport mode', kind: 'text' },
      { key: 'externalMarkingText', label: 'External marking', kind: 'text' },
    ],
  },
  {
    title: 'Dimensions & tonnage',
    fields: [
      { key: 'length', label: 'Length overall (m)', kind: 'number' },
      { key: 'width', label: 'Breadth (m)', kind: 'number' },
      { key: 'summerDraught', label: 'Summer draught (m)', kind: 'number' },
      { key: 'betweenPerpendicularsLength', label: 'Length b.p. (m)', kind: 'number' },
      { key: 'grossWeight', label: 'Gross tonnage', kind: 'number' },
      { key: 'netWeight', label: 'Net tonnage', kind: 'number' },
      { key: 'dwt', label: 'Deadweight (t)', kind: 'number' },
      { key: 'summerDeadweight', label: 'Summer deadweight (t)', kind: 'number' },
      { key: 'reducedGrossTonnage', label: 'Reduced gross tonnage', kind: 'number' },
    ],
  },
  {
    title: 'Machinery & performance',
    fields: [
      { key: 'mainEnginePower', label: 'Main engine power (kW)', kind: 'number' },
      { key: 'mainEngineAvailabilityIndicator', label: 'Main engine available', kind: 'boolean' },
      { key: 'openWaterSpeedMeasure', label: 'Service speed (kn)', kind: 'number' },
      { key: 'shipDriveTypeCode', label: 'Drive type code', kind: 'text' },
      { key: 'bowThrusterPower', label: 'Bow thruster (kW)', kind: 'number' },
      { key: 'sternThrusterPower', label: 'Stern thruster (kW)', kind: 'number' },
      { key: 'inertGasSystem', label: 'Inert gas system', kind: 'boolean' },
    ],
  },
  {
    title: 'Construction',
    fields: [
      { key: 'buildDate', label: 'Build date', kind: 'date' },
      { key: 'keelLayingDate', label: 'Keel laying date', kind: 'date' },
    ],
  },
  {
    title: 'Parties',
    fields: [
      { key: 'ownerName', label: 'Registered owner', kind: 'text' },
      { key: 'ownerRegisteredId', label: 'Owner registered id', kind: 'text' },
      { key: 'ownerStreet', label: 'Owner street', kind: 'text' },
      { key: 'ownerPostcode', label: 'Owner postcode', kind: 'text' },
      { key: 'ownerCity', label: 'Owner city', kind: 'text' },
      { key: 'ownerCountryCode', label: 'Owner country', kind: 'country' },
      { key: 'operatorName', label: 'Operator / lessee', kind: 'text' },
      { key: 'pniClubName', label: 'P&I club', kind: 'text' },
      { key: 'chartererName', label: 'Charterer', kind: 'text' },
      { key: 'chartererTypeCode', label: 'Charterer type code', kind: 'text' },
      { key: 'chartererStreet', label: 'Charterer street', kind: 'text' },
      { key: 'chartererPostcode', label: 'Charterer postcode', kind: 'text' },
      { key: 'chartererCity', label: 'Charterer city', kind: 'text' },
      { key: 'chartererCountryCode', label: 'Charterer country', kind: 'country' },
    ],
  },
  {
    title: 'Communications',
    fields: [
      { key: 'satelliteId', label: 'Satellite id', kind: 'text' },
      { key: 'satelliteProviderCode', label: 'Satellite provider', kind: 'text' },
    ],
  },
];

const P_FIELDS = P_GROUPS.flatMap((g) => g.fields);
const BOOL_OPTIONS = [
  { label: '—', value: '' },
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];
/** "Name (code)" — or the bare code when no vendored name exists. */
function codeLabel(name: string, code: string): string {
  return name === code ? code : `${name} (${code})`;
}

const iceOptions = ICE_CLASSES.map((c) => ({
  label: codeLabel(c.name, c.code),
  value: c.code,
}));

/** NSD's confirmation state, in words (spec 0069): Traficom confirms an ice class, NEMO records it. */
const ICE_STATUS_WORDS: Record<string, string> = {
  UNCONFIRMED: 'not confirmed by Traficom',
  PENDING: 'awaiting Traficom',
  CONFIRMED: 'confirmed by Traficom',
};

/** An ice class in words: the class, the confirmation state when known, the validity unless unconfirmed. */
function iceClassWords(ic: ShipIceClass): string {
  const status = (ic.status ?? '').toUpperCase();
  const state = ICE_STATUS_WORDS[status];
  const validTo = ic.validTo && status !== 'UNCONFIRMED' ? ` · valid until ${ic.validTo}` : '';
  return iceClassName(ic.code) + (state ? ` · ${state}` : '') + validTo;
}
const navOptions = NAVIGATION_TYPES.map((t) => ({
  label: codeLabel(t.name, t.code),
  value: t.code,
}));
const shipTypeAll = SHIP_TYPES.map((t) => ({
  label: codeLabel(t.name, t.code),
  value: t.code,
}));
const shipTypeOptions = ref(shipTypeAll);

function filterShipTypes(input: string, update: (fn: () => void) => void): void {
  const q = input.trim().toLowerCase();
  update(() => {
    shipTypeOptions.value = q
      ? shipTypeAll.filter((o) => o.label.toLowerCase().includes(q))
      : shipTypeAll;
  });
}

// FI pinned first in the generated list (spec 0041)
const countryAll = COUNTRIES.map((c) => ({
  label: codeLabel(c.name, c.code),
  value: c.code,
}));
const countryOptions = ref(countryAll);

function filterCountries(input: string, update: (fn: () => void) => void): void {
  const q = input.trim().toLowerCase();
  update(() => {
    countryOptions.value = q
      ? countryAll.filter((o) => o.label.toLowerCase().includes(q))
      : countryAll;
  });
}

// Ship registries for the NOA (annex V of 2009/42/EC, spec 0088): FI00 first
const registryAll = [...SHIP_REGISTRIES]
  .sort((a, b) => (a.code === 'FI00' ? -1 : b.code === 'FI00' ? 1 : 0))
  .map((r) => ({ label: codeLabel(r.name, r.code), value: r.code }));
const registryOptions = ref(registryAll);

// Ports from our port list (platform.location, worldwide, spec 0051): a lookup from two letters
const portOptions = ref<{ label: string; value: string }[]>([]);
const portNames = reactive<Record<string, string | null>>({});
function portWords(code: string): string {
  const name = portNames[code];
  return name ? codeLabel(name, code) : code;
}
function filterPorts(input: string, update: (fn: () => void) => void, abort: () => void): void {
  const term = input.trim();
  if (term.length < 2) {
    update(() => {
      portOptions.value = [];
    });
    return;
  }
  auth
    .searchPorts(term)
    .then((ports) =>
      update(() => {
        for (const p of ports) portNames[p.locode] = p.name;
        portOptions.value = ports.map((p) => ({ label: p.name ? codeLabel(p.name, p.locode) : p.locode, value: p.locode }));
      }),
    )
    .catch(() => abort());
}

function filterRegistries(input: string, update: (fn: () => void) => void): void {
  const q = input.trim().toLowerCase();
  update(() => {
    registryOptions.value = q ? registryAll.filter((o) => o.label.toLowerCase().includes(q)) : registryAll;
  });
}

/** Form state: everything a string; '' = unset, booleans 'yes'/'no'. */
const particularFacts = computed(() => {
  const p = detailsTarget.value?.particulars;
  if (!p) return [];
  const rows: { label: string; value: string }[] = [];
  if (p.iceClass) {
    rows.push({
      label: 'Ice class',
      value: iceClassWords(p.iceClass),
    });
  }
  for (const f of P_FIELDS) {
    const v = p[f.key];
    if (v === undefined || typeof v === 'object') continue;
    let value = String(v);
    if (f.kind === 'type') value = codeLabel(shipTypeName(String(v)), String(v));
    else if (f.kind === 'nav') value = codeLabel(navigationTypeName(String(v)), String(v));
    else if (f.kind === 'country') value = codeLabel(countryName(String(v)), String(v));
    else if (f.kind === 'registry') value = codeLabel(registryName(String(v)), String(v));
    else if (f.kind === 'port') value = portWords(String(v));
    else if (f.kind === 'boolean') value = v ? 'Yes' : 'No';
    rows.push({ label: f.label, value });
  }
  return rows;
});

// Certificate expiry (spec 0020): warn 60 days out — renewals run months
// ahead in practice. yyyy-mm-dd strings compare lexicographically.
const WARN_DAYS = 60;

function todayIso(): string {
  return new Date().toLocaleDateString('sv-SE'); // local, yyyy-mm-dd
}

function effectiveExpiry(c: ShipCertificate | CertFormRow): string | null {
  return ('extendedUntil' in c ? c.extendedUntil : null) || c.expiryDate || null;
}

function daysUntil(iso: string): number {
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}

function certChip(c: ShipCertificate): { tone: PillTone; icon: string; words: string } {
  const e = effectiveExpiry(c);
  if (!e) return { tone: 'gray', icon: 'help_outline', words: 'no expiry date' };
  if (e < todayIso()) return { tone: 'red', icon: 'error_outline', words: 'expired' };
  const d = daysUntil(e);
  if (d <= WARN_DAYS) {
    return { tone: 'amber', icon: 'schedule', words: `expires in ${d} d` };
  }
  return { tone: 'green', icon: 'verified', words: 'valid' };
}

function certStatusOf(v: Ship): { tone: PillTone; icon: string; words: string } | null {
  const dated = v.certificates
    .map(effectiveExpiry)
    .filter((e): e is string => !!e);
  if (v.certificates.length === 0) return null;
  if (dated.length === 0) {
    return { tone: 'gray', icon: 'help_outline', words: 'no expiry dates' };
  }
  const today = todayIso();
  if (dated.some((e) => e < today)) {
    return { tone: 'red', icon: 'error_outline', words: 'expired' };
  }
  const soonest = dated.reduce((a, b) => (a < b ? a : b));
  const d = daysUntil(soonest);
  if (d <= WARN_DAYS) {
    return { tone: 'amber', icon: 'schedule', words: `expires in ${d} d` };
  }
  return { tone: 'green', icon: 'verified', words: `valid · until ${soonest}` };
}

const columns: QTableColumn<Ship>[] = [
  {
    name: 'ship',
    label: 'Ship',
    align: 'left',
    field: (r) => (r.name ?? '').toLowerCase(),
    sortable: true,
  },
  { name: 'imo', label: 'IMO', align: 'left', field: (r) => r.imoNumber ?? '', sortable: true },
  { name: 'mmsi', label: 'MMSI', align: 'left', field: (r) => r.mmsi ?? '', sortable: true },
  { name: 'status', label: 'In NEMO', align: 'left', field: (r) => nemoPill(r).label, sortable: true },
  {
    name: 'certs',
    label: 'Certificates',
    align: 'left',
    field: (r) =>
      r.certificates.map(effectiveExpiry).filter(Boolean).sort()[0] ?? '~',
    sortable: true,
  },
  { name: 'updated', label: 'Updated', align: 'left', field: 'updated', sortable: true },
  { name: 'actions', label: '', align: 'right', field: () => '' },
];

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return ships.value;
  return ships.value.filter((v) =>
    [
      v.name ?? '',
      v.imoNumber ?? '',
      v.mmsi ?? '',
      v.callSign ?? '',
      v.isActive ? 'active' : 'inactive',
      certStatusOf(v)?.words ?? '',
      v.certificates.map((c) => `${c.typeCode} ${certificateName(c.typeCode)}`).join(' '),
    ]
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
});

const detailFacts = computed(() => {
  const v = detailsTarget.value;
  if (!v) return [];
  return [
    { label: 'In your fleet', value: v.fleet ? `since ${fmtDate(v.fleet.since)} · added by ${v.fleet.addedBy}` : 'no' },
    { label: 'On the master list', value: `since ${fmtDate(v.created)} · registered by ${v.addedBy}` },
    { label: 'Updated', value: fmtDate(v.updated) },
  ];
});

// ---- the field ledger (spec 0061) -----------------------------------------

/** The newest push across the org's ships — the feed's heartbeat. */
const lastIngest = computed(() => {
  let best: { source: string; receivedAt: string } | null = null;
  for (const v of ships.value) {
    if (v.lastIngest && (!best || v.lastIngest.receivedAt > best.receivedAt)) best = v.lastIngest;
  }
  return best;
});

type LedgerKind = PFieldDef['kind'] | 'ice';

interface LedgerField {
  key: string;
  label: string;
  kind: LedgerKind;
  /** Always shown, red when empty: the FI profile requires it. */
  required: boolean;
}

/**
 * The eight SHP elements the FI profile requires
 * (vendor/nemo/hub/fi-required.json, spec 0036), by wire key — plus the
 * ship's identity, which every declaration carries, and the four ship
 * items every NOA carries (spec 0088 amendment).
 */
const FI_REQUIRED_SHIP_KEYS = new Set([
  'name',
  'imoNumber',
  'mmsi',
  'callSign',
  'ownerName', // DE-007-10 registered owner
  'operatorName', // DE-007-16 lessee
  'iceClass', // DE-009-03
  'buildDate', // DE-009-04
  'keelLayingDate', // DE-009-05
  'inertGasSystem', // DE-009-17
  'mainEnginePower', // DE-010-06
  'openWaterSpeedMeasure', // DE-010-22 operational speed
  // The NOA's ship items (spec 0088 amendment): every arrival needs them
  'typeCode', // DE-005-16 ship type
  'flagState', // DE-005-09 flag state
  'registryCode', // DE-005-10 ship registry (annex V, e.g. FI00)
  'registryPort', // DE-005-12 port of registry
  // …and its tonnages and dimensions: NEMO refuses the NOA without them while
  // its ship database lacks them (ERR-029, live 2026-10-06), so they are asked
  // for up front — always shown, red when empty
  'length', // DE-008-25 length overall
  'width', // DE-008-13 breadth
  'grossWeight', // DE-008-27 gross tonnage
  'netWeight', // DE-008-28 net tonnage
  'dwt', // DE-008-29 deadweight
]);

/** Never cleared from the ledger: the name, and the IMO number — the hull's identity (spec 0077). */
const IDENTITY_KEPT = new Set(['name', 'imoNumber']);
/** Only the registering organisation changes the IMO number (spec 0068). */
const IMO_LOCKED_WORDS = 'Only the organisation that registered the ship changes its IMO number';

const LEDGER_FIELDS: LedgerField[] = [
  { key: 'name', label: 'Name', kind: 'text' as LedgerKind },
  { key: 'imoNumber', label: 'IMO number', kind: 'text' as LedgerKind },
  { key: 'mmsi', label: 'MMSI', kind: 'text' as LedgerKind },
  { key: 'callSign', label: 'Call sign', kind: 'text' as LedgerKind },
  { key: 'iceClass', label: 'Ice class', kind: 'ice' as LedgerKind },
  ...P_FIELDS,
].map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: FI_REQUIRED_SHIP_KEYS.has(f.key) }));

interface ExternalCell {
  source: string;
  value: unknown;
  occurredAt: string;
  receivedAt: string;
}

/**
 * The External column shows a value typed onto the shared record as source
 * "master list" (spec 0068). For editing it is ours, not a system's: the
 * override box shows it and an edit changes the shared value (spec 0071).
 */
const MASTER_SOURCE = 'master list';

/** The External cell that came from a system — a source that can hold a value back (spec 0061 rule 1). */
function systemExternalOf(v: Ship, key: string): ExternalCell | null {
  const cell = latestExternalOf(v, key);
  return cell && cell.source !== MASTER_SOURCE ? cell : null;
}

/** The External column for a field: the master list's resolved value, as the server ranked it (spec 0068). */
function latestExternalOf(v: Ship, key: string): ExternalCell | null {
  const cell = v.external?.[key];
  if (!cell) return null;
  return { source: cell.source, value: cell.value, occurredAt: cell.occurredAt, receivedAt: cell.receivedAt };
}

function resolvedOf(v: Ship, key: string): unknown {
  if (key === 'name') return v.name;
  if (key === 'imoNumber') return v.imoNumber;
  if (key === 'mmsi') return v.mmsi;
  if (key === 'callSign') return v.callSign;
  return v.particulars[key];
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function fmtField(kind: LedgerField['kind'], value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (kind === 'ice') return iceClassWords(value as ShipIceClass);
  const s = String(value);
  if (kind === 'type') return codeLabel(shipTypeName(s), s);
  if (kind === 'nav') return codeLabel(navigationTypeName(s), s);
  if (kind === 'country') return codeLabel(countryName(s), s);
  if (kind === 'registry') return codeLabel(registryName(s), s);
  if (kind === 'port') return portWords(s);
  if (kind === 'boolean') return value ? 'Yes' : 'No';
  return s;
}

interface LedgerRow {
  key: string;
  label: string;
  kind: LedgerKind;
  required: boolean;
  external: { text: string; source: string; when: string } | null;
  hasOverride: boolean;
  overrideMeta: { author: string; when: string } | null;
  resolved: string;
  missing: boolean;
  originWords: string;
  differs: boolean;
  clearable: boolean;
  /** The box cannot be edited by this organisation (the IMO number of a ship it did not register). */
  locked: boolean;
  lockedWords: string;
  /** Red words under To NEMO: a value NEMO would refuse (the IMO check digit, spec 0077). */
  problem: string | null;
  /** NEMO's value for the field (spec 0064), formatted; null when NEMO has none. */
  inNemo: string | null;
  nemoState: NemoState;
  /** The NEMO code column (spec 0070, renamed 0086): the element id and the report that carries the field. */
  nemoId: string;
  nemoHome: string;
}

/** The report under the NEMO ID: sent with the ship data, kept here, or travelling with the notices. */
function homeWords(home: ShipFieldId | undefined): string {
  if (!home) return '';
  if (home.sent) return home.formality;
  if (home.formality === 'NOA') return 'with NOA / NOD';
  return `${home.formality} · stays here`;
}

/** How the In NEMO cell relates to To NEMO (spec 0064 rule 2). */
type NemoState = 'unread' | 'same' | 'differs' | 'absent' | 'only';

function nemoStateWords(state: NemoState): string {
  switch (state) {
    case 'unread':
      return 'not read yet';
    case 'differs':
      return 'differs from To NEMO';
    case 'absent':
      return 'not in NEMO';
    case 'only':
      return 'only in NEMO';
    default:
      return 'same';
  }
}

/** Compare a NEMO value with ours: ice class by code, everything else by value. */
function nemoSame(kind: LedgerKind, ours: unknown, theirs: unknown): boolean {
  if (kind === 'ice') {
    return (ours as ShipIceClass | undefined)?.code === (theirs as ShipIceClass | undefined)?.code;
  }
  if (typeof ours === 'string' && typeof theirs === 'string') {
    return ours.trim().toUpperCase() === theirs.trim().toUpperCase();
  }
  return sameValue(ours, theirs);
}

function overrideMeta(o: ShipOverride): { author: string; when: string } {
  return { author: o.author, when: fmtWhen(o.at) };
}

const ledgerRows = computed<LedgerRow[]>(() => {
  const v = detailsTarget.value;
  if (!v) return [];
  const rows: LedgerRow[] = [];
  for (const f of LEDGER_FIELDS) {
    const external = latestExternalOf(v, f.key);
    const override = v.overrides?.[f.key];
    const resolved = resolvedOf(v, f.key);
    const hasResolved = resolved !== undefined && resolved !== null && resolved !== '';
    const nemoValue = v.nemo && f.key in v.nemo.fields ? v.nemo.fields[f.key] : undefined;
    const hasNemo = nemoValue !== undefined && nemoValue !== null && nemoValue !== '';
    if (!showAllFields.value && !f.required && !external && !override && !hasResolved && !hasNemo) continue;
    const nemoState: NemoState = !v.nemo
      ? 'unread'
      : hasNemo && hasResolved
        ? nemoSame(f.kind, resolved, nemoValue)
          ? 'same'
          : 'differs'
        : hasNemo
          ? 'only'
          : hasResolved
            ? 'absent'
            : 'same';
    rows.push({
      inNemo: hasNemo ? fmtField(f.kind, nemoValue) : null,
      nemoState,
      nemoId: v.nemoIds?.[f.key]?.de ?? '—',
      nemoHome: homeWords(v.nemoIds?.[f.key]),
      key: f.key,
      label: f.label,
      kind: f.kind,
      required: f.required,
      external: external
        ? { text: fmtField(f.kind, external.value), source: external.source, when: fmtWhen(external.receivedAt) }
        : null,
      hasOverride: !!override,
      overrideMeta: override ? overrideMeta(override) : null,
      // To NEMO is what is sent: the ship name goes in upper case (server nemoShipName, NEMO ERR-027)
      resolved: f.key === 'name' && typeof resolved === 'string' ? resolved.trim().toUpperCase() : fmtField(f.kind, resolved),
      missing: f.required && !hasResolved,
      originWords: override
        ? 'override'
        : external
          ? `from ${external.source}`
          : hasResolved
            ? 'entered here'
            : '',
      differs: !!override && !!external && !sameValue(override.value, external.value),
      // X drops an override (back to the source) or clears a value no system
      // supplied; the name and the IMO number are never cleared.
      // Only an override is cleared — back to External (spec 0086)
      clearable: !!override,
      locked: f.key === 'imoNumber' && !v.own,
      lockedWords: f.key === 'imoNumber' && !v.own ? IMO_LOCKED_WORDS : '',
      // A synced number that fails its check digit is shown, never sent silently (spec 0077).
      problem:
        f.key === 'imoNumber' && hasResolved && !imoValid(String(resolved)) ? imoWords(String(resolved)) : null,
    });
  }
  return rows;
});

// ---- inline editing of the Override column --------------------------------

/** What the editor shows: the override, else our own value when no source has one. */
/** The In NEMO column and its refresh (spec 0064) — hidden since NEMO's ship record cannot be read back by API users (open q 35, spec 0086). */
const SHOW_IN_NEMO = false;

const drafts = reactive<Record<string, string | number>>({});
const busy = ref<string | null>(null);

function draftFrom(kind: LedgerKind, value: unknown): string | number {
  if (value === undefined || value === null) return '';
  if (kind === 'ice') return (value as ShipIceClass).code ?? '';
  if (kind === 'boolean') return value ? 'yes' : 'no';
  if (kind === 'number') return typeof value === 'number' ? value : '';
  return String(value);
}

function resetDrafts(): void {
  for (const key of Object.keys(drafts)) delete drafts[key];
  const v = detailsTarget.value;
  if (!v) return;
  for (const f of LEDGER_FIELDS) {
    const override = v.overrides?.[f.key];
    const external = systemExternalOf(v, f.key);
    // The override column holds only an override (spec 0086); with a value
    // External shows it, empty the field is where one is typed
    drafts[f.key] = override ? draftFrom(f.kind, override.value) : '';
    void external;
  }
  for (const c of v.certificates) {
    const key = certExpiryKeyOf(c);
    const override = v.overrides?.[key];
    const external = systemExternalOf(v, key);
    // No source asserts an expiry: the date is the certificate's own, edited here
    drafts[key] = override ? String(override.value ?? '') : external ? '' : (c.expiryDate ?? '');
  }
}
watch(detailsTarget, resetDrafts, { immediate: true });

/** The editor's text back into a wire value; '' means "no value". */
function valueFrom(kind: LedgerKind, raw: unknown, current: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return null;
  if (kind === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'boolean') return raw === 'yes';
  if (kind === 'ice') {
    const rest = current && typeof current === 'object' ? (current as ShipIceClass) : undefined;
    return { ...(rest ?? {}), code: String(raw) };
  }
  return String(raw).trim() || null;
}

function optionsFor(kind: LedgerKind) {
  if (kind === 'type') return shipTypeOptions.value;
  if (kind === 'nav') return navOptions;
  if (kind === 'country') return countryOptions.value;
  if (kind === 'registry') return registryOptions.value;
  if (kind === 'port') return portOptions.value;
  if (kind === 'ice') return iceOptions;
  if (kind === 'boolean') return BOOL_OPTIONS.filter((o) => o.value !== '');
  return [];
}

/** q-select filter handlers for the searchable kinds; the others never filter. */
const filterHandlers: Partial<
  Record<LedgerKind, (input: string, update: (fn: () => void) => void, abort: () => void) => void>
> = { type: filterShipTypes, country: filterCountries, registry: filterRegistries, port: filterPorts };

function draftDate(r: LedgerRow, v: string): void {
  drafts[r.key] = v;
  void commitField(r);
}

async function reloadTarget(id: string): Promise<void> {
  changedInPlace = true;
  await refresh();
  detailsTarget.value = ships.value.find((s) => s.id === id) ?? null;
}

/** The details dialog's Save: the field being typed in commits on blur,
    then the dialog closes once every save has landed. */
const savingDetails = ref(false);
async function saveDetails(): Promise<void> {
  savingDetails.value = true;
  try {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
    await nextTick();
    // Let the blur's save start, then wait for it (and any other) to finish
    for (let i = 0; i < 100 && busy.value !== null; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await nextTick();
    if (busy.value === null) detailsDialog.value = false;
  } finally {
    savingDetails.value = false;
  }
}

async function run(key: string, work: () => Promise<void>, failure: string): Promise<void> {
  busy.value = key;
  try {
    await work();
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : failure });
  } finally {
    busy.value = null;
  }
}

/** When the In NEMO column was last read (spec 0064 rule 3). */
const nemoReadWords = computed(() => {
  const n = detailsTarget.value?.nemo;
  if (!n) return 'In NEMO: not read yet';
  return n.shipId ? `In NEMO as of ${fmtWhen(n.at)}` : `Not in NEMO (checked ${fmtWhen(n.at)})`;
});

function refreshNemo(): Promise<void> {
  const v = detailsTarget.value;
  if (!v) return Promise.resolve();
  return run('nemo', () => auth.refreshShipFromNemo(v.id).then(() => reloadTarget(v.id)),
    'Could not read the ship from NEMO.');
}

function useSource(field: string): Promise<void> {
  const v = detailsTarget.value;
  if (!v) return Promise.resolve();
  return run(field, () => auth.useShipSource(v.id, field).then(() => reloadTarget(v.id)),
    'Could not use the source value.');
}

/** Save one field of the Data table: an override when a source has a value, ours otherwise. */
function commitField(r: LedgerRow): Promise<void> {
  const v = detailsTarget.value;
  if (!v) return Promise.resolve();
  // Against the override when there is one, else against nothing — an empty
  // field means "no override", never "clear the value" (spec 0086)
  const system = latestExternalOf(v, r.key);
  const current = r.hasOverride ? v.overrides[r.key]?.value : system ? undefined : resolvedOf(v, r.key);
  const value = valueFrom(r.kind, drafts[r.key], resolvedOf(v, r.key));
  if (sameValue(value, current ?? null)) return Promise.resolve();
  if (value === null) {
    // Emptied: back to the source when there is one, otherwise cleared.
    if (r.hasOverride) return useSource(r.key);
    if (system || IDENTITY_KEPT.has(r.key)) return Promise.resolve();
  }
  if (r.key === 'imoNumber' && !imoValid(String(value))) {
    // Refused here as NEMO would refuse it (spec 0077); the draft goes back to the value.
    $q.notify({ type: 'negative', message: imoWords(String(value)), timeout: 8000 });
    drafts[r.key] = String(resolvedOf(v, r.key) ?? '');
    return Promise.resolve();
  }
  const input: ShipInput =
    r.key === 'name' || r.key === 'imoNumber' || r.key === 'mmsi' || r.key === 'callSign'
      ? { [r.key]: value as string | null }
      : { particulars: { [r.key]: value as string | number | boolean | ShipIceClass | null } };
  return run(r.key, () => auth.updateShip(v.id, input).then(() => reloadTarget(v.id)),
    'Could not save the field.');
}

function clearField(r: LedgerRow): Promise<void> {
  if (r.hasOverride) return useSource(r.key);
  drafts[r.key] = '';
  return commitField(r);
}

// ---- certificates in the same three columns -------------------------------

interface CertRow {
  key: string;
  typeCode: string;
  certificateId: string | null;
  detail: string;
  external: { text: string; source: string; when: string } | null;
  hasOverride: boolean;
  overrideMeta: { author: string; when: string } | null;
  superseded: boolean;
  resolved: string | null;
  chip: { tone: PillTone; icon: string; words: string };
  originWords: string;
  differs: boolean;
  clearable: boolean;
  cert: ShipCertificate;
  /** The To NEMO date in words, coloured by how near it is (spec 0086 amendment). */
  expiry: { words: string; tone: 'plain' | 'soon' | 'expired' | 'none' };
  /** NEMO's certificate of the same type (spec 0065): its expiry, formatted; null when NEMO has none. */
  inNemo: string | null;
  nemoState: NemoState;
}

function certExpiryKeyOf(c: ShipCertificate): string {
  return `cert:${c.typeCode}:${c.certificateId ?? ''}:expiryDate`;
}

const certRows = computed<CertRow[]>(() => {
  const v = detailsTarget.value;
  if (!v) return [];
  return v.certificates.map((c) => {
    const key = certExpiryKeyOf(c);
    const external = latestExternalOf(v, key);
    const externalText = external && typeof external.value === 'string' ? external.value : null;
    const override = v.overrides?.[key];
    const superseded = !!override?.superseded;
    const detail = [
      c.certificateId ? `No. ${c.certificateId}` : '',
      c.issueDate ? `issued ${c.issueDate}` : '',
      c.issuer ?? '',
    ]
      .filter(Boolean)
      .join(' · ');
    // NEMO keeps one certificate per type, so the type is the match
    const nemoCert = v.nemo?.certificates.find((n) => n.typeCode === c.typeCode) ?? null;
    const ours = effectiveExpiry(c);
    const nemoState: NemoState = !v.nemo
      ? 'unread'
      : !nemoCert
        ? 'absent'
        : (nemoCert.expiryDate ?? null) === (ours ?? null)
          ? 'same'
          : 'differs';
    return {
      inNemo: nemoCert ? (nemoCert.expiryDate ? `expires ${nemoCert.expiryDate}` : 'on file, no expiry date') : null,
      nemoState,
      key,
      cert: c,
      expiry: expiryOf(effectiveExpiry(c)),
      typeCode: c.typeCode,
      certificateId: c.certificateId,
      detail,
      external:
        external && externalText
          ? { text: externalText, source: external.source, when: fmtWhen(external.receivedAt) }
          : null,
      hasOverride: !!override,
      overrideMeta: override ? overrideMeta(override) : null,
      superseded,
      resolved: effectiveExpiry(c),
      chip: certChip(c),
      originWords: superseded
        ? `from ${external?.source} — override disregarded`
        : override
          ? 'override'
          : external
            ? `from ${external.source}`
            : c.expiryDate
              ? 'entered here'
              : '',
      differs: !!override && !!external && !sameValue(override.value, external.value),
      clearable: !!override,
    };
  });
});

/** "Expires …", "Expiring soon …" (amber) or "Expired …" (red). */
function expiryOf(e: string | null): CertRow['expiry'] {
  if (!e) return { words: 'No expiry date', tone: 'none' };
  if (e < todayIso()) return { words: `Expired ${e}`, tone: 'expired' };
  if (daysUntil(e) <= WARN_DAYS) return { words: `Expiring soon ${e}`, tone: 'soon' };
  return { words: `Expires ${e}`, tone: 'plain' };
}

/** The one certificate open for editing under its row (spec 0086 amendment). */
const openCertKey = ref<string | null>(null);

function toggleCert(r: CertRow): void {
  if (openCertKey.value === r.key) {
    closeOpenCert();
    return;
  }
  certAddOpen.value = false;
  openEditCert(r);
  openCertKey.value = r.key;
}

function closeOpenCert(): void {
  openCertKey.value = null;
  Object.assign(certForm, { ...EMPTY_CERT });
}

/** Every field the CRT sends for a certificate, with its NEMO code (vendor/nemo/hub/de-index.json). */
type CertEdit = 'description' | 'issuerType' | 'issuerCountry' | 'issuerId' | 'issuer' | 'issueDate' | 'expiryDate';

/**
 * Every field the CRT sends for a certificate, with its NEMO code
 * (vendor/nemo/hub/de-index.json) and what edits it in the open row: type and
 * number are the certificate's identity; an issuer field the issuer type does
 * not need is not sent.
 */
function certFieldsOf(c: ShipCertificate): { label: string; value: string; de: string; note?: string; edit?: CertEdit; fixed?: string }[] {
  const issuerType = ISSUER_TYPES.find((t) => t.code === c.issuerTypeCode);
  const files = certFiles.value[certKeyOfCert(c)] ?? [];
  const needs = issuerNeeds.value;
  const notNeeded = 'not for this issuer type';
  return [
    { label: 'Type', value: codeLabel(certificateName(c.typeCode), c.typeCode), de: 'DE-006-01', fixed: 'the certificate itself' },
    { label: 'Number', value: c.certificateId ?? '', de: 'DE-006-03', fixed: 'the certificate itself' },
    { label: 'Description', value: c.description ?? '', de: 'DE-006-04', edit: 'description' },
    { label: 'Issuer type', value: issuerType ? codeLabel(issuerType.name, issuerType.code) : c.issuerTypeCode ?? '', de: 'DE-006-06', edit: 'issuerType' },
    { label: 'Issuer flag state', value: c.issuerCountry ? codeLabel(countryName(c.issuerCountry), c.issuerCountry) : '', de: 'DE-006-07', ...(needs === 'country' ? { edit: 'issuerCountry' as const } : { fixed: notNeeded }) },
    { label: 'Issuer', value: c.issuerId ? codeLabel(certificateIssuerName(c.issuerId), c.issuerId) : '', de: 'DE-006-08', ...(needs === 'id' ? { edit: 'issuerId' as const } : { fixed: notNeeded }) },
    { label: 'Issuer name', value: c.issuer ?? '', de: 'DE-006-09', ...(needs === 'name' ? { edit: 'issuer' as const } : { fixed: notNeeded }) },
    { label: 'Issue date', value: c.issueDate ?? '', de: 'DE-006-10', edit: 'issueDate' },
    { label: 'Expiry date', value: c.expiryDate ?? '', de: 'DE-006-11', edit: 'expiryDate' },
    { label: 'Extended until', value: c.extendedUntil ?? '', de: 'DE-006-16', fixed: 'from the source' },
    {
      label: 'Files',
      value: files.map((f) => f.fileName).join(', '),
      de: 'ATT-037',
      note: files.length ? 'attached to the CRT' : 'NEMO requires the certificate file',
      fixed: 'Attach file, above',
    },
  ];
}

function certsPayloadOf(certs: ShipCertificate[]): ShipCertificateInput[] {
  return certs.map((c) => ({
    typeCode: c.typeCode,
    ...(c.certificateId ? { certificateId: c.certificateId } : {}),
    ...(c.issueDate ? { issueDate: c.issueDate } : {}),
    ...(c.expiryDate ? { expiryDate: c.expiryDate } : {}),
    ...(c.extendedUntil ? { extendedUntil: c.extendedUntil } : {}),
    ...(c.description ? { description: c.description } : {}),
    ...(c.issuer ? { issuer: c.issuer } : {}),
    ...(c.issuerTypeCode ? { issuerTypeCode: c.issuerTypeCode } : {}),
    ...(c.issuerId ? { issuerId: c.issuerId } : {}),
    ...(c.issuerCountry ? { issuerCountry: c.issuerCountry } : {}),
  }));
}

/** Save one certificate's expiry: the whole set travels (spec 0020), only that date changes. */
function commitCert(r: CertRow): Promise<void> {
  const v = detailsTarget.value;
  if (!v) return Promise.resolve();
  const date = String(drafts[r.key] ?? '') || null;
  const system = systemExternalOf(v, r.key);
  const current = r.hasOverride
    ? (v.overrides[r.key]?.value as string | null)
    : system
      ? null
      : r.resolved;
  if ((date ?? null) === (current ?? null)) return Promise.resolve();
  if (date === null) {
    if (r.hasOverride) return useSource(r.key);
    if (system) return Promise.resolve();
  }
  const certificates = certsPayloadOf(
    v.certificates.map((c) =>
      c.typeCode === r.typeCode && (c.certificateId ?? null) === r.certificateId
        ? { ...c, expiryDate: date }
        : c,
    ),
  );
  return run(r.key, () => auth.updateShip(v.id, { certificates }).then(() => reloadTarget(v.id)),
    'Could not save the expiry date.');
}

function clearCert(r: CertRow): Promise<void> {
  if (r.hasOverride) return useSource(r.key);
  drafts[r.key] = '';
  return commitCert(r);
}

function draftCertDate(r: CertRow, v: string): void {
  drafts[r.key] = v;
  void commitCert(r);
}

function fmtDate(iso: string): string {
  return fmtDay(iso);
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    ships.value = await auth.listShips();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load ships.' });
  } finally {
    loading.value = false;
  }
}

function openDetails(v: Ship): void {
  detailsTarget.value = v;
  detailsDialog.value = true;
}

/** The registrar may correct the IMO number (spec 0068); everyone else sees it. */
/** Add a certificate: the whole set travels (spec 0020), shared master data (spec 0068). */
function saveNewCert(): Promise<void> {
  const v = detailsTarget.value;
  if (!v || !certForm.typeCode) return Promise.resolve();
  const needs = issuerNeeds.value;
  const edited: ShipCertificateInput = {
    typeCode: certForm.typeCode,
    ...(certForm.certificateId.trim() ? { certificateId: certForm.certificateId.trim() } : {}),
    ...(certForm.issueDate ? { issueDate: certForm.issueDate } : {}),
    ...(certForm.expiryDate ? { expiryDate: certForm.expiryDate } : {}),
    ...(certForm.issuerTypeCode ? { issuerTypeCode: certForm.issuerTypeCode } : {}),
    ...(needs === 'name' && certForm.issuer.trim() ? { issuer: certForm.issuer.trim() } : {}),
    ...(needs === 'id' && certForm.issuerId ? { issuerId: certForm.issuerId } : {}),
    ...(needs === 'country' && certForm.issuerCountry ? { issuerCountry: certForm.issuerCountry } : {}),
    ...(certForm.description.trim() ? { description: certForm.description.trim() } : {}),
  };
  // Editing replaces that certificate; adding appends — the whole set travels (spec 0020)
  const others = v.certificates.filter((c) => certKeyOfCert(c) !== certForm.editingKey);
  const kept = certForm.editingKey ? v.certificates.find((c) => certKeyOfCert(c) === certForm.editingKey) : undefined;
  const certificates: ShipCertificateInput[] = [
    ...certsPayloadOf(others),
    { ...(kept?.extendedUntil ? { extendedUntil: kept.extendedUntil } : {}), ...edited },
  ];
  return run(
    'cert-add',
    () =>
      auth.updateShip(v.id, { certificates }).then(() => reloadTarget(v.id)).then(() => {
        closeCertForm();
        openCertKey.value = null;
      }),
    'Could not save the certificate.',
  );
}

function openAddCert(): void {
  openCertKey.value = null;
  Object.assign(certForm, { ...EMPTY_CERT });
  certAddOpen.value = true;
}

function closeCertForm(): void {
  certAddOpen.value = false;
  Object.assign(certForm, { ...EMPTY_CERT });
}

/** Edit a certificate's details in the same form (spec 0084: the fields NEMO asks for). */
function openEditCert(r: CertRow): void {
  const c = detailsTarget.value?.certificates.find((x) => certKeyOfCert(x) === certKeyOfRow(r));
  if (!c) return;
  Object.assign(certForm, {
    typeCode: c.typeCode, certificateId: c.certificateId ?? '', issueDate: c.issueDate ?? '', expiryDate: c.expiryDate ?? '',
    issuer: c.issuer ?? '', issuerTypeCode: c.issuerTypeCode ?? '', issuerId: c.issuerId ?? '', issuerCountry: c.issuerCountry ?? '',
    description: c.description ?? '', editingKey: certKeyOfCert(c),
  });
}

// ---- certificate files (spec 0084): the copies the CRT carries ------------------
const certFiles = ref<Record<string, CertificateFile[]>>({});
const certFileInput = ref<HTMLInputElement | null>(null);
let certFileFor: string | null = null;

function certKeyOfCert(c: { typeCode: string; certificateId: string | null }): string {
  return `${c.typeCode}:${c.certificateId ?? ''}`;
}
function certKeyOfRow(r: CertRow): string {
  return certKeyOfCert(r);
}

async function loadCertFiles(shipId: string): Promise<void> {
  try {
    const out: Record<string, CertificateFile[]> = {};
    for (const f of await auth.listCertificateFiles(shipId)) (out[f.certKey] ??= []).push(f);
    certFiles.value = out;
  } catch {
    certFiles.value = {};
  }
}
watch(
  () => detailsTarget.value?.id,
  (id) => {
    if (id) void loadCertFiles(id);
  },
);

/** What NEMO will ask of this certificate before its CRT can go (mirrors the server, spec 0084). */
function certGapsOf(r: CertRow): string[] {
  const c = detailsTarget.value?.certificates.find((x) => certKeyOfCert(x) === certKeyOfRow(r));
  if (!c) return [];
  const gaps: string[] = [];
  if (!c.issueDate) gaps.push('issue date');
  const needs = ISSUER_TYPES.find((t) => t.code === c.issuerTypeCode)?.needs;
  if (!c.issuerTypeCode) gaps.push('issuer type');
  else if (needs === 'country' && !c.issuerCountry) gaps.push('issuer flag state');
  else if (needs === 'id' && !c.issuerId) gaps.push('issuer');
  else if (needs === 'name' && !c.issuer) gaps.push('issuer name');
  if ((c.typeCode === 'OTHER' || c.issuerTypeCode === '99') && !c.description) gaps.push('description');
  if (!(certFiles.value[certKeyOfCert(c)]?.length)) gaps.push('the certificate file');
  return gaps;
}

function pickCertFile(r: CertRow): void {
  certFileFor = certKeyOfRow(r);
  certFileInput.value?.click();
}

async function onCertFilePicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const v = detailsTarget.value;
  const key = certFileFor;
  if (!file || !v || !key) return;
  await run(`attach:${key}`, async () => {
    await auth.uploadCertificateFile(v.id, key, file);
    changedInPlace = true;
    await loadCertFiles(v.id);
  }, 'Could not add the file.');
}

function removeCertFile(fileId: string): void {
  const v = detailsTarget.value;
  if (!v) return;
  const file = Object.values(certFiles.value).flat().find((f) => f.id === fileId);
  askConfirm({
    title: 'Are you sure you want to remove this file?',
    message: `If you decide to remove “${file?.fileName ?? 'this file'}”, it will be permanently removed.`,
    label: 'Confirm',
  }, () => {
    void run(`file:${fileId}`, async () => {
      await auth.removeCertificateFile(v.id, fileId);
      changedInPlace = true;
      await loadCertFiles(v.id);
    }, 'Could not remove the file.');
  });
}

// ---- Shared Figma removal confirmation for files, certificates and fleet membership.
const confirmDialog = ref(false);
const confirmText = reactive({ title: '', message: '', label: '' });
let confirmAction: (() => void) | null = null;

function askConfirm(text: { title: string; message: string; label: string }, action: () => void): void {
  Object.assign(confirmText, text);
  confirmAction = action;
  confirmDialog.value = true;
}

function confirmed(): void {
  confirmDialog.value = false;
  const action = confirmAction;
  confirmAction = null;
  action?.();
}

function removeCert(r: CertRow): void {
  const v = detailsTarget.value;
  if (!v) return;
  askConfirm({
    title: 'Are you sure you want to remove this certificate?',
    message:
      `Delete ${r.typeCode} — ${certificateName(r.typeCode)} from ${v.name ?? 'this ship'}? ` +
      'Certificates are shared master data: every organisation sees the change.',
    label: 'Delete',
  }, () => {
    openCertKey.value = null;
    const certificates = certsPayloadOf(
      v.certificates.filter(
        (c) => !(c.typeCode === r.typeCode && (c.certificateId ?? null) === r.certificateId),
      ),
    );
    void run(`remove:${r.key}`, () => auth.updateShip(v.id, { certificates }).then(() => reloadTarget(v.id)),
      'Could not remove the certificate.');
  });
}

function openCreate(): void {
  form.name = '';
  form.imoNumber = '';
  form.mmsi = '';
  form.callSign = '';
  formDialog.value = true;
}

/** Create the master row and the fleet row (spec 0068); the ship dialog then opens for the rest. */
/** The IMO box refuses a number that fails its check digit, with the digit it should end in (spec 0077). */
function imoRule(value: string | null | undefined): true | string {
  const s = String(value ?? '').trim();
  return !s || imoValid(s) ? true : imoWords(s);
}

async function save(): Promise<void> {
  if (!form.name.trim()) return;
  if (form.imoNumber.trim() && !imoValid(form.imoNumber.trim())) {
    $q.notify({ type: 'negative', message: imoWords(form.imoNumber.trim()) });
    return;
  }
  saving.value = true;
  try {
    const input: ShipInput = { name: form.name.trim() };
    if (form.imoNumber.trim()) input.imoNumber = form.imoNumber.trim();
    if (form.mmsi.trim()) input.mmsi = form.mmsi.trim();
    if (form.callSign.trim()) input.callSign = form.callSign.trim();
    await auth.createShip(input);
    $q.notify({ type: 'positive', message: `${form.name.trim()} created.` });
    formDialog.value = false;
    await refresh();
    const created = ships.value.find(
      (s) => (input.imoNumber ? s.imoNumber === input.imoNumber : s.name === input.name),
    );
    if (created) openDetails(created);
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not create the ship.',
    });
  } finally {
    saving.value = false;
  }
}

function removeFromFleet(v: Ship): void {
  askConfirm({
    title: 'Are you sure you want to remove this ship from your fleet?',
    message: `Take ${v.name ?? 'this ship'} out of your fleet? The ship stays on the shared master list; your overrides are kept if you add it back.`,
    label: 'Remove',
  }, () => {
    toggling.value = v.id;
    void auth
      .removeShipFromFleet(v.id)
      .then(refresh)
      .catch((e: unknown) => {
        $q.notify({
          type: 'negative',
          message: e instanceof Error ? e.message : 'Could not remove the ship.',
        });
      })
      .finally(() => {
        toggling.value = null;
      });
  });
}

onMounted(async () => {
  await refresh();
  if (props.dialogOnly) {
    const ship = ships.value.find((s) => s.id === props.shipId);
    if (ship) openDetails(ship);
    else {
      $q.notify({ type: 'negative', message: 'The ship is not in your fleet' });
      emit('closed', false);
    }
    return;
  }
  // A port call's report panel links a ship row here (spec 0075): open
  // that ship's dialog — the five columns — then drop the query
  const wanted = route.query['ship'];
  if (typeof wanted === 'string') {
    const ship = ships.value.find((s) => s.id === wanted);
    if (ship) openDetails(ship);
    void router.replace({ query: { ...route.query, ship: undefined } });
  }
});
</script>

<style scoped>
.ships-table {
  background: white;
}
.ships-table :deep(th) {
  font-weight: 600;
  color: var(--nl-ink-2);
}
.ship-row {
  cursor: pointer;
}
.inactive-row {
  opacity: 0.65;
}
.actions-cell {
  white-space: nowrap;
}
.cert-title {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 12px;
  font-weight: 600;
  color: var(--nl-ink-2);
}
.cert-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--nl-line-row);
}
.cert-row:last-child {
  border-bottom: none;
}
.detail-row {
  display: flex;
  gap: 12px;
  padding: 4px 0;
  font-size: 14px;
}
.detail-label {
  color: var(--nl-ink-2);
  min-width: 90px;
}
.detail-label-wide {
  min-width: 170px;
}
.detail-value {
  color: var(--nl-ink);
}
.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--nl-ink-3);
  margin: 6px 0 4px;
}
/* The section card (spec 0044) carries the frame; the expansion stays bare */
.particulars-box {
  margin: -4px -6px;
}
.last-ingest {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

/* The field ledger (specs 0061 + 0064): field + four value columns on a desk, stacked on a phone */
/* For NEMO (spec 0084): what a certificate lacks, and its files */
/* The line under a certificate row: spans every column, one row of words */
.cert-extra {
  grid-column: 1 / -1;
  order: 99;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 16px;
}
.cert-extra:empty {
  display: none;
}
/* The To NEMO expiry: amber when near, red when gone */
.cert-expiry--soon {
  color: var(--nl-amber-text);
}
.cert-expiry--expired {
  color: var(--nl-red-text);
}
.cert-expiry--none {
  color: var(--nl-ink-3);
}
/* The CRT fields under an expanded certificate: the ledger's own columns */
.cert-fields {
  grid-column: 1 / -1;
  order: 100;
  display: grid;
  grid-template-columns: subgrid;
  row-gap: 2px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--nl-line);
}
.cert-actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  margin-top: 8px;
}
.cert-field {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  font-size: 12px;
}
.cert-gaps {
  display: block;
  font-size: 12px;
  color: var(--nl-amber-text);
}
.cert-files {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  margin-top: 2px;
}
.cert-file {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
}
.cert-file__link {
  color: var(--nl-primary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hidden {
  display: none;
}
.cert-add {
  padding: 10px 10px 6px;
  border: 1px dashed var(--nl-line);
  border-radius: 6px;
}
.ledger {
  border: 1px solid var(--nl-line);
  border-radius: 6px;
  overflow: hidden;
  font-size: 14px;
}
/* The override column is the widest and never narrower than a date with its
   icons; the reading columns share the rest (spec 0070 amendment) */
.ledger-head,
.ledger-row {
  display: grid;
  grid-template-columns: 0.9fr 1fr minmax(240px, 2.3fr) 1fr;
  gap: 8px;
  padding: 6px 10px;
  align-items: start;
}
/* The data ledger ends with the NEMO ID column (spec 0070) */
.ledger--ids .ledger-head,
.ledger--ids .ledger-row {
  grid-template-columns: 0.9fr 1fr minmax(220px, 1.7fr) 1.25fr 0.65fr;
}
.ledger-head {
  background: var(--nl-band);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--nl-ink-2);
}
.ledger-row {
  border-top: 1px solid var(--nl-line-row);
}
.ledger-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}
.ledger-cell--label {
  color: var(--nl-ink-2);
}
.ledger-meta {
  font-size: 12px;
  color: var(--nl-ink-3);
}
/* The time behind a source or an author: smaller and lighter than the name */
.ledger-when {
  font-size: 12px;
  opacity: 0.75;
  white-space: nowrap;
}
/* FIN fields / All fields: the side that is on reads in full ink */
.ledger-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--nl-ink-3);
}
.ledger-switch__side {
  cursor: pointer;
  user-select: none;
}
.ledger-switch__side--on {
  color: var(--nl-ink);
  font-weight: 600;
}
.ledger-edit {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ledger-input {
  flex: 1;
  min-width: 0;
}
.ledger-input :deep(.q-field__control),
.ledger-input :deep(.q-field__native),
.ledger-input :deep(.q-field__marginal) {
  min-height: 44px;
  height: 44px;
}
/* The dropdown component's box (Figma 557:7884), as in New port call:
   44px, the text 14px in, the chevron 9px from the right edge */
.ledger-input.q-field--outlined :deep(.q-field__control) {
  padding: 0 14px;
}
.ledger-input.q-select.q-field--outlined :deep(.q-field__control) {
  padding-right: 9px;
}
.ledger-input :deep(.q-field__bottom) {
  display: none;
}
.ledger-differs-text {
  color: var(--nl-amber-text);
}
/* What NEMO's screens show (spec 0065): quiet lines, amber for warnings */
.nemo-issue {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 14px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
}
.nemo-issue + .nemo-issue {
  margin-top: 4px;
}
.nemo-issue-link {
  margin-left: 6px;
  color: var(--nl-teal-dark);
  font-weight: 600;
}
.nemo-issue--info {
  background: var(--nl-gray-bg);
  color: var(--nl-ink-2);
}
.ledger-missing-text {
  color: var(--nl-red-text);
}
.ledger-row--missing .ledger-cell--label {
  color: var(--nl-red-text);
}
/* The Missing tag: the phone's only (see below) */
.ledger-tag {
  display: none;
}
@media (max-width: 640px) {
  .ledger-head {
    display: none;
  }
  /* The ship's fields as on the NOA facts (user 2026-11-06): the name as a
     field label, its tag under it, the source's value, the field 8px under
     — white with the usual line. No line heads, no author line, and the To
     NEMO line only for a problem the tag does not say */
  .ledger-tag {
    display: inline-flex;
    align-self: flex-start;
    margin-top: 8px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--nl-g-yellow);
    color: var(--nl-g-on-yellow);
    font-size: 12px;
    font-weight: 600;
  }
  .ledger-tag--nemo {
    background: var(--nl-g-blue);
    color: var(--nl-on-fill);
  }
  .ledger-row,
  .ledger--ids .ledger-row {
    grid-template-columns: 1fr;
    gap: 4px;
    padding: 8px 10px;
  }
  .ledger-cell--label {
    font-weight: 600;
    color: var(--nl-ink);
  }
  .ledger-cell:not(.ledger-cell--label)::before {
    content: attr(data-col);
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--nl-ink-3);
  }
  .ledger-row--field {
    gap: 8px;
    padding: 12px 0;
  }
  .ledger-row--field .ledger-cell--label {
    font-size: 14px;
    line-height: 18px;
    font-weight: 600;
    color: var(--text-200);
  }
  .ledger-row--field .ledger-cell::before {
    content: none;
  }
  .ledger-row--field .ledger-cell--empty,
  .ledger-row--field .ledger-cell--phone-off,
  .ledger-row--field .ledger-cell--edit > .ledger-meta {
    display: none;
  }
  .ledger-row--field .ledger-input :deep(.q-field__control) {
    background: var(--nl-g-white);
    box-shadow: none;
  }
  .ledger-row--field .ledger-input :deep(.q-field__control:before) {
    border-style: solid;
    border-color: var(--nl-g-field-line);
  }
  .ledger-row--field .ledger-input :deep(.q-field__native),
  .ledger-row--field .ledger-input :deep(.q-field__input) {
    font-weight: 500;
  }
}
</style>
