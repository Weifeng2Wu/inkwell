import type { FileNode } from "@/types/files";

export type SearchMatch = {
  path: string;
  /** 1-based line. */
  line: number;
  /** 1-based column of the match in the full line. */
  column: number;
  /** The line, trimmed around the match. */
  preview: string;
  /** Offsets of the match inside `preview`. */
  previewStart: number;
  previewEnd: number;
  /** Set when `preview` leaves out text before it on the line (other than indentation). */
  clipped?: true;
};

export type SearchOptions = { caseSensitive: boolean; wholeWord: boolean; regex: boolean };

/** `Error.message` thrown by `searchText` / `searchProject` for a bad pattern. */
export const SEARCH_INVALID_REGEX = "SEARCH_INVALID_REGEX";
export const SEARCH_MAX_MATCHES = 1000;
export const SEARCH_MAX_FILE_LENGTH = 1_500_000;

const MAX_MATCHES_PER_LINE = 20;
const PREVIEW_LEAD = 40;
const PREVIEW_LENGTH = 160;
const CONCURRENCY = 6;

const TEXT_EXTENSIONS = new Set(
  "tex ltx bib cls sty bst bbx cbx dtx ins tikz md markdown mdown rmd qmd txt rst org typ csv tsv json yaml yml toml ini cfg py r m jl sh bat ps1 js mjs ts html css xml".split(
    " ",
  ),
);
const TEXT_NAMES = new Set(["makefile", "latexmkrc", ".latexmkrc", ".gitignore", "readme"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

function searchable(name: string) {
  const lower = name.toLowerCase();
  // Poster documents are machine-written layout data, often with embedded images.
  if (lower.endsWith(".poster.json")) return false;
  if (TEXT_NAMES.has(lower)) return true;
  const dot = lower.lastIndexOf(".");
  return dot > 0 && TEXT_EXTENSIONS.has(lower.slice(dot + 1));
}

/** Text files worth searching, in file-tree order. PDF notes sidecars are included. */
export function searchablePaths(files: FileNode[]): string[] {
  const paths: string[] = [];
  const visit = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.type === "directory") {
        if (!SKIPPED_DIRECTORIES.has(node.name)) visit(node.children ?? []);
      } else if (searchable(node.name)) paths.push(node.path);
    }
  };
  visit(files);
  return paths;
}

function compile(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null;
  const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = options.caseSensitive ? "g" : "gi";
  const attempts = options.wholeWord
    ? [
        [`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, `${flags}u`],
        [`(?<!\\w)(?:${source})(?!\\w)`, flags],
      ]
    : [
        [source, `${flags}u`],
        [source, flags],
      ];
  for (const [pattern, patternFlags] of attempts) {
    try {
      return new RegExp(pattern ?? "", patternFlags);
    } catch {
      // Try the next, more lenient form.
    }
  }
  throw new Error(SEARCH_INVALID_REGEX);
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

function matchLines(pattern: RegExp, path: string, text: string, limit: number): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (limit <= 0) return matches;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? "").replace(/\r$/, "");
    if (!line) continue;
    pattern.lastIndex = 0;
    let found = 0;
    for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
      if (!match[0]) {
        // Empty matches (`a*`, `^`) are not results; step over them.
        pattern.lastIndex = match.index + 1;
        continue;
      }
      const indent = line.length - line.trimStart().length;
      let start = Math.max(Math.min(indent, match.index), match.index - PREVIEW_LEAD);
      if (isLowSurrogate(line.charCodeAt(start))) start++;
      const preview = line.slice(start, start + PREVIEW_LENGTH);
      matches.push({
        path,
        line: index + 1,
        column: match.index + 1,
        preview,
        previewStart: match.index - start,
        previewEnd: Math.min(match.index + match[0].length - start, preview.length),
        ...(start > indent ? { clipped: true as const } : {}),
      });
      if (matches.length >= limit) return matches;
      if (++found >= MAX_MATCHES_PER_LINE) break;
    }
  }
  return matches;
}

/**
 * Searches one file line by line (patterns never span lines).
 * Throws `Error(SEARCH_INVALID_REGEX)` when the pattern does not compile.
 */
export function searchText(
  path: string,
  text: string,
  query: string,
  options: SearchOptions,
  limit: number,
): SearchMatch[] {
  const pattern = compile(query, options);
  return pattern ? matchLines(pattern, path, text, limit) : [];
}

export async function searchProject(args: {
  paths: string[];
  readFile: (path: string) => Promise<string | null>;
  /** Unsaved editor contents; these win over the file on disk. */
  buffers?: ReadonlyMap<string, string>;
  query: string;
  options: SearchOptions;
  signal?: AbortSignal;
  /** Called with all matches so far, in path order, whenever a file adds some. */
  onProgress?: (matches: SearchMatch[]) => void;
}): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const { paths, readFile, buffers, query, options, signal, onProgress } = args;
  const pattern = compile(query, options);
  if (!pattern) return { matches: [], truncated: false };

  const perFile: SearchMatch[][] = [];
  let total = 0;
  let next = 0;
  const done = () => signal?.aborted || total > SEARCH_MAX_MATCHES;
  const collect = () => perFile.flat().slice(0, SEARCH_MAX_MATCHES);

  const worker = async () => {
    while (!done()) {
      const index = next++;
      const path = paths[index];
      if (path === undefined) return;
      let text = buffers?.get(path) ?? null;
      if (text === null) {
        try {
          text = await readFile(path);
        } catch {
          continue;
        }
        if (done()) return;
      }
      if (text === null || text.length > SEARCH_MAX_FILE_LENGTH || text.includes("\u0000"))
        continue;
      // Matching is synchronous, so the workers can share one pattern and its `lastIndex`.
      const found = matchLines(pattern, path, text, SEARCH_MAX_MATCHES + 1 - total);
      if (!found.length) continue;
      perFile[index] = found;
      total += found.length;
      onProgress?.(collect());
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  return { matches: collect(), truncated: total > SEARCH_MAX_MATCHES };
}
