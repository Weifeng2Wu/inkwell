import { documentOutline } from "@/features/navigator";

/** A `\label` and what it marks, for completing and explaining `\ref`. */
export type LatexLabel = {
  key: string;
  /** Offsets of the key inside `\label{…}`. */
  start: number;
  end: number;
  /** 1-based line of the label. */
  line: number;
  /** The environment around the label (`figure`, `equation`) or the sectioning command above it. */
  scope: string;
  /** Its caption, section title or formula as readable text; empty when there is none. */
  title: string;
};

export type LatexReference = { key: string; start: number; end: number };

/** Commands whose argument is a label: `\ref`, `\eqref`, `\autoref`, `\cref`, … */
const REFERENCE_COMMAND = /^(?:(?:eq|auto|page|name|sub|[cCvVfF])?ref|[cC]refrange)$/;
const SECTIONING = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph"];
/** Environments that only arrange their content; a label inside belongs to what is around them. */
const LAYOUT = /^(?:document|center|flushleft|flushright|minipage|adjustbox|small|footnotesize)$/;
const MATH =
  /^(?:equation|align|alignat|xalignat|flalign|gather|multline|eqnarray|displaymath|math|dmath)\*?$/;
const TOKEN =
  /\\(begin|end)\s*\{([^{}\\]*)\}|\\(caption)\*?\s*(?:\[[^\]]*\])?\s*\{|\\label\s*\{([^{}]*)\}/g;

/** Blanks comments without moving anything, so offsets still match the source. */
function withoutComments(text: string) {
  return text.replace(/(\\.)|%[^\r\n]*/g, (part, escaped: string | undefined) =>
    escaped === undefined ? " ".repeat(part.length) : part,
  );
}

/** The contents of the `{…}` group opening at `open`, up to its matching brace. */
function group(text: string, open: number) {
  let depth = 0;
  for (let index = open; index < text.length && index < open + 2000; index++) {
    const char = text[index];
    if (char === "\\") index++;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return text.slice(open + 1, index);
  }
  return "";
}

function clip(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

/** Reduces a caption to readable text. */
function plain(source: string) {
  let text = source.replace(/\\(?:label|[a-zA-Z]*ref|[a-zA-Z]*cite[a-zA-Z]*)\*?\s*\{[^{}]*\}/g, "");
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(/\\[a-zA-Z]+\*?\s*\{([^{}]*)\}/g, "$1").replace(/\{([^{}]*)\}/g, "$1");
  }
  return clip(
    text
      .replace(/\\([&%$#_{}])/g, "$1")
      .replace(/\\[a-zA-Z]+\*?|\\./g, " ")
      .replace(/~/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    120,
  );
}

/** The source of a formula, without its label, on one line. */
function formula(source: string) {
  return clip(
    source
      .replace(/\\label\s*\{[^{}]*\}/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    80,
  );
}

/** Every `\label` of a LaTeX document, in order, with the caption or heading it belongs to. */
export function latexLabels(text: string): LatexLabel[] {
  const source = withoutComments(text);
  const headings = documentOutline(text, "latex");
  type Environment = { name: string; body: number; caption: string; labels: LatexLabel[] };
  const open: Environment[] = [];
  const labels: LatexLabel[] = [];
  let line = 1;
  let counted = 0;
  let heading = -1;

  for (const match of source.matchAll(TOKEN)) {
    const [whole, edge, name = "", caption, raw] = match;
    const after = match.index + whole.length;
    if (edge === "begin") {
      open.push({ name, body: after, caption: "", labels: [] });
    } else if (edge === "end") {
      const index = open.findLastIndex((environment) => environment.name === name);
      const closed = index < 0 ? undefined : open.splice(index)[0];
      if (closed && !closed.caption && MATH.test(name)) {
        const title = formula(source.slice(closed.body, match.index));
        for (const label of closed.labels) label.title = title;
      }
    } else if (caption) {
      const environment = open.findLast((candidate) => !LAYOUT.test(candidate.name));
      if (!environment || environment.caption) continue;
      environment.caption = plain(group(source, after - 1));
      for (const label of environment.labels) label.title = environment.caption;
    } else if (raw?.trim()) {
      const key = raw.trim();
      const start = after - 1 - raw.length + raw.indexOf(key);
      for (; counted < start; counted++) if (source[counted] === "\n") line++;
      while ((headings[heading + 1]?.line ?? Number.POSITIVE_INFINITY) <= line) heading++;
      const environment = open.findLast((candidate) => !LAYOUT.test(candidate.name));
      const section = headings[heading];
      const label: LatexLabel = {
        key,
        start,
        end: start + key.length,
        line,
        scope:
          environment?.name.replace(/\*$/, "") ?? (section ? SECTIONING[section.level] : "") ?? "",
        title: environment ? environment.caption : (section?.title ?? ""),
      };
      environment?.labels.push(label);
      labels.push(label);
    }
  }
  return labels;
}

/** The part of the line before `offset`, with comments blanked. */
function lineBefore(text: string, offset: number) {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return { start, text: withoutComments(text.slice(start, offset)) };
}

/** Whether the command at `index` is real: `\\ref` is a line break followed by text. */
function escaped(text: string, index: number) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashes++;
  return slashes % 2 === 1;
}

/** Completion context for a label being typed inside `\ref{…}` or one of its relatives. */
export function referenceContext(text: string, offset: number) {
  const before = lineBefore(text, offset);
  const match = /\\([a-zA-Z]+)\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)$/.exec(before.text);
  if (!match || !REFERENCE_COMMAND.test(match[1] ?? "") || escaped(before.text, match.index))
    return null;
  const current = (match[2] ?? "").slice((match[2] ?? "").lastIndexOf(",") + 1);
  const query = current.trimStart();
  const tail = /^[^,{}\s]*/.exec(text.slice(offset))?.[0] ?? "";
  return { query, start: offset - query.length, end: offset + tail.length };
}

/** The label named at `offset` by a `\ref`-like command, with the range of its key. */
export function latexReferenceAt(text: string, offset: number): LatexReference | null {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const line = withoutComments(text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd));
  for (const match of line.matchAll(/\\([a-zA-Z]+)\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/g)) {
    if (!REFERENCE_COMMAND.test(match[1] ?? "") || escaped(line, match.index)) continue;
    const list = match[2] ?? "";
    let cursor = lineStart + match.index + match[0].length - 1 - list.length;
    for (const part of list.split(",")) {
      const key = part.trim();
      const start = cursor + part.indexOf(key);
      if (key && offset >= start && offset <= start + key.length)
        return { key, start, end: start + key.length };
      cursor += part.length + 1;
    }
  }
  return null;
}
