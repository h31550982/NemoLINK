<template>
  <!-- No help links or ? icons on a phone (user 2026-11-06) -->
  <template v-if="content && !$q.screen.lt.sm">
    <!-- As a content link (guide p. 7): body colour, underlined -->
    <button
      v-if="label"
      type="button"
      class="nl-content-link"
      @click.stop.prevent="open = true"
    >{{ label }}</button>
    <q-btn
      v-else
      flat
      round
      dense
      size="sm"
      icon="help_outline"
      class="help-tip-btn"
      :aria-label="`Help: ${content.title}`"
      @click.stop.prevent="open = true"
    />
    <!-- House dialog look (spec 0016) inlined — HouseDialog embeds HelpTip
         in its header, so importing it here would be circular. -->
    <q-dialog v-model="open" persistent no-shake>
      <q-card class="help-card">
        <q-card-section class="help-card__header row items-center no-wrap">
          <div class="help-card__title col">{{ content.title }}</div>
          <q-btn
            flat
            round
            dense
            icon="close"
            color="grey-8"
            aria-label="Close"
            v-close-popup
          />
        </q-card-section>
        <q-card-section class="help-card__body">
          <p v-for="(p, i) in paragraphs" :key="i" class="help-par">{{ p }}</p>
        </q-card-section>
        <q-card-actions class="help-card__footer" align="right">
          <q-btn flat color="primary" no-caps label="Got it" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </template>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { HELP } from '../help/help-content';

/** label: show the tip as a text link with these words instead of the ? icon. */
const props = defineProps<{ topic: string; label?: string }>();

const open = ref(false);
const content = computed(() => {
  const found = HELP[props.topic];
  if (!found && process.env.DEV) {
    console.warn(`HelpTip: unknown topic '${props.topic}'`);
  }
  return found;
});
const paragraphs = computed(
  () => content.value?.body.split(/\n\s*\n/).filter((p) => p.trim()) ?? [],
);
</script>

<style scoped>
/* Same colour as the text the tip sits after. */
.help-tip-btn {
  color: inherit;
}
.help-card {
  width: 100%;
  max-width: 380px;
  border-radius: 20px;
}
.help-card__header {
  background: var(--nl-band);
  padding: 12px 12px 12px 20px;
}
.help-card__title {
  color: var(--nl-slate);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
}
.help-card__body {
  padding: 18px 20px;
}
.help-card__footer {
  background: var(--nl-band);
  padding: 10px 14px;
}
.help-par {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.55;
}
.help-par:last-child {
  margin-bottom: 0;
}
</style>
