export type OutlineItem = {
  /** 0-based depth. LaTeX: part 0 … paragraph 5. Markdown: `#` 0 … `######` 5. */
  level: number;
  title: string;
  /** 1-based line of the heading. */
  line: number;
};

const LATEX_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
};

const VERBATIM_ENVIRONMENTS = /^(?:verbatim\*?|Verbatim\*?|lstlisting|minted|comment)$/;

const MATH_ENVIRONMENTS =
  /^(?:equation|align|alignat|flalign|gather|multline|eqnarray|displaymath|math|split|subequations|tikzpicture)\*?$/;

const COLUMN_SPEC_ENVIRONMENTS = /^(?:tabular\*?|tabularx|tabulary|array|longtable|minipage)$/;

/** Commands whose arguments are keys, paths or lengths rather than prose. */
const ARGUMENT_COMMANDS =
  /^(?:[a-zA-Z]*cite[a-zA-Z]*|[a-zA-Z]*ref|label|tag|bibliography|bibliographystyle|addbibresource|bibitem|input|include|includeonly|includegraphics|includepdf|lstinputlisting|usepackage|RequirePackage|documentclass|url|vspace|hspace|setlength|addtolength|setcounter|addtocounter|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|newtheorem|DeclareMathOperator|definecolor|color|pagestyle|thispagestyle|graphicspath|hypersetup|captionsetup|usetikzlibrary|geometry|rule|index)$/;

/** Index of the first unescaped `%` in a line, or -1. */
function commentStart(line: string) {
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\") i++;
    else if (char === "%") return i;
  }
  return -1;
}

/**
 * Blanks comments and verbatim-like environments while keeping every line in
 * place, so offsets in the result still map to the original line numbers.
 */
function maskLatex(text: string) {
  let verbatim: string | null = null;
  return text
    .split("\n")
    .map((raw) => {
      if (verbatim !== null) {
        const end = raw.indexOf(`\\end{${verbatim}}`);
        if (end < 0) return "";
        const rest = raw.slice(end + verbatim.length + 6);
        verbatim = null;
        return stripLine(rest);
      }
      const line = stripLine(raw);
      const begin = /\\begin\{([^{}]+)\}/g;
      for (let match = begin.exec(line); match; match = begin.exec(line)) {
        const name = match[1] ?? "";
        if (!VERBATIM_ENVIRONMENTS.test(name)) continue;
        if (line.indexOf(`\\end{${name}}`, begin.lastIndex) >= 0) continue;
        verbatim = name;
        return line.slice(0, match.index);
      }
      return line;
    })
    .join("\n");
}

function stripLine(line: string) {
  const comment = commentStart(line);
  return comment < 0 ? line : line.slice(0, comment);
}

/**
 * Reads a balanced group starting at `text[start]` (which must be `open`).
 * Returns the index just past the closing delimiter, or -1 when unbalanced.
 */
function groupEnd(text: string, start: number, open: string, close: string, maxLength = 4000) {
  let depth = 0;
  const limit = Math.min(text.length, start + maxLength);
  for (let i = start; i < limit; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return i + 1;
  }
  return -1;
}

/** Skips adjacent `[..]` and `{..}` groups; `braces` false skips only `[..]`. */
function skipArguments(text: string, start: number, braces: boolean) {
  let index = start;
  for (;;) {
    const char = text[index];
    let end = -1;
    if (char === "[") end = groupEnd(text, index, "[", "]");
    else if (char === "{" && braces) end = groupEnd(text, index, "{", "}");
    if (end < 0) return index;
    index = end;
  }
}

const ESCAPED_OPEN = "\uE000";
const ESCAPED_CLOSE = "\uE001";

