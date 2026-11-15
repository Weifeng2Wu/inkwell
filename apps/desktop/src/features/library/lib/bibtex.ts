import {
  type BibliographyRecord,
  parseBibliographyRecords,
} from "@/features/editor/lib/bibliography";

export type BibEntry = { type: string; key: string; fields: Record<string, string> };

export type PaperMetadata = {
  type: string;
  title: string;
  /** Each author as "Family, Given"; institutional authors keep their full name. */
  authors: string[];
  year: string;
  venue: string;
  volume: string;
  number: string;
  pages: string;
  publisher: string;
  doi: string;
  arxiv: string;
  url: string;
};

export const EMPTY_METADATA: PaperMetadata = {
  type: "misc",
  title: "",
  authors: [],
  year: "",
  venue: "",
  volume: "",
  number: "",
  pages: "",
  publisher: "",
  doi: "",
  arxiv: "",
  url: "",
};

/** Fields whose values are identifiers or paths and must be written verbatim. */
const VERBATIM_FIELDS = new Set(["doi", "url", "file", "eprint", "archiveprefix", "readstatus"]);
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "on",
  "of",
  "in",
  "for",
  "to",
  "and",
  "with",
  "from",
]);

function ascii(text: string) {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]/g, "");
}

/** Builds an `author2024title` key that is unique among `existing`. */
export function citationKey(metadata: PaperMetadata, existing: ReadonlySet<string>): string {
  const family = (metadata.authors[0] ?? "").split(",")[0] ?? "";
  const word =
    metadata.title
      .split(/[^\p{L}\p{N}]+/u)
      .map(ascii)
      .find((candidate) => candidate && !STOP_WORDS.has(candidate.toLowerCase())) ?? "";
  const base = `${ascii(family)}${ascii(metadata.year)}${word}`.toLowerCase() || "paper";
  if (!existing.has(base)) return base;
  for (let index = 0; ; index += 1) {
    let suffix = "";
    for (let rest = index; rest >= 0; rest = Math.floor(rest / 26) - 1)
      suffix = String.fromCharCode(97 + (rest % 26)) + suffix;
    if (!existing.has(base + suffix)) return base + suffix;
  }
}

export function metadataFields(metadata: PaperMetadata): Record<string, string> {
  const venueField =
    metadata.type === "article"
      ? "journal"
      : metadata.type === "inproceedings" || metadata.type === "incollection"
        ? "booktitle"
        : "howpublished";
  const fields: Record<string, string> = {
    title: metadata.title,
    author: metadata.authors.join(" and "),
    year: metadata.year,
    [venueField]: metadata.venue,
    volume: metadata.volume,
    number: metadata.number,
    pages: metadata.pages.replace(/\s*[-–—]+\s*/g, "--"),
    publisher: metadata.publisher,
    doi: metadata.doi,
    eprint: metadata.arxiv,
    archiveprefix: metadata.arxiv ? "arXiv" : "",
    url: metadata.url,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value.trim()));
}

function balanced(value: string) {
  let depth = 0;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (character === "\\") cursor += 1;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

function fieldValue(name: string, value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (VERBATIM_FIELDS.has(name)) return text.replace(/[{}]/g, "");
  const safe = balanced(text) && !text.endsWith("\\") ? text : text.replace(/[{}\\]/g, "");
  return safe.replace(/(^|[^\\])([&%#])/g, "$1\\$2");
}

export function serializeBibEntry(entry: BibEntry): string {
  const lines = Object.entries(entry.fields)
    .filter(([, value]) => value.trim())
    .map(([name, value]) => `  ${name} = {${fieldValue(name, value)}},`);
  return `@${entry.type}{${entry.key},\n${lines.join("\n")}\n}`;
}

function record(text: string, key: string): BibliographyRecord | undefined {
  return parseBibliographyRecords(text).find((candidate) => candidate.key === key);
}

/** Replaces the entry with the same key, or appends it to the end of the file. */
export function upsertBibEntry(text: string, entry: BibEntry): string {
  const serialized = serializeBibEntry(entry);
  const existing = record(text, entry.key);
  if (existing) return text.slice(0, existing.start) + serialized + text.slice(existing.end);
  const body = text.trimEnd();
  return `${body}${body ? "\n\n" : ""}${serialized}\n`;
}

export function removeBibEntry(text: string, key: string): string {
  const existing = record(text, key);
  if (!existing) return text;
  return (text.slice(0, existing.start).trimEnd() + text.slice(existing.end)).replace(/^\s+/, "");
}

/** Sets fields on an existing entry; an empty value removes the field. */
export function setBibFields(text: string, key: string, fields: Record<string, string>): string {
  const existing = record(text, key);
  if (!existing) return text;
  return upsertBibEntry(text, {
    type: existing.type,
    key,
    fields: { ...existing.fields, ...fields },
  });
}
