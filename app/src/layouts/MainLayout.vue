<template>
  <q-layout
    view="lHh Lpr lFf"
    class="app-layout"
    :class="{
      'app-layout--call-edit': callEditDrawerOpen,
      'app-layout--shift-nav': shiftNavbar,
      'app-layout--overview': onOverview,
      'app-layout--process': isPortCallPage,
    }"
  >
    <!-- App header (Figma 341:5720): 66px white, a 2px line under it, the
         same on every screen — logo, status, settings and account. Search
         and New port call live in the front page's head (user 2026-11-02) -->
    <q-header class="app-header">
      <div ref="navbarContent" class="app-header__inner">
        <router-link v-if="isPortCallPage && isPhone" :to="backLocation" class="brand-link brand-back" :aria-label="backLabel">
          <q-icon name="arrow_back" size="24px" />
          <span v-if="!isPhone" class="brand-word">Back</span>
        </router-link>
        <!-- The logo always leads straight to the front page (user 2026-11-12) -->
        <router-link v-else to="/" class="brand-link" aria-label="NEMOLink — port calls">
          <img :src="markUrl" alt="" class="brand-mark" width="28.3834" height="25" />
          <span v-if="!isPhone" class="brand-word">Nemolink</span>
        </router-link>
        <q-space />
        <!-- Non-phone overview: search, New port call, Card view in the header (user 2026-11-06) -->
        <template v-if="!isPhone && onOverview && !isCaptainUser">
          <!-- Search + New port call centred in the header (user 2026-11-07) -->
          <div class="header-center">
            <SearchBox
              v-model="callSearch"
              placeholder="Search ships, voyages"
              :autofocus="false"
              class="header-search"
            />
            <q-btn
              v-if="auth.isAdmin.value"
              unelevated
              no-caps
              color="primary"
              label="New port call"
              class="header-new"
              :class="{ 'tool-muted': callFormOpen && !callEditDrawerOpen }"
              @click="callNewSignal++"
            />
          </div>
          <q-space />
          <q-toggle
            v-model="callCardView"
            label="Card view"
            left-label
            color="primary"
            class="view-switch"
            :class="{ 'tool-muted': callFormOpen && !callEditDrawerOpen }"
          />
        </template>
        <!-- Phones (user 2026-11-06): search icon, then hamburger -->
        <q-btn
          v-if="isPhone && onOverview && !isCaptainUser"
          flat dense round
          icon="search"
          aria-label="Search"
          class="app-header__icon"
          @click="searchOpen = !searchOpen"
        />
        <template v-if="!isPhone">
        <!-- Platform admin context (spec 0030): the chip always tells whose
             data is on screen; exiting returns to Select customer -->
        <q-chip
          v-if="auth.user.value?.acting"
          dense
          removable
          icon="swap_horiz"
          class="acting-chip"
          @remove="exitActing"
        >
          <span class="gt-xs">Acting in&nbsp;</span>{{ auth.user.value?.orgName }}
        </q-chip>
        <!-- The captain's PEC rides in the header (specs 0043/0045);
             without details the chip is the standing way in: "Add PEC data" -->
        <q-chip
          v-if="pecChipLabel"
          dense
          clickable
          :icon="pecHasDetails ? undefined : 'add'"
          class="pec-chip tnum"
          @click="openPecDialog"
        >
          {{ pecChipLabel }}
        </q-chip>
        <!-- The status light (spec 0082): NEMO, integrations, NEMOLink, lists -->
        <SystemStatusLight />
        <q-btn
          v-if="auth.user.value?.platformAdmin"
          flat
          dense
          round
          icon="domain"
          to="/platform"
          aria-label="Platform"
          class="app-header__icon"
        />
        <q-btn
          v-if="auth.isAdmin.value"
          flat
          dense
          round
          :icon="isPortCallPage ? undefined : 'settings'"
          to="/admin"
          aria-label="Admin"
          class="app-header__icon"
        >
          <img v-if="isPortCallPage" :src="processSettingsIcon" alt="" />
        </q-btn>
        <q-btn flat dense round :icon="isPortCallPage ? undefined : 'account_circle'" aria-label="Account" class="app-header__icon">
          <img v-if="isPortCallPage" :src="processAccountIcon" alt="" />
          <q-menu anchor="bottom right" self="top right">
            <q-list style="min-width: 220px">
              <q-item>
                <q-item-section>
                  <q-item-label class="text-weight-semibold">{{ displayName }}</q-item-label>
                  <q-item-label caption>{{ auth.user.value?.username }}</q-item-label>
                  <q-item-label caption>
                    <span class="text-capitalize">{{ auth.user.value?.role }}</span>
                    <template v-if="orgLabel"> · {{ orgLabel }}</template>
                  </q-item-label>
                  <q-item-label v-if="pecMenuLabel" caption class="tnum">
                    {{ pecMenuLabel }}
                  </q-item-label>
                </q-item-section>
              </q-item>
              <q-separator />
              <q-item clickable v-close-popup @click="signOut">
                <q-item-section avatar>
                  <q-icon name="logout" />
                </q-item-section>
                <q-item-section>Sign out</q-item-section>
              </q-item>
              <q-separator />
              <q-item dense>
                <q-item-section class="text-caption text-grey-7">
                  nauticAi NEMOLink v{{ version }}
                </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        </template>
        <template v-else>
          <!-- The hamburger turns into a close (user 2026-11-06) -->
          <q-btn
            flat
            dense
            round
            :icon="menuOpen ? 'close' : 'menu'"
            :aria-label="menuOpen ? 'Close menu' : 'Menu'"
            :aria-expanded="menuOpen"
            aria-controls="app-menu"
            class="app-header__icon app-header__icon--menu"
            @click="menuOpen = !menuOpen"
          />
        </template>
        <!-- Phone search overlay (user 2026-11-06) -->
        <div
          v-if="isPhone && onOverview && !isCaptainUser && searchOpen"
          class="app-search-overlay"
          @click.self="searchOpen = false"
        >
          <SearchBox
            v-model="callSearch"
            placeholder="Search ships, voyages"
            :autofocus="true"
            large
            class="app-search-overlay__field"
          />
        </div>
      </div>
      <!-- Phones: the menu fills the screen under the bar, no stroke
           (user 2026-11-06) -->
      <div v-if="isPhone && menuOpen" id="app-menu" class="app-menu">
        <q-list class="app-menu__list">
        <q-item>
          <q-item-section>
            <q-item-label class="text-weight-semibold">{{ displayName }}</q-item-label>
            <q-item-label caption>{{ auth.user.value?.username }}</q-item-label>
            <q-item-label caption>
              <span class="text-capitalize">{{ auth.user.value?.role }}</span>
              <template v-if="orgLabel"> · {{ orgLabel }}</template>
            </q-item-label>
          </q-item-section>
        </q-item>
        <q-separator />
        <SystemStatusLight item />
        <q-item v-if="auth.user.value?.acting" clickable @click="menuOpen = false; exitActing()">
          <q-item-section avatar><q-icon name="swap_horiz" /></q-item-section>
          <q-item-section>
            <q-item-label>Acting in {{ auth.user.value?.orgName }}</q-item-label>
            <q-item-label caption>Tap to exit</q-item-label>
          </q-item-section>
        </q-item>
        <q-item v-if="pecChipLabel" clickable @click="menuOpen = false; openPecDialog()">
          <q-item-section avatar><q-icon :name="pecHasDetails ? 'badge' : 'add'" /></q-item-section>
          <q-item-section class="tnum">{{ pecChipLabel }}</q-item-section>
        </q-item>
        <q-item v-if="auth.user.value?.platformAdmin" clickable to="/platform" @click="menuOpen = false">
          <q-item-section avatar><q-icon name="domain" /></q-item-section>
          <q-item-section>Platform</q-item-section>
        </q-item>
        <q-item v-if="auth.isAdmin.value" clickable to="/admin" @click="menuOpen = false">
          <q-item-section avatar><q-icon name="settings" /></q-item-section>
          <q-item-section>Admin</q-item-section>
        </q-item>
        <q-item clickable @click="menuOpen = false; signOut()">
          <q-item-section avatar><q-icon name="logout" /></q-item-section>
          <q-item-section>Sign out</q-item-section>
        </q-item>
        <q-separator />
        <q-item dense>
          <q-item-section class="text-caption text-grey-7">
            nauticAi NEMOLink v{{ version }}
          </q-item-section>
        </q-item>
        </q-list>
      </div>
    </q-header>

    <q-page-container class="page-ground" :class="{ 'page-ground--front': onOverview }">
      <router-view />
    </q-page-container>
    <!-- The in-place ship editor (spec 0085) -->
    <ShipEditorHost />

    <!-- First sign-in as captain: ask for the PEC (specs 0043/0045) -->
    <HouseDialog
      v-model="pecDialog"
      title="Your PEC"
      help-topic="captain.pec"
      :max-width-px="560"
      sectioned
      close-label="Later"
      :close-disable="pecSaving"
      main-label="Save"
      :main-loading="pecSaving"
      :main-disable="!pecNone && !pecForm.number.trim()"
      @main="savePec"
    >
      <div class="dlg-section">
        <q-toggle
          v-model="pecNone"
          label="I don’t have a PEC licence for Finland"
          left-label
          :disable="pecSaving"
        />
      </div>

      <template v-if="!pecNone">
        <div class="dlg-section">
          <div class="dlg-section__title">Certificate</div>
          <div class="row q-col-gutter-sm q-mb-sm">
            <q-input
              v-model="pecForm.number"
              label="PEC number"
              outlined
              dense
              maxlength="10"
              autofocus
              class="col-6"
              :disable="pecSaving"
              hint="Up to 10 characters, from the certificate"
            />
            <q-select
              v-model="pecForm.type"
              :options="PEC_TYPES"
              clearable
              emit-value
              map-options
              label="Type of PEC"
              outlined
              dense
              options-dense
              class="col-6"
              :disable="pecSaving"
            />
          </div>
          <DateField
            v-model="pecForm.validUntil"
            label="Valid until"
            :min-date="todayDate"
            :disable="pecSaving"
          />
        </div>

        <div class="dlg-section">
          <div class="dlg-section__title">Coverage</div>
          <q-select
            v-model="pecForm.regions"
            :options="PEC_REGIONS"
            multiple
            emit-value
            map-options
            use-chips
            label="Regional PEC (VTS areas)"
            outlined
            dense
            options-dense
            class="q-mb-sm"
            :disable="pecSaving"
          />
          <q-select
            v-model="pecForm.ports"
            :options="pecPortOptions"
            multiple
            emit-value
            map-options
            use-chips
            use-input
            input-debounce="0"
            label="Port PEC"
            outlined
            dense
            options-dense
            :disable="pecSaving"
            hint="List: UN/LOCODE Finnish ports (NEMO)"
            @filter="filterPecPorts"
          />
        </div>
      </template>

    </HouseDialog>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuth, type PecInfo } from '../auth/auth';
