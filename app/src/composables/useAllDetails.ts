import { computed, ref, watchEffect } from 'vue';

/** All details, once turned on, stays on in every pop-up and page until it is
 * turned off (user 2026-11-13). One choice for the whole app, remembered in
 * this browser. */
const KEY = 'nemolink.allDetails';
function readPreferred(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
const preferred = ref(readPreferred());
function setPreferred(on: boolean): void {
  preferred.value = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private window or blocked storage — the switch still works for this visit */
  }
}

export function useAllDetails() {
  /** Opened by the view itself because something needs attention; not remembered. */
  const forced = ref(false);
  const allDetails = computed<boolean>({
    get: () => preferred.value || forced.value,
    set: (on) => {
      forced.value = false;
      setPreferred(on);
    },
  });
  /** Open the details while checks find something to fix. Loading checks
   * (null) leave the view as it is; the switch stays usable. */
  function autoDetails(needsAttention: () => boolean | null): void {
    watchEffect(() => {
      const attention = needsAttention();
      if (attention !== null) forced.value = attention;
    });
  }
  return { allDetails, autoDetails };
}
