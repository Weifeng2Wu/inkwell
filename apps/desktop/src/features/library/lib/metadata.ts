import { EMPTY_METADATA, type PaperMetadata } from "./bibtex";

export type LookupSource = "crossref-doi" | "crossref-title" | "arxiv-id" | "arxiv-title";

const DOI = /\b10\.\d{4,9}\/[^\s"<>{}|\\^`]+/i;
const ARXIV_NEW = /\d{4}\.\d{4,5}/;
const ARXIV_OLD = /[a-z-]+(?:\.[A-Z]{2})?\/\d{7}/;
const ARXIV_LABELLED = new RegExp(
  `(?:arxiv\\s*:\\s*|arxiv\\.org/(?:abs|pdf)/)(${ARXIV_NEW.source}|${ARXIV_OLD.source})`,
  "i",
);
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;

export function findDoi(text: string): string {
  const match = DOI.exec(text)?.[0] ?? "";
  return match.replace(/[.,;:)\]'"]+$/, "");
}

export function findArxivId(text: string): string {
  return ARXIV_LABELLED.exec(text)?.[1] ?? "";
}

export type Identifier =
  | { kind: "doi" | "arxiv" | "title"; value: string }
  | { kind: "bibtex"; value: string };

/** Classifies what a user pasted: a BibTeX entry, a DOI, an arXiv id, or a title. */
export function parseIdentifier(input: string): Identifier | null {
  const text = input.trim();
  if (!text) return null;
  if (/^@[a-z]+\s*[{(]/i.test(text)) return { kind: "bibtex", value: text };
  const doi = findDoi(text);
  const arxivDoi = ARXIV_DOI.exec(doi)?.[1];
  if (arxivDoi) return { kind: "arxiv", value: arxivDoi };
  const bare = new RegExp(`^(${ARXIV_NEW.source}|${ARXIV_OLD.source})(?:v\\d+)?$`, "i").exec(text);
  const arxiv = findArxivId(text) || bare?.[1];
  if (arxiv) return { kind: "arxiv", value: arxiv };
  if (doi) return { kind: "doi", value: doi };
  return { kind: "title", value: text.replace(/\s+/g, " ") };
}

export function pdfFilenameHints(path: string) {
  const name = (path.replace(/\\/g, "/").split("/").at(-1) ?? "").replace(/\.pdf$/i, "");
  const identifier = parseIdentifier(name.replace(/_/g, " "));
  return {
    title: identifier?.kind === "title" ? identifier.value : "",
    doi: identifier?.kind === "doi" ? identifier.value : "",
    arxiv: identifier?.kind === "arxiv" ? identifier.value : "",
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function first(value: unknown): string {
  return Array.isArray(value) ? text(value[0]) : text(value);
}

const CROSSREF_TYPES: Record<string, string> = {
  "journal-article": "article",
  "proceedings-article": "inproceedings",
  "book-chapter": "incollection",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  dissertation: "phdthesis",
  report: "techreport",
};

function crossrefWork(work: unknown): PaperMetadata | null {
  if (!work || typeof work !== "object") return null;
  const data = work as Record<string, unknown>;
  const title = first(data.title);
  if (!title) return null;
  const authors = (Array.isArray(data.author) ? data.author : []).flatMap((author) => {
    const { family, given, name } = (author ?? {}) as Record<string, unknown>;
    const full = text(family) ? [text(family), text(given)].filter(Boolean).join(", ") : text(name);
    return full ? [full] : [];
  });
  const date = ["published", "published-print", "published-online", "issued"]
    .map((field) => (data[field] as { "date-parts"?: unknown[][] } | undefined)?.["date-parts"])
    .find((parts) => parts?.[0]?.[0]);
  return {
    ...EMPTY_METADATA,
    type: CROSSREF_TYPES[text(data.type)] ?? "misc",
    title,
    authors,
    year: String(date?.[0]?.[0] ?? ""),
    venue: first(data["container-title"]),
    volume: text(data.volume),
    number: text(data.issue),
    pages: text(data.page),
    publisher: text(data.publisher),
    doi: text(data.DOI),
    url: text(data.URL),
  };
}

function parseCrossref(body: string): PaperMetadata[] {
  const message = (JSON.parse(body) as { message?: unknown }).message as
    | Record<string, unknown>
    | undefined;
  const works = Array.isArray(message?.items) ? message.items : [message];
  return works.flatMap((work) => crossrefWork(work) ?? []);
}

function authorName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const family = parts.pop() ?? "";
  return parts.length ? `${family}, ${parts.join(" ")}` : family;
}

function parseArxiv(body: string): PaperMetadata[] {
  const feed = new DOMParser().parseFromString(body, "application/xml");
  const child = (parent: Element, name: string) =>
    text(parent.getElementsByTagName(name)[0]?.textContent);
  return [...feed.getElementsByTagName("entry")].flatMap((entry) => {
    const title = child(entry, "title");
    const id = /arxiv\.org\/abs\/(.+?)(?:v\d+)?$/i.exec(child(entry, "id"))?.[1] ?? "";
    if (!title || !id) return [];
    return {
      ...EMPTY_METADATA,
      type: "misc",
      title,
      authors: [...entry.getElementsByTagName("author")].map((author) =>
        authorName(child(author, "name")),
      ),
      year: child(entry, "published").slice(0, 4),
      venue: child(entry, "arxiv:journal_ref"),
      doi: child(entry, "arxiv:doi"),
      arxiv: id,
      url: `https://arxiv.org/abs/${id}`,
    };
  });
}

/** Parses a raw Crossref or arXiv response; malformed bodies yield no candidates. */
export function parseLookupResponse(source: LookupSource, body: string): PaperMetadata[] {
  try {
    return source.startsWith("crossref") ? parseCrossref(body) : parseArxiv(body);
  } catch {
    return [];
  }
}

function words(title: string) {
  return new Set(
    title
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

/** Word-level Jaccard similarity of two titles, from 0 to 1. */
export function titleSimilarity(first: string, second: string): number {
  const left = words(first);
  const right = words(second);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export type PdfTextItem = { text: string; height: number };

/** Guesses the title as the largest-type run of text on the first page. */
export function guessTitle(items: readonly PdfTextItem[]): string {
  const runs: { height: number; text: string }[] = [];
  for (const item of items) {
    const value = item.text.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const last = runs.at(-1);
    if (last && Math.abs(last.height - item.height) < 0.5) last.text += ` ${value}`;
    else runs.push({ height: item.height, text: value });
  }
  const candidates = runs.filter(
    (run) =>
      run.text.length >= 12 &&
      run.text.length <= 300 &&
      /\p{L}{3}/u.test(run.text) &&
      // The arXiv margin stamp is often the largest type on the page.
      !/^arxiv:/i.test(run.text),
  );
  const largest = Math.max(0, ...candidates.map((run) => run.height));
  return candidates.find((run) => run.height === largest)?.text ?? "";
}
