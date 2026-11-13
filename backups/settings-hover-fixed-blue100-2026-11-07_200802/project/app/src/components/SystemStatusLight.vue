<template>
  <!-- The status light (spec 0082): one dot in the header — green, yellow,
       red — and what each part says behind it -->
  <!-- In the phone's hamburger menu (user 2026-11-06): a row that opens
       in place to the same list -->
  <q-expansion-item
    v-if="item"
    dense-toggle
    :label="WORDS[light]"
    caption="System status"
    @show="void load()"
  >
    <template #header>
      <q-item-section avatar>
        <span class="sl-dot" :class="`sl-dot--${light}`" />
      </q-item-section>
      <q-item-section>
        <q-item-label>System status</q-item-label>
        <q-item-label caption>{{ WORDS[light] }}</q-item-label>
      </q-item-section>
    </template>
    <q-list dense>
      <q-item v-for="i in items" :key="i.key">
        <q-item-section avatar style="min-width: 24px">
          <span class="sl-dot sl-dot--small" :class="`sl-dot--${i.light}`" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ i.label }}</q-item-label>
          <q-item-label caption>{{ i.words }}</q-item-label>
        </q-item-section>
      </q-item>
      <q-item-label v-if="checkedAt" caption class="q-px-md q-pb-sm sl-meta">
        checked {{ fmtStamp(checkedAt) }}
      </q-item-label>
    </q-list>
  </q-expansion-item>
  <q-btn v-else flat dense round class="q-mr-sm" :aria-label="`System status: ${WORDS[light]}`">
    <span class="sl-dot" :class="`sl-dot--${light}`" />
    <q-tooltip>{{ WORDS[light] }}</q-tooltip>
    <q-menu anchor="bottom right" self="top right" @show="void load()">
      <q-list style="min-width: 300px; max-width: 420px" dense>
        <q-item-label header class="row items-center">
          System status
          <q-space />
          <span class="sl-meta">{{ checkedAt ? `checked ${fmtStamp(checkedAt)}` : '' }}</span>
        </q-item-label>
        <q-item v-for="i in items" :key="i.key">
          <q-item-section avatar style="min-width: 24px">
            <span class="sl-dot sl-dot--small" :class="`sl-dot--${i.light}`" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ i.label }}</q-item-label>
            <q-item-label caption>{{ i.words }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>

<script setup lang="ts">
/**
 * The header's status light (spec 0082): polls GET /status every five
 * minutes — NEMO (the hourly alive check or the latest send), the
 * organisation's integrations (last data > 2 h yellow, > 12 h red),
 * NEMOLink itself, and NEMO's lists and contracts. The server not answering
 * is red on its own.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { useAuth, type StatusItem } from '../auth/auth';
import { fmtStamp } from '../lib/time';

type Light = 'green' | 'yellow' | 'red';

/** item: draw as a row for a menu instead of the header dot. */
defineProps<{ item?: boolean }>();

const auth = useAuth();
const light = ref<Light>('green');
const items = ref<StatusItem[]>([]);
const checkedAt = ref<string | null>(null);

const WORDS: Record<Light, string> = {
  green: 'All systems working',
  yellow: 'Something needs attention',
  red: 'Something is down',
};

async function load(): Promise<void> {
  try {
    const s = await auth.systemStatus();
    light.value = s.light;
    items.value = s.items;
    checkedAt.value = s.checkedAt;
  } catch {
    light.value = 'red';
    checkedAt.value = new Date().toISOString();
    items.value = [
      { key: 'system', label: 'NEMOLink', light: 'red', words: 'The NEMOLink server did not answer', at: null },
    ];
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 5 * 60_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.sl-dot {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
}
.sl-dot--small {
  width: 10px;
  height: 10px;
}
.sl-dot--green {
  background: var(--nl-green);
}
.sl-dot--yellow {
  background: var(--nl-amber);
}
.sl-dot--red {
  background: var(--nl-red);
}
.sl-meta {
  font-size: 12px;
  color: var(--nl-ink-3);
}
</style>