import DateField from '../components/DateField.vue';
import HouseDialog from '../components/HouseDialog.vue';
import SystemStatusLight from '../components/SystemStatusLight.vue';
import markUrl from '../assets/figma/nemolink-mark.svg';
import processSettingsIcon from '../assets/figma/process-settings.svg';
import processAccountIcon from '../assets/figma/process-account-circle.svg';
import ShipEditorHost from '../components/ShipEditorHost.vue';
import SearchBox from '../components/SearchBox.vue';
import { callSearch, callCardView, callNewSignal, callFormOpen, callEditDrawerOpen } from '../lib/call-search';
import { PEC_REGIONS, PEC_TYPES } from '../lib/pec';
import { version } from '../../package.json';

const $q = useQuasar();
const auth = useAuth();
const router = useRouter();
const route = useRoute();
const navbarContent = ref<HTMLElement | null>(null);
const navbarHasRoom = ref(false);
const shiftNavbar = computed(() => callEditDrawerOpen.value && $q.screen.width >= 1024 && navbarHasRoom.value);
let navbarResize: ResizeObserver | undefined;
let navbarMutation: MutationObserver | undefined;

/** Reserve the drawer and its 48px gap only when all nav controls fit. */
function measureNavbar(): void {
  const navbar = navbarContent.value;
  if (!navbar) return;
  const controls = Array.from(navbar.children).filter((element): element is HTMLElement =>
    element instanceof HTMLElement && !element.classList.contains('q-space') && getComputedStyle(element).display !== 'none',
  );
  const controlsWidth = controls.reduce((total, element) => {
    const style = getComputedStyle(element);
    return total + element.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
  }, 0);
  const viewport = document.documentElement.clientWidth;
  const drawerWidth = Math.min(560, Math.max(380, viewport * 0.4));
  const outerGutter = Math.max(0, (viewport - 1272) / 2);
  const gaps = Math.max(0, controls.length - 1) * 8;
  navbarHasRoom.value = viewport - drawerWidth - outerGutter >= controlsWidth + gaps + 16 + 48;
}
function observeNavbar(): void {
  navbarResize?.disconnect();
  if (navbarContent.value) {
    navbarResize?.observe(navbarContent.value);
    for (const child of navbarContent.value.children) navbarResize?.observe(child);
  }
  measureNavbar();
}
onMounted(() => {
  navbarResize = new ResizeObserver(measureNavbar);
  navbarMutation = new MutationObserver(observeNavbar);
  if (navbarContent.value) navbarMutation.observe(navbarContent.value, { childList: true, subtree: true });
  observeNavbar();
});
watch(() => [callEditDrawerOpen.value, $q.screen.width], measureNavbar, { flush: 'post' });
onBeforeUnmount(() => {
  navbarResize?.disconnect();
  navbarMutation?.disconnect();
});
/** Phones: the header search and the hamburger menu. */
const isPhone = computed(() => $q.screen.lt.sm);
/** Phone search overlay (user 2026-11-06). */
const searchOpen = ref(false);
watch(() => route.fullPath, () => { searchOpen.value = false; });
watch(isPhone, (p) => { if (!p) searchOpen.value = false; });
/** The phone's full-screen menu; shuts on any route change. */
const menuOpen = ref(false);
watch(() => route.fullPath, () => {
  menuOpen.value = false;
});
watch(isPhone, (phone) => {
  if (!phone) menuOpen.value = false;
});

