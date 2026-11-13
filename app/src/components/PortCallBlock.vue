<template>
  <!-- The whole block is a drop target, collapsed or expanded (spec 0049) -->
  <div
    class="call-wrap"
    :class="[`call-wrap--${layout}`, { 'call-wrap--muted': muted }]"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
  <!-- Folded: the row or card is one button; it opens the port call as a
       pop-up the size of Ship forms with All details on (user 2026-11-04),
       no dropdown -->
  <div
    v-if="!process"
    class="call-block"
    role="button"
    tabindex="0"
    :aria-label="`Open the port call: ${call.shipName ?? 'ship'}, ${call.portName ?? call.portLocode ?? 'no port'}`"
    @click="setOpen(true)"
    @keyup.enter.self="setOpen(true)"
    @keydown.space.self.prevent="setOpen(true)"
  >
    <div class="call-header">
        <div class="chead" :class="`chead--${layout}`">
          <div class="chead__status" :class="`chead__status--${timeStatus.tone}`">
            <span class="chead__dot" aria-hidden="true" />{{ timeStatus.words }}
          </div>
          <div class="chead__name">{{ call.shipName ?? '—' }}</div>
          <div class="chead__port">
            <div class="chead__port-name">{{ call.portName ?? call.portLocode ?? '—' }}</div>
            <div class="chead__route tnum">{{ placeLine }}</div>
          </div>
          <div class="chead__time chead__time--eta tnum">
            <span class="chead__time-tag">{{ call.ata ? 'ATA' : 'ETA' }}</span>
            <div>{{ datePart(call.ata ?? call.eta) }}</div>
            <div>{{ timePart(call.ata ?? call.eta) }}<span v-if="call.ata" class="chead__actual"> actual</span></div>
          </div>
          <div class="chead__time chead__time--etd tnum">
            <span class="chead__time-tag">{{ call.atd ? 'ATD' : 'ETD' }}</span>
            <div>{{ datePart(call.atd ?? call.etd) }}</div>
            <div>{{ timePart(call.atd ?? call.etd) }}<span v-if="call.atd" class="chead__actual"> actual</span></div>
          </div>
          <!-- The reports, in flow order; a chip with a wizard opens it -->
          <div class="chead__reports">
            <!-- Not in NEMO yet: the VID alone, yellow — the next thing to do,
                 and for an admin the way in (spec 0075) -->
            <button
              v-if="!vidSent && canCreateVid && !moored"
              type="button"
              class="vid-btn"
              :aria-label="`VID — ${stateWords(at('VID'))}. Send to NEMO`"
              @click.stop="openWizard('vid')"
              @keydown.enter.stop
              @keyup.enter.stop
              @keydown.space.stop
              @keyup.space.stop
            >
              <StatusPill
                :tone="chipTone(at('VID'))"
                :icon="chipIcon(at('VID'))"
                :label="chipLabel(at('VID'))"
                :size="pillSize"
              />
              <q-tooltip>Not in NEMO yet — create the port call in NEMO</q-tooltip>
            </button>
            <template v-else>
              <!-- A report with a wizard opens it straight from here (user rule
                   2026-09-26): VID, SID/SHP/CRT at the ship step, NOA -->
              <template v-for="(o, i) in shownChips" :key="o.code">
                <!-- On a card the departure reports start a row of their own (user 2026-10-31) -->
                <span v-if="layout === 'card' && i > 0 && i === departFrom" class="chead__break" aria-hidden="true" />
                <button
                  v-if="chipOpens(o.code)"
                  type="button"
                  class="vid-btn"
                  :aria-label="`${o.code} — ${stateWords(o, vidSent)}. Open ${wizardOf(o.code) ? 'Send to NEMO' : 'the report'}`"
                  @click.stop="openChip(o.code)"
                  @keydown.enter.stop
                  @keyup.enter.stop
                  @keydown.space.stop
                  @keyup.space.stop
                >
                  <StatusPill
                    :tone="chipTone(o, vidSent)"
                    :icon="chipIcon(o, vidSent)"
                    :label="chipLabel(o)"
                    :size="pillSize"
                  />
                  <q-tooltip>{{ o.title }} — {{ stateWords(o, vidSent) }}. Open {{ wizardOf(o.code) ? 'Send to NEMO' : 'the report' }}</q-tooltip>
                </button>
                <StatusPill
                  v-else
                  :tone="chipTone(o, vidSent)"
                  :icon="chipIcon(o, vidSent)"
                  :label="chipLabel(o)"
                  :size="pillSize"
                />
              </template>
              <!-- Over six reports in a row: five, then "+N" — a tap shows them
                   all and the row grows (Figma 401:8622, user 2026-11-02) -->
              <button
                v-if="hiddenChips > 0"
                type="button"
                class="more-pill"
                :aria-label="`Show ${hiddenChips} more reports`"
                @click.stop="chipsOpen = true"
                @keydown.enter.stop
                @keyup.enter.stop
                @keydown.space.stop
                @keyup.space.stop
              >+{{ hiddenChips }}</button>
            </template>
          </div>
          <!-- The deadline and its one urgent action (guide p. 4, 11): in a
               table row under the name, on a card a warning box after the pills.
               NEMO's refusals are named here too (user 2026-10-06). A moored
               call shows none of it (user 2026-11-02). -->
          <div v-if="!moored && (urgent || refusedCodes.length)" class="chead__due">
            <div v-if="urgent" class="chead__warn">
              <div class="chead__warn-title tnum">
                {{ urgent.code }} {{ urgent.asap ? 'due now' : shortDue(urgent) }}
                <q-tooltip max-width="320px">{{ dueTooltip(urgent) }}</q-tooltip>
              </div>
              <div class="chead__warn-text">{{ dueSentence(urgent) }}<template v-if="!vidSent"> Send the VID first.</template></div>
              <button
                v-if="urgentAction"
                type="button"
                class="chead__urgent"
                @click.stop="urgentAction.run()"
                @keydown.enter.stop
                @keyup.enter.stop
                @keydown.space.stop
                @keyup.space.stop
              >
                {{ urgentAction.label }}
              </button>
            </div>
            <button
              v-if="refusedCodes.length"
              type="button"
              class="head-errors__btn"
              :aria-label="`NEMO refused ${refusedCodes.join(', ')} — open the call to fix and send again`"
              @click.stop="setOpen(true)"
              @keydown.enter.stop
              @keyup.enter.stop
              @keydown.space.stop
              @keyup.space.stop
            >
              <q-icon name="warning" size="16px" />
              <span>NEMO refused {{ refusedCodes.join(', ') }}</span>
              <q-tooltip>Open the call and tap the red report to fix and send again</q-tooltip>
            </button>
          </div>
          <!-- A card's facts (Figma reference 266:8298, at 14px): port, route,
               ETA and ETD, a label column and a hairline under each row -->
          <dl v-if="layout === 'card'" class="chead__facts">
            <div class="chead__fact">
              <dt>Port</dt>
              <dd>{{ call.portName ?? call.portLocode ?? '—' }}</dd>
            </div>
            <div class="chead__fact">
              <dt>Route</dt>
              <dd class="tnum">{{ placeLine || '—' }}</dd>
            </div>
            <div class="chead__fact">
              <dt>{{ call.ata ? 'ATA' : 'ETA' }}</dt>
              <dd class="chead__fact-time tnum">
                <span>{{ datePart(call.ata ?? call.eta) }}</span><span>{{ timePart(call.ata ?? call.eta) }}</span>
              </dd>
            </div>
            <div class="chead__fact">
              <dt>{{ call.atd ? 'ATD' : 'ETD' }}</dt>
              <dd class="chead__fact-time tnum">
                <span>{{ datePart(call.atd ?? call.etd) }}</span><span>{{ timePart(call.atd ?? call.etd) }}</span>
              </dd>
            </div>
          </dl>
          <!-- The one next thing (spec 0092): the report the server names next,
               as a button when it has a wizard and you may send, else in words;
               under it how far the flow has come -->
          <div v-if="SHOW_NEXT_ACTION && nextOb" class="head-act">
            <button
              v-if="nextAction"
              type="button"
              class="act-btn"
              :class="{ 'act-btn--create': nextOb.code === 'VID' }"
              :aria-label="`${nextAction.verb} — ${nextAction.state}`"
              @click.stop="openWizardFor(nextOb.code)"
              @keydown.enter.stop
              @keyup.enter.stop
              @keydown.space.stop
              @keyup.space.stop
            >
              <span class="act-btn__verb">{{ nextAction.verb }}</span>
              <span class="act-btn__state" :class="`act-btn__state--${nextOb.dueState}`">{{ nextAction.state }}</span>
              <q-icon name="arrow_forward" size="16px" />
            </button>
            <span v-else class="act-next">
              Next: <b>{{ nextOb.title }}</b> · {{ nextOb.code }}<template v-if="nextOb.dueAt">
                · <span :class="`act-next--${nextOb.dueState}`">{{ shortDue(nextOb) }}</span></template>
            </span>
            <!-- The bar, a phone's (no count: a call carries any number of reports, 2026-10-06) -->
            <div class="act-progress" aria-label="Where each report stands">
              <span class="act-segs">
                <span
                  v-for="o in progressSegs"
                  :key="o.code"
                  class="act-seg"
                  :class="`act-seg--${chipTone(o, vidSent)}`"
                >
                  <q-tooltip>{{ o.code }} — {{ stateWords(o, vidSent) }}</q-tooltip>
                </span>
              </span>
            </div>
          </div>
        </div>
    </div>
  </div>

  <PortCallProcess
    v-if="process && !modulePage"
    :call="processCall"
    :eta-label="fmtSchedule(orig.eta)"
    :etd-label="fmtSchedule(orig.etd)"
    :route-label="placeLine"
    :documents="docs"
    :can-upload="!!canUpload"
    :can-report="canCreateVid"
    :can-edit="canEdit"
    :can-remove-document="canRemoveDoc"
    @action="openProcessAction"
    @upload="openFormsWizard"
    @remove="askRemoveDoc"
    @edit="emit('edit', call)"
    @cancel="emit('cancel', call)"
  >
    <template #badges>
      <ul v-if="processBadges.length" class="process-badges" aria-label="Report status">
        <li v-for="o in processBadges" :key="o.code">
          <StatusPill :tone="chipTone(o, vidSent)" :icon="chipIcon(o, vidSent)" :label="chipLabel(o)" size="card" />
          <q-tooltip>{{ o.title }} — {{ stateWords(o, vidSent) }}</q-tooltip>
        </li>
      </ul>
    </template>
    <template #applicable>
      <section v-if="topics.length" class="process-applicable" :aria-labelledby="`applicable-title-${call.id}`">
        <h3 :id="`applicable-title-${call.id}`" class="pc-sec__title">As applicable</h3>
        <!-- No topics here: the reports alone, wrapping onto rows (user 2026-11-12) -->
        <ul class="process-applicable__chips">
          <template v-for="topic in topics" :key="topic.title">
            <li v-for="report in topic.reports" :key="report.code">
              <ReportChip
                v-if="report.ob && canCreateVid && vidSent"
                :obligation="report.ob"
                :vid-sent="vidSent"
                @pick="openProcessAction({ kind: 'report', code: $event })"
              />
              <span v-else>
                <StatusPill
                  :tone="report.ob ? chipTone(report.ob, vidSent) : 'gray'"
                  :icon="report.ob ? chipIcon(report.ob, vidSent) : undefined"
                  :label="report.code"
                />
                <q-tooltip>{{ report.title }}</q-tooltip>
              </span>
            </li>
          </template>
        </ul>
      </section>
    </template>
    <template #audit>
      <div class="process-audit">
        <template v-if="!captain">
          <button
            type="button"
            class="audit-toggle"
            :aria-expanded="logOpen"
            aria-label="Audit log"
            @click="toggleLog"
          >
            <q-icon v-if="logOpen" name="expand_less" size="20px" />
            <img v-else :src="processExpandMore" alt="" />
            Audit
            <q-tooltip>The full history of this call</q-tooltip>
          </button>

          <div v-if="logOpen" class="log-panel">
            <div v-if="!events" class="row justify-center q-pa-sm">
              <q-spinner size="20px" color="secondary" />
            </div>
            <template v-else>
              <div v-for="(e, i) in events" :key="i" class="timeline-row">
                <q-icon :name="timelineIcon(e)" size="16px" class="timeline-icon" />
                <div class="col">
                  <div class="text-body2">{{ timelineText(e) }}</div>
                </div>
                <div class="timeline-meta">
                  <div class="text-caption text-grey-7 tnum">{{ fmtWhen(e.at) }}</div>
                  <div v-if="e.actor" class="text-caption text-grey-7 ellipsis">{{ e.actor }}</div>
                </div>
              </div>
              <div v-if="events.length === 0" class="text-caption text-grey-7">
                No events recorded yet.
              </div>
            </template>
          </div>
        </template>
      </div>
    </template>
  </PortCallProcess>

  <div v-if="modulePage && sectionLoading" class="q-py-lg" role="status"><q-spinner color="primary" size="32px" /><span class="q-ml-sm">Loading section…</span></div>
  <p v-else-if="modulePage && sectionError" role="status">{{ sectionError }}</p>


  <div v-if="dragDepth > 0 && canUpload" class="drop-overlay">
    <q-icon name="upload_file" size="28px" class="q-mr-sm" />
    Drop files to attach to this call
  </div>

  <!-- What was read from one document (spec 0049) -->
  <!-- NEMO had cancelled the visit (2026-10-06): never a dead end — send the
       VID again, or cancel the call here too -->
  <HouseDialog
    v-model="goneOpen"
    :title="goneExchange?.headline ?? 'NEMO had cancelled this visit'"
    :subtitle="`${call.shipName ?? 'Ship'} · ${call.portName ?? call.portLocode ?? '—'}`"
    :max-width-px="480"
    main-label="Send VID again"
    main-icon="send"
    :main-disable="cancellingHere"
    @main="sendVidAgain"
  >
    <p class="text-body2">
      Someone cancelled this port call in NEMO — in the NEMO user interface or from another
      system. NEMOLink has unlinked it from that visit, so its VID is unsent again.
    </p>
    <ul class="text-body2 gone-choices">
      <li><b>Send VID again</b> — the call is still on: create it in NEMO anew.</li>
      <li><b>Cancel here as well</b> — the call is off: NEMOLink cancels it too. Nothing goes to NEMO.</li>
    </ul>
    <template #actions>
      <q-btn
        flat
        no-caps
        color="negative"
        icon="block"
        label="Cancel here as well"
        :loading="cancellingHere"
        @click="cancelHereToo"
      />
    </template>
  </HouseDialog>

  <component :is="modulePage ? ModulePage : HouseDialog"
    v-model="docDialog"
    @update:model-value="finishSection"
    :context="`${call.shipName ?? 'Ship'} · ${call.portName ?? call.portLocode ?? 'Port not set'}`"
    :title="openedDoc?.summary?.formName ?? openedDoc?.fileName ?? 'Document'"
    :max-width-px="720"
  >
    <template v-if="openedDoc" #actions>
      <q-btn outline no-caps color="primary" label="Download original" type="a" :href="auth.callDocumentFileUrl(call.id, openedDoc.id)" target="_blank" />
      <q-btn v-if="canRemoveDoc(openedDoc)" flat no-caps color="negative" label="Remove document" @click="askRemoveDoc(openedDoc)" />
    </template>
    <template v-if="openedDoc">
      <div v-if="openedDoc.parseNote" class="doc-note q-mb-sm">
        {{ openedDoc.parseNote }}
      </div>
      <div v-if="docDetail === null" class="row justify-center q-pa-md">
        <q-spinner size="24px" color="secondary" />
      </div>
      <template v-else>
        <template v-if="docDetail.parsed?.form">
          <div
            v-for="w in docDetail.parsed.form.warnings"
            :key="w"
            class="doc-note q-mb-sm"
          >
            {{ w[0]?.toUpperCase() + w.slice(1) }}.
          </div>
          <div
            v-if="freshChecks && freshChecks.errorCount + freshChecks.warningCount > 0"
            class="doc-note doc-note--error q-mb-sm"
          >
            {{ freshChecks.errorCount + freshChecks.warningCount }} to check —
            tap the marked values to see what we read and what looks wrong.
          </div>
          <!-- D4 (spec 0093): no IMO in the file — counts once confirmed -->
          <div v-if="openedDoc?.shipConfirmNeeded" class="doc-note q-mb-sm">
            This form names no IMO, so it does not count for the call yet. Is it
            <b>{{ call.shipName ?? 'this ship' }}</b>’s<template v-if="call.imoNumber"> ({{ call.imoNumber }})</template>?
            <q-btn
              v-if="canUpload"
              unelevated
              dense
              no-caps
              color="primary"
              label="Yes, it is"
              class="q-ml-sm q-px-sm"
              :loading="confirmingShip"
              @click="confirmShip"
            />
          </div>
          <!-- The ship's file back in NEMO codes and units (spec 0093 §3) -->
          <div v-if="freshChecks && openedDoc" class="row items-center q-gutter-sm q-mb-sm">
            <q-btn
              outline
              no-caps
              color="primary"
              icon="task"
              label="Download for NEMO"
              type="a"
              :href="freshChecks.errorCount === 0 ? auth.callDocumentCorrectedUrl(call.id, openedDoc.id) : undefined"
              target="_blank"
              :disable="freshChecks.errorCount > 0"
            />
            <span class="text-caption text-grey-7">
              {{
                freshChecks.errorCount > 0
                  ? `Fix the ${freshChecks.errorCount === 1 ? 'flagged value' : `${freshChecks.errorCount} flagged values`} first.`
                  : 'The same file with NEMO codes and units written in.'
              }}
            </span>
          </div>
          <div
            v-if="Object.keys(docDetail.parsed.form.fields).length > 0"
            class="doc-fields q-mb-sm"
          >
            <div
              v-for="(value, key) in docDetail.parsed.form.fields"
              :key="key"
              class="doc-field"
            >
              <span class="doc-field__label">{{ fieldWords(String(key)) }}</span>
              <span
                v-if="marked(`fields.${String(key)}`)"
                class="doc-field__value"
                :class="markClasses(`fields.${String(key)}`)"
                role="button"
                tabindex="0"
                @click="openAnn(`fields.${String(key)}`, fieldWords(String(key)), value)"
              >{{ displayVal(`fields.${String(key)}`, value) }}</span>
              <span v-else class="doc-field__value">{{ value }}</span>
            </div>
          </div>
          <template v-if="(docDetail.parsed.form.rows?.length ?? 0) > 0">
            <div class="text-caption text-grey-7 q-mb-xs">
              {{ docDetail.parsed.form.rows?.length }}
              {{ docDetail.parsed.form.rowsLabel }}
              <template v-if="docDetail.parsed.form.rowsTruncated">
                (list cut off — the full file is kept)
              </template>
            </div>
            <div class="doc-table-wrap">
              <table class="doc-table">
                <thead>
                  <tr>
                    <th v-for="col in detailColumns" :key="col">
                      {{ fieldWords(col) }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in docDetail.parsed.form.rows" :key="i">
                    <td v-for="col in detailColumns" :key="col" class="tnum">
                      <span
                        v-if="marked(`rows.${i}.${col}`)"
                        :class="markClasses(`rows.${i}.${col}`)"
                        role="button"
                        tabindex="0"
                        @click="openAnn(`rows.${i}.${col}`, fieldWords(col), row[col] ?? '')"
                      >{{ displayVal(`rows.${i}.${col}`, row[col] ?? '') }}</span>
                      <template v-else>{{ row[col] ?? '' }}</template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </template>
        <div v-else class="text-body2 text-grey-8">
          No data was read from this file. The original is kept — download
          it to look at the contents.
        </div>
      </template>
    </template>
  </component>

  <!-- One checked value: what the file says, how we read it, the fix
       (specs 0050, 0051, 0093) -->
  <CorrectionDialog
    v-model="annDialog"
    :call-id="call.id"
    :doc-id="openedDoc?.id ?? ''"
    :info="annInfo"
    :can-upload="!!canUpload"
    @saved="onCorrected"
  />

  <RemovalDialog
    v-model="removeDialog"
    title="Are you sure you want to remove this file?"
    :loading="removing"
    @confirm="doRemoveDoc"
  >
    <p v-if="removeTarget">
      “{{ removeTarget.fileName }}” will be permanently removed from this call. The upload stays in the audit log.
    </p>
  </RemovalDialog>

  <!-- The NEMO wizard (spec 0079): the VID, then the ship data, one
       Ctrl+Enter per step — opened at the step the chip stands for -->
  <NemoWizardDialog
    v-if="canCreateVid && wizardOpen"
    :key="route.fullPath"
    :page="modulePage"
    v-model="wizardOpen"
    @update:model-value="finishSection"
    :call="call"
    :start-at="wizardStart"
    :ship-report-code="['SID', 'SHP', 'CRT'].includes(String(route.query.report)) ? String(route.query.report) : 'SID'"
    @sent="emit('changed')"
    @completed="completeSection($event === 'ship' ? 'ship-data' : 'nemo')"
    @edit-call="emit('edit', call)"
  />
  <!-- The NOA wizard (spec 0088): the facts, then the confirmation and the send -->
  <NoaWizardDialog
    v-if="canCreateVid && noaOpen"
    :key="route.fullPath"
    :page="modulePage"
    v-model="noaOpen"
    @update:model-value="finishSection"
    :call="call"
    :refresh-key="noaRefresh"
    :attachments-busy="reportUploading || removing"
    :start-at="noaStartAt"
    @sent="emit('changed')"
    @completed="completeSection('pre-arrival')"
    @open-table="openFormsAt"
    @edit-call="emit('edit', call)"
  >
    <template #attachments>
      <ReportAttachments
        :call-id="call.id"
        :docs="docs ?? []"
        :uploading="reportUploading || removing"
        :can-upload="!!canUpload"
        context="Pre-arrival · Port call files"
        :page="modulePage"
        @upload="uploadReportFiles"
        @remove="askRemoveDoc"
      />
    </template>
  </NoaWizardDialog>
  <ReportDialog v-if="reportCode" :key="route.fullPath" :page="modulePage" v-model="reportOpen" :call="call" :code="reportCode" @sent="emit('changed')" @completed="completeSection('report')" @update:model-value="finishSection" />
  <FormsWizardDialog
    v-if="formsOpen"
    :key="route.fullPath"
    :page="formsPage"
    :upload-only="modulePage && route.params.section === 'upload'"
    v-model="formsOpen"
    @update:model-value="formsPage && finishSection($event)"
    :call="call"
    :files="formsFiles"
    :docs="docs ?? []"
    :start-at="formsStartAt"
    :report-code="formsReportCode"
    @changed="onFormsChanged"
    @review="goSection('documents')"
  >
    <template #applicable>
      <section v-if="topics.length" class="process-applicable" :aria-labelledby="`applicable-title-${call.id}`">
        <h3 :id="`applicable-title-${call.id}`" class="pc-sec__title">As applicable</h3>
        <dl class="pc-reports">
          <template v-for="topic in topics" :key="topic.title">
            <dt>{{ topic.title }}</dt>
            <dd class="pc-chips pc-chips--wrap">
              <template v-for="report in topic.reports" :key="report.code">
                <ReportChip
                  v-if="report.ob && canCreateVid && vidSent"
                  :obligation="report.ob"
                  :vid-sent="vidSent"
                  @pick="openProcessAction({ kind: 'report', code: $event })"
                />
                <span v-else>
                  <StatusPill
                    :tone="report.ob ? chipTone(report.ob, vidSent) : 'gray'"
                    :icon="report.ob ? chipIcon(report.ob, vidSent) : undefined"
                    :label="report.code"
                  />
                  <q-tooltip>{{ report.title }}</q-tooltip>
                </span>
              </template>
            </dd>
          </template>
        </dl>
      </section>
    </template>
  </FormsWizardDialog>
  <NodDialog v-if="canCreateVid && nodOpen" :key="route.fullPath" :page="modulePage" v-model="nodOpen" :call="call" :refresh-key="noaRefresh" :attachments-busy="reportUploading || removing" @sent="emit('changed')" @completed="completeSection('pre-departure')" @edit-call="emit('edit', call)" @update:model-value="finishSection">
    <template #attachments>
      <ReportAttachments
        :call-id="call.id"
        :docs="docs ?? []"
        :uploading="reportUploading || removing"
        :can-upload="!!canUpload"
        context="Pre-departure · Port call files"
        :page="modulePage"
        @upload="uploadReportFiles"
        @remove="askRemoveDoc"
      />
    </template>
  </NodDialog>
  <ActualSheet
    v-if="canCreateVid && actualKind"
    :key="route.fullPath"
    :page="modulePage"
    v-model="actualOpen"
    @update:model-value="finishSection"
    :call="call"
    :kind="actualKind"
    @sent="emit('changed')"
    @completed="completeSection($event)"
    @open="openFirstStep"
  />
  </div>
</template>

<script setup lang="ts">
/**
 * The port-call block (docs/specs/0048, refining 0047): two flows in one
 * block — the ship's movement (NEMO port-call status, the times) and the
 * reports the call owes NEMO (the code chips). Collapsed it reads across;
 * expanded it edits down: place, estimated, actual, each with the reports
 * that carry it, then the obligation groups. History hides behind a button.
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { reportSection, sectionLocation, stageSectionUploads, takeSectionUploads } from '../lib/port-call-sections';
import { DEPARTURE_REPORTS, documentReportCodes, type ProcessAction } from '../lib/port-call-process';
import { useQuasar } from 'quasar';
import {
  useAuth,
  type CheckAnnotation,
  type Obligation,
  type ObligationGroup,
  type PendingSuggestion,
  type PreArrivalReport,
  type PortCall,
  type PortCallDocument,
  type PortCallDocumentDetail,
  type TimelineEvent,
  type NemoExchange,
} from '../auth/auth';
import { fmtSchedule, fmtStamp, fmtWhen } from '../lib/time';
import { fieldWords } from '../lib/doc-words';
import {
  GROUP_TITLES,
  NEMO_STATUS_ICONS,
  NEMO_STATUS_TONES,
  SITUATIONAL,
  chipIcon,
  chipTone,
  chipLabel,
  codeLabel,
  stageOf,
  dueLine,
  stateWords,
  sentWords,
  guideUrl,
  unconfirmed,
  statusLabel,
  urgentDue,
  laneWords,
  dueTooltip,
  dueSentence,
  timeStatus as timeStatusOf,
} from '../lib/obligations';
import { timelineIcon, timelineText } from '../lib/timeline-text';
import HelpTip from './HelpTip.vue';
import PortCallProcess from './PortCallProcess.vue';
import HouseDialog from './HouseDialog.vue';
import RemovalDialog from './RemovalDialog.vue';
import ModulePage from './ModulePage.vue';
import ReportAttachments from './ReportAttachments.vue';
import CorrectionDialog, { type CorrectionTarget } from './CorrectionDialog.vue';
import FormalityItems from './FormalityItems.vue';
import ReportChip from './ReportChip.vue';
import StatusPill, { type PillTone } from './StatusPill.vue';
import NemoWizardDialog from './NemoWizardDialog.vue';
import NoaWizardDialog from './NoaWizardDialog.vue';
import ReportDialog from './ReportDialog.vue';
import FormsWizardDialog from './FormsWizardDialog.vue';
import ActualSheet from './ActualSheet.vue';
import processExpandMore from '../assets/figma/process-expand-more.svg';
import NodDialog from './NodDialog.vue';

const props = withDefaults(defineProps<{
  call: PortCall;
  /** Admin: the times are editable in place (POST /portcalls/:id/update). */
  canEdit: boolean;
  /** Admin + editor: may confirm or reject a reported time. */
  isOperator: boolean;
  /** Admin, editor or captain: may drop and add documents (spec 0049). */
  canUpload?: boolean;
  /** Captain view: read-only block, no audit log (their list is scoped). */
  captain?: boolean;
  /** Focus mode (spec 0054): another row is open, this one steps back. */
  muted?: boolean;
  /** Folded, a row of the overview table or a port call card (guide p. 13). */
  layout?: 'row' | 'card';
  /** Normal page with the port call's phase list, rather than a dialog. */
  process?: boolean;
  /** Refresh accepted report state before the following section opens. */
  refreshCall?: () => Promise<void>;
}>(), { layout: 'row', canUpload: false, captain: false, muted: false });

