export type ActiveEditor = {
  /** Monaco language id of the focused document, such as `latex` or `markdown`. */
  language: () => string;
  /** Replaces the selection with `text`; false when the editor rejected the edit. */
  insert: (text: string) => boolean;
};

/** Where the caret is in the active editor; `selected` counts selected characters. */
export type Cursor = { line: number; column: number; selected: number };

let active: ActiveEditor | null = null;
let cursor: Cursor | null = null;
const listeners = new Set<() => void>();

function setCursor(next: Cursor | null) {
  if (
    cursor?.line === next?.line &&
    cursor?.column === next?.column &&
    cursor?.selected === next?.selected
  )
    return;
  cursor = next;
  for (const listener of listeners) listener();
}

export function setActiveEditor(editor: ActiveEditor) {
  active = editor;
}

export function clearActiveEditor(editor: ActiveEditor) {
  if (active !== editor) return;
  active = null;
  setCursor(null);
}

/** The text editor that most recently had focus, for panels that insert at its cursor. */
export function activeEditor(): ActiveEditor | null {
  return active;
}

/** Called by an editor when its caret or selection moves; ignored unless it is active. */
export function reportCursor(editor: ActiveEditor, next: Cursor) {
  if (active === editor) setCursor(next);
}

export function subscribeCursor(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function cursorSnapshot(): Cursor | null {
  return cursor;
}