/** The port call list is the overview page: the Blue/350 ground and the phone search. */
const isPortCallPage = computed(() => ['port-call', 'port-call-section', 'port-call-edit'].includes(String(route.name)));
const backLocation = computed(() => route.name === 'port-call' ? '/' : { name: 'port-call', params: { callId: String(route.params.callId) } });
const backLabel = computed(() => route.name === 'port-call' ? 'Back to port calls' : 'Back to port call overview');
const onOverview = computed(() => route.path === '/');

const orgLabel = computed(() =>
  auth.user.value?.platformAdmin && !auth.user.value?.acting ? 'Platform' : (auth.user.value?.orgName ?? ''),
);

const displayName = computed(
  () => auth.user.value?.displayName ?? auth.user.value?.username ?? '',
);

// ---- captain's PEC (specs 0043/0045) ---------------------------------------

const isCaptainUser = computed(() => auth.user.value?.role === 'captain');

const captainPec = computed<PecInfo | null>(() =>
  isCaptainUser.value ? (auth.user.value?.pec ?? null) : null,
);

const pecHasDetails = computed(() => {
  const p = captainPec.value;
  return !!p && !('none' in p);
});

// Always present for captains (user rule 2026-08-24): with details it
// shows the number, otherwise it is the way in to add/change the answer
const pecChipLabel = computed(() => {
  if (!isCaptainUser.value) return null;
  const p = captainPec.value;
  return p && !('none' in p) ? `PEC ${p.number}` : 'Add PEC data';
});

