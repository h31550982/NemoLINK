/**
 * Ctrl/⌘+Enter runs the main button of whatever is on top (spec 0073), also
 * when the keyboard focus has dropped out of it (user 2026-11-13).
 *
 * Each pop-up, report page and form card catches the shortcut on its own
 * element on the way down. That misses the press when focus sits on the
 * page itself — after a click on blank space, or on a checkbox or pill that
 * re-renders under the pointer — and the shortcut then did nothing. Every
 * open owner registers here; a press nobody caught goes to the one opened
 * last, the one on top. Presses inside a dropdown list or another
 * pop-up stay theirs.
 */
import { onBeforeUnmount, watch } from 'vue';

type Run = (e: KeyboardEvent) => void;
const stack: { run: Run }[] = [];
let installed = false;

export function isMainShortcut(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented || !isMainShortcut(e)) return;
  if (e.target instanceof Element && e.target.closest('.q-dialog, .q-menu')) return;
  stack[stack.length - 1]?.run(e);
}

/** Registers the owner while `active` is true; the latest opened is on top. */
export function useMainShortcut(active: () => boolean, run: Run): void {
  if (!installed) {
    document.addEventListener('keydown', onKeydown);
    installed = true;
  }
  const owner = { run };
  const remove = () => {
    const at = stack.indexOf(owner);
    if (at >= 0) stack.splice(at, 1);
  };
  watch(active, (on) => {
    remove();
    if (on) stack.push(owner);
  }, { immediate: true });
  onBeforeUnmount(remove);
}