/** Reduces a LaTeX fragment such as a heading argument to readable text. */
function latexToPlain(source: string) {
  let text = source
    .replace(/\\\\(?:\[[^\]]*\])?/g, " ")
    .replace(/\\\{/g, ESCAPED_OPEN)
    .replace(/\\\}/g, ESCAPED_CLOSE)
    .replace(/(?<!\\)\$/g, "")
    .replace(/\\([&%$#_])/g, "$1")
    .replace(/\\[`'"^~=.](?=[\p{L}{])/gu, "");
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text
      .replace(/\\texorpdfstring\s*\{[^{}]*\}\s*\{([^{}]*)\}/g, "$1")
      .replace(
        /\\(?:label|[a-zA-Z]*ref|[a-zA-Z]*cite[a-zA-Z]*|footnote|index|thanks|vspace|hspace)\*?(?:\[[^\]]*\])*\{[^{}]*\}/g,
        "",
      )
      .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])*\s*\{([^{}]*)\}/g, "$1")
      .replace(/(?<!\\[a-zA-Z]+\*?\s*)\{([^{}]*)\}/g, "$1");
  }
  return text
    .replace(/\\[a-zA-Z]+\*?/g, " ")
    .replace(/\\[,;:!> ]/g, " ")
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replaceAll(ESCAPED_OPEN, "{")
    .replaceAll(ESCAPED_CLOSE, "}")
    .replace(/\s+/g, " ")
    .trim();
}

function latexOutline(text: string): OutlineItem[] {
  const masked = maskLatex(text);
  const items: OutlineItem[] = [];
  const heading = /\\(part|chapter|section|subsection|subsubsection|paragraph)(?![a-zA-Z])\*?/g;
  let line = 1;
  let counted = 0;
  for (let match = heading.exec(masked); match; match = heading.exec(masked)) {
    if (masked[match.index - 1] === "\\") continue;
    let index = heading.lastIndex;
    const skipSpace = () => {
      while (/\s/.test(masked[index] ?? "")) index++;
    };
    skipSpace();
    if (masked[index] === "[") {
      const end = groupEnd(masked, index, "[", "]");
      if (end < 0) continue;
      index = end;
      skipSpace();
    }
    if (masked[index] !== "{") continue;
    const end = groupEnd(masked, index, "{", "}");
    if (end < 0) continue;
    for (; counted < match.index; counted++) if (masked[counted] === "\n") line++;
    items.push({
      level: LATEX_LEVELS[match[1] ?? ""] ?? 0,
      title: latexToPlain(masked.slice(index + 1, end - 1)),
      line,
    });
    heading.lastIndex = end;
  }
  return items;
}

type MarkdownLine = { text: string; line: number };

/** Lines of prose: everything outside YAML frontmatter and fenced code blocks. */
function markdownProse(text: string): MarkdownLine[] {
  const lines = text.split("\n");
  const prose: MarkdownLine[] = [];
  let index = 0;
  if (/^---\s*$/.test(lines[0] ?? "")) {
    const close = lines.findIndex((line, at) => at > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
    if (close > 0) index = close + 1;
  }
  let fence: { char: string; length: number } | null = null;
  for (; index < lines.length; index++) {
    const raw = (lines[index] ?? "").replace(/\r$/, "");
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (fence) {
      const run = marker?.[1] ?? "";
      if (run[0] === fence.char && run.length >= fence.length && !marker?.[2]?.trim()) fence = null;
      continue;
    }
    if (marker?.[1] && !(marker[1].startsWith("`") && marker[2]?.includes("`"))) {
      fence = { char: marker[1].charAt(0), length: marker[1].length };
      continue;
    }
    prose.push({ text: raw, line: index + 1 });
  }
  return prose;
}

/** Removes inline Markdown markup, keeping the visible text. */
function markdownToPlain(source: string) {
  return source
    .replace(/<!--.*?-->/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/(`+)(.*?)\1/g, "$2")
    .replace(/(?<!\\)(?:\*{1,3}|~~)/g, "")
    .replace(/(?<![\p{L}\p{N}\\])_{1,3}(?=\S)|(?<=\S)_{1,3}(?![\p{L}\p{N}])/gu, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownOutline(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const { text: line, line: number } of markdownProse(text)) {
    const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
    if (!match) continue;
    const title = markdownToPlain((match[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, ""));
    if (title) items.push({ level: (match[1] ?? "#").length - 1, title, line: number });
  }
  return items;
}

/** Section headings of a LaTeX or Markdown document; empty for other languages. */
export function documentOutline(text: string, language: string): OutlineItem[] {
  if (language === "latex") return latexOutline(text);
  if (language === "markdown") return markdownOutline(text);
  return [];
}

/** Body prose of a LaTeX document with commands, keys and maths removed. */
function latexProse(text: string) {
  let source = maskLatex(text);
  const begin = source.indexOf("\\begin{document}");
  if (begin >= 0) source = source.slice(begin + 16);
  const finish = source.indexOf("\\end{document}");
  if (finish >= 0) source = source.slice(0, finish);

  let out = "";
  let index = 0;
  const skipTo = (terminator: string, from: number) => {
    const end = source.indexOf(terminator, from);
    return end < 0 ? source.length : end + terminator.length;
  };
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "\\") {
      const command = /^[a-zA-Z]+\*?/.exec(source.slice(index + 1, index + 40))?.[0];
      if (!command) {
        const next = source[index + 1] ?? "";
        index += 2;
        if (next === "[") index = skipTo("\\]", index);
        else if (next === "(") index = skipTo("\\)", index);
        else if (next === "\\") index = skipArguments(source, index, false);
        if (!/[`'"^~=.]/.test(next)) out += " ";
        continue;
      }
      index += 1 + command.length;
      const name = command.replace(/\*$/, "");
      out += " ";
      if (name === "begin" || name === "end") {
        const close = source[index] === "{" ? groupEnd(source, index, "{", "}") : -1;
        if (close < 0) continue;
        const environment = source.slice(index + 1, close - 1);
        index = close;
        if (name === "end") continue;
        if (MATH_ENVIRONMENTS.test(environment)) index = skipTo(`\\end{${environment}}`, index);
        else index = skipArguments(source, index, COLUMN_SPEC_ENVIRONMENTS.test(environment));
      } else if (name === "href") {
        const close = source[index] === "{" ? groupEnd(source, index, "{", "}") : -1;
        if (close >= 0) index = close;
      } else {
        index = skipArguments(source, index, ARGUMENT_COMMANDS.test(name));
      }
    } else if (char === "$") {
      const delimiter = source[index + 1] === "$" ? "$$" : "$";
      let end = index + delimiter.length;
      for (;;) {
        end = source.indexOf(delimiter, end);
        if (end < 0 || source[end - 1] !== "\\") break;
        end += 1;
      }
      index = end < 0 ? index + delimiter.length : end + delimiter.length;
      out += " ";
    } else {
      if (char === "~" || char === "&") out += " ";
      else if (char !== "{" && char !== "}") out += char;
      index++;
    }
  }
  return out;
}

function markdownWords(text: string) {
  return markdownProse(text)
    .map(({ text: line }) => line)
    .filter((line) => !/^ {0,3}\[[^\]]+\]:\s/.test(line))
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/(?<![\\$\w])\$(?=\S)[^$\n]*?(?<=[^\s\\])\$(?![\d$])/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<(?:https?:|mailto:)[^>\s]*>/g, " ")
    .replace(/\bhttps?:\/\/\S+/g, " ")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ");
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const WORD = /[\p{L}\p{N}\p{M}]+(?:(?:['’-]|(?<=\d)[.,](?=\d))[\p{L}\p{N}\p{M}]+)*/gu;

/**
 * Manuscript word count. Han and kana characters count one each; everything
 * else (including Hangul, which is space-delimited) counts Unicode words.
 */
export function countWords(text: string, language: string): number {
  const { characters, words } = proseCounts(text, language);
  return characters + words;
}

/** Han and kana characters, and the words of every other script, in a document's prose. */
function proseCounts(text: string, language: string): { characters: number; words: number } {
  const prose =
    language === "latex" ? latexProse(text) : language === "markdown" ? markdownWords(text) : text;
  let characters = 0;
  const rest = prose.replace(CJK, () => {
    characters++;
    return " ";
  });
  return { characters, words: rest.match(WORD)?.length ?? 0 };
}

export const READING_CHARACTERS_PER_MINUTE = 300;
export const READING_WORDS_PER_MINUTE = 220;

/**
 * Whole minutes it takes to read a document, rounded up: 300 Han or kana characters or 220
 * words a minute. An empty document takes 0 minutes; anything else at least 1.
 */
export function readingMinutes(text: string, language: string): number {
  const { characters, words } = proseCounts(text, language);
  const minutes = characters / READING_CHARACTERS_PER_MINUTE + words / READING_WORDS_PER_MINUTE;
  return minutes > 0 ? Math.max(1, Math.ceil(minutes - 1e-9)) : 0;
}

/** The heading the cursor is under: the last one that starts at or before `line`. */
export function currentHeading<Item extends { line: number }>(
  items: readonly Item[],
  line: number | null | undefined,
): Item | undefined {
  if (!line) return undefined;
  let current: Item | undefined;
  for (const item of items) {
    if (item.line > line) break;
    current = item;
  }
  return current;
}
