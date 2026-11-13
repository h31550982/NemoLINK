<template>
  <div>
    <div class="tab-title q-mb-md row items-center">
      <span>Users</span>
      <HelpTip topic="users.statuses" />
      <q-space />
      <SearchBox v-model="search" placeholder="Search users" />
    </div>

    <div v-if="loading" class="row justify-center q-pa-lg">
      <q-spinner size="32px" color="primary" />
    </div>

    <template v-else>
      <q-banner
        v-if="pendingCount > 0"
        rounded
        class="bg-warning text-dark q-mb-md"
      >
        <template #avatar>
          <q-icon name="hourglass_empty" />
        </template>
        {{ pendingCount }} user{{ pendingCount === 1 ? '' : 's' }} awaiting approval
      </q-banner>

      <q-table
        :rows="filtered"
        :columns="columns"
        row-key="id"
        flat
        bordered
        dense
        hide-bottom
        :pagination="{ rowsPerPage: 0 }"
        class="users-table rounded-borders"
        :no-data-label="search ? 'No users match your search.' : 'No users yet.'"
      >
        <template #body="props">
          <q-tr :props="props" :class="{ 'pending-row': props.row.status === 'pending' }">
            <q-td key="user" :props="props">
              <div class="text-weight-semibold">
                {{ props.row.displayName ?? props.row.username }}
                <span v-if="props.row.id === auth.user.value?.id" class="text-caption text-grey-7">
                  (you)
                </span>
              </div>
              <div class="text-caption text-grey-7">{{ props.row.username }}</div>
              <div
                v-if="props.row.email && props.row.email !== props.row.username"
                class="text-caption text-grey-7"
              >
                {{ props.row.email }}
              </div>
            </q-td>
            <q-td key="role" :props="props">
              <span class="text-capitalize">{{ props.row.role ?? '—' }}</span>
              <div v-if="props.row.role === 'captain'" class="text-caption text-grey-7">
                <template v-if="props.row.shipId">{{ shipName(props.row.shipId) }}</template>
                <template v-else>no ship linked</template>
              </div>
            </q-td>
            <q-td key="signin" :props="props">
              <q-icon
                :name="props.row.authType === 'oidc' ? 'business' : 'keyboard'"
                size="16px"
                color="grey-7"
                class="q-mr-xs"
              />{{ props.row.authType === 'oidc' ? 'SSO' : 'Local' }}
            </q-td>
            <q-td key="status" :props="props">
              <StatusPill
                :tone="statusOf(props.row).tone"
                :icon="statusOf(props.row).icon"
                :label="statusOf(props.row).words"
              />
              <div v-if="props.row.lockedUntil" class="text-caption locked-note">
                <q-icon name="lock_clock" size="14px" />
                Locked until {{ fmtTime(props.row.lockedUntil) }}
              </div>
            </q-td>
            <q-td key="welcome" :props="props">
              <StatusPill
                v-if="props.row.status === 'active' && props.row.email"
                :tone="welcomeOf(props.row).tone"
                :icon="welcomeOf(props.row).icon"
                :label="welcomeOf(props.row).words"
              />
              <span v-else class="text-grey-5">—</span>
            </q-td>
            <q-td key="created" :props="props">{{ fmtDate(props.row.created) }}</q-td>
            <q-td key="lastSeen" :props="props">
              <span v-if="props.row.lastSeen">{{ fmtDateTime(props.row.lastSeen) }}</span>
              <span v-else class="text-grey-5">—</span>
            </q-td>
            <q-td key="actions" :props="props" class="actions-cell">
              <template v-if="props.row.status === 'pending'">
                <q-btn
                  flat round dense
                  color="positive"
                  icon="check"
                  :aria-label="`Approve ${props.row.username}`"
                  @click="openApprove(props.row)"
                >
                  <q-tooltip>Approve</q-tooltip>
                </q-btn>
                <q-btn
                  flat round dense
                  color="negative"
                  icon="block"
                  :aria-label="`Reject ${props.row.username}`"
                  @click="confirmReject(props.row)"
                >
                  <q-tooltip>Reject</q-tooltip>
                </q-btn>
              </template>
              <template v-else-if="props.row.status === 'active'">
                <q-btn
                  v-if="props.row.id !== auth.user.value?.id"
                  flat round dense
                  color="primary"
                  icon="manage_accounts"
                  :aria-label="`Change role of ${props.row.username}`"
                  @click="openRoleChange(props.row)"
                >
                  <q-tooltip>Change role</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="props.row.role === 'captain'"
                  flat round dense
                  color="primary"
                  icon="directions_boat"
                  :aria-label="`Assign a ship to ${props.row.username}`"
                  @click="openAssignShip(props.row)"
                >
                  <q-tooltip>Assign ship</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="props.row.email"
                  flat round dense
                  color="primary"
                  icon="forward_to_inbox"
                  :loading="sendingWelcome === props.row.id"
                  :aria-label="`Send welcome email to ${props.row.username}`"
                  @click="sendWelcome(props.row)"
                >
                  <q-tooltip>
                    {{ props.row.welcomeEmail ? 'Resend welcome email' : 'Send welcome email' }}
                  </q-tooltip>
                </q-btn>
                <q-btn
                  v-if="props.row.id !== auth.user.value?.id"
                  flat round dense
                  color="negative"
                  icon="block"
                  :aria-label="`Revoke access of ${props.row.username}`"
                  @click="confirmReject(props.row)"
                >
                  <q-tooltip>Revoke access</q-tooltip>
                </q-btn>
              </template>
              <template v-else-if="props.row.status === 'rejected'">
                <q-btn
                  flat round dense
                  color="positive"
                  icon="undo"
                  :aria-label="`Re-approve ${props.row.username}`"
                  @click="openApprove(props.row)"
                >
                  <q-tooltip>Re-approve</q-tooltip>
                </q-btn>
              </template>
            </q-td>
          </q-tr>
        </template>
      </q-table>
    </template>

    <!-- Approve / re-approve: pick a role -->
    <HouseDialog
      v-model="approveDialog"
      :title="`Approve ${approveTarget?.displayName ?? approveTarget?.username ?? ''}`"
      help-topic="users.roles"
      :close-disable="acting"
      :main-label="`Approve as ${approveRole}`"
      main-color="positive"
      :main-loading="acting"
      @main="doApprove"
    >
      <div class="text-caption text-grey-7 q-mb-sm">{{ approveTarget?.username }}</div>
      <q-list>
        <q-item
          v-for="r in ROLES"
          :key="r.value"
          tag="label"
          clickable
          class="rounded-borders"
        >
          <q-item-section avatar>
            <q-radio v-model="approveRole" :val="r.value" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="text-capitalize">{{ r.value }}</q-item-label>
            <q-item-label caption>{{ r.hint }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </HouseDialog>

    <!-- Change role of an active user (spec 0019) -->
    <HouseDialog
      v-model="roleDialog"
      :title="`Change role of ${roleTarget?.displayName ?? roleTarget?.username ?? ''}`"
      help-topic="users.roles"
      :close-disable="acting"
      :main-label="`Change to ${newRole}`"
      :main-loading="acting"
      :main-disable="newRole === roleTarget?.role"
      @main="doChangeRole"
    >
      <div class="text-caption text-grey-7 q-mb-sm">
        {{ roleTarget?.username }} — currently
        <span class="text-capitalize">{{ roleTarget?.role }}</span>
      </div>
      <q-list>
        <q-item
          v-for="r in ROLES"
          :key="r.value"
          tag="label"
          clickable
          class="rounded-borders"
        >
          <q-item-section avatar>
            <q-radio v-model="newRole" :val="r.value" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="text-capitalize">{{ r.value }}</q-item-label>
            <q-item-label caption>{{ r.hint }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </HouseDialog>

    <!-- Captain ↔ ship binding (spec 0049) -->
    <HouseDialog
      v-model="shipDialog"
      :title="`Assign a ship to ${shipTarget?.displayName ?? shipTarget?.username ?? ''}`"
      help-topic="users.captain-ship"
      :close-disable="acting"
      :main-label="shipChoice ? 'Assign ship' : 'Remove link'"
      :main-loading="acting"
      :main-disable="shipChoice === (shipTarget?.shipId ?? null)"
      @main="doAssignShip"
    >
      <div class="text-caption text-grey-7 q-mb-sm">
        The captain sees this ship’s port calls and uploads its forms.
      </div>
      <q-select
        v-model="shipChoice"
        :options="shipOptions"
        label="Ship"
        outlined
        dense
        clearable
        emit-value
        map-options
        options-dense
        hint="List: your ships (admin area)"
      />
    </HouseDialog>

    <!-- Reject / revoke: confirm -->
    <HouseDialog
      v-model="rejectDialog"
      :title="rejectTarget?.status === 'active' ? 'Revoke access?' : 'Reject sign-up?'"
      :close-disable="acting"
      :main-label="rejectTarget?.status === 'active' ? 'Revoke access' : 'Reject'"
      main-color="negative"
      :main-loading="acting"
      @main="doReject"
    >
      <div class="text-body2">
        <template v-if="rejectTarget?.status === 'active'">
          <b>{{ rejectTarget?.displayName ?? rejectTarget?.username }}</b> will be signed
          out immediately and can no longer log in. You can re-approve them later.
        </template>
        <template v-else>
          <b>{{ rejectTarget?.displayName ?? rejectTarget?.username }}</b> will not get
          access. You can still re-approve them later.
        </template>
      </div>
    </HouseDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fmtDay, fmtStamp } from '../../lib/time';
import { useQuasar, type QTableColumn } from 'quasar';
import { useAuth, type OrgUser, type Ship } from '../../auth/auth';
import HelpTip from '../../components/HelpTip.vue';
import HouseDialog from '../../components/HouseDialog.vue';
import SearchBox from '../../components/SearchBox.vue';
import StatusPill, { type PillTone } from '../../components/StatusPill.vue';

const $q = useQuasar();
const auth = useAuth();

const users = ref<OrgUser[]>([]);
const loading = ref(true);
const acting = ref(false);
const search = ref('');

const approveDialog = ref(false);
const approveTarget = ref<OrgUser | null>(null);
const approveRole = ref('viewer');

const roleDialog = ref(false);
const roleTarget = ref<OrgUser | null>(null);
const newRole = ref('viewer');

const rejectDialog = ref(false);
const rejectTarget = ref<OrgUser | null>(null);
const sendingWelcome = ref<string | null>(null);

// Captain ↔ ship binding (spec 0049)
const ships = ref<Ship[]>([]);
const shipDialog = ref(false);
const shipTarget = ref<OrgUser | null>(null);
const shipChoice = ref<string | null>(null);

const shipOptions = computed(() =>
  ships.value
    .filter((s) => s.isActive)
    .map((s) => ({
      label: s.imoNumber ? `${s.name ?? '—'} (IMO ${s.imoNumber})` : (s.name ?? '—'),
      value: s.id,
    })),
);

function shipName(id: string): string {
  const ship = ships.value.find((s) => s.id === id);
  return ship?.name ?? 'ship no longer in the fleet';
}

const ROLES = [
  { value: 'admin', hint: 'Manage users and organization settings' },
  { value: 'editor', hint: 'Prepare, check and send declarations' },
  { value: 'viewer', hint: 'Read-only access' },
  { value: 'captain', hint: 'Ship captain — ship tasks only' },
];

const columns: QTableColumn<OrgUser>[] = [
  {
    name: 'user',
    label: 'User',
    align: 'left',
    field: (r) => (r.displayName ?? r.username).toLowerCase(),
    sortable: true,
  },
  { name: 'role', label: 'Role', align: 'left', field: (r) => r.role ?? '', sortable: true },
  { name: 'signin', label: 'Sign-in', align: 'left', field: 'authType', sortable: true },
  { name: 'status', label: 'Status', align: 'left', field: 'status', sortable: true },
  {
    name: 'welcome',
    label: 'Welcome email',
    align: 'left',
    field: (r) => r.welcomeEmail?.status ?? '',
    sortable: true,
  },
  { name: 'created', label: 'Created', align: 'left', field: 'created', sortable: true },
  {
    name: 'lastSeen',
    label: 'Last active',
    align: 'left',
    field: (r) => r.lastSeen ?? '',
    sortable: true,
  },
  { name: 'actions', label: '', align: 'right', field: () => '' },
];

const pendingCount = computed(
  () => users.value.filter((u) => u.status === 'pending').length,
);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return users.value;
  return users.value.filter((u) =>
    [
      u.username,
      u.displayName ?? '',
      u.email ?? '',
      u.role ?? '',
      statusOf(u).words,
      u.authType === 'oidc' ? 'sso company' : 'local',
      u.lockedUntil ? 'locked' : '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
});

function statusOf(u: OrgUser): { tone: PillTone; icon: string; words: string } {
  // Design law 3: status is always color + icon + words.
  switch (u.status) {
    case 'pending':
      return { tone: 'amber', icon: 'hourglass_empty', words: 'Awaiting approval' };
    case 'active':
      return { tone: 'green', icon: 'check_circle', words: 'Active' };
    default:
      return { tone: 'red', icon: 'block', words: 'Rejected' };
  }
}

function welcomeOf(u: OrgUser): { tone: PillTone; icon: string; words: string } {
  switch (u.welcomeEmail?.status) {
    case 'delivered':
      return { tone: 'green', icon: 'mark_email_read', words: 'delivered' };
    case 'sent':
    case 'queued':
      // Blue = sent / in transit (concept §3)
      return { tone: 'blue', icon: 'send', words: 'on its way' };
    case 'bounced':
    case 'complained':
    case 'failed':
      return { tone: 'red', icon: 'error_outline', words: u.welcomeEmail.status };
    default:
      return { tone: 'gray', icon: 'mail_outline', words: 'not sent' };
  }
}

function fmtDate(iso: string): string {
  return fmtDay(iso);
}

function fmtDateTime(iso: string): string {
  return fmtStamp(iso);
}

function fmtTime(iso: string): string {
  return fmtStamp(iso).slice(11);
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    users.value = await auth.listUsers();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load users.' });
  } finally {
    loading.value = false;
  }
}

