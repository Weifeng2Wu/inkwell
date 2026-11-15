/** Small editing helpers for manuscripts. Pure, so the editor only applies their result. */

export type WrapEdit = {
  /** Range of `text` to replace. */
  start: number;
  end: number;
  replacement: string;
  /** Selection after the edit: the wrapped (or unwrapped) text itself. */
  selectionStart: number;
  selectionEnd: number;
};

/** Length of the run of `char` ending just before `index` (step -1) or starting at it (step 1). */
function run(text: string, index: number, char: string, step: 1 | -1) {
  let length = 0;
  for (let cursor = step === 1 ? index : index - 1; text[cursor] === char; cursor += step) length++;
  return length;
}

/**
 * Whether `text[start..end]` already sits inside the `before`/`after` pair. Markers made of
 * one repeated character (`*`, `**`) are read by run length, so the bold in `***x***` is
 * not mistaken for a second italic.
 */
function isWrapped(text: string, start: number, end: number, before: string, after: string) {
  const char = before[0] ?? "";
  if (before === after && char && before === char.repeat(before.length)) {
    const shortest = Math.min(run(text, start, char, -1), run(text, end, char, 1));
    return before.length === 1 ? shortest % 2 === 1 : shortest >= before.length;
  }
  return (
    text.slice(Math.max(0, start - before.length), start) === before &&
    text.slice(end, end + after.length) === after
  );
}

/**
 * Wraps a selection in a pair such as `**…**` or `\textbf{…}`, or removes the pair when the
 * selection already has it. An empty selection gets an empty pair with the caret inside.
 */
export function wrapEdit(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string,
): WrapEdit {
  const selected = text.slice(start, end);
  if (isWrapped(text, start, end, before, after))
    return {
      start: start - before.length,
      end: end + after.length,
      replacement: selected,
      selectionStart: start - before.length,
      selectionEnd: end - before.length,
    };
  const inner = selected.length - before.length - after.length;
  if (inner >= 0 && selected.startsWith(before) && selected.endsWith(after))
    return {
      start,
      end,
      replacement: selected.slice(before.length, selected.length - after.length),
      selectionStart: start,
      selectionEnd: start + inner,
    };
  return {
    start,
    end,
    replacement: `${before}${selected}${after}`,
    selectionStart: start + before.length,
    selectionEnd: end + before.length,
  };
}

/** Blanks comments so a commented-out `\begin` or `\end` is not counted. */
function withoutComments(text: string) {
  return text.replace(/(\\.)|%[^\r\n]*/g, (part, escaped: string | undefined) =>
    escaped === undefined ? "" : part,
  );
}

const OPENING = /\\begin\s*\{([^{}\\%\s]+)\}(?:\s*(?:\[[^\]]*\]|\{[^{}]*\}))*\s*$/;

/**
 * The environment a line opens that the document does not close yet: the name to put in
 * `\end{…}` after Enter. `lineBefore` is the text between the line start and the caret.
 */
export function unclosedEnvironment(documentText: string, lineBefore: string): string | null {
  const name = OPENING.exec(withoutComments(lineBefore))?.[1];
  if (!name) return null;
  const source = withoutComments(documentText);
  const count = (command: string) => source.split(`\\${command}{${name}}`).length - 1;
  return count("begin") > count("end") ? name : null;
}
