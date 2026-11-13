/**
 * The in-place ship editor (spec 0085): any "ship data" link opens the ship
 * dialog over the page it is on — no navigation — and resolves when the
 * dialog closes, telling the caller whether anything was saved so it can
 * refresh what it shows. One editor at a time; ShipEditorHost renders it.
 */
import { reactive } from 'vue';

export const shipEditorState = reactive<{ shipId: string | null; resolve: ((changed: boolean) => void) | null }>({
  shipId: null,
  resolve: null,
});

/** Opens the ship dialog in place; resolves `true` when something was saved. */
export function openShipEditor(shipId: string): Promise<boolean> {
  shipEditorState.resolve?.(false);
  return new Promise((resolve) => {
    shipEditorState.shipId = shipId;
    shipEditorState.resolve = resolve;
  });
}

export function closeShipEditor(changed: boolean): void {
  const resolve = shipEditorState.resolve;
  shipEditorState.shipId = null;
  shipEditorState.resolve = null;
  resolve?.(changed);
}
