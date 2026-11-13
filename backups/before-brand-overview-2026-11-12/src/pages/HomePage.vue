<template>
  <q-page class="home" :class="{ 'home--process': isProcessPage }">
    <!-- Page head: phones only — New port call button; rest in navbar (user 2026-11-06) -->
    <div v-if="isPhone && !isProcessPage" class="home-head">
      <div class="home-wrap">
        <div class="home-tools">
          <q-btn
            v-if="auth.isAdmin.value && !isCaptain"
            unelevated
            no-caps
            color="primary"
            label="New port call"
            class="home-new"
            @click="openCreate"
          />
        </div>
      </div>
    </div>

    <div v-if="isProcessPage && !isEditPage" class="process-page home-wrap">
      <div v-if="loading" class="q-py-lg"><q-spinner color="primary" size="32px" /></div>
      <template v-else-if="selectedCall">
      <PortCallBlock
        :key="selectedCall.id"
        process
        :refresh-call="reload"
        v-bind="blockProps(selectedCall)"
        @edit="openEdit"
        @cancel="openCancel"
        @confirm="openConfirm"
        @reject="openReject"
        @changed="reload"
      />
      </template>
      <p v-else role="status">This port call is no longer available.</p>
    </div>
    <div v-else-if="!isEditPage" class="home-body home-wrap">
      <div v-if="loading" class="row justify-center q-pa-lg">
        <q-spinner size="32px" color="primary" />
      </div>

      <template v-else>
        <!-- Empty states teach (law 8) -->
        <div v-if="isCaptain && calls.length === 0" class="teach-card">
          No port calls for your ship yet. If you expected to see calls
          here, your account may not be linked to a ship yet — ask your
          operator to assign your ship in the admin area.
        </div>
        <div v-else-if="calls.length === 0 && ships.length === 0" class="teach-card">
          No ships yet — ships are added in the admin area, and port calls
          appear automatically when your systems send voyage plans.
          <div v-if="auth.isAdmin.value" class="q-mt-sm">
            <router-link to="/admin/ships" class="nl-action-link">Add ships</router-link>
          </div>
        </div>
        <div v-else-if="calls.length === 0" class="teach-card">
          No port calls yet — they appear automatically when your systems
          send voyage plans<template v-if="auth.isAdmin.value">,
          or create one with “New port call”</template>.
        </div>
        <div
          v-else-if="filteredCalls.length > 0 && callGroups.length === 0"
          class="teach-card"
        >
          Nothing ahead or in port, and no departures.
        </div>

        <!-- Upcoming → Departed → Moored, newest on top in each (spec 0072);
             the port call is the key block (spec 0048). Moored sits at the
             bottom as a dropdown: its title, the count and a chevron, shut
             until clicked (user 2026-11-02) -->
        <section
          v-for="group in callGroups"
          :key="group.key"
          class="call-group"
          :class="`call-group--${group.key}`"
        >
          <div v-if="group.key === 'moored'" class="group-head">
            <h2 class="group-title">
              <button
                type="button"
                class="group-toggle"
                :aria-expanded="mooredOpen"
                aria-controls="moored-calls"
                @click="toggleMoored"
              >
                {{ group.title }}
                <q-icon
                  name="expand_more"
                  size="24px"
                  class="group-toggle__chevron"
                  :class="{ 'group-toggle__chevron--open': mooredOpen }"
                />
              </button>
            </h2>
          </div>
          <div v-else class="group-head">
            <h2 class="group-title">{{ group.title }}</h2>
          </div>
          <template v-if="group.key !== 'moored' || mooredOpen">
          <!-- Card view (guide p. 13–14): three to a row; an opened card
               takes the whole row -->
          <div v-if="showCards" :id="group.key === 'moored' ? 'moored-calls' : undefined" class="call-cards">
            <PortCallBlock
              v-for="call in group.calls"
              :key="call.id"
              layout="card"
              v-bind="blockProps(call)"
              @toggle="(open: boolean) => setOpen(call.id, open)"
              @edit="openEdit"
              @cancel="openCancel"
              @confirm="openConfirm"
              @reject="openReject"
              @changed="reload"
            />
          </div>

          <!-- List view (guide p. 13–14): a white table with a 4px bar in the
               group's colour, a #FAFAFC header row, rows 1px apart -->
          <div
            v-else
            :id="group.key === 'moored' ? 'moored-calls' : undefined"
            class="call-table"
            :class="`call-table--${group.key}`"
          >
            <div class="call-table__head" aria-hidden="true">
              <span>Vessel</span>
              <span>Port &amp; route</span>
              <span>ETA</span>
              <span>ETD</span>
              <span>Reports</span>
            </div>
            <PortCallBlock
              v-for="call in group.calls"
              :key="call.id"
              layout="row"
              v-bind="blockProps(call)"
              @toggle="(open: boolean) => setOpen(call.id, open)"
              @edit="openEdit"
              @cancel="openCancel"
              @confirm="openConfirm"
              @reject="openReject"
              @changed="reload"
            />
          </div>
          </template>
        </section>

        <p v-if="staleCount > 0" class="home-note">
          {{ staleCount }} past
          {{ staleCount === 1 ? 'call' : 'calls' }} never sent to NEMO
          {{ staleCount === 1 ? 'is' : 'are' }} not shown — too late to report.
        </p>

        <p v-if="calls.length > 0 && filteredCalls.length === 0" class="home-note">
          No port calls match “{{ search.trim() }}”.
          <button type="button" class="nl-action-link" @click="search = ''">Clear the search</button>
        </p>

        <!-- Ships without calls keep a slim row: "which of my ships needs me" -->
        <section v-if="!isCaptain && filteredIdleShips.length > 0" class="call-group">
          <div class="group-head">
            <h2 class="group-title">Ships without calls</h2>
          </div>
          <div class="idle-table">
            <div v-for="ship in filteredIdleShips" :key="ship.shipId" class="idle-row">
              <span class="idle-row__name">{{ ship.name ?? '—' }}</span>
              <span class="idle-row__imo tnum">IMO {{ ship.imoNumber ?? '—' }}</span>
              <q-space />
              <span class="idle-row__note">No planned calls</span>
            </div>
          </div>
        </section>
      </template>
    </div>

    <div v-if="isEditPage && loading" class="process-page home-wrap" role="status">
      <q-spinner color="primary" size="32px" /><span class="q-ml-sm">Loading port call…</span>
    </div>
    <p v-else-if="isEditPage && (!selectedCall || !auth.isAdmin.value || isCaptain)" class="process-page home-wrap" role="status">
      {{ selectedCall ? 'You do not have permission to edit this port call.' : 'This port call is no longer available.' }}
    </p>

    <!-- Direct editing uses a page; editing from a report retains its drawer or sheet. -->
    <component
      :is="isEditPage ? ModulePage : formUsesSheet ? HouseDialog : form.id ? PortCallDrawer : QDialog"
      v-model="formDialog"
      v-bind="formShellProps"
      @show="focusField(form.id ? 'port' : 'ship')"
      @main="saveCall"
    >
      <component
        :is="isEditPage || formUsesSheet ? 'div' : FormCard"
        v-bind="formCardProps"
        @close="formDialog = false"
        @main="saveCall"
      >
        <section class="fcard-section">
          <h2 class="fcard-section__title">Ship &amp; port</h2>
          <FormField v-if="!form.id" name="ship" label="Ship" for-id="pc-ship">
            <q-select
              popup-content-class="nl-field-menu"
              for="pc-ship"
              v-model="form.shipId"
              :options="shipOptions"
              outlined
              dense
              emit-value
              map-options
            />
          </FormField>
          <FormField
            name="port"
            label="Port"
            for-id="pc-port"
            :hint="form.visitId
              ? `In NEMO as ${form.visitId}. The port cannot change there: cancel the call and create a new one.`
              : 'Finnish ports NEMO knows, with their port areas and ISPS facilities.'"
          >
            <q-select
              popup-content-class="nl-field-menu"
              for="pc-port"
              v-model="form.portLocode"
              :options="portOptions"
              :disable="!!form.visitId"
              outlined
              dense
              use-input
              fill-input
              hide-selected
              emit-value
              map-options
              input-debounce="300"
              @filter="filterPorts"
              @update:model-value="onPortPicked"
            >
              <!-- The most-used ports in SemiBold (Figma "dropdown field / often used") -->
              <template #option="scope">
                <q-item v-bind="scope.itemProps" :class="{ 'nl-dd-often': scope.opt.often }">
                  <q-item-section>{{ scope.opt.label }}</q-item-section>
                </q-item>
              </template>
            </q-select>
          </FormField>
          <!-- "Fill in the port area and berth if they are known" (VID, emsw.fi) -->
          <FormField name="area" label="Port area" for-id="pc-area" optional :hint="areaHint">
            <q-select
              popup-content-class="nl-field-menu"
              for="pc-area"
              v-model="form.portAreaCode"
              :options="areaOptions"
              outlined
              dense
              emit-value
              map-options
              options-dense
              :disable="areaOptions.length === 0"
              @update:model-value="form.berth = ''"
            />
          </FormField>
          <FormField
            name="berth"
            label="Berth"
            for-id="pc-berth"
            optional
            :hint="form.portAreaCode ? 'Fill it in if it is known. The list holds the area’s berths in NEMO.' : 'Pick a port area first.'"
          >
            <q-select
              popup-content-class="nl-field-menu"
              for="pc-berth"
              v-model="form.berth"
              :options="berthOptions"
              outlined
              dense
              emit-value
              map-options
              options-dense
              :disable="berthOptions.length === 0"
            />
          </FormField>
        </section>

        <section class="fcard-section">
          <h2 class="fcard-section__title">ETA</h2>
          <ScheduleFields
            v-if="formDialog"
            id="pc-eta"
            v-model="form.eta"
            name="eta"
            :popup-side="form.id ? 'left' : 'right'"
            :today="todayDate"
            :min-date="originalTimes.eta && originalTimes.eta.slice(0, 10) < todayDate ? originalTimes.eta.slice(0, 10) : todayDate"
            :error="etaError"
            @incomplete="scheduleIncomplete.eta = $event"
          />
        </section>

        <section class="fcard-section">
          <h2 class="fcard-section__title">ETD</h2>
          <ScheduleFields
            v-if="formDialog"
            id="pc-etd"
            v-model="form.etd"
            name="etd"
            :popup-side="form.id ? 'left' : 'right'"
            :today="todayDate"
            :min-date="form.eta ? form.eta.slice(0, 10) : todayDate"
            :after="form.eta || undefined"
            :error="etdError"
            @incomplete="scheduleIncomplete.etd = $event"
          />
        </section>

        <section v-if="form.id" class="fcard-section">
          <h2 class="fcard-section__title">Actual arrival (ATA)</h2>
          <ScheduleFields
            v-if="formDialog"
            id="pc-ata"
            v-model="form.ata"
            name="ata"
            :popup-side="form.id ? 'left' : 'right'"
            :today="todayDate"
            min-date=""
            @incomplete="scheduleIncomplete.ata = $event"
          />
        </section>

        <section v-if="form.id" class="fcard-section">
          <h2 class="fcard-section__title">Actual departure (ATD)</h2>
          <ScheduleFields
            v-if="formDialog"
            id="pc-atd"
            v-model="form.atd"
            name="atd"
            :popup-side="form.id ? 'left' : 'right'"
            :today="todayDate"
            :min-date="form.ata ? form.ata.slice(0, 10) : ''"
            :after="form.ata || undefined"
            :error="atdError"
            @incomplete="scheduleIncomplete.atd = $event"
          />
        </section>

        <section class="fcard-section">
          <h2 class="fcard-section__title">Voyage &amp; cargo</h2>
          <FormField name="voyage" label="Voyage number" for-id="pc-voyage" optional>
            <q-input for="pc-voyage" v-model="form.voyageNumber" outlined dense />
          </FormField>
          <FormField
            name="cargo"
            label="Cargo"
            for-id="pc-cargo"
            optional
          >
            <q-select
              popup-content-class="nl-field-menu"
              for="pc-cargo"
              v-model="form.cargoItems"
              :options="cargoOptions"
              multiple
              use-chips
              use-input
              emit-value
              map-options
              input-debounce="300"
              outlined
              dense
              options-dense
              @filter="filterCargo"
            >
              <template #selected-item="scope">
                <q-chip dense :tabindex="scope.tabindex">{{ scope.opt.label }}</q-chip>
              </template>
            </q-select>
          </FormField>
          <FormField name="cargoNotes" label="Cargo notes" for-id="pc-cargo-notes" optional>
            <q-input for="pc-cargo-notes" v-model="form.cargoDescription" outlined dense />
          </FormField>
        </section>

        <section class="fcard-section">
          <h2 class="fcard-section__title">Route</h2>
          <FormField
            name="prev"
            label="Previous ports"
            for-id="pc-prev"
            optional
            hint="UN/LOCODEs, the most recent first, separated by commas. For example FIVAA, PLGDN."
          >
            <q-input for="pc-prev" v-model="form.prevPorts" outlined dense />
          </FormField>
          <FormField
            name="next"
            label="Next ports"
            for-id="pc-next"
            optional
            hint="UN/LOCODEs separated by commas, for example SEGOT. ZZUKN means the next port is not known."
          >
            <q-input for="pc-next" v-model="form.nextPorts" outlined dense>
              <template #append>
                <!-- In-field quick-set (docs/07 law 11): sets/clears the
                     unknown-next-port code; filled while active -->
                <q-btn
                  dense
                  size="12px"
                  :outline="!zzuknSelected"
                  :unelevated="zzuknSelected"
                  color="primary"
                  label="ZZUKN"
                  :aria-label="zzuknSelected ? 'Remove ZZUKN' : 'Set next port unknown (ZZUKN)'"
                  @click="zzuknSelected = !zzuknSelected"
                />
              </template>
            </q-input>
          </FormField>
        </section>
      </component>
      <template v-if="isEditPage" #secondary>
        <q-btn outline no-caps color="primary" label="Close" @click="closeEditPage" />
      </template>
    </component>

    <!-- Confirm a suggestion (operator) -->
    <HouseDialog
      v-model="confirmDialog"
      :title="confirmTarget?.field === 'ata' ? 'Confirm arrival' : 'Confirm departure'"
      :max-width-px="420"
      main-label="Confirm"
      :main-loading="saving"
      @main="doConfirm"
    >
      <template v-if="confirmTarget">
        <p class="text-body2 q-mb-sm">
          {{ confirmTarget.suggestion.sourceSystem }} reports
          {{ confirmTarget.field === 'ata' ? 'arrival' : 'departure' }} at
          <b class="tnum">{{ fmt(confirmTarget.suggestion.value) }}</b>.
          Confirming records it as the actual and moves the call’s stage.
        </p>
        <DateTimeField v-model="confirmValue" label="Time (adjust if needed)" />
      </template>
    </HouseDialog>

    <!-- Reject a suggestion (operator) -->
    <HouseDialog
      v-model="rejectDialog"
      title="Reject this report?"
      :max-width-px="420"
      main-label="Reject"
      main-color="negative"
      :main-loading="saving"
      @main="doReject"
    >
      <p v-if="rejectTarget" class="text-body2">
        The {{ rejectTarget.field === 'ata' ? 'arrival' : 'departure' }} time
        reported by {{ rejectTarget.suggestion.sourceSystem }}
        ({{ fmt(rejectTarget.suggestion.value) }}) will be cleared. It stays
        in the archive and the audit log; nothing is applied to the call.
      </p>
    </HouseDialog>

    <NemoResultDialog v-model="resultOpen" :exchanges="resultExchanges" :subtitle="resultSubtitle" />

    <!-- Cancel a call (admin). In NEMO it is the COA (spec 0080): the reason
         is the remark NEMO wants, so it is required there -->
    <RemovalDialog
      v-model="cancelDialog"
      kind="port-call"
      title="Are you sure you want to remove this port call?"
      :loading="saving"
      :disable="cancelInNemo && !cancelReason.trim()"
      @confirm="doCancel"
    >
      <p>
        {{ cancelTarget?.shipName ?? 'Ship' }} · {{ cancelTarget?.portName ?? cancelTarget?.portLocode ?? '—' }}.
        The call will be cancelled and removed from this page. Its history stays in the audit log.
        A cancelled call is never reopened by the source system.
      </p>
      <template #details>
        <template v-if="cancelInNemo">
          <p class="q-mb-sm">
            The port call is in NEMO as <b class="tnum">{{ cancelTarget?.visitId }}</b>.
            This sends the cancellation (COA): NEMO cancels the call and invalidates its VID and NOA.
            The visit id cannot be reused; a new call needs a new VID.
          </p>
          <q-input
            v-model="cancelReason"
            label="Reason — goes to NEMO as the cancellation remark"
            outlined dense maxlength="500" :disable="saving"
          />
          <div class="row q-gutter-sm q-mt-sm">
            <q-btn v-for="r in QUICK_REASONS" :key="r" outline dense no-caps color="primary"
              class="q-px-sm" :label="r" :disable="saving" @click="cancelReason = r" />
          </div>
        </template>
        <q-input v-else v-model="cancelReason" label="Reason (optional)" outlined dense maxlength="500" :disable="saving" />
      </template>
    </RemovalDialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fmtStamp } from '../lib/time';