const pecMenuLabel = computed(() => {
  const p = captainPec.value;
  if (!p) return null;
  return 'none' in p ? 'No PEC for Finland' : `PEC ${p.number}`;
});

const pecDialog = ref(false);
const pecSaving = ref(false);
const pecNone = ref(false);
const pecForm = reactive({
  number: '',
  type: null as 'restricted' | 'unrestricted' | null,
  regions: [] as string[],
  ports: [] as string[],
  validUntil: '',
});
let pecOriginalValidUntil = '';
let pecAsked = false; // once per session — "Later" is respected

/** Today, 'YYYY-MM-DD' local — the Valid-until floor. */
const todayDate = computed(() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
});

// FI port options for the Port-PEC picker, loaded once per session
let pecPortsAll: { label: string; value: string }[] = [];
const pecPortOptions = ref<{ label: string; value: string }[]>([]);

async function loadPecPorts(): Promise<void> {
  if (pecPortsAll.length > 0) return;
  try {
    const { ports } = await auth.listPortOptions();
    pecPortsAll = ports.map((p) => ({
      label: p.name ? `${p.name} (${p.locode})` : p.locode,
      value: p.locode,
    }));
    pecPortOptions.value = pecPortsAll;
  } catch {
    pecPortsAll = [];
  }
}

