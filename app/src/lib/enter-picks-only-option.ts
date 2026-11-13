/**
 * Enter takes a dropdown's only choice (user 2026-11-13): when typing into a
 * dropdown has narrowed its list down to one option, Enter picks it — no
 * arrow key first. Quasar picks only a highlighted option on Enter; this
 * fills the gap for every q-select in the app at once.
 *
 * It listens on the way down (capture), so it runs before the select's own
 * handler, and does nothing when an option is already highlighted (Quasar
 * picks that one) or the list holds more than one choice. A list that is
 * still filtering — typed into a moment ago, or showing its spinner — is
 * waited for first, so Enter never picks a stale option.
 */

/** Longer than any input-debounce in the app (250–300 ms), plus a frame. */
const SETTLE_MS = 400;
const lastTyped = new WeakMap<EventTarget, number>();

function comboboxOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.getAttribute('role') !== 'combobox') return null;
  return target.closest('.q-select') ? target : null;
}

/** The one option to pick, or null: list open, nothing highlighted, one live option. */
function onlyOption(box: HTMLElement): HTMLElement | null {
  if (box.getAttribute('aria-expanded') !== 'true') return null;
  const listId = box.getAttribute('aria-controls');
  const list = listId ? document.getElementById(listId) : null;
  if (!list) return null;
  const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')].filter(
    (o) => o.getAttribute('aria-disabled') !== 'true' && !o.classList.contains('disabled'),
  );
  if (options.length !== 1) return null;
  if (list.querySelector('.q-manual-focusable--focused')) return null;
  return options[0]!;
}

function filtering(box: HTMLElement): boolean {
  const typedAt = lastTyped.get(box) ?? 0;
  return Date.now() - typedAt < SETTLE_MS || !!box.closest('.q-field')?.querySelector('.q-spinner');
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pickWhenSettled(box: HTMLElement): Promise<void> {
  const until = Date.now() + 2500;
  while (filtering(box) && Date.now() < until) await wait(60);
  if (!box.isConnected || document.activeElement !== box) return;
  onlyOption(box)?.click();
}

function onInput(e: Event): void {
  const box = comboboxOf(e.target);
  if (box) lastTyped.set(box, Date.now());
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const box = comboboxOf(e.target);
  if (!box) return;
  const list = document.getElementById(box.getAttribute('aria-controls') ?? '');
  // Something highlighted: the select's own Enter picks it
  if (list?.querySelector('.q-manual-focusable--focused')) return;
  // Typed a moment ago: the list may not even be open yet
  if (filtering(box) && (box.getAttribute('aria-expanded') === 'true' || lastTyped.has(box))) {
    e.preventDefault();
    e.stopPropagation();
    void pickWhenSettled(box);
    return;
  }
  const only = onlyOption(box);
  if (!only) return;
  e.preventDefault();
  e.stopPropagation();
  only.click();
}

export function installEnterPicksOnlyOption(): void {
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKeydown, true);
}