import { callFormOpen, callEditDrawerOpen, callSearch, callCardView, callNewSignal } from '../lib/call-search';
import { QDialog, useQuasar } from 'quasar';
import { MOBILE_BREAKPOINT } from '../lib/breakpoints';
import {
  useAuth,
  type CargoItem,
  type FleetShip,
  type NextPort,
  type PendingSuggestion,
  NemoExchangeError,
  type NemoExchange,
  type PortCall,
  type PortAreaOption,
  type PortOption,
  type PrevPort,
} from '../auth/auth';
import { groupCalls, isStale } from '../lib/call-list';
import FormCard from '../components/FormCard.vue';
import FormField from '../components/FormField.vue';
import HouseDialog from '../components/HouseDialog.vue';
import RemovalDialog from '../components/RemovalDialog.vue';
import NemoResultDialog from '../components/NemoResultDialog.vue';
import PortCallBlock from '../components/PortCallBlock.vue';
import PortCallDrawer from '../components/PortCallDrawer.vue';
import ModulePage from '../components/ModulePage.vue';
import ScheduleFields from '../components/ScheduleFields.vue';

const $q = useQuasar();
const route = useRoute();
const isEditPage = computed(() => route.name === 'port-call-edit');
const isProcessPage = computed(() => isEditPage.value || route.name === 'port-call' || route.name === 'port-call-section');
const selectedCall = computed(() => calls.value.find(call => call.id === route.params.callId));
const router = useRouter();
const auth = useAuth();
const isCaptain = computed(() => auth.user.value?.role === 'captain');