const emit = defineEmits<{
  (e: 'edit', call: PortCall): void;
  (e: 'cancel', call: PortCall): void;
  (e: 'confirm', call: PortCall, field: 'ata' | 'atd', s: PendingSuggestion): void;
  (e: 'reject', call: PortCall, field: 'ata' | 'atd', s: PendingSuggestion): void;
  (e: 'changed'): void;
  (e: 'toggle', open: boolean): void;
}>();

const $q = useQuasar();
const auth = useAuth();
const router = useRouter();
const route = useRoute();
// Direct opens use page routes at every viewport size. Child tasks keep their dialogs.
const modulePage = computed(() => route.name === 'port-call-section' && route.params.callId === props.call.id);
const formsPage = computed(() => modulePage.value && ['upload', 'documents'].includes(String(route.params.section)));
const completing = ref(false);
function goSection(section: string, itemId?: string, query: Record<string, string> = {}): void {
  void router.push(sectionLocation(props.call.id, section, itemId, query));
}
// Step by step, not all in a row (user 2026-11-13): closing a section goes
// back to the port call page; the next step is opened from there.
function finishSection(open: boolean): void {
  if (open || !modulePage.value) return;
  void router.push({ name: 'port-call', params: { callId: props.call.id } });
}
async function completeSection(fromSection = String(route.params.section)): Promise<void> {
  if (!modulePage.value || completing.value) return;
  const current = String(route.params.section);
  const nemoSection = ['nemo', 'ship-data'].includes(fromSection) && ['nemo', 'ship-data'].includes(current);
  if (fromSection !== current && !nemoSection) return;
  const sentFrom = route.fullPath;
  completing.value = true;
  try {
    await props.refreshCall?.();
    if (!modulePage.value || route.fullPath !== sentFrom) return;
    $q.notify({ type: 'positive', message: 'NEMO accepted the report.' });
    // Only the VID wizard's own steps carry on (VID → ship data, same section
    // on the port call page); every other accepted send returns to the page.
    if (fromSection === 'nemo' && current === 'ship-data') {
      wizardOpen.value = false;
      wizardStart.value = 'ship';
      await nextTick();
      wizardOpen.value = true;
    } else if (fromSection === 'nemo') goSection('ship-data');
    else await router.push({ name: 'port-call', params: { callId: props.call.id } });
  } catch {
    $q.notify({ type: 'warning', message: 'The report was accepted, but the port call could not be refreshed. Please try again.' });
  } finally {
    completing.value = false;
  }
}
const saving = ref(false);