function filterPecPorts(input: string, update: (fn: () => void) => void): void {
  const q = input.trim().toLowerCase();
  update(() => {
    pecPortOptions.value = q
      ? pecPortsAll.filter((o) => o.label.toLowerCase().includes(q))
      : pecPortsAll;
  });
}

function fillPecForm(p: PecInfo | null): void {
  pecNone.value = !!p && 'none' in p;
  const d = p && !('none' in p) ? p : null;
  pecForm.number = d?.number ?? '';
  pecForm.type = d?.type ?? null;
  pecForm.regions = d?.regions ? [...d.regions] : [];
  pecForm.ports = d?.ports ? [...d.ports] : [];
  pecForm.validUntil = d?.validUntil ?? '';
  pecOriginalValidUntil = pecForm.validUntil;
}

// Ask on first sign-in as captain while unanswered ({none: true} counts
// as answered — the toggle records "no PEC for Finland")
watch(
  () => auth.user.value,
  (u) => {
    if (u?.role === 'captain' && (u.pec === null || u.pec === undefined) && !pecAsked) {
      pecAsked = true;
      fillPecForm(null);
      pecDialog.value = true;
      void loadPecPorts();
    }
  },
  { immediate: true },
);

function openPecDialog(): void {
  fillPecForm(captainPec.value);
  pecDialog.value = true;
  void loadPecPorts();
}

async function savePec(): Promise<void> {
  const changedValidUntil = pecForm.validUntil !== pecOriginalValidUntil;
  if (!pecNone.value && pecForm.validUntil && changedValidUntil
    && pecForm.validUntil < todayDate.value) {
    $q.notify({ type: 'negative', message: 'Valid until cannot be in the past' });
    return;
  }
  pecSaving.value = true;
  try {
    const pec: PecInfo = pecNone.value
      ? { none: true }
      : {
          number: pecForm.number.trim(),
          ...(pecForm.type ? { type: pecForm.type } : {}),
          ...(pecForm.regions.length > 0 ? { regions: [...pecForm.regions] } : {}),
          ...(pecForm.ports.length > 0 ? { ports: [...pecForm.ports] } : {}),
          ...(pecForm.validUntil ? { validUntil: pecForm.validUntil } : {}),
        };
    await auth.setMyPec(pec);
    pecDialog.value = false;
    $q.notify({ type: 'positive', message: 'PEC saved' });
  } catch (e) {
    $q.notify({ type: 'negative', message: (e as Error).message });
  } finally {
    pecSaving.value = false;
  }
}

async function signOut(): Promise<void> {
  await auth.logout();
  await router.push('/login');
}

async function exitActing(): Promise<void> {
  try {
    await auth.setActingOrg(null);
    await router.push('/platform');
  } catch {
    // The chip stays; the next click retries
  }
}
</script>

<style scoped>
/* The drawer reveals this surface while the page resizes beside it. */
.app-layout {
  background: var(--nl-ground);
}
.app-layout--overview {
  background: var(--nl-ground-front);
}
.app-layout--process,
.app-layout--process .page-ground {
  background: var(--blue-100);
}
/* App header (guide p. 8): white, 66px, no line under it (user
   2026-11-01); the content edge is the page's — 100px at 1440, 1240px wide */
.app-header {
  background: var(--nl-card);
  color: var(--nl-g-ink);
  /* The browser owns the Dynamic Island/status-bar inset; never hardcode it. */
  padding-top: env(safe-area-inset-top, 0px);
}
.app-header__inner {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--nl-header-height);
  max-width: var(--nl-page-max-width);
  margin-inline: auto;
  padding-left: var(--nl-page-padding-left);
  padding-right: var(--nl-page-padding-right);
}
.brand-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 37px;
  flex: none;
  text-decoration: none;
  margin-inline-end: 81px;
}
.brand-back { flex-direction: row; gap: 8px; width: auto; min-width: 48px; min-height: 48px; justify-content: center; color: var(--nl-g-ink); }
.brand-back .brand-word { font-size: 14px; line-height: 20px; }
.brand-back :deep(.q-icon) { flex: none; }
[dir="rtl"] .brand-back :deep(.q-icon) { transform: scaleX(-1); }
.brand-back:focus-visible { outline: 2px solid var(--blue-800); outline-offset: 4px; }
.brand-mark {
  display: block;
}
/* The only Inter in the app: the word under the mark (guide p. 6) */
.brand-word {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 8px;
  line-height: 8px;
  color: var(--nl-g-ink);
}
.app-header__icon {
  color: var(--nl-g-body);
}
/* The phone menu: white, the whole screen under the 66px bar, no line or
   shadow; its own scroll */