const calls = ref<PortCall[]>([]);
const ships = ref<FleetShip[]>([]);
const loading = ref(true);
const saving = ref(false);
/** The search in the page head filters this list. */
const search = callSearch;

// ---- list or cards (guide p. 13–14) -----------------------------------------

/** The view switch; persisted via callCardView in call-search (user 2026-11-06). */
const cardView = callCardView;
/** Phones get cards only — no list, no switch (user 2026-11-06). */
const isPhone = computed(() => $q.screen.lt.sm);
const showCards = computed(() => cardView.value || isPhone.value);

/** What every block gets, list or card. */
function blockProps(call: PortCall) {
  return {
    call,
    canEdit: !isCaptain.value && auth.isAdmin.value,
    isOperator: !isCaptain.value && auth.isOperator.value,
    canUpload: isCaptain.value || auth.isOperator.value,
    muted: isMuted(call.id),
    captain: isCaptain.value,
  };
}

// ---- list (spec 0072) -----------------------------------------------------

const filteredCalls = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return calls.value;
  return calls.value.filter((c) =>
    [
      c.shipName,
      c.imoNumber,
      c.portLocode,
      c.voyageNumber,
      c.cargoDescription,
      ...c.cargoItems.map((i) => `${i.hs6} ${i.name}`),
    ].some((v) => v?.toLowerCase().includes(q)),
  );
});

/** Spec 0074: a call whose times are all past with nothing sent to NEMO
    is left out — reporting it now would make no sense. */
