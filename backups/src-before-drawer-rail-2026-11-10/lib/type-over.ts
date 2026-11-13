/**
 * Typing over a filled date or date-time box (spec 0071 amendment 2). The
 * input mask only appends, so a digit typed mid-entry would push the rest
 * along (2025-08-12 → 2026-50-81) and be refused. With these handlers a digit
 * typed inside the entry replaces the one at the caret, and Backspace/Delete
 * inside the entry move the caret instead of shifting the parts. At the end
 * of the entry the mask behaves as before (append, delete the tail).
 */
import { nextTick, type Ref } from 'vue';
import { typeOverCaret, typeOverIso } from './time';

export function useTypeOver(
  text: Ref<string>,
  withTime: boolean,
  /** Called with the new text after every accepted keystroke; `partDone` when a part was completed. */
  onTyped: (next: string, partDone: boolean) => void,
): { onBeforeInput: (e: InputEvent) => void; onKeydown: (e: KeyboardEvent) => void } {
  /** After the masked input redraws (which puts the caret at the end), put it back after the typed digit. */
  function place(el: HTMLInputElement, caret: number): void {
    const set = (): void => el.setSelectionRange(caret, caret);
    void nextTick(() => {
      set();
      requestAnimationFrame(set);
    });
  }

  /** Inside the entry: the caret (or the selection's end) stops short of the text's end. */
  function inside(el: HTMLInputElement): boolean {
    return (el.selectionEnd ?? text.value.length) < text.value.length;
  }

  function move(e: Event, el: HTMLInputElement, dir: -1 | 1): void {
    e.preventDefault();
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    // A selection collapses to its edge; a caret steps past one digit.
    const caret = start !== end ? (dir < 0 ? start : end) : typeOverCaret(start, dir, withTime);
    el.setSelectionRange(caret, caret);
  }

  function onBeforeInput(e: InputEvent): void {
    const el = e.target as HTMLInputElement;
    if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') {
      // Phones: Backspace often arrives without a usable keydown.
      if (inside(el)) move(e, el, e.inputType === 'deleteContentBackward' ? -1 : 1);
      return;
    }
    if (e.inputType !== 'insertText' || !e.data || !/^\d$/.test(e.data)) return;
    const start = el.selectionStart ?? text.value.length;
    if (start >= text.value.length) return; // appending: the mask does it
    e.preventDefault();
    const r = typeOverIso(text.value, start, e.data, withTime);
    if (!r) return;
    text.value = r.text;
    onTyped(r.text, r.partDone);
    place(el, r.caret);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLInputElement;
    if (inside(el)) move(e, el, e.key === 'Backspace' ? -1 : 1);
  }

  return { onBeforeInput, onKeydown };
}