.app-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: calc(100dvh - var(--nl-header-safe-height));
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--nl-card);
  color: var(--nl-g-ink);
  padding: 8px env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
}
.app-menu__list {
  max-width: none;
}
.app-menu__list :deep(.q-item) { padding-inline: var(--nl-page-gutter); }
@media (max-width: 1023px) {
  .brand-link {
    margin-inline-end: 16px;
  }
}
@media (max-width: 599.98px) {
  .brand-link {
    margin-inline-end: 4px;
    width: auto;
  }
  /* Align the visible 24px glyphs to the content edges, while keeping
     their 48px touch targets inside the safe area. */
  .brand-back { margin-inline-start: -16px; }
  .app-header__icon { width: 48px; min-width: 48px; height: 48px; min-height: 48px; }
  .app-header__icon :deep(.q-icon) { font-size: 24px; }
  .app-header__icon--menu { margin-inline-end: -16px; }
  /* Phones: the N alone, 20px high (user 2026-11-06) */
  .brand-mark {
    height: 20px;
    width: auto;
  }
}
/* Overview tools in the header: search, New port call, Card view (user 2026-11-06) */
/* Search + New port call: one group in the middle of the header (user 2026-11-07) —
   on desktop the true centre; on tablet between the logo and the icons */
.header-center {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.header-search {
  flex: 0 1 280px;
  min-width: 60px;
}
@media (min-width: 1024px) {
  .header-center {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .header-search {
    width: 280px;
  }
}
@media (max-width: 1023px) {
  .header-center {
    flex: 0 1 auto;
  }
  .header-search {
    flex: 0 1 160px;
  }
}
.header-new {
  flex: none;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  line-height: normal;
  white-space: nowrap;
}
.header-new :deep(.q-btn__content) {
  min-height: 0;
}
.view-switch {
  flex: none;
  /* 8px header gap + 8px = 16px after New port call (user 2026-11-07) */
  margin-left: 8px;
}
/* On tablet the label "Card view" is hidden — the toggle alone is enough (user 2026-11-06) */
@media (max-width: 1023px) {
  .view-switch :deep(.q-toggle__label) {
    display: none;
  }
}
.tool-muted {
  opacity: 0.45;
  transition: opacity 0.18s ease;
}
.tool-muted:hover,
.tool-muted:focus-within {
  opacity: 1;
}
/* Phone search overlay: covers the full header bar (user 2026-11-06) */
.app-header__inner {
  position: relative;
}
.app-search-overlay {
  position: absolute;
  inset: 0;
  background: var(--nl-card);
  display: flex;
  align-items: center;
  padding-left: var(--nl-page-padding-left);
  padding-right: var(--nl-page-padding-right);
  z-index: 2;
}
.app-search-overlay__field {
  flex: 1;
}
/* Acting in another org: the warning pair, words with it (guide p. 4) */
.acting-chip {
  max-width: 50vw;
  background: var(--nl-amber-bg);
  color: var(--nl-amber-text);
  font-weight: 600;
  border-radius: 12px;
}
/* Captain's PEC — a quiet identity chip (spec 0043) */
.pec-chip {
  background: var(--nl-g-base);
  color: var(--nl-g-ink);
  font-weight: 600;
  border-radius: 12px;
}
.page-ground {
  background: var(--nl-ground);
  min-height: 100vh;
  /* Mobile browsers resize their chrome; dvh tracks the visible viewport. */
  min-height: 100dvh;
}
/* The front page (port-call overview): Blue/350 under the cards, as the search field (user 2026-11-02) */
.page-ground--front {
  background: var(--nl-ground-front);
}
@media (min-width: 1024px) {
  .app-layout .app-header__inner {
    transition: padding-right 200ms cubic-bezier(0.2, 0, 0, 1);
  }
  .app-layout--shift-nav .app-header__inner {
    /* Keep the centered container and logo's left edge unchanged. */
    padding-right: max(16px, calc(var(--nl-call-drawer-width) + 48px - max(0px, (100vw - 1272px) / 2)));
    transition-duration: 300ms;
  }
  .app-layout--shift-nav .header-center {
    position: static;
    transform: none;
    flex: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-layout .app-header__inner {
    transition: none;
  }
}
</style>