const liveCalls = computed(() => {
  const now = new Date();
  return filteredCalls.value.filter((c) => !isStale(c, now));
});
const staleCount = computed(() => filteredCalls.value.length - liveCalls.value.length);


/** Upcoming shows every call ahead, however far off; a group with no calls
    is not shown, Upcoming included (user 2026-11-02). Moored goes to the
    bottom, below Departed, as a dropdown (user 2026-11-02). */
const GROUP_ORDER = ['upcoming', 'departed', 'moored'];
const callGroups = computed(() =>
  groupCalls(liveCalls.value)
    .filter((g) => g.calls.length > 0)
    .sort((a, b) => GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key)),
);

/** The Moored dropdown starts shut. */
const mooredOpen = ref(false);

function toggleMoored(): void {
  mooredOpen.value = !mooredOpen.value;
  // Shutting it closes its open calls, so focus mode does not dim the page
  // around a row that is no longer there
  if (!mooredOpen.value) {
    const moored = callGroups.value.find((g) => g.key === 'moored');
    for (const c of moored?.calls ?? []) openIds.value.delete(c.id);
  }
}

// ---- focus mode (spec 0054, law 16) ----------------------------------------

/** Which calls are expanded. Open one and the ground behind the list
    darkens while every other row steps back — the open row is the work. */
const openIds = ref(new Set<string>());
const shownCalls = liveCalls;
/** A row hidden by the search or the window must not keep the list dimmed. */
const openShown = computed(() =>
  shownCalls.value.some((c) => openIds.value.has(c.id)),
);

function setOpen(id: string, open: boolean): void {
  if (open) openIds.value.add(id);
  else openIds.value.delete(id);
}

function isMuted(id: string): boolean {
  return openShown.value && !openIds.value.has(id);
}

watch(
  () => openShown.value,
  (on) => document.body.classList.toggle('nl-focus', on),
);
onUnmounted(() => document.body.classList.remove('nl-focus'));

const idleShips = computed(() => ships.value.filter((s) => !s.call));
const filteredIdleShips = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return idleShips.value;
  return idleShips.value.filter((s) =>
    [s.name, s.imoNumber, s.callSign].some((v) => v?.toLowerCase().includes(q)),
  );
});

function fmt(iso: string | null | undefined): string {
  if (!iso) return '';
  return fmtStamp(iso);
}

// ---- date helpers ----------------------------------------------------------

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---- create / edit (admin) -------------------------------------------------

/** The card is open (shared: the layout drops the legend meanwhile). */
const formDialog = callFormOpen;
onUnmounted(() => {
  formDialog.value = false;
  callEditDrawerOpen.value = false;
});
const form = reactive({
  id: null as string | null,
  /** In NEMO: the port is locked (spec 0080). */
  visitId: null as string | null,
  shipId: '',
  portLocode: '',
  portAreaCode: '',
  berth: '',
  eta: '',
  etd: '',
  ata: '',
  atd: '',
  voyageNumber: '',
  cargoDescription: '',
  cargoItems: [] as string[],
  prevPorts: '',
  nextPorts: '',
});
/** The code lists as loaded, to detect edits (codes win over pushed dates). */
const originalRoute = reactive({ prev: '', next: '' });
/** Cargo codes as loaded — untouched lists are omitted on save. */
let originalCargo = '';
/** ETA/ETD as loaded — date rules apply only to values the user changed. */
const originalTimes = reactive({ eta: '', etd: '' });

/** Today, 'YYYY-MM-DD' local — the earliest pickable ETA date. */
const todayDate = computed(() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
});
/** Today 00:00, datetime-local format — the ETA floor. */
const etaMin = computed(() => `${todayDate.value}T00:00`);

// Inline immediately per docs/07 law 4 (user rule 2026-08-24); the
// datetime-local strings compare chronologically, clock time included.
// The past-ETA rule applies only to a value the user changed, so other
// fields of a historical call stay editable; the ordering rules always.
const etaError = computed(() =>
  form.eta && form.eta !== originalTimes.eta && form.eta < etaMin.value
    ? 'ETA cannot be in the past'
    : null,
);
const etdError = computed(() =>
  form.eta && form.etd && form.etd <= form.eta ? 'ETD must be after the ETA' : null,
);
const atdError = computed(() =>
  form.ata && form.atd && form.atd <= form.ata ? 'ATD must be after the ATA' : null,
);
const scheduleIncomplete = reactive({ eta: false, etd: false, ata: false, atd: false });
const scheduleInvalid = computed(
  () => scheduleIncomplete.eta || scheduleIncomplete.etd || (form.id && (scheduleIncomplete.ata || scheduleIncomplete.atd)) || !!etaError.value || !!etdError.value || !!atdError.value,
);

/** ZZUKN quick chip (spec 0037): toggles the code in the next-ports list. */
const zzuknSelected = computed({
  get: () =>
    form.nextPorts.split(',').some((c) => c.trim().toUpperCase() === 'ZZUKN'),
  set: (on: boolean) => {
    const codes = form.nextPorts.split(',').map((c) => c.trim()).filter(Boolean);
    const without = codes.filter((c) => c.toUpperCase() !== 'ZZUKN');
    form.nextPorts = (on ? [...without, 'ZZUKN'] : without).join(', ');
  },
});
// The place inside the port (spec 0048): areas and their berths come from
// the location reference data, per port.
const portAreas = ref<PortAreaOption[]>([]);
const areaOptions = computed(() =>
  portAreas.value.map((a) => ({
    label: a.name ? `${a.name} (${a.code})` : a.code,
    value: a.code,
  })),
);
const berthOptions = computed(() => {
  const area = portAreas.value.find((a) => a.code === form.portAreaCode);
  return (area?.berths ?? []).map((b) => ({ label: b.name ?? b.code, value: b.code }));
});
const areaHint = computed(() =>
  !form.portLocode
    ? 'Pick the port first.'
    : areaOptions.value.length === 0
      ? 'NEMO has no published port areas for this port.'
      : 'Fill it in if it is known. The list holds the port’s areas in NEMO.',
);

/** Puts the cursor in a field of the card, by its FormField name (the card
    opens with its first field ready). */
function focusField(key: string): void {
  document
    .querySelector<HTMLElement>(`.call-form-card [data-field="${key}"]`)
    ?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), textarea, [tabindex="0"]')
    ?.focus({ preventScroll: true });
}

async function loadPortAreas(locode: string): Promise<void> {
  if (!locode) {
    portAreas.value = [];
    return;
  }
  try {
    portAreas.value = await auth.listPortAreas(locode);
  } catch {
    portAreas.value = [];
  }
}

function onPortPicked(): void {
  form.portAreaCode = '';
  form.berth = '';
  void loadPortAreas(form.portLocode);
}

const shipOptions = ref<{ label: string; value: string }[]>([]);
const portOptions = ref<{ label: string; value: string; often?: boolean }[]>([]);

