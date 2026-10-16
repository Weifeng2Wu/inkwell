import type { FileNode } from "@/types/files";

export type BibliographyEntry = {
  key: string;
  title: string;
  author: string;
  year: string;
  source: string;
};

function closingDelimiter(text: string, start: number, opening: string): number {
  let depth = opening === "{" ? 1 : 0;
  let quoted = false;
  const base = depth;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (character === '"' && depth === base) quoted = !quoted;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (opening === "{" && depth === 0) return cursor;
    }
    if (opening === "(" && character === ")" && depth === 0 && !quoted) return cursor;
  }
  return text.length;
}

function readFields(text: string, strings: Map<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  const field = /([a-z][\w-]*)\s*=\s*/gi;
  while (true) {
    const match = field.exec(text);
    if (!match) break;
    let cursor = field.lastIndex;
    const pieces: string[] = [];
    while (cursor < text.length) {
      while (/\s/.test(text[cursor] ?? "")) cursor += 1;
      const opening = text[cursor];
      if (opening === "{") {
        const end = closingDelimiter(text, cursor + 1, "{");
        pieces.push(text.slice(cursor + 1, end));
        cursor = end + 1;
      } else if (opening === '"') {
        const start = ++cursor;
        let depth = 0;
        while (cursor < text.length) {
          const character = text[cursor];
          if (character === "\\") {
            cursor += 2;
            continue;
          }
          if (character === '"' && depth === 0) break;
          if (character === "{") depth += 1;
          if (character === "}") depth -= 1;
          cursor += 1;
        }
        pieces.push(text.slice(start, cursor));
        cursor += 1;
      } else {
        const start = cursor;
        while (cursor < text.length && !/[,#\r\n]/.test(text[cursor] ?? "")) cursor += 1;
        const value = text.slice(start, cursor).trim();
        pieces.push(strings.get(value.toLowerCase()) ?? value);
      }
      while (/\s/.test(text[cursor] ?? "")) cursor += 1;
      if (text[cursor] !== "#") break;
      cursor += 1;
    }
    fields[(match[1] ?? "").toLowerCase()] = pieces.join("");
    field.lastIndex = Math.max(cursor, field.lastIndex);
  }
  return fields;
}

function plainText(text: string): string {
  return text
    .replace(/\\['"`^~=.]\s*\{?([a-zA-Z])\}?/g, "$1")
    .replace(/\\[uvHckbdtr](?:\s+\{?|\{)([a-zA-Z])\}?/g, "$1")
    .replace(/\\([%&_#$])/g, "$1")
    .replace(/\\(?:LaTeX|TeX)\b/g, (command) => command.slice(1))
    .replace(/\\(?:[a-zA-Z]+|[^a-zA-Z\s])/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBibliography(text: string, source: string): BibliographyEntry[] {
  const records: { type: string; body: string }[] = [];
  const header = /@([a-z]+)\s*([{(])/gi;
  while (true) {
    const match = header.exec(text);
    if (!match) break;
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    if (text.slice(lineStart, match.index).trimStart().startsWith("%")) continue;
    const end = closingDelimiter(text, header.lastIndex, match[2] ?? "{");
    records.push({ type: (match[1] ?? "").toLowerCase(), body: text.slice(header.lastIndex, end) });
    header.lastIndex = end + 1;
  }
  const strings = new Map<string, string>();
  for (const record of records)
    if (record.type === "string")
      for (const [key, value] of Object.entries(readFields(record.body, strings)))
        strings.set(key, value);
  const entries: BibliographyEntry[] = [];
  for (const record of records) {
    if (["comment", "preamble", "string"].includes(record.type)) continue;
    const comma = record.body.indexOf(",");
    if (comma < 0) continue;
    const key = record.body.slice(0, comma).trim();
    if (!key || /[\s{}]/.test(key)) continue;
    const fields = readFields(record.body.slice(comma + 1), strings);
    entries.push({
      key,
      title: plainText(fields.title ?? ""),
      author: plainText(fields.author ?? fields.editor ?? ""),
      year: fields.year ?? fields.date?.slice(0, 4) ?? "",
      source,
    });
  }
  return entries;
}

export function bibliographyPaths(files: FileNode[]): string[] {
  return files
    .flatMap((file) =>
      file.type === "directory"
        ? bibliographyPaths(file.children ?? [])
        : /\.bib$/i.test(file.name)
          ? [file.path]
          : [],
    )
    .sort();
}

export function indexBibliographies(sources: Iterable<[string, string]>): BibliographyEntry[] {
  const entries = new Map<string, BibliographyEntry>();
  for (const [source, content] of sources)
    for (const entry of parseBibliography(content, source))
      if (!entries.has(entry.key)) entries.set(entry.key, entry);
  return [...entries.values()].sort((first, second) => first.key.localeCompare(second.key));
}

export const CITATION_COMMANDS = new Set([
  "cite",
  "citep",
  "citet",
  "citealp",
  "citealt",
  "citeauthor",
  "citeyear",
  "citeyearpar",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
  "footcitetext",
  "smartcite",
  "supercite",
  "fullcite",
  "notecite",
  "nocite",
]);

export function citationContext(text: string, offset: number) {
  const before = text.slice(0, offset);
  const uncommented = before.replace(
    /(\\.)|%[^\r\n]*/g,
    (part, escaped: string | undefined) => escaped ?? " ".repeat(part.length),
  );
  const match = /\\([a-z]+)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/i.exec(uncommented);
  if (!match || !CITATION_COMMANDS.has((match[1] ?? "").toLowerCase())) return null;
  let precedingSlashes = 0;
  for (let cursor = match.index - 1; cursor >= 0 && uncommented[cursor] === "\\"; cursor -= 1)
    precedingSlashes += 1;
  if (precedingSlashes % 2 === 1) return null;
  const content = match[2] ?? "";
  const comma = content.lastIndexOf(",");
  const current = content.slice(comma + 1);
  const leading = current.length - current.trimStart().length;
  const tail = /^[^,{}\r\n]*/.exec(text.slice(offset))?.[0] ?? "";
  return {
    query: current.trim(),
    start: offset - current.length + leading,
    end: offset + tail.trimEnd().length,
    usedKeys: new Set(
      content
        .slice(0, comma < 0 ? 0 : comma)
        .split(",")
        .map((key) => key.trim()),
    ),
  };
}

export function searchBibliography(
  entries: readonly BibliographyEntry[],
  query: string,
  usedKeys: Set<string>,
) {
  const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const searchable = normalize(`${entry.key} ${entry.title} ${entry.author} ${entry.year}`);
    return !usedKeys.has(entry.key) && terms.every((term) => searchable.includes(term));
  });
}
