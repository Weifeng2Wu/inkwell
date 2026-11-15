import { bibliographyText, parseBibliographyRecords } from "@/features/editor/lib/bibliography";
import type { PdfAnnotation } from "@/features/editor/lib/pdf-notes";
import { pathSync } from "@/lib/path";
import type { FileNode } from "@/types/files";

export const PAPERS_DIRECTORY = "papers";
export const DEFAULT_BIBLIOGRAPHY = "references.bib";
export const DIGEST_PATH = `${PAPERS_DIRECTORY}/reading-digest.md`;

export const READING_STATUSES = ["unread", "reading", "read"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

export type LibraryItem = {
  key: string;
  type: string;
  title: string;
  /** Display names in "Given Family" order. */
  authors: string[];
  year: string;
  venue: string;
  doi: string;
  arxiv: string;
  url: string;
  tags: string[];
  status: ReadingStatus;
  /** Project-relative path of the `.bib` file that defines the entry. */
  source: string;
  /** Project-relative path of the linked PDF, when it exists in the project. */
  file?: string;
  /** Project-relative path of the PDF's notes sidecar, when it exists. */
  notes?: string;
};

export type Library = { items: LibraryItem[]; unlinked: string[] };

const slashes = (path: string) => path.replace(/\\/g, "/").replace(/^\.\//, "");

export function filePaths(files: readonly FileNode[]): string[] {
  return files.flatMap((file) =>
    file.type === "directory" ? filePaths(file.children ?? []) : [file.path],
  );
}

function displayName(author: string) {
  const [family = "", given = ""] = author.split(",").map((part) => part.trim());
  return given ? `${given} ${family}` : family;
}

function readingStatus(value: string | undefined): ReadingStatus {
  const status = value?.trim().toLowerCase();
  if (status === "read") return "read";
  return status === "reading" || status === "skimmed" ? "reading" : "unread";
}

/** Resolves a BibTeX `file` field (plain or JabRef `label:path:type`) to a project path. */
function linkedFile(value: string, source: string, paths: ReadonlyMap<string, string>) {
  for (const part of value.split(";")) {
    const path = slashes((/^[^:]*:(.+):[^:]*$/.exec(part)?.[1] ?? part).trim());
    if (!path) continue;
    const directory = slashes(pathSync.dirname(source));
    const beside = directory && directory !== "." ? `${directory}/${path}` : path;
    const found = paths.get(beside.toLowerCase()) ?? paths.get(path.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

/**
 * Builds the library from the project's bibliography. Entries come from `.bib` sources;
 * PDFs under `papers/` that no entry links to are reported as `unlinked`.
 */
export function buildLibrary(
  sources: Iterable<readonly [string, string]>,
  paths: readonly string[],
): Library {
  const known = new Map(paths.map((path) => [slashes(path).toLowerCase(), path]));
  const items = new Map<string, LibraryItem>();
  for (const [source, content] of sources)
    for (const { key, type, fields } of parseBibliographyRecords(content)) {
      if (items.has(key)) continue;
      const file = linkedFile(fields.file ?? "", source, known);
      const eprint = /arxiv/i.test(fields.archiveprefix ?? fields.eprinttype ?? "")
        ? (fields.eprint ?? "")
        : "";
      items.set(key, {
        key,
        type,
        title: bibliographyText(fields.title ?? ""),
        authors: bibliographyText(fields.author ?? fields.editor ?? "")
          .split(/\s+and\s+/i)
          .map(displayName)
          .filter(Boolean),
        year: fields.year ?? fields.date?.slice(0, 4) ?? "",
        venue: bibliographyText(fields.journal ?? fields.booktitle ?? fields.howpublished ?? ""),
        doi: (fields.doi ?? "").trim(),
        arxiv: eprint.trim(),
        url: (fields.url ?? "").trim(),
        tags: (fields.keywords ?? "")
          .split(/[,;]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        status: readingStatus(fields.readstatus),
        source,
        file,
        notes: file ? known.get(`${slashes(file)}.notes.md`.toLowerCase()) : undefined,
      });
    }
  const linked = new Set([...items.values()].map((item) => item.file));
  return {
    items: [...items.values()],
    unlinked: paths.filter(
      (path) =>
        /\.pdf$/i.test(path) &&
        slashes(path).toLowerCase().startsWith(`${PAPERS_DIRECTORY}/`) &&
        !linked.has(path),
    ),
  };
}

function firstFamilyName(item: LibraryItem): string {
  return (item.authors[0] ?? "").split(/\s+/).pop() ?? "";
}

export function shortAuthors(item: LibraryItem): string {
  const family = firstFamilyName(item);
  return item.authors.length > 1 ? `${family} et al.` : family;
}

const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Entries matching every search term, the reading status and, when given, the exact tag. */
export function searchLibrary(
  items: readonly LibraryItem[],
  query: string,
  status: ReadingStatus | "all",
  tag?: string | null,
): LibraryItem[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const wanted = tag ? normalize(tag) : "";
  return items.filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (wanted && !item.tags.some((value) => normalize(value) === wanted)) return false;
    const searchable = normalize(
      [item.key, item.title, item.authors.join(" "), item.year, item.venue, ...item.tags].join(" "),
    );
    return terms.every((term) => searchable.includes(term));
  });
}

export const LIBRARY_SORT_ORDERS = ["added", "year", "author", "title"] as const;
export type LibrarySortOrder = (typeof LIBRARY_SORT_ORDERS)[number];
export const LIBRARY_SORT_STORAGE_KEY = "inkwell-library-sort-v1";

/** The saved sort order; anything unknown falls back to most recently added. */
export function parseSortOrder(value: string | null | undefined): LibrarySortOrder {
  return LIBRARY_SORT_ORDERS.find((order) => order === value) ?? "added";
}

/**
 * Orders entries for the list. `added` is bibliography order reversed, so the newest entry
 * comes first; `year` is newest first; `author` (first author's family name) and `title`
 * are alphabetical. Entries that lack the sorted field go last, and ties keep the most
 * recently added first.
 */
export function sortLibrary(items: readonly LibraryItem[], order: LibrarySortOrder): LibraryItem[] {
  const recent = [...items].reverse();
  if (order === "added") return recent;
  if (order === "year") {
    const year = (item: LibraryItem) => Number.parseInt(item.year, 10) || Number.NEGATIVE_INFINITY;
    return recent.sort((first, second) => year(second) - year(first) || 0);
  }
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const text = (item: LibraryItem) => (order === "author" ? firstFamilyName(item) : item.title);
  return recent.sort((first, second) => {
    const [a, b] = [text(first), text(second)];
    return a && b ? collator.compare(a, b) : a ? -1 : b ? 1 : 0;
  });
}

/** The status a click on the status dot moves to: unread → reading → read → unread. */
export function nextReadingStatus(status: ReadingStatus): ReadingStatus {
  const next = (READING_STATUSES.indexOf(status) + 1) % READING_STATUSES.length;
  return READING_STATUSES[next] ?? "unread";
}

export type ReferenceLink = { kind: "doi" | "arxiv" | "url"; label: string; url: string };

/** Where an entry can be read online: its DOI, its arXiv page, then any other URL. */
export function referenceLinks(item: Pick<LibraryItem, "doi" | "arxiv" | "url">): ReferenceLink[] {
  const links: ReferenceLink[] = [];
  if (item.doi) links.push({ kind: "doi", label: item.doi, url: `https://doi.org/${item.doi}` });
  if (item.arxiv)
    links.push({
      kind: "arxiv",
      label: `arXiv:${item.arxiv}`,
      url: `https://arxiv.org/abs/${item.arxiv}`,
    });
  const covered = [item.doi, item.arxiv].some((id) => id && item.url.includes(id));
  if (/^https?:\/\//i.test(item.url) && !covered) {
    const label = item.url.replace(/^https?:\/\/(?:www\.)?/i, "").replace(/\/$/, "");
    links.push({ kind: "url", label, url: item.url });
  }
  return links;
}

/** The citation to insert for a Monaco language id. */
export function citationText(key: string, language: string): string {
  if (language === "latex") return `\\cite{${key}}`;
  return language === "markdown" ? `[@${key}]` : key;
}

/**
 * A passage quoted from a paper, formatted for the target document and followed by its
 * citation when the paper is in the library.
 */
export function quotationText(text: string, key: string | undefined, language: string): string {
  const quote = text.replace(/\s+/g, " ").trim();
  if (language === "latex") {
    const escaped = quote.replace(/[\\{}]/g, "").replace(/[&%#$_]/g, "\\$&");
    return `\`\`${escaped}''${key ? ` \\cite{${key}}` : ""}`;
  }
  if (language === "markdown") return `> ${quote}${key ? ` [@${key}]` : ""}\n`;
  return key ? `"${quote}" (${key})` : `"${quote}"`;
}

/** Target `.bib` for new entries: `references.bib`, else the first existing bibliography. */
export function bibliographyTarget(sources: Iterable<string>): string {
  const paths = [...sources].sort();
  return (
    paths.find((path) => slashes(path) === DEFAULT_BIBLIOGRAPHY) ?? paths[0] ?? DEFAULT_BIBLIOGRAPHY
  );
}

function quoted(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Collects every paper's highlights and comments into one Markdown document. Wiki links
 * to the PDFs keep the digest connected in the knowledge graph.
 */
export function readingDigest(
  title: string,
  papers: readonly { item: LibraryItem; annotations: readonly PdfAnnotation[] }[],
): string {
  const sections = papers
    .filter(({ annotations }) => annotations.length)
    .map(({ item, annotations }) => {
      const byline = [shortAuthors(item), item.year].filter(Boolean).join(", ");
      const link = item.file ? `\n\n[[${slashes(item.file)}]]` : "";
      const notes = [...annotations]
        .sort((first, second) => first.page - second.page)
        .map((annotation) =>
          [`${quoted(annotation.quote)}\n> — p. ${annotation.page}`, annotation.note.trim()]
            .filter(Boolean)
            .join("\n\n"),
        );
      return `## ${item.title || item.key}\n\n\`${item.key}\`${byline ? ` · ${byline}` : ""}${link}\n\n${notes.join("\n\n")}`;
    });
  return `# ${title}\n\n${sections.join("\n\n")}\n`;
}