async function loadShipOptions(): Promise<void> {
  try {
    const ships = await auth.listShips();
    shipOptions.value = ships
      .filter((v) => v.isActive)
      .map((v) => ({
        label: `${v.name ?? '—'}${v.imoNumber ? ` · IMO ${v.imoNumber}` : ''}`,
        value: v.id,
      }));
  } catch {
    shipOptions.value = [];
  }
}

// NEMO declares Finnish port calls only (spec 0037), so the picker holds
// the full FI list with the org's ten most-used ports on top (spec 0042).
let portCache: { frequent: PortOption[]; ports: PortOption[] } | null = null;

function portOpt(p: PortOption): { label: string; value: string } {
  return { label: p.name ? `${p.name} · ${p.locode}` : p.locode, value: p.locode };
}

/** The org's three most-used ports on top in SemiBold ("often used", Figma
    557:7836 — at most 3), then every port; no group headings (user 2026-11-06). */
function groupedPortOptions(): { label: string; value: string; often?: boolean }[] {
  if (!portCache) return [];
  const all = portCache.ports.map(portOpt);
  return [...portCache.frequent.slice(0, 3).map((p) => ({ ...portOpt(p), often: true })), ...all];
}

async function loadPortOptions(): Promise<void> {
  try {
    portCache = await auth.listPortOptions();
    portOptions.value = groupedPortOptions();
  } catch {
    portCache = null;
  }
}

// ---- official cargoes (spec 0046): HS-map shortlist + full nomenclature ----

interface CargoOpt {
  label: string;
  value: string;
  disable?: boolean;
}

let cargoShortlist: CargoOpt[] = [];
/** hs6 → plain name, remembered from whichever list offered the code. */
const cargoName = new Map<string, string>();
const cargoOptions = ref<CargoOpt[]>([]);

async function loadCargoShortlist(): Promise<void> {
  if (cargoShortlist.length > 0) return;
  try {
    const rows = await auth.listHsMap();
    const seen = new Set<string>();
    cargoShortlist = [];
    for (const r of rows) {
      if (seen.has(r.hs6)) continue;
      seen.add(r.hs6);
      if (!cargoName.has(r.hs6)) cargoName.set(r.hs6, r.refinement);
      // Statistics-group code up front (user rule): "20 — Raakapuu (440399)"
      cargoShortlist.push({
        label: `${r.groupCode} — ${r.refinement} (${r.hs6})`,
        value: r.hs6,
      });
    }
    cargoOptions.value = groupedCargoOptions();
  } catch {
    cargoShortlist = [];
  }
}

/** Chips need their labels even when the option set changes under them. */
function withSelectedCargo(list: CargoOpt[]): CargoOpt[] {
  const present = new Set(list.map((o) => o.value));
  const selected = form.cargoItems
    .filter((c) => !present.has(c))
    .map((c) => ({ label: `${cargoName.get(c) ?? c} (${c})`, value: c }));
  return [...selected, ...list];
}

function groupedCargoOptions(): CargoOpt[] {
  return withSelectedCargo(
    cargoShortlist.length > 0
      ? [
          { label: 'FI statistics groups', value: '__hdr-figroups', disable: true },
          ...cargoShortlist,
        ]
      : [],
  );
}

function filterCargo(input: string, update: (fn: () => void) => void): void {
  const q = input.trim();
  if (q.length < 2) {
    update(() => {
      cargoOptions.value = groupedCargoOptions();
    });
    return;
  }
  void auth
    .listCodelistEntries('hs_cargo_item', q)
    .then(({ entries }) => {
      update(() => {
        const ql = q.toLowerCase();
        const short = cargoShortlist.filter((o) => o.label.toLowerCase().includes(ql));
        const shortCodes = new Set(short.map((o) => o.value));
        const rest = entries
          .filter((e) => !shortCodes.has(e.code))
          .map((e) => {
            const name = e.en ?? e.code;
            if (!cargoName.has(e.code)) cargoName.set(e.code, name);
            return { label: `${name} (${e.code})`, value: e.code };
          });
        cargoOptions.value = withSelectedCargo([...short, ...rest]);
      });
    })
    .catch(() => update(() => {}));
}

function filterPorts(
  input: string,
  update: (fn: () => void) => void,
): void {
  const q = input.trim().toLowerCase();
  update(() => {
    if (!q) {
      portOptions.value = groupedPortOptions();
      return;
    }
    portOptions.value = (portCache?.ports ?? [])
      .map(portOpt)
      .filter((o) => o.label.toLowerCase().includes(q));
  });
}

const LOCODE_RE = /^[A-Z]{2}[A-Z2-9]{3}$/;

function joinRoute(ports: { portLocode: string }[]): string {
  return ports.map((p) => p.portLocode).join(', ');
}

/** '' -> [], 'fivaa, plgdn' -> codes; throws on a malformed code. */
function parseRoute(text: string): string[] {
  const codes = text
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c !== '');
  for (const code of codes) {
    if (!LOCODE_RE.test(code)) {
      throw new Error(`"${code}" is not a UN/LOCODE (e.g. FIVAA)`);
    }
  }
  if (codes.length > 10) throw new Error('At most 10 ports per direction');
  return codes;
}

const formMainDisable = computed(
  () => !form.portLocode || (!form.id && !form.shipId) || scheduleInvalid.value,
);
const formUsesSheet = computed(() => isPhone.value || (!!form.id && $q.screen.width < 900));
watch(
  () => formDialog.value && !!form.id && !formUsesSheet.value && !isEditPage.value,
  (open) => { callEditDrawerOpen.value = open; },
  { immediate: true },
);
/** Only editing from within a report uses a drawer or phone sheet. */
const formShellProps = computed(() =>
  isEditPage.value
    ? {
        title: 'Edit port call',
        context: `${selectedCall.value?.shipName ?? 'Ship'} · ${selectedCall.value?.portName ?? selectedCall.value?.portLocode ?? 'Port not set'}`,
        class: 'process-page home-wrap',
        mainLabel: 'Save changes',
        mainLoading: saving.value,
        mainDisable: formMainDisable.value,
      }
    : formUsesSheet.value
    ? {
        title: form.id ? 'Edit port call' : 'New port call',
        titleStyle: 'detail',
        sheetBreakpoint: form.id ? 900 : MOBILE_BREAKPOINT,
        mainLabel: form.id ? 'Save changes' : 'Create port call',
        mainLoading: saving.value,
        mainDisable: formMainDisable.value,
        closeDisable: saving.value,
        // No footer Close on Edit port call (user 2026-11-07): the X at the top closes it
        noClose: !!form.id,
      }
    : form.id
      ? {}
      : { persistent: true, noShake: true },
);
/** The card inside it: FormCard on a wide screen, a plain body on a phone. */
const formCardProps = computed(() =>
  isEditPage.value || formUsesSheet.value
    ? { class: 'call-form-sheet' }
    : {
        class: 'call-form-card',
        title: form.id ? 'Edit port call' : 'New port call',
        mainLabel: form.id ? 'Save changes' : 'Create port call',
        mainLoading: saving.value,
        mainDisable: formMainDisable.value,
      },
);