// ---- focus (spec 0054) -----------------------------------------------------

/** Open means "this is the row I am working on" — the list dims the rest. */
const expanded = ref(false);

function setOpen(open: boolean): void {
  if (open) void router.push({ name: 'port-call', params: { callId: props.call.id } });
}
// Opened: the documents and the area's name load; closed: unsaved times go
watch(expanded, (open) => {
  emit('toggle', open);
  if (open) {
    filesOpen.value = false;
    onShow();
  } else {
    resetDraft();
    openCode.value = null;
  }
});

// ---- the two flows ---------------------------------------------------------

/** The reports NEMO refused last — also a refused update of one it holds (2026-10-06). */
const refusedCodes = computed(() =>
  props.call.obligations.filter((o) => o.state === 'rejected' || !!o.rejected).map((o) => o.code),
);

/** Reports that travel inside a notice's wizard: no chip of their own in the row (user 2026-10-06). */
const RIDES_WITH: Record<string, string[]> = { NOA: ['DUE', 'CWA', 'EFF', 'STA', 'WAS', 'SEC'] };
/**
 * The opened card's chips are single formalities (user 2026-10-06): each
 * opens a dialog of its own to see it and send it again; VID, ATA and ATD
 * already have single steps of their own. The row's chips open the wizards.
 */
const OWN_DIALOG = new Set(['NOA', 'DUE', 'NOD', 'SID', 'SHP', 'CRT', 'CWA', 'EFF', 'STA', 'WAS', 'SEC']);
const OWN_STEP = new Set(['VID', 'ATA', 'ATD']);
const riders = new Set(Object.values(RIDES_WITH).flat());

/** The always-given reports, in flow order — the compact chip row: VID · Pre-arr · ATA · Pre-dep · ATD. */
const flowChips = computed(() =>
  vidSent.value
    ? props.call.obligations
        .filter((o) => o.group !== 'ship' && !riders.has(o.code))
        .map((o) =>
          stageOf(
            o,
            (RIDES_WITH[o.code] ?? []).flatMap((c) => props.call.obligations.filter((p) => p.code === c)),
          ),
        )
    : props.call.obligations.filter((o) => o.code === 'VID'),
);

/** Where the departure side of the flow starts in the chips (-1: none). */
/** A table row shows six reports at most: five and "+N" until that is tapped.
    A moored call shows its first report alone, then "+N" (user 2026-11-02). */
const CHIPS_MAX = 6;
const chipsOpen = ref(false);
const moored = computed(() => props.call.nemoStatus === 'Moored');
const shownChips = computed(() => {
  if (chipsOpen.value) return cardChips.value;
  if (moored.value) return cardChips.value.slice(0, 1);
  return props.layout === 'row' && cardChips.value.length > CHIPS_MAX
    ? cardChips.value.slice(0, CHIPS_MAX - 1)
    : cardChips.value;
});
const hiddenChips = computed(() => cardChips.value.length - shownChips.value.length);

const departFrom = computed(() =>
  cardChips.value.findIndex((o) => DEPARTURE_REPORTS.has(o.code) || o.group === 'predeparture' || o.group === 'departure'),
);

// ---- the VID (spec 0075) ----------------------------------------------------

/** Nothing of the call reaches NEMO before its visit id exists. */
const vidSent = computed(() => !!props.call.visitId || at('VID').state === 'sent');
/** Creating the call in NEMO is an admin act (spec 0070, session:admin). */
const canCreateVid = computed(() => !props.captain && auth.isAdmin.value);
/** NEMO refuses the COA once the ATA is in (spec 0080). */
const ataInNemo = computed(() => !!props.call.visitId && at('ATA').state === 'sent');

// ---- the NEMO wizard (spec 0079): the VID chip opens step 1, the SID and
//      SHP chips step 2 — the ship data under this visit id (spec 0077) ----
const wizardOpen = ref(false);
const noaOpen = ref(false);
const wizardStart = ref<'vid' | 'ship'>('vid');
async function openWizard(at: 'vid' | 'ship'): Promise<void> {
  if (at === 'ship' && !(await visitAlive())) return;
  goSection(at === 'ship' ? 'ship-data' : 'nemo');
}
/** The reports that have a wizard, and where it opens (specs 0079, 0084, 0088). */
const WIZARD_OF: Record<string, 'vid' | 'ship' | 'noa' | 'ata' | 'nod' | 'atd'> = {
  VID: 'vid',
  SID: 'ship',
  SHP: 'ship',
  CRT: 'ship',
  NOA: 'noa',
  // The DUE goes with the NOA (spec 0092)
  DUE: 'noa',
  ATA: 'ata',
  NOD: 'nod',
  ATD: 'atd',
};
function wizardOf(code: string): 'vid' | 'ship' | 'noa' | 'ata' | 'nod' | 'atd' | null {
  return WIZARD_OF[code] ?? null;
}
const nodOpen = ref(false);
const noaStartAt = ref<'reports' | 'facts' | 'send'>('reports');
/** The ATA / ATD sheet (spec 0092): which side of the call it stamps, or closed. */
const actualKind = ref<'arrival' | 'departure' | null>(null);
const actualOpen = computed({
  get: () => actualKind.value !== null,
  set: (open: boolean) => {
    if (!open) actualKind.value = null;
  },
});
/**
 * Every send dialog but the VID's opens only on a live visit (2026-10-06):
 * NEMO not reached, or the visit cancelled there (the call comes back with
 * its VID unsent), and the user hears why instead of a dialog.
 */
const checking = ref(false);
const goneOpen = ref(false);
const goneExchange = ref<NemoExchange | null>(null);
const cancellingHere = ref(false);
/** Waiting for the reload that clears the visit id before the VID step opens. */
const vidAfterReload = ref(false);
watch(
  () => props.call.visitId,
  (v) => {
    if (!v && vidAfterReload.value) {
      vidAfterReload.value = false;
      void openWizard('vid');
    }
  },
);
function sendVidAgain(): void {
  goneOpen.value = false;
  if (!props.call.visitId) void openWizard('vid');
  else vidAfterReload.value = true;
}
/** NEMO cancelled it; the call is off here too — a soft cancel, nothing goes to NEMO. */
async function cancelHereToo(): Promise<void> {
  cancellingHere.value = true;
  try {
    await auth.cancelPortCall(props.call.id, `Cancelled in NEMO (${goneExchange.value?.visitId ?? 'visit'})`);
    goneOpen.value = false;
    $q.notify({ type: 'positive', message: 'Cancelled in NEMOLink as well', timeout: 5000 });
    emit('changed');
  } catch (e) {
    $q.notify({ type: 'negative', message: (e as Error).message, timeout: 12000 });
  } finally {
    cancellingHere.value = false;
  }
}
async function visitAlive(): Promise<boolean> {
  if (!props.call.visitId) return true;
  checking.value = true;
  try {
    const out = await auth.nemoCheck(props.call.id);
    if (out.state === 'live' || out.state === 'notInNemo') return true;
    const x = out.exchange;
    if (out.state === 'unlinked') {
      goneExchange.value = x;
      goneOpen.value = true;
      emit('changed');
      return false;
    }
    // NEMO not reached: nothing to choose yet, so a notice says it
    $q.notify({
      type: 'warning',
      icon: 'cloud_off',
      message: x?.headline ?? 'NEMO is not reachable',
      ...(x?.explanation ? { caption: x.explanation } : {}),
      multiLine: true,
      timeout: 15000,
    });
    return false;
  } catch (e) {
    $q.notify({ type: 'negative', message: (e as Error).message, timeout: 12000 });
    return false;
  } finally {
    checking.value = false;
  }
}