function openApprove(u: OrgUser): void {
  approveTarget.value = u;
  approveRole.value = u.role ?? 'viewer';
  approveDialog.value = true;
}

function openRoleChange(u: OrgUser): void {
  roleTarget.value = u;
  newRole.value = u.role ?? 'viewer';
  roleDialog.value = true;
}

function confirmReject(u: OrgUser): void {
  rejectTarget.value = u;
  rejectDialog.value = true;
}

async function doApprove(): Promise<void> {
  if (!approveTarget.value) return;
  acting.value = true;
  try {
    await auth.approveUser(approveTarget.value.id, approveRole.value);
    $q.notify({
      type: 'positive',
      message: `${approveTarget.value.displayName ?? approveTarget.value.username} approved as ${approveRole.value}.`,
    });
    approveDialog.value = false;
    await refresh();
  } catch {
    $q.notify({ type: 'negative', message: 'Approval failed — try again.' });
  } finally {
    acting.value = false;
  }
}

async function doChangeRole(): Promise<void> {
  if (!roleTarget.value) return;
  acting.value = true;
  try {
    await auth.changeUserRole(roleTarget.value.id, newRole.value);
    $q.notify({
      type: 'positive',
      message: `${roleTarget.value.displayName ?? roleTarget.value.username} is now ${newRole.value}.`,
    });
    roleDialog.value = false;
    await refresh();
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not change the role.',
    });
  } finally {
    acting.value = false;
  }
}