// The navbar's "New port call" button signals via callNewSignal (user 2026-11-06)
watch(callNewSignal, () => openCreate());

function openCreate(): void {
  Object.assign(form, {
    id: null, visitId: null, shipId: '', portLocode: '', portAreaCode: '', berth: '',
    eta: '', etd: '', ata: '', atd: '',
    voyageNumber: '', cargoDescription: '', cargoItems: [], prevPorts: '', nextPorts: '',
  });
  Object.assign(originalRoute, { prev: '', next: '' });
  Object.assign(originalTimes, { eta: '', etd: '' });
  originalCargo = '';
  portAreas.value = [];
  void loadShipOptions();
  void loadPortOptions();
  void loadCargoShortlist();
  formDialog.value = true;
}

function openEdit(call: PortCall): void {
  if (route.name !== 'port-call-section' && !isEditPage.value) {
    void router.push({ name: 'port-call-edit', params: { callId: call.id } });
    return;
  }
  Object.assign(form, {
    id: call.id,
    visitId: call.visitId,
    shipId: call.shipId ?? '',
    portLocode: call.portLocode ?? '',
    portAreaCode: call.portAreaCode ?? '',
    berth: call.berth ?? '',
    eta: isoToLocalInput(call.eta),
    etd: isoToLocalInput(call.etd),
    ata: isoToLocalInput(call.ata),
    atd: isoToLocalInput(call.atd),
    voyageNumber: call.voyageNumber ?? '',
    cargoDescription: call.cargoDescription ?? '',
    cargoItems: (call.cargoItems ?? []).map((c) => c.hs6),
    prevPorts: joinRoute(call.prevPorts ?? []),
    nextPorts: joinRoute(call.nextPorts ?? []),
  });
  for (const c of call.cargoItems ?? []) {
    if (!cargoName.has(c.hs6)) cargoName.set(c.hs6, c.name);
  }
  originalCargo = form.cargoItems.join(',');
  cargoOptions.value = groupedCargoOptions();
  void loadCargoShortlist();
  Object.assign(originalRoute, { prev: form.prevPorts, next: form.nextPorts });
  Object.assign(originalTimes, { eta: form.eta, etd: form.etd });
  if (call.portLocode) {
    portOptions.value = [{ label: call.portLocode, value: call.portLocode }];
  }
  void loadPortOptions();
  void loadPortAreas(form.portLocode);
  formDialog.value = true;
}

async function saveCall(): Promise<void> {
  saving.value = true;
  try {
    // Backstop for the inline field errors (Save is disabled while any shows)
    const inlineError = etaError.value ?? etdError.value ?? atdError.value;
    if (inlineError) {
      $q.notify({ type: 'negative', message: inlineError });
      return;
    }
    let prevCodes: string[];
    let nextCodes: string[];
    try {
      prevCodes = parseRoute(form.prevPorts);
      nextCodes = parseRoute(form.nextPorts);
    } catch (e) {
      $q.notify({ type: 'negative', message: (e as Error).message });
      return;
    }
    const toPrev = (codes: string[]): PrevPort[] =>
      codes.map((portLocode) => ({ portLocode }));
    const toNext = (codes: string[]): NextPort[] =>
      codes.map((portLocode) => ({ portLocode }));
    const toCargo = (codes: string[]): CargoItem[] =>
      codes.map((hs6) => ({ hs6, name: cargoName.get(hs6) ?? hs6 }));
    const cargoChanged = form.cargoItems.join(',') !== originalCargo;
    let createdCallId: string | undefined;
    if (form.id) {
      // Untouched code lists are omitted so source-pushed dates survive
      const prevChanged = form.prevPorts.replace(/\s/g, '') !== originalRoute.prev.replace(/\s/g, '');
      const nextChanged = form.nextPorts.replace(/\s/g, '') !== originalRoute.next.replace(/\s/g, '');
      await auth.updatePortCall(form.id, {
        portLocode: form.portLocode,
        portAreaCode: form.portAreaCode || null,
        berth: form.berth || null,
        eta: localInputToIso(form.eta),
        etd: localInputToIso(form.etd),
        ata: localInputToIso(form.ata),
        atd: localInputToIso(form.atd),
        voyageNumber: form.voyageNumber.trim() || null,
        cargoDescription: form.cargoDescription.trim() || null,
        ...(cargoChanged
          ? { cargoItems: form.cargoItems.length > 0 ? toCargo(form.cargoItems) : null }
          : {}),
        ...(prevChanged
          ? { prevPorts: prevCodes.length > 0 ? toPrev(prevCodes) : null }
          : {}),
        ...(nextChanged
          ? { nextPorts: nextCodes.length > 0 ? toNext(nextCodes) : null }
          : {}),
      });
    } else {
      createdCallId = await auth.createPortCall({
        shipId: form.shipId,
        portLocode: form.portLocode,
        ...(form.portAreaCode ? { portAreaCode: form.portAreaCode } : {}),
        ...(form.berth ? { berth: form.berth } : {}),
        ...(localInputToIso(form.eta) ? { eta: localInputToIso(form.eta)! } : {}),
        ...(localInputToIso(form.etd) ? { etd: localInputToIso(form.etd)! } : {}),
        ...(form.voyageNumber.trim() ? { voyageNumber: form.voyageNumber.trim() } : {}),
        ...(form.cargoDescription.trim()
          ? { cargoDescription: form.cargoDescription.trim() }
          : {}),
        ...(form.cargoItems.length > 0 ? { cargoItems: toCargo(form.cargoItems) } : {}),
        ...(prevCodes.length > 0 ? { prevPorts: toPrev(prevCodes) } : {}),
        ...(nextCodes.length > 0 ? { nextPorts: toNext(nextCodes) } : {}),
      });
    }
    formDialog.value = false;
    await reload();
    if (isEditPage.value) await closeEditPage();
    if (createdCallId) await router.push({ name: 'port-call', params: { callId: createdCallId } });
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not save the port call.',
    });
  } finally {
    saving.value = false;
  }
}

// ---- confirm / reject (operator) -------------------------------------------

const confirmDialog = ref(false);
const confirmTarget = ref<{
  call: PortCall;
  field: 'ata' | 'atd';
  suggestion: PendingSuggestion;
} | null>(null);
const confirmValue = ref('');

function openConfirm(
  call: PortCall,
  field: 'ata' | 'atd',
  suggestion: PendingSuggestion,
): void {
  confirmTarget.value = { call, field, suggestion };
  confirmValue.value = isoToLocalInput(suggestion.value);
  confirmDialog.value = true;
}

