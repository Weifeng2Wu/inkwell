/**
 * Marks an element as a row of a keyboard list: write `data-list-row` on the element that
 * takes focus. See `moveRowFocus`.
 */
export const LIST_ROW = "data-list-row";

/**
 * The index a keyboard list moves to for a key, or null when the key does not move it.
 * `index` is -1 when no row is current. Movement stops at both ends.
 */
export function listMoveIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowDown") return Math.min(index + 1, count - 1);
  if (key === "ArrowUp") return Math.max(index - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The rows of a keyboard list in document order, leaving out collapsed (`inert`) parts. */
export function listRows(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[${LIST_ROW}]`)].filter(
    (row) => !row.closest("[inert]"),
  );
}

/** The row an event happened in, or null when it happened outside every row. */
export function eventRow(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(`[${LIST_ROW}]`) : null;
}

type Modifiers = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };
type ListKeyEvent = Modifiers & {
  key: string;
  target: EventTarget | null;
  currentTarget: Element;
  preventDefault: () => void;
};

/**
 * Moves focus between the `[data-list-row]` elements inside the element that handles the
 * event with ↑/↓, Home and End. Returns whether the key was handled.
 */
export function moveRowFocus(event: ListKeyEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const rows = listRows(event.currentTarget);
  const current = eventRow(event.target);
  const next = listMoveIndex(event.key, current ? rows.indexOf(current) : -1, rows.length);
  if (next === null) return false;
  event.preventDefault();
  rows[next]?.focus();
  return true;
}

/**
 * The character a key press types, or null for control keys, shortcuts and the space bar
 * (which activates the focused row). AltGr combinations count as typing.
 */
export function typedCharacter(event: Modifiers & { key: string }): string | null {
  if (event.key.length !== 1 || event.key === " " || event.metaKey) return null;
  return event.ctrlKey === event.altKey ? event.key : null;
}

/** Whether a key press asks for the context menu: the menu key or Shift+F10. */
export function isMenuKey(event: Modifiers & { key: string }): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}
