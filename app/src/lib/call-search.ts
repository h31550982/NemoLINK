import { ref, watch } from 'vue';

export const callSearch = ref('');
export const callFormOpen = ref(false);
/** The nonmodal new/edit port call drawer is open; the desktop navbar can make room. */
export const callEditDrawerOpen = ref(false);

// Card view preference: shared so the navbar can toggle it (user 2026-11-06)
const VIEW_KEY = 'nl.homeView';
function readCardView(): boolean {
  try { return localStorage.getItem(VIEW_KEY) === 'cards'; } catch { return false; }
}
export const callCardView = ref(readCardView());
watch(callCardView, (on) => {
  try { localStorage.setItem(VIEW_KEY, on ? 'cards' : 'list'); } catch {}
});

// Incrementing this signals HomePage to open the New port call form (user 2026-11-06)
export const callNewSignal = ref(0);