async function doConfirm(): Promise<void> {
  const target = confirmTarget.value;
  if (!target) return;
  saving.value = true;
  try {
    const iso = localInputToIso(confirmValue.value);
    const adjusted = iso && iso !== target.suggestion.value ? iso : undefined;
    await auth.confirmPortCallActual(target.call.id, target.field, adjusted);
    confirmDialog.value = false;
    await reload();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not confirm.' });
  } finally {
    saving.value = false;
  }
}

const rejectDialog = ref(false);
const rejectTarget = ref<{
  call: PortCall;
  field: 'ata' | 'atd';
  suggestion: PendingSuggestion;
} | null>(null);

function openReject(
  call: PortCall,
  field: 'ata' | 'atd',
  suggestion: PendingSuggestion,
): void {
  rejectTarget.value = { call, field, suggestion };
  rejectDialog.value = true;
}

async function doReject(): Promise<void> {
  const target = rejectTarget.value;
  if (!target) return;
  saving.value = true;
  try {
    await auth.rejectPortCallSuggestion(target.call.id, target.field);
    rejectDialog.value = false;
    await reload();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not reject.' });
  } finally {
    saving.value = false;
  }
}

// ---- cancel (admin) --------------------------------------------------------

const cancelDialog = ref(false);
const cancelTarget = ref<PortCall | null>(null);
const cancelReason = ref('');
/** In NEMO the cancel is the COA (spec 0080): its remark is required. */
/** One-tap COA remarks — NEMO cannot change a call's ship or port, so these are the usual two. */
const QUICK_REASONS = ['Port changed', 'Ship changed', 'Voyage cancelled'];

// ---- the result viewer (spec 0081) -------------------------------------------
const resultOpen = ref(false);
const resultExchanges = ref<NemoExchange[]>([]);
const resultSubtitle = ref<string | undefined>(undefined);
function showResult(exchanges: NemoExchange[], call: PortCall): void {
  resultExchanges.value = exchanges;
  resultSubtitle.value = `${call.shipName ?? 'Ship'} · ${call.portName ?? call.portLocode ?? '—'}`;
  resultOpen.value = true;
}
const cancelInNemo = computed(() => !!cancelTarget.value?.visitId);

function openCancel(call: PortCall): void {
  cancelTarget.value = call;
  cancelReason.value = '';
  cancelDialog.value = true;
}

async function doCancel(): Promise<void> {
  const target = cancelTarget.value;
  if (!target) return;
  saving.value = true;
  try {
    const out = await auth.cancelPortCall(target.id, cancelReason.value.trim() || undefined);
    cancelDialog.value = false;
    if (out.exchange) showResult([out.exchange], target);
    await reload();
  } catch (e) {
    // NEMO's refusal, or NEMO down: the result viewer says it (spec 0081)
    if (e instanceof NemoExchangeError && e.exchange) {
      cancelDialog.value = false;
      showResult([e.exchange], target);
    } else $q.notify({ type: 'negative', message: (e as Error).message, timeout: 12000 });
  } finally {
    saving.value = false;
  }
}

function closeEditPage() {
  formDialog.value = false;
  return router.push({ name: 'port-call', params: { callId: String(route.params.callId) } });
}

// Open the page editor after its call loads, including direct URLs and reloads.
watch(() => [route.fullPath, !!selectedCall.value] as const, () => {
  if (isEditPage.value && selectedCall.value && auth.isAdmin.value && !isCaptain.value) openEdit(selectedCall.value);
  else formDialog.value = false;
}, { immediate: true });

// ---- load ------------------------------------------------------------------

async function reload(): Promise<void> {
  if (isCaptain.value) {
    // Captains get the scoped list only — the fleet stays office-side
    calls.value = await auth.listPortCalls();
    return;
  }
  const [portCalls, fleet] = await Promise.all([
    auth.listPortCalls(),
    auth.fetchFleet(),
  ]);
  calls.value = portCalls;
  ships.value = fleet;
}

// A New port call link (?new=…) opens the form
watch(
  () => route.query.new,
  (v) => {
    if (!v || !auth.isAdmin.value || isCaptain.value) return;
    // The query goes first: a dialog closes on a route change
    void router.replace({ query: {} }).then(openCreate);
  },
  { immediate: true },
);

