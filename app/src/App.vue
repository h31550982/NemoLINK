<template>
  <router-view />
</template>

<script setup lang="ts">
// Instrument Sans, Medium 500 for reading and SemiBold 600 for what to
// notice (style guide v1.0 p. 6) — self-hosted, font-display: swap.
// Inter SemiBold stays only for the word under the logo mark.
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/inter/600.css';
import { useQuasar } from 'quasar';
import { MOBILE_BREAKPOINT } from './lib/breakpoints';
import { installKeepPlace } from './lib/keepPlace';

// Every icon is a Material Symbol (outlined): a plain name such as "event"
// renders from that font, so templates keep the short names. Prefixed names
// (sym_o_…, img:…) take Quasar's own route — except the dropdown triangle,
// which becomes the chevron the Figma file draws (icon/chevron-down).
const SYMBOL_SWAPS: Record<string, string> = {
  sym_o_arrow_drop_down: 'keyboard_arrow_down',
};
const $q = useQuasar();
// Match the CSS phone breakpoint before child layouts render.
$q.screen.setSizes({ sm: MOBILE_BREAKPOINT });

/** Every dropdown opens downwards (user 2026-11-05): Quasar flips a list up
    when it does not fit below its field, so just before one opens the room
    below the field goes into --nl-menu-room, and the list (app.scss) is never
    taller than that — a long list gets shorter and scrolls inside. Capture
    phase, so it runs ahead of the opening click or key. */
/** The list's 8px gap under its field (Figma 557:7884) plus 8px of air. */
const MENU_GAP = 16;
function roomForMenu(e: Event): void {
  const field = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.q-select');
  if (!field) return;
  const room = document.documentElement.clientHeight - field.getBoundingClientRect().bottom - MENU_GAP;
  document.documentElement.style.setProperty('--nl-menu-room', `${Math.max(0, Math.floor(room))}px`);
}
document.addEventListener('pointerdown', roomForMenu, true);
document.addEventListener('keydown', roomForMenu, true);
document.addEventListener('focusin', roomForMenu, true);
// Opening or closing any dropdown leaves the page where it was (user 2026-11-06)
installKeepPlace();
$q.iconMapFn = (name) => {
  const swap = SYMBOL_SWAPS[name];
  if (swap) return { cls: 'material-symbols-outlined', content: swap };
  return /^[a-z0-9_]+$/.test(name) && !name.startsWith('sym_')
    ? { cls: 'material-symbols-outlined', content: name }
    : undefined;
};
</script>