/** From the ATA / ATD sheet's "Send the X first" link: close it, open X's dialog.
    Closed first, so a sheet reopened for the other side starts fresh. */
async function openFirstStep(code: string): Promise<void> {
  actualKind.value = null;
  await nextTick();
  await openWizardFor(code);
}

async function openWizardFor(code: string): Promise<void> {
  const at = wizardOf(code);
  if (!at) return;
  if (at !== 'vid' && !(await visitAlive())) return;
  goSection(reportSection(code), undefined, ['SID', 'SHP', 'CRT'].includes(code) ? { report: code } : {});
}
// ---- the next thing (spec 0092) ---------------------------------------------

/** The report the server names next; null once the departure is in. */
const nextOb = computed(() => (props.call.next ? props.call.obligations.find((o) => o.code === props.call.next) ?? null : null));
/** The flow, one segment per report, in order. */
const progressSegs = computed(() => props.call.obligations.filter((o) => o.group !== 'ship'));
/**
 * The button: the verb, then the state in count-first words, with the
 * deadline first when it presses ("overdue · 10 to fill"). Only where a
 * wizard exists and the user may send; otherwise the card says it in words.
 */
/**
 * The big next-step button (spec 0092), off for a test (user 2026-10-06): the
 * chips are the buttons — the VID chip creates the call in NEMO, each report
 * chip opens its dialog — and the card keeps its balance. Off, a phone shows
 * the chips in the folded card too (the rule that hid them keys on .head-act).
 */
const SHOW_NEXT_ACTION = false;
const nextAction = computed(() => {
  const o = nextOb.value;
  if (!o || !canCreateVid.value || !wizardOf(o.code)) return null;
  // The arrival is a moment, not a form: the ETA is what the button measures against
  // A source already said when (spec 0095): the button names it
  const said = o.code === 'ATA' ? props.call.suggestions?.ata : o.code === 'ATD' ? props.call.suggestions?.atd : undefined;
  if (said) return { verb: `Send ${o.code}`, state: `${said.lane === 'ais' ? 'AIS' : 'logbook'} ${fmtStamp(said.value).slice(11)}` };
  // "Arrived now" only once the ship can have arrived: until an hour before
  // the ETA the button records the arrival (2026-10-06: "Arrived now · ETA in 22 h" read oddly)
  if (o.code === 'ATA') return { verb: soon(props.call.eta) ? 'Arrived now' : 'Record arrival', state: etaWords(props.call.eta, 'ETA') };
  if (o.code === 'ATD') return { verb: soon(props.call.etd) ? 'Departed now' : 'Record departure', state: etaWords(props.call.etd, 'ETD') };
  const verb = o.code === 'VID' ? 'Create in NEMO' : `Send ${o.code}`;
  // The DUE goes with the NOA (spec 0092): its gaps hold the send back too
  const dueReport = o.code === 'NOA' ? at('DUE') : null;
  const gaps = o.missing.length + (dueReport && dueReport.state !== 'sent' ? dueReport.missing.length : 0);
  const state = gaps > 0 ? `${gaps} to fill` : o.state === 'rejected' ? 'refused — send again' : o.state === 'ready' ? 'ready' : 'start';
  const due = o.dueState === 'overdue' ? (o.asap ? 'due now' : 'overdue') : o.dueState === 'soon' ? shortDue(o) : null;
  return { verb, state: due ? `${due} · ${state}` : state };
});

/** Within an hour of the time, or past it (an unknown time counts as now). */
function soon(at: string | null): boolean {
  return !at || Date.parse(at) - Date.now() <= 60 * 60_000;
}

/** "ETA passed 2 d 23 h ago" / "ETD in 3 h" — the arrival and departure buttons' words. */
function etaWords(eta: string | null, tag: 'ETA' | 'ETD'): string {
  if (!eta) return `no ${tag}`;
  const m = Math.round((Date.now() - Date.parse(eta)) / 60_000);
  const a = Math.abs(m);
  const d = Math.floor(a / 1440);
  const h = Math.floor((a % 1440) / 60);
  const span = d ? `${d} d${h ? ` ${h} h` : ''}` : h ? `${h} h` : `${a % 60} min`;
  return m >= 0 ? `${tag} passed ${span} ago` : `${tag} in ${span}`;
}

/** Where ship rows are edited: the ship dialog's five columns (admins). */
const shipLink = computed(() =>
  auth.isAdmin.value && props.call.shipId ? `/admin/ships?ship=${props.call.shipId}` : null,
);

/** The reports in flow order: one line on a desktop, wrapping group by
    group on a phone (user rule 2026-09-02). */


/**
 * The reports overview (user 2026-11-06): one pill per form, in the order
 * they go — the port call (its form also sends the ship data), the notices
 * and the actual times. A pill covers every report its form sends: the NOA's
 * also the DUE and the reports ticked to go with it (crew, effects, stores,
 * waste, security); it wears the least finished one's state.
 */
const SEND_ORDER: ObligationGroup[] = ['call', 'prearrival', 'arrival', 'predeparture', 'departure'];
const noaRiders = ref<PreArrivalReport[]>([]);
async function loadRiders(): Promise<void> {
  noaRiders.value = [];
  if (!canCreateVid.value || !vidSent.value) return;
  try {
    const pv = await auth.noaPreview(props.call.id);
    noaRiders.value = pv.reports.filter((r) => r.on);
  } catch {
    // No preview (not in NEMO yet, or no rights): the NOA and DUE alone
  }
}
watch(expanded, (open) => {
  if (open) void loadRiders();
});
// A send from here reloads the call: the NOA's riders follow
watch(
  () => props.call.obligations,
  () => {
    if (expanded.value || props.process) void loadRiders();
  },
);
/** The form each group's reports are filled in: its pill opens that one. */
const FORM_CODE: Record<ObligationGroup, string> = {
  call: 'VID',
  ship: 'SID',
  prearrival: 'NOA',
  arrival: 'ATA',
  predeparture: 'NOD',
  departure: 'ATD',
};
/** Rider reports (ticked to go with the NOA) as obligations, for the stage. */
function riderObligation(r: PreArrivalReport): Obligation {
  return {
    ...at(r.code),
    code: r.code,
    title: r.title,
    group: 'prearrival',
    state: r.refused ? 'rejected' : r.inNemo ? 'sent' : r.missing.length ? 'missing' : 'ready',
    missing: r.missing,
    rejected: r.refused ? { at: '' } : null,
  };
}
const reportRows = computed(() =>
  SEND_ORDER.map((group) => {
    // One pill per form, whatever steps it has (user 2026-11-06): the VID's
    // form also sends the ship data (SID, SHP, CRT) in its second step
    const own = props.call.obligations.filter((o) => o.group === group || (group === 'call' && o.group === 'ship'));
    const riders = group === 'prearrival' ? noaRiders.value.filter((r) => !own.some((o) => o.code === r.code)) : [];
    if (own.length === 0) return null;
    const main = own.find((o) => o.code === FORM_CODE[group]) ?? own[0]!;
    const parts = [...own.filter((o) => o !== main), ...riders.map(riderObligation)];
    const pill = stageOf(main, parts);
    const name = main.code;
    const label = pill.state === 'missing' ? `${name} ${pill.missing.length}` : name;
    return { group, pill, label, codes: [...own.map((o) => o.code), ...riders.map((r) => r.code)] };
  }).filter((g): g is NonNullable<typeof g> => g !== null),
);

/** The NOA's riders by code, for the as-applicable topics. */


function at(code: string): Obligation {
  return (
    props.call.obligations.find((o) => o.code === code) ?? {
      code,
      title: code,
      group: 'call',
      state: 'notStarted',
      filled: 0,
      total: 0,
      missing: [],
      dueAt: null,
      dueState: 'none',
      asap: false,
      items: [],
    }
  );
}

const urgent = computed(() => urgentDue(props.call.obligations));

/** The status line over the name (guide p. 12): a dot and a word. */
const timeStatus = computed(() => timeStatusOf(props.call));
/** Cards carry 25px pills, table rows 24px (guide p. 12). */
const pillSize = computed(() => (props.layout === 'card' ? 'card' : 'table'));

/** The house stamp split in two lines for the ETA/ETD columns: date, then time. */
function datePart(iso: string | null): string {
  return fmtStamp(iso).slice(0, 10) || '—';
}
function timePart(iso: string | null): string {
  return fmtStamp(iso).slice(11);
}

/**
 * The one urgent action on a folded call (guide p. 11): submit the report
 * whose deadline presses — or, before the call is in NEMO, the VID that has
 * to go first. Only where a wizard exists and the user may send.
 */
const urgentAction = computed(() => {
  const o = urgent.value;
  if (!o || !canCreateVid.value) return null;
  if (!vidSent.value) return { label: 'Submit VID', run: () => void openWizard('vid') };
  if (!wizardOf(o.code)) return null;
  return { label: `Submit ${o.code}`, run: () => void openWizardFor(o.code) };
});

function shortDue(o: Obligation): string {
  const line = dueLine(o);
  const tail = line.split('· ')[1];
  return tail ? `due ${tail}` : 'due';
}

const openCode = ref<string | null>(null);
const openObligation = computed(() =>
  openCode.value ? at(openCode.value) : null,
);

async function pick(code: string): Promise<void> {
  if (canCreateVid.value && vidSent.value && OWN_DIALOG.has(code)) {
    if (await visitAlive()) {
      goSection('report', code);
    }
    return;
  }
  if (canCreateVid.value && OWN_STEP.has(code) && (code === 'VID' || vidSent.value)) {
    await openWizardFor(code);
    return;
  }
  openCode.value = openCode.value === code ? null : code;
}
const reportCode = ref<string | null>(null);
const reportOpen = computed({
  get: () => reportCode.value !== null,
  set: (open: boolean) => {
    if (!open) reportCode.value = null;
  },
});

const pending = computed(() => {
  const out: { field: 'ata' | 'atd'; suggestion: PendingSuggestion }[] = [];
  const s = props.call.suggestions;
  if (s?.ata) out.push({ field: 'ata', suggestion: s.ata });
  if (s?.atd) out.push({ field: 'atd', suggestion: s.atd });
  return out;
});

// ---- place -----------------------------------------------------------------

/** Codes read fine in the header; the area's name is worth a lookup. */
const areaName = ref<string | null>(null);

/** PLGDN → FIVAA → [FIRAU] → unknown (spec 0037); ZZUKN reads as words. */
const voyageRoute = computed<{ code: string; current?: boolean }[]>(() => {
  const prev = props.call.prevPorts ?? [];
  const next = props.call.nextPorts ?? [];
  if (prev.length === 0 && next.length === 0) return [];
  const show = (locode: string): string => (locode === "ZZUKN" ? "unknown" : locode);
  return [
    ...[...prev].reverse().map((p) => ({ code: show(p.portLocode) })),
    { code: props.call.portLocode ?? "—", current: true },
    ...next.map((p) => ({ code: show(p.portLocode) })),
  ];
});

const placeLine = computed(() => {
  const parts = [props.call.portLocode ?? ''];
  if (props.call.berth) parts.push(props.call.berth);
  else if (props.call.portAreaCode) parts.push(props.call.portAreaCode);
  return parts.filter(Boolean).join(' · ');
});

async function loadAreaName(): Promise<void> {
  const code = props.call.portAreaCode;
  const locode = props.call.portLocode;
  if (!code || !locode || areaName.value) return;
  try {
    const areas = await auth.listPortAreas(locode);
    areaName.value = areas.find((a) => a.code === code)?.name ?? null;
  } catch {
    areaName.value = null;
  }
}