onMounted(async () => {
  try {
    await reload();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load port calls.' });
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.home--process { background: var(--blue-100); }
.process-page.home-wrap { padding-top: 77px; }
@media (max-width: 599.98px) {
  /* Content spacing is separate from the device's system safe area. */
  .process-page.home-wrap { padding-top: 32px; }
}

/* Content starts 100px from each side at 1440 — 1240px wide (guide p. 8) */
.home-wrap {
  max-width: var(--nl-page-max-width);
  margin-inline: auto;
  padding-left: var(--nl-page-padding-left);
  padding-right: var(--nl-page-padding-right);
}
/* The page head (Figma 341:5720): a white band, its content 63px off the
   bottom and 184px under the app header at desktop */
.home-head {
  background: var(--nl-card);
  padding: 184px 0 63px;
}
@media (max-width: 1023px) {
  .home-head {
    padding-top: 72px;
  }
}
@media (max-width: 599.98px) {
  /* Phone head: title hidden, button left-aligned, 77px under the nav bar
     (user 2026-11-06) */
  .home-head {
    padding-top: 30px;
    padding-bottom: 20px;
  }
  .home-head .home-tools {
    justify-content: flex-start;
  }
}
/* Page title: Display/58 as in Figma — a 24px line in a 30px box, the help
   link 20px under it. When it wraps (the captain's title on a phone) the
   24px line would run into itself: normal line height there */
.home-title {
  margin: 0 0 26px;
  color: var(--nl-g-ink);
}
@media (max-width: 699px) {
  .home-title {
    line-height: normal;
    margin-bottom: 8px;
  }
}
/* 20px Medium under the Display/58 title — not a token (user 2026-11-02) */
.home-head :deep(.nl-content-link) {
  font-size: 20px;
  line-height: 24px;
  letter-spacing: -0.2px;
  color: var(--nl-g-secondary);
}
/* Phones: title hidden (user 2026-11-06) */
@media (max-width: 599.98px) {
  .home-title {
    display: none;
  }
}
/* Search, New port call and the view switch: one 44px row, 32px under the
   help link (its 30px box in Figma) */
.home-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 15px;
  margin-top: 38px;
}
/* Phones: no title above the button */
@media (max-width: 599.98px) {
  .home-tools {
    margin-top: 0;
  }
}
.home-search {
  flex: 0 1 436px;
  max-width: 436px;
}
/* 44px, 14px SemiBold label, radius 10 (Figma 341:5749) */
.home-new {
  height: 44px;
  min-height: 44px;
  padding: 0 10px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  line-height: normal;
}
.home-new :deep(.q-btn__content) {
  min-height: 0;
}
/* Phones: the next size down — 36px, 16px each side (user 2026-11-06) */
@media (max-width: 599.98px) {
  .home-new {
    height: 36px;
    min-height: 36px;
    padding: 0 16px;
  }
}
/* List / cards: the on–off switch (app.scss draws every q-toggle) */
.view-switch {
  flex: none;
}
/* The body on the front page's #F3F4F8 ground (MainLayout) */
.home-body {
  padding-top: 32px;
  padding-bottom: 48px;
}
/* Phones: the head band is still present, body starts closer (user 2026-11-06) */
@media (max-width: 599.98px) {
  .home-body {
    padding-top: 24px;
    padding-bottom: 16px;
  }
}
/* The port call card in its dialog: the Set schedule card's size
   (--nl-large-card-*, user 2026-11-03); its form scrolls inside.
   Unscoped: the dialog is teleported to the body. */
:global(.call-form-card) {
  --fcard-width: var(--nl-large-card-width);
  --fcard-height: var(--nl-large-card-height);
  width: 100%;
  /* Quasar lets clicks through only to a dialog's div children: the card is
     a section, and a click on it would otherwise land on the backdrop */
  pointer-events: all;
}
:global(.call-edit-drawer .call-form-card) {
  --fcard-width: 560px;
  --fcard-height: 100%;
  width: 100%;
  max-height: 100%;
  margin: 0;
  border-radius: 0;
}
:global(.call-edit-drawer .fcard__head) {
  position: relative;
  padding-top: 24px;
  padding-bottom: 24px;
  padding-left: 32px;
}
:global(.call-edit-drawer .fcard__close) {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  left: -17px;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--nl-g-line-base);
  border-radius: 50%;
  background: var(--nl-card);
  color: var(--nl-g-secondary);
}
:global(.call-edit-drawer .fcard__close .q-icon) {
  font-size: 20px;
}
:global(.call-edit-drawer .fcard__close::after) {
  display: none;
}
:global(.call-edit-drawer .fcard__form) {
  overscroll-behavior: contain;
}
:global(.call-edit-drawer .fcard__foot) {
  border-radius: 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
@media (max-width: 599.98px) {
  :global(.call-edit-drawer .fcard__close) {
    left: auto;
    right: 16px;
  }
  :global(.call-edit-drawer .fcard__head),
  :global(.call-edit-drawer .fcard__form),
  :global(.call-edit-drawer .fcard__foot) {
    padding-left: 16px;
    padding-right: 16px;
  }
  :global(.call-edit-drawer .fcard__head) {
    padding-right: 64px;
  }
}
/* The phone sheet's body: FormCard's sections, 32px apart */
.call-form-sheet {
  display: flex;
  flex-direction: column;
  gap: 32px;
}
.call-form-sheet .fcard-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.call-form-sheet .fcard-section__title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 -6px;
  color: var(--nl-g-secondary);
  font-size: 14px;
  line-height: normal;
  font-weight: 600;
  letter-spacing: 0.48px;
  text-transform: uppercase;
}
.call-form-sheet .fcard-section__title::before {
  content: '';
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--nl-g-blue);
}
.call-group + .call-group {
  margin-top: 48px;
}
/* Departed comes up closer to the groups above (user 2026-11-01) */
.call-group + .call-group--departed {
  margin-top: 24px;
}
/* Section heading: 16/21 SemiBold ink (user 2026-11-01, kept off the token
   scale on purpose, user 2026-11-02), 16px above the table */
.group-head {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 16px;
}
/* Phones: the group titles 14px; Upcoming and Departed 12px above their
   cards (user 2026-11-06) */
@media (max-width: 599.98px) {
  .call-group--upcoming .group-head,
  .call-group--departed .group-head {
    margin-bottom: 12px;
  }
  .group-head .group-title {
    font-size: 14px;
  }
}
.group-title {
  margin: 0;
  font-size: 16px;
  line-height: 21px;
  font-weight: 600;
  letter-spacing: 0.12em; /* 12% (user 2026-11-02) */
  text-transform: uppercase;
  color: var(--nl-g-ink);
}
/* The Moored dropdown head: the title as a button and a chevron, down when
   shut, up when open (user 2026-11-02) */
.group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: inherit;
  cursor: pointer;
}
.group-toggle__chevron {
  transition: transform 0.15s ease;
}
.group-toggle__chevron--open {
  transform: rotate(180deg);
}
/* Table on an overview page (guide p. 13): white, radius 10, a 4px bar on
   top — blue Upcoming, green Departed */
.call-table {
  position: relative;
  background: var(--nl-card);
  border-radius: 10px;
  overflow: hidden;
  border-top: 4px solid var(--nl-g-blue);
}
.call-table--moored {
  border-top-color: var(--nl-g-secondary);
}
.call-table--departed {
  border-top-color: var(--nl-g-green);
}
/* Header row: Blue/200, 44px, Heading/12, a Blue/600 divider under it */
.call-table__head {
  display: grid;
  grid-template-columns: var(--nl-call-cols);
  column-gap: 16px;
  align-items: center;
  height: 44px;
  padding: 0 24px;
  background: var(--nl-g-subtle);
  border-bottom: 1px solid var(--nl-g-line-base);
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--nl-g-secondary);
}
@media (max-width: 899px) {
  .call-table__head {
    display: none;
  }
}
/* Cards three to a row, 16px apart (guide p. 8), each 355px wide (48px
   under a third of the column, user 2026-10-31); an open one spans the
   whole column */
.call-cards {
  container-type: inline-size;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 355px));
  gap: 16px;
  align-items: start;
}
.call-cards__open {
  grid-column: 1 / -1;
  width: 100cqw;
}
@media (max-width: 1023px) {
  .call-cards {
    grid-template-columns: repeat(2, minmax(0, 355px));
  }
}
@media (max-width: 599.98px) {
  .call-cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
.home-note {
  margin: 16px 0 0;
  font-size: 14px;
  line-height: normal;
  color: var(--nl-g-body);
}
/* Ships without calls: a slim white table */
.idle-table {
  background: var(--nl-card);
  border-radius: 10px;
  overflow: hidden;
}
.idle-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  padding: 18px 24px;
}
.idle-row + .idle-row {
  border-top: 1px solid var(--nl-g-line-row);
}
.idle-row__name {
  font-size: 16px;
  line-height: 21px;
  font-weight: 600;
  color: var(--nl-g-ink);
}
.idle-row__imo {
  font-size: 14px;
  line-height: normal;
  color: var(--nl-g-body);
}
.idle-row__note {
  font-size: 14px;
  line-height: normal;
  color: var(--nl-g-secondary);
}
/* Focus mode (spec 0054, law 16): with a call open you are editing it, not
   searching the list — the list's own tools step back until you reach for
   them (user rule 2026-09-02) */
.tool-muted {
  opacity: 0.45;
  transition: opacity 0.18s ease;
}
.tool-muted:hover,
.tool-muted:focus-within {
  opacity: 1;
}
</style>
