<template>
  <q-page class="flex flex-center q-pa-md">
    <q-card flat class="login-card">
      <div class="login-help">
        <HelpTip topic="login.methods" />
      </div>
      <!-- The header logo (mark over the word), three times the size -->
      <div class="login-logo" role="img" aria-label="NEMOLink">
        <img :src="markUrl" alt="" width="28.3834" height="25" class="login-logo__mark" />
        <span class="login-logo__word">Nemolink</span>
      </div>

      <q-btn
        class="full-width login-btn"
        color="primary"
        size="lg"
        no-caps
        unelevated
        label="SSO Login"
        :loading="ssoStarting"
        @click="startSso"
      />

      <div class="login-divider row items-center no-wrap">
        <q-separator class="col" />
        <span class="login-divider-text">or with username and password</span>
        <q-separator class="col" />
      </div>

      <q-form @submit.prevent="submitLocal">
        <q-input
          v-model="username"
          placeholder="Username"
          aria-label="Username"
          autocomplete="username"
          outlined
          class="login-field q-mb-sm"
          :disable="submitting"
          @blur="checkSso"
        />
        <div v-if="ssoHint" class="login-sso-hint row items-start no-wrap q-mb-sm">
          <q-icon name="info" size="18px" class="q-mr-sm" />
          <span>
            Your company has SSO Login in use — please use the
            <strong>SSO Login</strong> button above.
          </span>
        </div>
        <q-input
          v-model="password"
          placeholder="Password"
          aria-label="Password"
          type="password"
          autocomplete="current-password"
          outlined
          class="login-field q-mb-md"
          :disable="submitting"
        />
        <q-btn
          class="full-width login-btn"
          type="submit"
          color="primary"
          size="lg"
          outline
          no-caps
          label="Sign in"
          :loading="submitting || ssoChecking"
          :disable="!username || !password || ssoHint"
        />
      </q-form>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuth } from '../auth/auth';
import HelpTip from '../components/HelpTip.vue';
import markUrl from '../assets/figma/nemolink-mark.svg';

const $q = useQuasar();
const auth = useAuth();
const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');
const submitting = ref(false);
const ssoStarting = ref(false);
/** Home-realm discovery (spec 0057): this address's domain signs in via SSO. */
const ssoHint = ref(false);
const ssoChecking = ref(false);
/** One answer per domain per page load — the server's answer can't change. */
const ssoByDomain = new Map<string, boolean>();

/** The domain of a well-formed address, lowercased; null for a plain username. */
function domainOf(value: string): string | null {
  const match = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(value.trim().toLowerCase());
  return match?.[1] ?? null;
}

/** Typing again is a fresh address — the previous verdict no longer applies. */
watch(username, () => {
  ssoHint.value = false;
});

/** True once the hint is showing: the local form can't sign this person in. */
async function checkSso(): Promise<boolean> {
  const domain = domainOf(username.value);
  if (!domain) return false;
  let sso = ssoByDomain.get(domain);
  if (sso === undefined) {
    ssoChecking.value = true;
    try {
      sso = await auth.isSsoLogin(username.value);
    } finally {
      ssoChecking.value = false;
    }
    ssoByDomain.set(domain, sso);
  }
  // The field may have moved on while the answer was in flight
  if (domainOf(username.value) !== domain) return false;
  ssoHint.value = sso;
  return sso;
}

onMounted(() => {
  // OIDC redirect flags (spec 0012 contract) — toast once, then strip.
  const flag = route.query['login'];
  if (flag === 'pending') {
    $q.notify({
      type: 'info',
      icon: 'hourglass_empty',
      message: 'You don’t have access yet — your admin has been notified.',
      caption: 'Contact them to get approved.',
      timeout: 8000,
    });
  } else if (flag === 'revoked') {
    $q.notify({
      type: 'negative',
      icon: 'block',
      message: 'Your access has been revoked.',
      caption: 'Please contact your admin.',
      timeout: 8000,
    });
  } else if (flag === 'failed') {
    $q.notify({
      type: 'negative',
      message: 'Sign-in didn’t work. Try again or contact your admin.',
      timeout: 8000,
    });
  }
  if (typeof flag === 'string') {
    void router.replace({ path: '/login' });
  }
});

function startSso(): void {
  // Full-page navigation: the server 302s to Microsoft.
  ssoStarting.value = true;
  window.location.href = '/api/v1/auth/oidc/start';
}

async function submitLocal(): Promise<void> {
  // An SSO address has no local password — sending one could only ever fail,
  // and a failure would count towards the lockout on a real account
  if (await checkSso()) return;
  submitting.value = true;
  try {
    await auth.login(username.value, password.value);
    await router.push('/');
  } catch (e) {
    $q.notify({
      type: 'negative',
      message: e instanceof Error ? e.message : 'Sign-in didn’t work.',
    });
    password.value = '';
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
/* Login ground rule (docs/07, user decision 2026-08-22): one centered
   rounded card — logo, one big soft button, plain divider, rounded fields.
   No taglines, no helper text, nothing else. The single exception is the
   SSO hint (spec 0057), which appears only when the typed address belongs
   to an SSO domain — it replaces a dead end, it does not decorate. */
.login-card {
  position: relative;
  width: 100%;
  max-width: 420px;
  border-radius: 24px;
  padding: 44px 36px 36px;
  text-align: center;
  border: 1px solid var(--nl-g-line-white); /* flat: a hairline, no shadow (guide p. 10) */
}
.login-help {
  position: absolute;
  top: 12px;
  right: 12px;
}
.login-logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  margin: 0 auto 32px;
}
.login-logo__mark {
  display: block;
  width: 85px;
  height: auto;
}
.login-logo__word {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 24px;
  line-height: 24px;
  color: var(--nl-g-ink);
}
.login-btn {
  border-radius: 14px;
}
.login-sso-hint {
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--nl-blue-bg);
  color: var(--nl-blue-text);
  font-size: 14px;
  line-height: 1.35;
  text-align: left;
}
.login-divider {
  margin: 28px 0;
}
.login-divider-text {
  padding: 0 14px;
  font-size: 12px;
  color: var(--nl-ink-3);
  white-space: nowrap;
}
.login-field :deep(.q-field__control) {
  border-radius: 14px;
  background: var(--nl-gray-bg);
}
.login-field :deep(.q-field__control::before) {
  border-color: transparent;
}
@media (max-width: 479px) {
  .login-card {
    padding: 32px 22px 28px;
    border-radius: 20px;
  }
}
</style>
