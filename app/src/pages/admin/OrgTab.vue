<template>
  <div>
    <div class="tab-title q-mb-md">Organization</div>

    <div v-if="loading" class="row justify-center q-pa-lg">
      <q-spinner size="32px" color="primary" />
    </div>

    <template v-else-if="org">
      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <div class="detail-row">
            <span class="detail-label">Name</span>
            <span class="detail-value text-weight-semibold">{{ org.name }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Short name</span>
            <span class="detail-value">{{ org.slug }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Company sign-in</span>
            <span class="detail-value">
              <StatusPill
                :tone="org.ssoConfigured ? 'green' : 'gray'"
                :icon="org.ssoConfigured ? 'check_circle' : 'do_not_disturb'"
                :label="org.ssoConfigured ? 'Configured' : 'Not configured'"
              />
            </span>
          </div>
          <div v-if="org.entraTenantId" class="detail-row">
            <span class="detail-label">Entra tenant</span>
            <span class="detail-value">{{ org.entraTenantId }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Created</span>
            <span class="detail-value">{{ fmtDay(org.created) }}</span>
          </div>
        </q-card-section>
      </q-card>

      <!-- Static customer-level declaration data (spec 0038) -->
      <q-card flat bordered>
        <q-card-section>
          <div class="card-title row items-center q-mb-sm">
            <span>NEMO declarant details</span>
            <HelpTip topic="org.declarant" />
            <q-space />
            <q-btn
              flat
              dense
              no-caps
              color="tealdark"
              icon="edit"
              label="Edit"
              @click="openEdit"
            />
          </div>
          <div class="detail-row">
            <span class="detail-label">Business ID</span>
            <span class="detail-value">{{ org.businessId ?? '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">EORI</span>
            <span class="detail-value">{{ org.eori ?? '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Agent ID number</span>
            <span class="detail-value">{{ org.agent.agentId ?? '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Agency name</span>
            <span class="detail-value">{{ org.agent.agencyName ?? '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Mobile</span>
            <span class="detail-value tnum">{{ org.agent.mobile ?? '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Landline</span>
            <span class="detail-value tnum">{{ org.agent.landline ?? '—' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Agent email</span>
            <span class="detail-value">{{ org.agent.email ?? '—' }}</span>
          </div>
          <!-- The DUE's liable party address (spec 0092) -->
          <div class="detail-row">
            <span class="detail-label">Postal address</span>
            <span class="detail-value">{{ addressLine || '—' }}</span>
          </div>
        </q-card-section>
      </q-card>


      <!-- The org's own NEMO key (spec 0059) -->
      <q-card flat bordered class="q-mt-md">
        <q-card-section>
          <div class="card-title row items-center q-mb-sm">
            <span>NEMO API key</span>
            <HelpTip topic="org.nemoKey" />
          </div>
          <div class="text-body2 q-mb-sm" style="color: var(--nl-ink-2)">
            The key your organization got from Fintraffic. NEMOLink files
            declarations to NEMO with it, on your behalf. It is stored
            encrypted and never shown again after saving.
          </div>
          <div v-if="credentialsError" class="text-body2 q-mb-sm" style="color: var(--nl-red-text)">
            {{ credentialsError }}
          </div>
          <div v-if="!vaultConfigured" class="text-body2 q-mb-sm" style="color: var(--nl-amber-text)">
            Keys cannot be stored on this deployment yet — the credential vault
            is not configured. Ask nauticAi support.
          </div>
          <div v-for="cred in credentials" :key="cred.target" class="detail-row">
            <span class="detail-label">{{ TARGET_LABEL[cred.target] }}</span>
            <span class="detail-value">
              <StatusPill
                :tone="cred.configured ? 'green' : 'gray'"
                :icon="cred.configured ? 'check_circle' : 'do_not_disturb'"
                :label="cred.configured ? 'Configured' : 'Not configured'"
              />
            </span>
            <span v-if="cred.configured" class="detail-note">
              set by {{ cred.author ?? 'unknown' }}
              on {{ fmtDay(cred.updated!) }}
            </span>
            <q-space />
            <q-btn
              flat
              dense
              no-caps
              color="tealdark"
              :icon="cred.configured ? 'autorenew' : 'add'"
              :label="cred.configured ? 'Replace' : 'Set key'"
              :disable="!vaultConfigured"
              @click="openKey(cred.target)"
            />
            <q-btn
              v-if="cred.configured"
              flat
              dense
              no-caps
              color="negative"
              icon="delete_outline"
              label="Remove"
              @click="confirmRemoveKey(cred.target)"
            />
          </div>
        </q-card-section>
      </q-card>

      <!-- The ingest contract for upstream systems (spec 0052) -->
      <q-card flat bordered class="q-mt-md">
        <q-card-section>
          <div class="card-title row items-center q-mb-sm">
            <span>Upstream data ingestion</span>
            <q-space />
            <q-btn
              flat
              dense
              no-caps
              color="tealdark"
              icon="download"
              label="Download schema"
              type="a"
              :href="auth.ingestSchemaUrl()"
            />
          </div>
          <div class="text-body2 q-mb-sm" style="color: var(--nl-ink-2)">
            Systems that push data into NEMOLink (voyage plans, arrival and
            departure actuals, ship master data) send it to the ingest API.
            The JSON Schema below describes the exact envelope to send —
            give it to the team configuring the upstream system.
          </div>
          <div class="detail-row">
            <span class="detail-label">Schema version</span>
            <span class="detail-value tnum">{{ ingestSchema?.version ?? '—' }}</span>
          </div>
        </q-card-section>
      </q-card>
    </template>

    <HouseDialog
      v-model="editDialog"
      title="NEMO declarant details"
      help-topic="org.declarant"
      :max-width-px="520"
      :close-disable="saving"
      close-label="Cancel"
      main-label="Save"
      :main-loading="saving"
      @main="save"
    >
      <div class="row q-col-gutter-sm q-mb-sm">
        <q-input v-model="form.businessId" label="Business ID" outlined dense
          class="col-6" :disable="saving" hint="Finnish form e.g. 0669579-8" />
        <q-input v-model="form.eori" label="EORI" outlined dense class="col-6"
          :disable="saving" />
      </div>
      <q-input v-model="form.agentId" label="Agent identification number" outlined
        dense class="q-mb-sm" :disable="saving" hint="e.g. FI06695798" />
      <q-input v-model="form.agencyName" label="Agency name" outlined dense
        class="q-mb-sm" :disable="saving" />
      <div class="row q-col-gutter-sm q-mb-sm">
        <q-input v-model="form.mobile" label="Mobile" outlined dense class="col-6"
          :disable="saving" hint="with country prefix, e.g. +358…" />
        <q-input v-model="form.landline" label="Landline" outlined dense
          class="col-6" :disable="saving" />
      </div>
      <q-input v-model="form.email" label="Agent email" outlined dense
        class="q-mb-sm" :disable="saving" />
      <!-- The DUE names the agency as the liable party, with this address (spec 0092) -->
      <q-input v-model="form.street" label="Street address" outlined dense
        class="q-mb-sm" :disable="saving" />
      <div class="row q-col-gutter-sm">
        <q-input v-model="form.postcode" label="Postcode" outlined dense class="col-4"
          :disable="saving" />
        <q-input v-model="form.city" label="City" outlined dense class="col-8"
          :disable="saving" />
      </div>
      <q-select
        v-model="form.countryCode"
        :options="countryOptions"
        emit-value map-options outlined dense options-dense clearable
        use-input fill-input hide-selected input-debounce="0"
        label="Country"
        hint="List: countries (ISO 3166)"
        class="q-mt-sm"
        :disable="saving"
        @filter="filterCountries"
      />
    </HouseDialog>

    <HouseDialog
      v-model="keyDialog"
      :title="keyDialogTitle"
      help-topic="org.nemoKey"
      :max-width-px="520"
      :close-disable="savingKey"
      close-label="Cancel"
      main-label="Save key"
      :main-loading="savingKey"
      :main-disable="!keyForm.clientId.trim() || !keyForm.clientSecret"
      @main="saveKey"
    >
      <div class="text-body2 q-mb-md" style="color: var(--nl-ink-2)">
        Paste the client ID and client secret Fintraffic issued for
        {{ TARGET_LABEL[keyForm.target].toLowerCase() }}. Saving replaces any
        key already stored for it.
      </div>
      <q-input v-model="keyForm.clientId" label="Client ID" outlined dense
        class="q-mb-sm" :disable="savingKey" autocomplete="off"
        hint="The business ID of the organisation the key belongs to (Fintraffic’s Asiakastunniste) — every call to NEMO names it" />
      <q-input v-model="keyForm.clientSecret" label="Client secret" outlined dense
        class="q-mb-sm" :disable="savingKey" type="password" autocomplete="new-password"
        hint="Stored encrypted; never shown again after saving" />
      <q-input v-model="keyForm.label" label="Note (optional)" outlined dense
        :disable="savingKey" hint="e.g. which Fintraffic ticket it came from" />
    </HouseDialog>

    <RemovalDialog
      v-model="removeDialog"
      title="Are you sure you want to remove this NEMO key?"
      :loading="removingKey"
      @confirm="doRemoveKey"
    >
      <div>
        NEMOLink will stop being able to file
        {{ removeTarget ? TARGET_LABEL[removeTarget].toLowerCase() : '' }}
        declarations until a key is set again. The stored key cannot be read
        back — to undo this you would enter it fresh from Fintraffic.
      </div>
    </RemovalDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { fmtDay } from '../../lib/time';
import { useQuasar } from 'quasar';
import {
  useAuth,
  type NemoCredentialStatus,
  type OrgInfo,
  type OrgUpdate,
} from '../../auth/auth';
import { COUNTRIES } from '../../generated/countries';
import HelpTip from '../../components/HelpTip.vue';
import HouseDialog from '../../components/HouseDialog.vue';
import RemovalDialog from '../../components/RemovalDialog.vue';
import StatusPill from '../../components/StatusPill.vue';

const $q = useQuasar();
const auth = useAuth();

const org = ref<OrgInfo | null>(null);
const ingestSchema = ref<{ version: string; filename: string } | null>(null);
const loading = ref(true);
const saving = ref(false);
const editDialog = ref(false);

// --- the org's own NEMO key (spec 0059) ---
const TARGET_LABEL: Record<'stg' | 'prd', string> = {
  stg: 'Staging (test)',
  prd: 'Production',
};
const credentials = ref<NemoCredentialStatus[]>([]);
const vaultConfigured = ref(true);
/** The key status could not be read — said in place, not only in a toast that is gone in a moment. */
const credentialsError = ref<string | null>(null);
const keyDialog = ref(false);
const savingKey = ref(false);
const keyForm = reactive({
  target: 'stg' as 'stg' | 'prd',
  clientId: '',
  clientSecret: '',
  label: '',
});
const keyDialogTitle = computed(() =>
  `${TARGET_LABEL[keyForm.target]} NEMO key`,
);
const removeDialog = ref(false);
const removeTarget = ref<'stg' | 'prd' | null>(null);
const removingKey = ref(false);

/** The postal address on one line, for the card. */
const addressLine = computed(() => {
  const a = org.value?.agent;
  if (!a) return '';
  return [a.street, [a.postcode, a.city].filter(Boolean).join(' '), a.countryCode].filter(Boolean).join(', ');
});

/** Countries for the address (ISO 3166), Finland first as generated; typed to filter. */
const countryAll = COUNTRIES.map((c) => ({ label: `${c.name} (${c.code})`, value: c.code }));
const countryOptions = ref(countryAll);
function filterCountries(input: string, update: (fn: () => void) => void): void {
  const q = input.trim().toLowerCase();
  update(() => {
    countryOptions.value = q ? countryAll.filter((o) => o.label.toLowerCase().includes(q)) : countryAll;
  });
}

const form = reactive({
  businessId: '',
  eori: '',
  agentId: '',
  agencyName: '',
  mobile: '',
  landline: '',
  email: '',
  street: '',
  postcode: '',
  city: '',
  countryCode: null as string | null,
});


function openEdit(): void {
  if (!org.value) return;
  form.businessId = org.value.businessId ?? '';
  form.eori = org.value.eori ?? '';
  form.agentId = org.value.agent.agentId ?? '';
  form.agencyName = org.value.agent.agencyName ?? '';
  form.mobile = org.value.agent.mobile ?? '';
  form.landline = org.value.agent.landline ?? '';
  form.email = org.value.agent.email ?? '';
  form.street = org.value.agent.street ?? '';
  form.postcode = org.value.agent.postcode ?? '';
  form.city = org.value.agent.city ?? '';
  form.countryCode = org.value.agent.countryCode ?? null;
  editDialog.value = true;
}

/** '' -> clear only when a value existed; unchanged fields are omitted. */
function fieldPatch(
  raw: string,
  original: string | null | undefined,
): string | null | undefined {
  const value = raw.trim();
  if (value === (original ?? '')) return undefined;
  return value === '' ? null : value;
}

async function save(): Promise<void> {
  if (!org.value) return;
  const input: OrgUpdate = {};
  const businessId = fieldPatch(form.businessId, org.value.businessId);
  if (businessId !== undefined) input.businessId = businessId;
  const eori = fieldPatch(form.eori, org.value.eori);
  if (eori !== undefined) input.eori = eori;
  const agent: NonNullable<OrgUpdate['agent']> = {};
  for (const key of ['agentId', 'agencyName', 'mobile', 'landline', 'email', 'street', 'postcode', 'city'] as const) {
    const patch = fieldPatch(form[key], org.value.agent[key]);
    if (patch !== undefined) agent[key] = patch;
  }
  if ((form.countryCode ?? null) !== (org.value.agent.countryCode ?? null)) agent.countryCode = form.countryCode ?? null;
  if (Object.keys(agent).length > 0) input.agent = agent;
  if (Object.keys(input).length === 0) {
    editDialog.value = false;
    return;
  }
  saving.value = true;
  try {
    org.value = await auth.updateOrg(input);
    editDialog.value = false;
    $q.notify({ type: 'positive', message: 'Declarant details saved.' });
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not save.',
    });
  } finally {
    saving.value = false;
  }
}

/** Always opens empty — a stored secret never reaches the browser. */
function openKey(target: 'stg' | 'prd'): void {
  keyForm.target = target;
  keyForm.clientId = '';
  keyForm.clientSecret = '';
  keyForm.label = '';
  keyDialog.value = true;
}

async function saveKey(): Promise<void> {
  savingKey.value = true;
  try {
    credentials.value = await auth.setNemoCredential({
      target: keyForm.target,
      clientId: keyForm.clientId.trim(),
      clientSecret: keyForm.clientSecret,
      label: keyForm.label.trim() || null,
    });
    keyDialog.value = false;
    $q.notify({ type: 'positive', message: 'NEMO key saved.' });
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not save the key.',
    });
  } finally {
    savingKey.value = false;
  }
}

function confirmRemoveKey(target: 'stg' | 'prd'): void {
  removeTarget.value = target;
  removeDialog.value = true;
}

async function doRemoveKey(): Promise<void> {
  const target = removeTarget.value;
  if (!target) return;
  removingKey.value = true;
  try {
    credentials.value = await auth.removeNemoCredential(target);
    removeDialog.value = false;
    $q.notify({ type: 'positive', message: 'NEMO key removed.' });
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Could not remove the key.',
    });
  } finally {
    removingKey.value = false;
  }
}

onMounted(async () => {
  try {
    org.value = await auth.getOrg();
  } catch {
    $q.notify({ type: 'negative', message: 'Could not load organization info.' });
  } finally {
    loading.value = false;
  }
  try {
    const state = await auth.getNemoCredentials();
    credentials.value = state.credentials;
    vaultConfigured.value = state.vaultConfigured;
    credentialsError.value = null;
  } catch {
    credentialsError.value =
      'Could not load the NEMO key status — reload the page; if it persists, ask nauticAi support ' +
      '(the server log says why).';
    $q.notify({ type: 'negative', message: 'Could not load the NEMO key status.' });
  }
  try {
    ingestSchema.value = await auth.ingestSchemaMeta();
  } catch {
    // The card still renders; the download link works regardless.
  }
});
</script>

<style scoped>
.card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--nl-ink);
}
.detail-row {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  font-size: 14px;
  align-items: center;
}
.detail-label {
  color: var(--nl-ink-2);
  min-width: 160px;
}
.detail-value {
  color: var(--nl-ink);
  word-break: break-all;
}
.detail-note {
  color: var(--nl-ink-2);
  font-size: 14px;
}
</style>