// ---- times in place --------------------------------------------------------

interface Draft {
  eta: string;
  etd: string;
  ata: string;
  atd: string;
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const draft = reactive<Draft>({ eta: '', etd: '', ata: '', atd: '' });
const orig = reactive<Draft>({ eta: '', etd: '', ata: '', atd: '' });

function resetDraft(): void {
  Object.assign(draft, orig);
}

watch(
  () => props.call,
  (call) => {
    const next: Draft = {
      eta: isoToLocalInput(call.eta),
      etd: isoToLocalInput(call.etd),
      ata: isoToLocalInput(call.ata),
      atd: isoToLocalInput(call.atd),
    };
    Object.assign(orig, next);
    Object.assign(draft, next);
  },
  { immediate: true, deep: false },
);

// Any write to the call — here, in the dialog, or a confirmed report —
// invalidates the cached history.
watch(
  () => props.call.updated,
  () => {
    events.value = null;
    if (logOpen.value) void loadLog();
  },
);

const todayDate = computed(() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
});

/** The date rules of spec 0035, inline at the field (docs/07 law 4). */
// ---- the opened pop-up (user 2026-11-04) ----------------------------------

/** The files under the documents bar open from its chevron. */
const filesOpen = ref(false);

/** The overview's cargo: the official cargoes picked, else the notes. */
const cargoWords = computed(() =>
  props.call.cargoItems?.length
    ? props.call.cargoItems.map((c) => c.name).join(', ')
    : (props.call.cargoDescription ?? ''),
);