async function doReject(): Promise<void> {
  if (!rejectTarget.value) return;
  acting.value = true;
  try {
    await auth.rejectUser(rejectTarget.value.id);
    $q.notify({
      type: 'positive',
      message: `${rejectTarget.value.displayName ?? rejectTarget.value.username} no longer has access.`,
    });
    rejectDialog.value = false;
    await refresh();
  } catch {
    $q.notify({ type: 'negative', message: 'Rejection failed — try again.' });
  } finally {
    acting.value = false;
  }
}

function openAssignShip(u: OrgUser): void {
  shipTarget.value = u;
  shipChoice.value = u.shipId;
  shipDialog.value = true;
}

async function doAssignShip(): Promise<void> {
  const target = shipTarget.value;
  if (!target) return;
  acting.value = true;
  try {
    await auth.assignUserShip(target.id, shipChoice.value);
    $q.notify({
      type: 'positive',
      message: shipChoice.value
        ? `${target.displayName ?? target.username} now sees ${shipName(shipChoice.value)}’s port calls.`
        : `${target.displayName ?? target.username} is no longer linked to a ship.`,
    });
    shipDialog.value = false;
    await refresh();
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not assign the ship.',
    });
  } finally {
    acting.value = false;
  }
}

async function sendWelcome(u: OrgUser): Promise<void> {
  sendingWelcome.value = u.id;
  try {
    await auth.resendWelcome(u.id);
    $q.notify({
      type: 'positive',
      message: `Welcome email sent to ${u.email}.`,
    });
    await refresh();
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not send the welcome email.',
    });
  } finally {
    sendingWelcome.value = null;
  }
}

onMounted(() => {
  void refresh();
  // Ship names for captain rows and the assign dialog — best-effort
  void auth
    .listShips()
    .then((rows) => {
      ships.value = rows;
    })
    .catch(() => undefined);
});
</script>

<style scoped>
.users-table {
  background: white;
}
.users-table :deep(th) {
  font-weight: 600;
  color: var(--nl-ink-2);
}
.pending-row {
  background: var(--nl-missing-bg);
}
.pending-row > td:first-child {
  border-left: 4px solid var(--nl-missing-bar);
}
.actions-cell {
  white-space: nowrap;
}
.locked-note {
  color: var(--nl-amber-text);
}
</style>
