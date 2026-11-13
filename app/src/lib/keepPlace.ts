/**
 * Every dropdown leaves the page where it was (user 2026-11-06).
 *
 * Opening or closing one — a section behind a chevron, an expansion item, a
 * select's list — must not move what you are looking at. The browser moves
 * it two ways: closing a section near the bottom of a scrolling area shrinks
 * it, and the scroll position is clamped, so everything slides down; and a
 * select hands focus back to its field when its list closes, which can
 * scroll the field into view.
 *
 * So for a moment after such a press the thing pressed (the toggle, or the
 * select whose list closes) is held at the same height on the screen: its
 * scrolling area is scrolled back by however far it moved. Where the area
 * has run out of room, a little padding at its bottom makes the room, and
 * that padding melts away again as soon as you scroll up past it. Your own
 * scrolling (wheel, touch, keys) always wins.
 */

/** What counts as a dropdown's own control. */
const TOGGLE = '[aria-expanded], .q-expansion-item__container > .q-item, .q-select';
/** How long after the press the place is held: covers Quasar's transitions. */
const HOLD_MS = 700;

type Scroller = { el: HTMLElement; doc: boolean };

/** The select whose list is open, if any: the list closes back onto it. */
let lastSelect: HTMLElement | null = null;
let hold: { anchor: HTMLElement; top: number; sc: Scroller; until: number } | null = null;

/** Bottom padding added per scrolling area: the inline value it replaced,
    the computed padding it builds on, and the room added. */
const added = new WeakMap<HTMLElement, { inline: string; from: string; extra: number }>();

function scrollerOf(el: HTMLElement): Scroller {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return { el: p, doc: false };
  }
  return { el: (document.scrollingElement as HTMLElement) ?? document.documentElement, doc: true };
}

/** The element whose padding makes room: the page's is the body. */
function padTarget(sc: Scroller): HTMLElement {
  return sc.doc ? document.body : sc.el;
}

function extraOf(sc: Scroller): number {
  return added.get(padTarget(sc))?.extra ?? 0;
}

function setExtra(sc: Scroller, extra: number): void {
  const t = padTarget(sc);
  let cur = added.get(t);
  if (extra <= 0) {
    if (cur) {
      t.style.paddingBottom = cur.inline;
      added.delete(t);
    }
    return;
  }
  if (!cur) {
    cur = { inline: t.style.paddingBottom, from: getComputedStyle(t).paddingBottom, extra };
    added.set(t, cur);
  }
  cur.extra = extra;
  t.style.paddingBottom = `calc(${cur.from} + ${Math.ceil(extra)}px)`;
}

/** Scroll by `d`, making room at the bottom first if the area has none. */
function scrollBy(sc: Scroller, d: number): void {
  const el = sc.el;
  const max = el.scrollHeight - el.clientHeight;
  const need = el.scrollTop + d - max;
  if (need > 0) setExtra(sc, extraOf(sc) + need);
  el.scrollTop += d;
}

/** As you scroll up, the made room goes again — never under your eyes. */
function melt(sc: Scroller): void {
  const extra = extraOf(sc);
  if (!extra) return;
  const el = sc.el;
  const below = el.scrollHeight - el.clientHeight - el.scrollTop;
  if (below > 0) setExtra(sc, extra - Math.min(extra, below));
}

function tick(): void {
  if (!hold) return;
  const { anchor, top, sc, until } = hold;
  if (!anchor.isConnected || performance.now() > until) {
    hold = null;
    return;
  }
  const d = anchor.getBoundingClientRect().top - top;
  if (Math.abs(d) >= 0.5) scrollBy(sc, d);
  requestAnimationFrame(tick);
}

function start(anchor: HTMLElement): void {
  const sc = scrollerOf(anchor);
  const first = !hold;
  hold = { anchor, top: anchor.getBoundingClientRect().top, sc, until: performance.now() + HOLD_MS };
  if (first) requestAnimationFrame(tick);
  const target = sc.doc ? window : sc.el;
  if (!(target as unknown as { __nlMelt?: boolean }).__nlMelt) {
    (target as unknown as { __nlMelt?: boolean }).__nlMelt = true;
    target.addEventListener('scroll', () => melt(sc), { passive: true });
  }
}

function anchorFor(e: Event): HTMLElement | null {
  const t = e.target as HTMLElement | null;
  const menuOpen = !!document.querySelector('.q-menu');
  // A press inside the open list (an option) closes it back onto its select
  if (menuOpen && t?.closest?.('.q-menu')) return lastSelect?.isConnected ? lastSelect : null;
  const own = t?.closest?.<HTMLElement>(TOGGLE) ?? null;
  if (own) {
    const select = own.closest<HTMLElement>('.q-select');
    if (select) lastSelect = select;
    return select ?? own;
  }
  // A press anywhere else while a list is open closes the list
  return menuOpen && lastSelect?.isConnected ? lastSelect : null;
}

function onPress(e: Event): void {
  if (e instanceof KeyboardEvent && !['Enter', ' ', 'Escape'].includes(e.key)) return;
  const a = anchorFor(e);
  if (a) start(a);
}

/** Your own scrolling ends the hold at once. */
function release(): void {
  hold = null;
}

export function installKeepPlace(): void {
  document.addEventListener('pointerdown', onPress, true);
  document.addEventListener('keydown', onPress, true);
  window.addEventListener('wheel', release, { passive: true, capture: true });
  window.addEventListener('touchmove', release, { passive: true, capture: true });
}