/** The files card's headline: how many forms were read, or what is missing. */
const docsHeadline = computed(() => {
  const list = docs.value ?? [];
  const read = list.filter((d) => d.parseStatus === 'parsed').length;
  if (list.length === 0) return { icon: 'info', tone: 'none', words: 'No documents yet' };
  const words = read > 0 ? `${read} ${read === 1 ? 'form' : 'forms'} read` : `${list.length} ${list.length === 1 ? 'file' : 'files'}`;
  const trouble = list.some((d) => d.parseStatus === 'failed');
  return { icon: trouble ? 'error' : 'check_circle', tone: trouble ? 'error' : 'ok', words };
});
/** What the headline does not say: files not read, checks, ship to confirm. */
const docExtraPills = computed(() => docPills.value.filter((pl) => pl.tone !== 'teal'));
/** The files' size together, "1.2 MB". */
const docsSize = computed(() => {
  const b = (docs.value ?? []).reduce((n, d) => n + (d.byteSize ?? 0), 0);
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} kB`;
});

/** As applicable, by topic: the call's own report when it has one, else a quiet code. */
const TOPICS: { title: string; codes: string[] }[] = [
  { title: 'Crew', codes: ['CWA', 'CWD'] },
  { title: 'Passengers', codes: ['PXA', 'PXD'] },
  { title: 'Cargo', codes: ['CGA', 'CGD'] },
  { title: 'Dangerous goods', codes: ['HZA', 'HZD'] },
  { title: 'Security', codes: ['SEC'] },
  { title: 'Health', codes: ['MDH'] },
  { title: 'Waste', codes: ['WAS', 'WAR'] },
  { title: 'Stores', codes: ['STA', 'STD'] },
  { title: 'Other', codes: ['MTS'] },
];
/**
 * As applicable (user 2026-11-06): only the reports not already among the
 * call's own in the overview — what goes, or has gone, is not offered again.
 * A topic with nothing left drops out.
 */
const topics = computed(() => {
  const listed = new Set(reportRows.value.flatMap((g) => g.codes));
  return TOPICS.map((tp) => ({
    title: tp.title,
    reports: tp.codes
      .filter((code) => !listed.has(code))
      .map((code) => ({
        code,
        title: SITUATIONAL.find((x) => x.code === code)?.title ?? code,
        ob: props.call.obligations.find((o) => o.code === code) ?? null,
      })),
  })).filter((tp) => tp.reports.length > 0);
});

// ---- ship documents (spec 0049) -------------------------------------------

const docs = ref<PortCallDocument[] | null>(null);
const formsOpen = ref(false);
const formsFiles = ref<File[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const dragDepth = ref(0);

/** Collapsed chip: the list row's count until the real list is loaded. */
const docCountLocal = ref(props.call.documentCount ?? 0);
watch(
  () => props.call.documentCount,
  (n) => {
    docCountLocal.value = n ?? 0;
    // Keep a card's or list row's cargo report badges in step with its documents
    if (!props.process && (docs.value === null ? (n ?? 0) > 0 : docs.value.length !== (n ?? 0))) void loadDocs();
  },
);
const docCount = computed(() =>
  docs.value === null ? docCountLocal.value : docs.value.length,
);

const DOC_TONES: Record<PortCallDocument['parseStatus'], 'teal' | 'amber' | 'red'> = {
  parsed: 'teal',
  pdf: 'amber',
  unrecognized: 'amber',
  failed: 'red',
};
const DOC_ICONS: Record<PortCallDocument['parseStatus'], string> = {
  parsed: 'task_alt',
  pdf: 'picture_as_pdf',
  unrecognized: 'help_outline',
  failed: 'error_outline',
};

const DOC_WORDS: Record<PortCallDocument['parseStatus'], string> = {
  parsed: 'Read',
  pdf: 'PDF',
  unrecognized: 'Not read',
  failed: 'Failed',
};

/**
 * The headline's pills (user 2026-10-20): the documents summed by how they
 * were read — "Not read", "2 Read" — then what still wants a look.
 */
const docPills = computed(() => {
  const list = docs.value ?? [];
  const out: { tone: 'teal' | 'amber' | 'red'; icon: string; label: string }[] = [];
  for (const st of ['failed', 'unrecognized', 'pdf', 'parsed'] as const) {
    const n = list.filter((d) => d.parseStatus === st).length;
    if (n > 0) out.push({ tone: DOC_TONES[st], icon: DOC_ICONS[st], label: n > 1 ? `${n} ${DOC_WORDS[st]}` : DOC_WORDS[st] });
  }
  const checks = list.reduce((n, d) => n + checkCount(d), 0);
  if (checks > 0) out.push({ tone: 'amber', icon: 'rule', label: `${checks} to check` });
  const unconfirmedShip = list.filter((d) => d.shipConfirmNeeded).length;
  if (unconfirmedShip > 0) {
    out.push({ tone: 'amber', icon: 'help_outline', label: unconfirmedShip > 1 ? `${unconfirmedShip} ship not confirmed` : 'Ship not confirmed' });
  }
  return out;
});

const CONTEXT_WORDS: Record<string, string> = {
  arrival: 'arrival',
  departure: 'departure',
  both: 'arrival & departure',
};

/** Errors + warnings from the checks stored at upload (spec 0050). */
function checkCount(d: PortCallDocument): number {
  return (d.summary?.errorCount ?? 0) + (d.summary?.warningCount ?? 0);
}

function docSummaryLine(d: PortCallDocument): string {
  if (d.parseStatus !== 'parsed') return d.parseNote ?? '';
  const parts: string[] = [];
  const s = d.summary;
  // The form's name rides here now the row has no pill (user 2026-10-20)
  if (s?.formName) parts.push(s.formName);
  if (s?.rowsLabel !== undefined) parts.push(`${s.rowCount ?? 0} ${s.rowsLabel}`);
  if (d.context) parts.push(CONTEXT_WORDS[d.context] ?? d.context);
  // The check count lives in the amber pill beside — not repeated here
  if (s?.warnings?.[0]) parts.push(s.warnings[0]);
  return parts.length > 0 ? parts.join(' · ') : 'read';
}

async function loadDocs(): Promise<void> {
  try {
    docs.value = await auth.listCallDocuments(props.call.id);
  } catch {
    docs.value = [];
  }
}

const reportUploading = ref(false);
/** The notices share the call's saved files; recognized forms also refresh their data. */
async function uploadReportFiles(files: File[]): Promise<void> {
  if (!props.canUpload || reportUploading.value || removing.value || !files.length) return;
  reportUploading.value = true;
  let changed = false;
  try {
    for (const file of files) {
      try {
        const doc = await auth.uploadCallDocument(props.call.id, file);
        docs.value = [doc, ...(docs.value ?? []).filter(d => d.id !== doc.id && !doc.supersededIds?.includes(d.id))];
        changed = true;
      } catch (error) {
        $q.notify({ type: 'negative', message: error instanceof Error ? error.message : `Could not upload “${file.name}”.` });
      }
    }
    if (changed) {
      await loadDocs();
      noaRefresh.value++;
      emit('changed');
    }
  } finally {
    reportUploading.value = false;
  }
}

function pickFiles(): void {
  fileInput.value?.click();
}

function onPicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  openFormsWizard(files);
}

function onDragEnter(event: DragEvent): void {
  if (!props.canUpload || props.process) return;
  if (!event.dataTransfer?.types.includes('Files')) return;
  dragDepth.value++;
}

function onDragLeave(): void {
  if (dragDepth.value > 0) dragDepth.value--;
}

function onDrop(event: DragEvent): void {
  dragDepth.value = 0;
  if (!props.canUpload) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  openFormsWizard(files);
}

const confirmingShip = ref(false);

/** "Yes, this form is our ship's" from the document view (spec 0093 D4). */
async function confirmShip(): Promise<void> {
  const doc = openedDoc.value;
  if (!doc) return;
  confirmingShip.value = true;
  try {
    const row = await auth.confirmCallDocumentShip(props.call.id, doc.id);
    openedDoc.value = row;
    if (docs.value !== null) docs.value = docs.value.map((d) => (d.id === row.id ? row : d));
    emit('changed');
  } catch (e) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Could not confirm the ship.' });
  } finally {
    confirmingShip.value = false;
  }
}

/** Dropped or picked files open the forms wizard (spec 0093 §4). */
function openFormsWizard(files: File[]): void {
  if (files.length === 0 || formsOpen.value) return;
  stageSectionUploads(props.call.id, files);
  goSection('upload');
}

/** Resume the wizard over the saved forms — nothing is uploaded again. */
function openFormsReview(): void {
  if (formsOpen.value) return;
  goSection('documents');
}

/** A report pill in Send to NEMO (user 2026-11-05): Review forms opens over
    it at that report's table; closing it brings the NOA wizard's gaps up to date. */
const formsStartAt = ref<string | undefined>(undefined);
const formsReportCode = ref<string | undefined>(undefined);
const noaRefresh = ref(0);
function openFormsAt(table: string, reportCode?: string): void {
  if (formsOpen.value && !(modulePage.value && route.params.section === 'upload')) return;
  formsReportCode.value = reportCode;
  if (modulePage.value && !formsPage.value) { formsFiles.value = []; formsStartAt.value = table; formsOpen.value = true; return; }
  goSection('documents', undefined, { table, ...(reportCode ? { report: reportCode } : {}) });
}
/* The port call edited from the NOA wizard's "Edit details": once the call
   comes back changed, the wizard's facts catch up */
watch(
  () => props.call,
  () => {
    if (noaOpen.value) noaRefresh.value++;
  },
);
watch(formsOpen, (open) => {
  if (open) return;
  formsStartAt.value = undefined;
  formsReportCode.value = undefined;
  if (noaOpen.value) noaRefresh.value++;
});

/** The wizard saved or changed forms: the list and the call catch up. */
function onFormsChanged(): void {
  void loadDocs();
  emit('changed');
}

// ---- document detail + removal --------------------------------------------

const docDialog = ref(false);
const openedDoc = ref<PortCallDocument | null>(null);
const docDetail = ref<PortCallDocumentDetail | null>(null);

// The checks come back recomputed on every read (spec 0050)
const freshChecks = computed(() => docDetail.value?.checks ?? null);

function annOf(path: string): CheckAnnotation | undefined {
  return freshChecks.value?.annotations[path];
}

// ---- corrections + the port at hand (spec 0051) ---------------------------

function corrOf(path: string) {
  return docDetail.value?.corrections?.[path];
}

/** A value worth tapping: checked, or already corrected. */
function marked(path: string): boolean {
  return !!annOf(path) || !!corrOf(path);
}

function markClasses(path: string): string[] {
  const classes = ['ann'];
  const ann = annOf(path);
  if (ann && ann.severity !== 'ok') classes.push(`ann--${ann.severity}`);
  if (corrOf(path)) classes.push('ann--corrected');
  return classes;
}

/** What the table shows: the correction wins, the file's value in the dialog. */
function displayVal(path: string, raw: string): string {
  return corrOf(path)?.value ?? raw;
}

const annDialog = ref(false);
const annInfo = ref<CorrectionTarget | null>(null);

function openAnn(path: string, label: string, raw: string): void {
  const d = docDetail.value;
  const source = d ? [d.parsed?.form?.formName, d.fileName].filter(Boolean).join(' · ') : undefined;
  annInfo.value = { path, label, raw, source, ann: annOf(path) ?? null, corr: corrOf(path) ?? null };
  annDialog.value = true;
}

/** A saved correction: fresh checks and counts on the open document. */
function onCorrected(result: Awaited<ReturnType<typeof auth.correctCallDocument>>): void {
  const doc = openedDoc.value;
  if (!doc || !docDetail.value) return;
  docDetail.value = {
    ...docDetail.value,
    checks: result.checks,
    corrections: result.corrections,
    summary: result.document.summary,
  };
  if (docs.value !== null) {
    docs.value = docs.value.map((d) =>
      d.id === doc.id ? { ...d, summary: result.document.summary } : d,
    );
  }
}

const detailColumns = computed<string[]>(() => {
  const rows = docDetail.value?.parsed?.form?.rows ?? [];
  const cols: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!cols.includes(key)) cols.push(key);
    }
  }
  return cols;
});


function openDoc(d: PortCallDocument): void {
  goSection('document', d.id);
}

function loadDocument(d: PortCallDocument): void {
  openedDoc.value = d;
  docDetail.value = null;
  docDialog.value = true;
  void (async () => {
    try {
      docDetail.value = await auth.callDocumentDetail(props.call.id, d.id);
    } catch {
      docDialog.value = false;
      $q.notify({ type: 'negative', message: 'Could not load the document.' });
    }
  })();
}

const removeDialog = ref(false);
const removeTarget = ref<PortCallDocument | null>(null);
const removing = ref(false);

function canRemoveDoc(d: PortCallDocument): boolean {
  if (props.isOperator) return true;
  return !!props.canUpload && d.uploadedBy === auth.user.value?.username;
}

function askRemoveDoc(d: PortCallDocument): void {
  removeTarget.value = d;
  removeDialog.value = true;
}

async function doRemoveDoc(): Promise<void> {
  const target = removeTarget.value;
  if (!target) return;
  removing.value = true;
  try {
    await auth.removeCallDocument(props.call.id, target.id);
    removeDialog.value = false;
    if (docs.value !== null) {
      docs.value = docs.value.filter((d) => d.id !== target.id);
    }
    noaRefresh.value++;
    emit('changed');
    if (modulePage.value && route.params.section === 'document') goSection('documents');
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not remove the document.',
    });
  } finally {
    removing.value = false;
  }
}

// ---- history behind a button ----------------------------------------------

const logOpen = ref(false);
const events = ref<TimelineEvent[] | null>(null);

function toggleLog(): void {
  logOpen.value = !logOpen.value;
  if (logOpen.value) void loadLog();
}

async function loadLog(): Promise<void> {
  if (events.value) return;
  try {
    // Newest first in log views (docs/07 law 12)
    events.value = (await auth.portCallTimeline(props.call.id)).slice().reverse();
  } catch {
    events.value = [];
  }
}

const processCall = computed<PortCall>(() => ({
  ...props.call,
  obligations: [...props.call.obligations, ...noaRiders.value.filter(r => !props.call.obligations.some(o => o.code === r.code)).map(riderObligation)],
}));
/**
 * The page's report badges, in filling order (user 2026-11-12): the card's
 * flow chips, plus one badge per report an uploaded document adds.
 */
/** The flow chips with the reports of `codes` slotted in: arrival reports before Pre-arr, departure reports before Pre-dep. */
function withDocumentReports(flow: Obligation[], codes: string[]): Obligation[] {
  const shown = new Set(flow.map((o) => o.code));
  const added = codes
    .filter((code, i, all) => !shown.has(code) && all.indexOf(code) === i)
    .map((code) => processCall.value.obligations.find((o) => o.code === code)
      ?? { ...at(code), title: SITUATIONAL.find((x) => x.code === code)?.title ?? code });
  if (!added.length) return flow;
  const arrival = added.filter((o) => !DEPARTURE_REPORTS.has(o.code));
  const departure = added.filter((o) => DEPARTURE_REPORTS.has(o.code));
  const out: Obligation[] = [];
  let arrivalIn = false;
  let departureIn = false;
  for (const o of flow) {
    if (!arrivalIn && o.group !== 'call') { out.push(...arrival); arrivalIn = true; }
    if (!departureIn && (o.group === 'predeparture' || o.group === 'departure')) { out.push(...departure); departureIn = true; }
    out.push(o);
  }
  if (!arrivalIn) out.push(...arrival);
  if (!departureIn) out.push(...departure);
  return out;
}
const documentCodes = computed(() => documentReportCodes(processCall.value, docs.value ?? []));
const processBadges = computed<Obligation[]>(() => withDocumentReports(flowChips.value, documentCodes.value));
/** Front-page cards and list rows: the flow chips plus the cargo reports of uploaded documents (user 2026-11-12). */
const CARD_DOCUMENT_REPORTS = new Set(['CGA', 'CGD']);
const cardChips = computed<Obligation[]>(() => withDocumentReports(flowChips.value, documentCodes.value.filter((code) => CARD_DOCUMENT_REPORTS.has(code))));
/**
 * A badge on a card or list row opens the same view as its row on the port
 * call page (user 2026-11-12): a wizard report its section, a document report
 * (cargo) the report the page's row opens.
 */
function chipOpens(code: string): boolean {
  if (!vidSent.value) return false;
  if (wizardOf(code)) return canCreateVid.value;
  return CARD_DOCUMENT_REPORTS.has(code) && (!!props.canUpload || canCreateVid.value);
}
function openChip(code: string): void {
  if (wizardOf(code)) void openWizardFor(code);
  else void openProcessAction({ kind: 'report', code });
}
async function openProcessAction(action: ProcessAction): Promise<void> {
  if (action.kind === 'document') {
    const doc = docs.value?.find(d => d.id === action.id);
    if (doc) openDoc(doc);
    return;
  }
  if (action.kind === 'review') {
    if (props.canUpload) openFormsReview();
    return;
  }
  if (action.kind === 'forms') { openFormsAt(action.section); return; }
  if (action.kind === 'edit') { emit('edit', props.call); return; }
  if (action.kind === 'report' && ['CGA', 'CGD'].includes(action.code) && props.canUpload) {
    openFormsAt('cargo', action.code);
    return;
  }
  if (!canCreateVid.value) return;
  if (action.kind === 'noa') {
    if (!(await visitAlive())) return;
    goSection('pre-arrival', undefined, { step: action.step });
    return;
  }
  if (wizardOf(action.code)) {
    noaStartAt.value = 'reports';
    await openWizardFor(action.code);
  } else if (await visitAlive()) {
    goSection('report', action.code);
  }
}
// The URL owns the open section, including reloads and browser Back/Forward.
let sectionRequest = 0;
const sectionLoading = ref(false);
const sectionError = ref('');
watch(() => route.fullPath, async () => {
  const request = ++sectionRequest;
  wizardOpen.value = false;
  noaOpen.value = false;
  nodOpen.value = false;
  actualKind.value = null;
  formsOpen.value = false;
  docDialog.value = false;
  reportCode.value = null;
  sectionError.value = '';
  sectionLoading.value = false;
  if (route.name !== 'port-call-section' || route.params.callId !== props.call.id) return;
  const section = String(route.params.section);
  if (['upload', 'documents', 'document', 'pre-arrival', 'pre-departure'].includes(section)) {
    sectionLoading.value = true;
    await loadDocs();
    if (request !== sectionRequest) return;
    sectionLoading.value = false;
  }
  if (['upload', 'documents'].includes(section) && props.canUpload) {
    formsFiles.value = takeSectionUploads(props.call.id);
    formsStartAt.value = typeof route.query.table === 'string' ? route.query.table : undefined;
    const declaration = route.query.report;
    formsReportCode.value = formsStartAt.value === 'cargo' && typeof declaration === 'string' && ['CGA', 'CGD'].includes(declaration) ? declaration : undefined;
    formsOpen.value = true;
  } else if (section === 'document') {
    const document = docs.value?.find(doc => doc.id === route.params.itemId);
    if (document) loadDocument(document);
    else sectionError.value = 'This document is no longer available.';
  } else if (canCreateVid.value) {
    if (section === 'nemo' || section === 'ship-data') {
      wizardStart.value = section === 'ship-data' ? 'ship' : 'vid';
      wizardOpen.value = true;
    } else if (section === 'pre-arrival') {
      const step = route.query.step;
      noaStartAt.value = step === 'facts' || step === 'send' ? step : 'reports';
      noaOpen.value = true;
    } else if (section === 'arrival' || section === 'departure') {
      actualKind.value = section === 'arrival' ? 'arrival' : 'departure';
    } else if (section === 'pre-departure') nodOpen.value = true;
    else if (section === 'report' && typeof route.params.itemId === 'string') reportCode.value = route.params.itemId;
    else sectionError.value = 'This section is not available. Return to the port call overview or continue below.';
  } else sectionError.value = 'You do not have permission to open this section.';
}, { immediate: true });

onMounted(() => {
  if (props.process) { onShow(); void loadRiders(); }
  // A card or list row needs its documents for the cargo report badges
  else if ((props.call.documentCount ?? 0) > 0 && docs.value === null) void loadDocs();
});

function onShow(): void {
  void loadAreaName();
  if (docs.value === null) void loadDocs();
}
</script>

<style scoped>
.process-applicable { display: flex; flex-direction: column; gap: 16px; margin-top: 32px; }
.process-applicable__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding: 0; list-style: none; }
.process-audit { margin-top: 46px; }
.process-audit .audit-toggle { margin-top: 0; }
.gone-choices {
  margin: 8px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 4px;
}
.call-wrap {
  position: relative;
  transition: opacity 0.18s ease;
}
/* Focus mode (spec 0054, law 16): while one row is open the others step
   back — hovering one brings it forward, it stays a live target. */
.call-wrap--muted {
  opacity: 0.6;
}
.call-wrap--muted:hover {
  opacity: 0.9;
}
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--nl-teal-dark);
  border-radius: 10px;
  background: var(--nl-teal-bg);
  color: var(--nl-teal-dark);
  font-weight: 600;
  font-size: 14px;
  pointer-events: none;
}
/* Flat (guide p. 10): white, no border, no shadow; the table or the card
   gives the frame */
.call-block {
  background: var(--nl-card);
  overflow: hidden; /* the sunken body clips to the card's corners */
}
/* Port call card (guide p. 13): white on base, radius 10, no border */
.call-wrap--card .call-block {
  border-radius: 10px;
}
/* Table rows are divided by the lightest stroke, Blue/500 */
.call-wrap--row + .call-wrap--row {
  border-top: 1px solid var(--nl-g-line-row);
}
/* Row padding 18/24; card inset 34px, 48px at the bottom */
.call-block :deep(.call-header) {
  padding: 18px 24px;
  align-items: flex-start;
}
.call-wrap--card .call-block :deep(.call-header) {
  padding: 24px 24px 40px; /* Figma 297:2634 (user 2026-10-31) */
}
/* Phones: as much under the card's content as over it (user 2026-11-06) */
@media (max-width: 599.98px) {
  .call-wrap--card:not(.call-wrap--open) .call-block :deep(.call-header) {
    padding-bottom: 24px;
  }
}
.call-wrap--open .call-block :deep(.call-header) {
  padding: 18px 24px;
  align-items: center;
}
.call-wrap--card.call-wrap--open .call-block :deep(.call-header) {
  padding: 24px 34px;
}
/* No hover wash on a row or card (user 2026-10-31); keyboard focus keeps it */
.call-block :deep(.call-header.q-hoverable:hover:not(:focus-visible):not(.q-manual-focusable--focused) > .q-focus-helper) {
  opacity: 0;
}

/* ---- the folded call: one grid, two layouts (guide p. 13) */
.chead {
  display: grid;
  width: 100%;
  min-width: 0;
  color: var(--nl-g-body);
}
/* Table row: Vessel · Port & route · ETA · ETD · Reports; status, name
   and the deadline share the first cell */
.chead--row {
  grid-template-columns: var(--nl-call-cols);
  column-gap: 16px;
  grid-template-areas:
    'status port eta etd reports'
    'name   port eta etd reports'
    'due    port eta etd reports';
  grid-template-rows: auto auto 1fr;
}
/* Level with the vessel cell's top: the status line, then the name —
   every group (user 2026-11-02) */
.chead--row .chead__port,
.chead--row .chead__time,
.chead--row .chead__reports {
  align-self: start;
}
/* Card: status, name, pills, warning, then the facts (port, route, times)
   in place of the port line and time columns */
.chead--card {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'status' 'name' 'reports' 'due' 'facts';
}
.chead--card .chead__time,
.chead--card .chead__port {
  display: none;
}
.chead__status {
  grid-area: status;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  line-height: normal;
  font-weight: 600;
}
.chead__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.chead__status--blue {
  color: var(--nl-g-blue);
}
.chead__status--green {
  color: var(--nl-g-green);
}
.chead__status--slate {
  color: var(--nl-g-secondary);
}
.chead--card .chead__status {
  gap: 12px;
  font-size: 14px;
  line-height: 21px;
  margin-bottom: 10px; /* card status → name (guide p. 9) */
}
.chead--card .chead__dot {
  width: 8px;
  height: 8px;
}
.chead__name {
  grid-area: name;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--nl-g-ink);
  font-size: 16px;
  line-height: 21px;
  font-weight: 600;
}
.chead--card .chead__name {
  font-size: 22px; /* Heading/22: a card's title */
  line-height: normal;
  letter-spacing: 0.22px;
}
.chead__port {
  grid-area: port;
  min-width: 0;
  font-size: 14px;
  line-height: normal;
}
.chead__port-name,
.chead__route {
  overflow-wrap: anywhere;
}
.chead__time {
  font-size: 14px;
  line-height: normal;
}
.chead__time--eta {
  grid-area: eta;
}
.chead__time--etd {
  grid-area: etd;
}
/* The column head says ETA/ETD; the tag shows only when the heads are gone */
.chead__time-tag {
  display: none;
  font-weight: 600;
  color: var(--nl-g-ink);
}
.chead__actual {
  color: var(--nl-g-secondary);
}
.chead__reports {
  grid-area: reports;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px;
  min-width: 0;
}
/* Rows of chips 10px apart: each chip carries the 10px above it (so the
   empty break line adds nothing), the first row's taken off the 16px */
.chead--card .chead__reports {
  column-gap: 10px;
  row-gap: 0;
  margin-top: 6px;
}
.chead--card .chead__reports > * {
  margin-top: 10px;
}
/* A full-width break: the next chip starts a new row */
.chead--card .chead__reports > .chead__break {
  flex-basis: 100%;
  height: 0;
  margin-top: 0;
}
/* The deadline (guide p. 4): in a row, the #803034 title with the 28px
   urgent button beside it (user 2026-10-31), under it only when the cell is
   too narrow */
.chead__due {
  grid-area: due;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding-top: 12px;
}
.chead__warn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.chead__warn-title {
  color: var(--nl-g-warn-title);
  font-size: 14px;
  line-height: normal;
  font-weight: 600;
}
.chead__warn-text {
  display: none;
}
/* Urgent button (guide p. 11): red, radius 6, white text — at most one */
.chead__urgent {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: var(--nl-g-red);
  color: var(--nl-on-fill);
  font: inherit;
  font-size: 14px;
  line-height: normal;
  font-weight: 600;
  cursor: pointer;
}
.chead__urgent:hover {
  filter: brightness(0.94);
}
.chead__urgent:focus-visible {
  outline: 2px solid var(--nl-g-blue);
  outline-offset: 2px;
}
/* On a card the deadline is a warning box after the pills: Red/100, radius
   12, the title and one sentence at 14px, then the button — the 16px box
   scaled down to match (padding 14, 30px button 12px under the text) */
.chead--card .chead__due {
  padding-top: 24px;
  align-items: stretch;
}
.chead--card .chead__warn {
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: flex-start;
  gap: 4px;
  padding: 14px;
  border-radius: 12px;
  background: var(--nl-g-warn-fill);
}
.chead--card .chead__warn-title,
.chead--card .chead__warn-text {
  font-size: 14px;
  line-height: normal;
}
.chead--card .chead__warn-text {
  display: block;
  color: var(--nl-g-warn-text);
}
.chead--card .chead__urgent {
  height: 30px;
  margin-top: 8px; /* 12px under the text */
}
/* The facts (Figma 266:8298 at 14px): 32px under what comes before; label
   and value columns, rows 10px apart with a hairline under each */
.chead__facts {
  grid-area: facts;
  margin: 32px 0 0;
  font-size: 14px;
  line-height: normal;
}
.chead__fact {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  column-gap: 12px;
  padding: 10px 0;
}
.chead__fact:first-child {
  padding-top: 0;
}
.chead__fact dt {
  color: var(--nl-g-secondary);
}
.chead__fact dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--nl-g-ink);
}
.chead__fact-time {
  display: flex;
  flex-wrap: wrap;
  column-gap: 14px;
}
/* Narrow screens: the table heads go, the row stacks like a short card */
@media (max-width: 899px) {
  .chead--row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      'status status'
      'name name'
      'port port'
      'eta etd'
      'reports reports'
      'due due';
    grid-template-rows: none;
  }
  .chead--row .chead__port,
  .chead--row .chead__time,
  .chead--row .chead__reports {
    padding-top: 8px;
  }
  .chead--row .chead__time-tag {
    display: inline;
  }
}
/* "+N" (Figma 401:8622): a 24px table pill, white with the 1px Blue/700
   line, its count 12px SemiBold Text/300 */
.more-pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--nl-g-field-line);
  border-radius: 12px;
  background: var(--nl-g-white);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--nl-g-ink);
  white-space: nowrap;
  cursor: pointer;
}
.more-pill:focus-visible {
  outline: 2px solid var(--nl-g-blue);
  outline-offset: 2px;
}
/* The chip as a button (spec 0075) — the pill is the whole target */
.vid-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  border-radius: 999px;
  line-height: 1;
}
.vid-btn:hover :deep(.pill) {
  filter: brightness(0.94);
}
.vid-btn:focus-visible {
  outline: 2px solid var(--nl-g-blue);
  outline-offset: 2px;
}
/* NEMO refused a report: red words with the icon (guide p. 4) */
.head-errors__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  color: var(--nl-g-red);
  font: inherit;
  font-size: 14px;
  line-height: normal;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.head-errors__btn:hover span {
  text-decoration: underline;
}
.head-act {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 16px;
  margin-top: 8px;
}
/* The one next thing: filled blue (D2 — green only for the closed call) */
.act-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 6px 14px;
  border: none;
  border-radius: 10px;
  background: var(--nl-primary);
  color: var(--nl-on-fill);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.act-btn:hover {
  filter: brightness(1.08);
}
/* Create in NEMO: yellow like the unsent VID chip — the call is not in NEMO yet (2026-10-06) */
.act-btn--create {
  background: var(--nl-g-yellow);
  color: var(--nl-amber-ink);
}
.act-btn--create:hover {
  filter: brightness(0.97);
}
.act-btn:focus-visible {
  outline: 2px solid var(--nl-slate);
  outline-offset: 2px;
}
.act-btn__verb {
  font-weight: 600;
}
.act-btn__state {
  font-size: 12px;
  opacity: 0.92;
}
.act-btn__state--overdue {
  font-weight: 600;
  opacity: 1;
}
.act-next {
  font-size: 14px;
  color: var(--nl-ink-2);
}
.act-next--soon {
  color: var(--nl-amber-text);
}
.act-next--overdue {
  color: var(--nl-red-text);
  font-weight: 600;
}
.act-progress {
  /* A phone's bar; a desktop has the chips above (and an empty item here
     would hold the button off the right edge) */
  display: none;
  align-items: center;
  gap: 8px;
}
/* The bar is for a phone; a desktop has the chips beside it */
.act-segs {
  display: none;
  gap: 3px;
}
.act-seg {
  width: 22px;
  height: 5px;
  border-radius: 3px;
  background: var(--nl-gray-bg);
}
.act-seg--red {
  background: var(--nl-red);
}
.act-seg--amber {
  background: var(--nl-amber);
}
.act-seg--teal {
  background: var(--nl-teal);
}
.act-seg--green {
  background: var(--nl-green);
}
.act-seg--blue {
  background: var(--nl-blue);
}
.act-seg--violet {
  background: var(--nl-nemo);
}
.act-seg--gray {
  background: var(--nl-line-2);
}
/* Opened, the body sits on the house's tinted ground (spec 0044's
   sectioned anatomy) so the white input fields carry the eye */
.body {
  padding: 22px 22px 14px;
  border-top: 1px solid var(--nl-line);
  background: var(--nl-ground);
}
.body :deep(.q-field--outlined .q-field__control) {
  background: var(--nl-card);
}
/* A gray pill's own tint is too close to the body ground — on the tint it
   keeps its edge as a white chip with a hairline (no height change) */
.body :deep(.pill--gray) {
  background: var(--nl-card);
  box-shadow: inset 0 0 0 1px var(--nl-line);
}
.suggestion-strip {
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
}
.fact-text {
  font-size: 14px;
  line-height: 1.6;
}
.fact-text--sub {
  color: var(--nl-ink-2);
}
/* ---- opened header (user 2026-10-20): the ship, then a column per stage */
.ohead {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(170px, 1.35fr) repeat(5, minmax(0, 1fr));
  align-items: stretch;
}
.ohead-ship {
  min-width: 0;
  padding: 2px 14px 2px 2px;
}
.ohead-ship__name {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}
.ohead-ship__port {
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
}
.ohead-ship__status {
  margin-top: 10px;
}
.ohead-stage {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 12px 10px;
  border-left: 1px solid var(--nl-line);
}
/* The stage a deadline presses on wears it: red when due, amber when close */
.ohead-stage--overdue,
.ohead-stage--soon {
  border-left-color: transparent;
  border-radius: 8px;
}
.ohead-stage--overdue {
  background: var(--nl-red-bg);
}
.ohead-stage--soon {
  background: var(--nl-amber-bg);
}
.ohead-stage--overdue + .ohead-stage,
.ohead-stage--soon + .ohead-stage {
  border-left-color: transparent;
}
.ohead-stage__label {
  font-size: 12px;
  color: var(--nl-ink-2);
}
.ohead-stage__chips {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.ohead-stage__state {
  font-size: 12px;
  color: var(--nl-ink-2);
}
.ohead-stage__due {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ohead-stage--overdue .ohead-stage__due {
  color: var(--nl-red-text);
}
.ohead-stage--soon .ohead-stage__due {
  color: var(--nl-amber-text);
}
/* On the white header a gray chip keeps the hairline it has in the body */
.ohead :deep(.pill--gray) {
  background: var(--nl-card);
  box-shadow: inset 0 0 0 1px var(--nl-line-2);
}
/* ---- the steps rail (user 2026-10-20) */
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
}
.step {
  position: relative;
  display: flex;
  gap: 18px;
  padding-bottom: 46px;
}
/* The rail joins one dot to the next */
.step:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 32px;
  bottom: 0;
  width: 2px;
  background: var(--nl-line-2);
}
.step__dot {
  flex: 0 0 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 2px solid var(--nl-line-2);
  background: var(--nl-card);
  color: var(--nl-ink-2);
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.step--done .step__dot {
  background: var(--nl-primary);
  border-color: var(--nl-primary);
  color: var(--nl-on-fill);
}
.step--current .step__dot {
  border-color: var(--nl-primary);
  color: var(--nl-primary);
}
.step__main {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 520px;
}
.step__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  min-height: 32px;
  margin-bottom: 6px;
}
.step__title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 16px;
  font-weight: 600;
}
.step__chips {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
/* The fields keep room under them for an error line — that is the gap */
.step__fields {
  display: grid;
  gap: 0;
}
/* The last field's error line lives in the step gap, so every step sits
   the same distance below the one before (user 2026-10-20) */
.step__fields > :last-child {
  margin-bottom: -20px;
}
/* ---- documents: the list, then the drop zone */
.doc-list {
  margin-top: 10px;
}
/* The file takes the room; its meta and actions keep their line */
.doc-list .doc-main {
  flex: 1 1 0;
}
.doc-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-top: 6px;
}
.drop-zone {
  border: 1.5px dashed var(--nl-line-2);
  border-radius: 10px;
  background: var(--nl-gray-bg);
  padding: 18px 20px;
}
.drop-zone__text {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.drop-zone__icon {
  color: var(--nl-ink-2);
  flex: none;
}
.drop-zone__title {
  font-size: 14px;
  font-weight: 600;
}
.drop-zone__btn {
  margin-top: 14px;
  padding: 4px 14px;
}
/* ---- reports: label column, chips beside */
.rep-grid {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  gap: 8px 12px;
  align-items: start;
}
.rep-grid__label {
  font-size: 14px;
  color: var(--nl-ink-2);
  padding-top: 3px;
}
.rep-grid__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 6px;
}
/* ---- actions and the audit */
/* Edit, then Cancel under it (user 2026-10-20) */
.call-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 24px;
}
.call-actions__edit {
  min-height: 40px;
  padding: 0 18px;
  font-weight: 600;
}
/* Black ink, disabled or not (user 2026-10-20); the cursor and tooltip say when it is off */
.call-actions__cancel,
.call-actions__cancel.disabled {
  color: var(--nl-ink) !important;
  opacity: 1 !important;
}
/* Flush with the Edit button's left edge */
.call-actions__cancel {
  padding-left: 0;
  padding-right: 0;
  min-height: 0;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.audit-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 22px;
  padding: 4px 0;
  border: none;
  background: none;
  color: var(--nl-primary);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.audit-toggle:focus-visible {
  outline: 2px solid var(--nl-teal-dark);
  outline-offset: 2px;
  border-radius: 4px;
}
.log-panel {
  border-top: 1px solid var(--nl-line-2);
  margin-top: 8px;
  padding-top: 4px;
}
/* Name, area and berth each wrap as one piece (user rule 2026-09-02) */
.place-seg {
  display: inline-block;
  max-width: 100%;
}
.route-line {
  color: var(--nl-ink-2);
  font-size: 12px;
  padding-top: 4px;
}
.route-line b {
  color: var(--nl-ink);
}
.route-arrow {
  color: var(--nl-ink-3);
}
.save-bar {
  background: var(--nl-teal-bg);
  color: var(--nl-teal-dark);
  border-radius: 8px;
  padding: 6px 8px 6px 12px;
}
.file-input {
  display: none;
}
.doc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  cursor: pointer;
}
.doc-row + .doc-row {
  border-top: 1px dashed var(--nl-line-2);
}
.doc-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.doc-main {
  flex: 1 1 auto;
  min-width: 0;
}
.doc-name {
  font-size: 14px;
  font-weight: 600;
}
.doc-meta {
  flex: 0 0 auto;
  max-width: 32%;
  text-align: right;
  line-height: 1.3;
}
.doc-note {
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
}
.doc-note--error {
  background: var(--nl-red-bg);
  color: var(--nl-red-text);
}
/* A checked value: dotted underline, tap for the reading (spec 0050) */
.ann {
  cursor: pointer;
  border-bottom: 1.5px dotted var(--nl-ink-3);
}
.ann--error {
  border-bottom-color: var(--nl-red-text);
  color: var(--nl-red-text);
  font-weight: 600;
}
.ann--warning {
  border-bottom-color: var(--nl-amber-text);
  color: var(--nl-amber-text);
  font-weight: 600;
}
/* Corrected in place (spec 0051): solid teal — visibly edited, tap for
   the file's original */
.ann--corrected {
  border-bottom: 1.5px solid var(--nl-teal-dark);
}
/* "Did you mean" rows (spec 0051): tap to pick the right code. The code
   never breaks — a long facility name wraps under itself instead. */
.doc-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 6px 16px;
}
.doc-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.doc-field__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--nl-ink-3);
}
.doc-field__value {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.doc-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--nl-line);
  border-radius: 8px;
}
.doc-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
}
.doc-table th {
  text-align: left;
  font-weight: 600;
  color: var(--nl-ink-2);
  background: var(--nl-gray-bg);
  padding: 6px 10px;
  white-space: nowrap;
}
.doc-table td {
  padding: 5px 10px;
  border-top: 1px solid var(--nl-line);
  white-space: nowrap;
}
/* Fintraffic's guide beside the report title (spec 0087) */
.rep-guide {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--nl-primary);
  text-decoration: none;
}
.rep-guide:hover {
  text-decoration: underline;
}
.rep-detail {
  background: var(--nl-card);
  border: 1px solid var(--nl-line);
  border-radius: 8px;
  padding: 8px 10px;
  margin-top: 6px;
  font-size: 14px;
}
.timeline-row {
  display: flex;
  gap: 10px;
  padding: 5px 0;
  align-items: flex-start;
}
.timeline-icon {
  color: var(--nl-ink-3);
  margin-top: 3px;
}
.timeline-meta {
  flex: 0 0 auto;
  max-width: 45%;
  text-align: right;
}
@media (max-width: 700px) {
  /* The block is already one big button — the caret earns no room */
  .call-block :deep(.call-header > .q-item__section--side) {
    display: none;
  }
  /* The reported time reads across the strip; its buttons go under it */
  .suggestion-strip {
    flex-wrap: wrap;
    row-gap: 6px;
  }
  .suggestion-strip > .col {
    flex: 1 1 calc(100% - 32px);
  }
  .act-btn {
    flex: 1 1 100%;
    justify-content: space-between;
    min-height: 44px;
  }
  .act-progress {
    display: inline-flex;
    flex: 1 1 100%;
  }
  .act-segs {
    display: inline-flex;
    flex: 1;
  }
  .act-seg {
    flex: 1;
    width: auto;
  }
  /* Phone: the ship over the stages, the stages three to a row */
  .ohead {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    row-gap: 8px;
  }
  .ohead-ship {
    grid-column: 1 / -1;
    padding-bottom: 6px;
  }
  .ohead-stage:nth-child(3n + 2) {
    border-left-color: transparent;
  }
  .step {
    gap: 12px;
  }
  .call-actions {
    padding-left: 0;
  }
  .rep-grid {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .rep-grid__chips {
    margin-bottom: 6px;
  }
  /* Phone: name, area and berth each on their own row, no separators */
  .place-seg {
    display: block;
  }
  .place-seg--berth::first-letter {
    text-transform: uppercase;
  }
  .place-dot {
    display: none;
  }
  /* Phone: the file and its actions on one line; the meta lives in the
     detail dialog (the status sits in the headline, user 2026-10-20) */
  .doc-meta {
    display: none;
  }
}
/* ---- the opened port call, a pop-up (canvas E4 · overview on the right,
   user 2026-11-04): the main column, then the 388px overview on Blue/300 */
.call-block {
  cursor: pointer;
}
.call-block:focus-visible {
  outline: 2px solid var(--nl-g-blue);
  outline-offset: -2px;
}
/* Version 3 again (user 2026-11-06): one column, 34px sides as the header
   and footer; no section list */
.pc {
  min-height: 100%;
  color: var(--nl-g-ink);
}
.pc-main {
  min-width: 0;
  padding: 24px 34px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
/* The port call card left, the reports overview right, 20px apart and
   equally tall */
.pc-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: stretch;
}
/* Port call and Reports side by side, each on its light grey card again
   (user 2026-11-06) */
.pc-card.pc-card--reports {
  gap: 14px;
}
/* The facts as the reports' rows: the value in ink */
.pc-facts--rows dd {
  font-size: 14px;
  letter-spacing: 0.14px;
  color: var(--nl-g-ink);
  overflow-wrap: anywhere;
}
/* Section: a blue dot and an uppercase title, 14px under it */
.pc-sec {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pc-sec__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
/* A heading with its help line under it, 4px apart */
.pc-sec__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* The help: an underlined content link in 14px body text (Body text/14) */
.pc-help {
  font-size: 14px;
  line-height: normal;
  letter-spacing: 0.14px;
}
/* Phones show no help links, so the empty line goes too */
.pc-help:empty {
  display: none;
}
.pc-help :deep(.nl-content-link) {
  letter-spacing: 0.14px;
}
/* Section headings: 16px SemiBold, no capitals (user 2026-11-06) */
.pc-sec__title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  line-height: normal;
  font-weight: 600;
  letter-spacing: 0.16px;
  color: var(--text-300);
}
.pc-chips {
  display: flex;
  align-items: center;
  gap: 5px;
}
.pc-chips--wrap {
  flex-wrap: wrap;
}
/* Schedule: four fields 20px apart, the label and its reports above each */
.pc-times {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.pc-time {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pc-time__label {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.14px;
  color: var(--nl-g-ink);
}
.pc-field {
  height: 44px;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 0 12px;
  border: 1.5px solid var(--nl-g-field-line);
  border-radius: 6px;
  background: var(--nl-g-white);
  font: inherit;
  text-align: left;
  color: var(--nl-g-ink);
  cursor: pointer;
}
.pc-field--read {
  cursor: default;
}
.pc-field--error {
  border-color: var(--nl-g-red);
}
.pc-field__value {
  font-size: 14px;
  letter-spacing: 0.14px;
}
.pc-field__value--empty {
  color: var(--nl-g-secondary);
}
.pc-field__pen {
  width: 36px;
  height: 36px;
  flex: none;
  color: var(--nl-g-ink);
}
.pc-time__error,
.pc-due {
  font-size: 12px;
  font-weight: 600;
  color: var(--nl-g-red);
}
.pc-due {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
}
/* Ship documents: one card, the head on Blue/200, every file listed */
.pc-files {
  border: 1px solid var(--blue-500);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.15s;
}
.pc-files--over {
  border-color: var(--nl-g-blue);
}
.pc-files__head {
  min-height: 64px;
  box-sizing: border-box;
  padding: 10px 8px 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--nl-g-subtle);
}
.pc-files__status {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pc-files__line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.pc-files__words {
  font-size: 15px;
  font-weight: 600;
}
.pc-files__sub {
  padding-left: 30px;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.24px;
  color: var(--nl-g-secondary);
}
.pc-files__sep {
  width: 1px;
  height: 26px;
  background: var(--blue-500);
}
.pc-files__toggle {
  width: 40px;
  height: 40px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--nl-g-ink);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pc-files__toggle .q-icon {
  transition: transform 0.15s;
}
.pc-files__chev--open {
  transform: rotate(180deg);
}
.pc-files__icon--ok {
  color: var(--nl-g-green);
}
.pc-files__icon--error {
  color: var(--nl-g-red);
}
.pc-files__icon--none {
  color: var(--nl-g-secondary);
}
.pc-files__btn {
  height: 40px;
  flex: none;
}
.pc-file {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 90px;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid var(--blue-500);
  cursor: pointer;
}
.pc-file__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.pc-file__name {
  font-size: 14px;
  font-weight: 600;
}
.pc-file__sub {
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 0.24px;
  color: var(--nl-g-secondary);
}
.pc-link {
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--nl-g-ink);
  text-decoration: underline;
  cursor: pointer;
}
.pc-files__foot {
  min-height: 52px;
  padding: 0 16px;
  border-top: 1px dashed var(--nl-g-field-line);
  display: flex;
  align-items: center;
  gap: 10px;
}
.pc-files__all {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--nl-g-ink);
  text-decoration: none;
}
.pc-files__all-link {
  text-decoration: underline;
}
.pc-files__count {
  font-size: 15px;
  color: var(--nl-g-secondary);
}
/* As applicable: topic tiles, three to a row */
/* The overview on Blue/200, a 90px label column */
.pc-card {
  padding: 16px 20px;
  border-radius: 10px;
  background: var(--nl-g-subtle);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.pc-facts {
  margin: 0;
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 12px 16px;
  align-items: center;
  font-size: 14px;
  letter-spacing: 0.14px;
}
.pc-facts dt {
  color: var(--nl-g-secondary);
}
.pc-facts dd {
  margin: 0;
  min-width: 0;
  color: var(--nl-g-ink);
  overflow-wrap: anywhere;
}
.pc-edit {
  align-self: flex-start;
  font-size: 14px;
}
/* Reports summary: one row per stage between hairlines */
.pc-reports {
  margin: 0;
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  border-top: 1px solid var(--blue-500);
}
.pc-reports dt,
.pc-reports dd {
  margin: 0;
  min-height: 44px;
  padding: 10px 0;
  border-bottom: 1px solid var(--blue-500);
  display: flex;
  align-items: center;
}
.pc-reports dt {
  font-size: 14px;
  color: var(--nl-g-body);
}
/* Tablet and narrower: the two cards stacked, the files bar wraps */
@media (max-width: 899px) {
  .pc-top {
    grid-template-columns: minmax(0, 1fr);
  }
  .pc-files__head {
    flex-wrap: wrap;
  }
  .pc-file {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
}
/* Phones keep their narrower sides */
@media (max-width: 599.98px) {
  /* 42px under the pop-up header's line, as every phone pop-up (user 2026-11-06) */
  .pc-main {
    padding: 42px 16px 20px;
  }
}
</style>

<style>
/* The pop-up's body: no padding, the overview reaches its edges
   (the dialog is teleported, hence unscoped) */
.pc-dialog .house-dialog__body {
  padding: 0 !important;
}
</style>
