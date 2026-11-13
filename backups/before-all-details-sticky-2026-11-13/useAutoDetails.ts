import { watchEffect, type Ref } from 'vue';

/** Reapply the default when checks or the active section change.
 * Loading checks leave the current view intact; manual toggles remain available. */
export function useAutoDetails(allDetails: Ref<boolean>, needsAttention: () => boolean | null): void {
  watchEffect(() => {
    const attention = needsAttention();
    if (attention !== null) allDetails.value = attention;
  });
}
