import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { parseBibliographyRecords } from "@/features/editor/lib/bibliography";
import { PDF_DOCUMENT_OPTIONS } from "@/features/editor/lib/pdf-options";
import { join } from "@/lib/path";
import {
  type BibEntry,
  citationKey,
  EMPTY_METADATA,
  metadataFields,
  type PaperMetadata,
  removeBibEntry,
  setBibFields,
  upsertBibEntry,
} from "./bibtex";
import { bibliographyTarget, type LibraryItem } from "./library";
import {
  findArxivId,
  findDoi,
  guessTitle,
  type Identifier,
  type LookupSource,
  parseLookupResponse,
  titleSimilarity,
} from "./metadata";

/** File access for the open project; paths are project-relative. */
export type ProjectFiles = {
  projectPath: string;
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<void>;
};

/** What duplicate detection needs to know about a reference already in the library. */
export type KnownReference = Pick<LibraryItem, "key" | "doi" | "arxiv"> &
  Partial<Pick<LibraryItem, "file" | "source">>;

const TITLE_MATCH = 0.8;

async function lookup(source: LookupSource, query: string): Promise<PaperMetadata[]> {
  try {
    return parseLookupResponse(source, await invoke<string>("library_lookup", { source, query }));
  } catch (error) {
    if (String(error).includes("LIBRARY_NOT_FOUND")) return [];
    throw error;
  }
}

/** Looks an identifier up online; title searches return candidates, best match first. */
export async function lookupIdentifier(identifier: Identifier): Promise<PaperMetadata[]> {
  if (identifier.kind === "doi") return lookup("crossref-doi", identifier.value);
  if (identifier.kind === "arxiv") return lookup("arxiv-id", identifier.value);
  if (identifier.kind === "bibtex") return [];
  const found = await Promise.allSettled([
    lookup("crossref-title", identifier.value),
    lookup("arxiv-title", identifier.value),
  ]);
  const candidates = found.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failure = found.find((result) => result.status === "rejected");
  if (!candidates.length && failure?.status === "rejected") throw failure.reason;
  const score = (candidate: PaperMetadata) => titleSimilarity(candidate.title, identifier.value);
  return candidates.sort((first, second) => score(second) - score(first));
}

export type PdfHints = { title: string; doi: string; arxiv: string };

/** Reads identifiers and a likely title from the first pages of a project PDF. */
export async function readPdfHints(projectPath: string, path: string): Promise<PdfHints> {
  const { pdfjs } = await import("react-pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({
    ...PDF_DOCUMENT_OPTIONS,
    url: convertFileSrc(await join(projectPath, path), "asset"),
    isEvalSupported: false,
  });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let number = 1; number <= Math.min(2, pdf.numPages); number += 1) {
      const content = await (await pdf.getPage(number)).getTextContent();
      pages.push(
        content.items.flatMap((item) =>
          "str" in item ? [{ text: item.str, height: item.height }] : [],
        ),
      );
    }
    const text = pages
      .flat()
      .map((item) => item.text)
      .join(" ");
    const info = (await pdf.getMetadata()).info as { Title?: unknown };
    const embedded = typeof info.Title === "string" ? info.Title.trim() : "";
    return {
      title: guessTitle(pages[0] ?? []) || embedded,
      doi: findDoi(text),
      arxiv: findArxivId(text),
    };
  } finally {
    await task.destroy();
  }
}

/**
 * Resolves a PDF's metadata online. Identifiers printed in the PDF are trusted; a title
 * search is accepted only when the best candidate closely matches the PDF's title.
 */
export async function identifyPdf(hints: PdfHints): Promise<PaperMetadata | null> {
  if (hints.doi) {
    const [match] = await lookupIdentifier({ kind: "doi", value: hints.doi });
    if (match) return match;
  }
  if (hints.arxiv) {
    const [match] = await lookupIdentifier({ kind: "arxiv", value: hints.arxiv });
    if (match) return match;
  }
  if (!hints.title) return null;
  const [best] = await lookupIdentifier({ kind: "title", value: hints.title });
  return best && titleSimilarity(best.title, hints.title) >= TITLE_MATCH ? best : null;
}

/** Copies a PDF from anywhere on disk into the project's `papers/` folder. */
export async function importPdf(projectPath: string, sourcePath: string): Promise<string> {
  const imported = await invoke<{ relativePath: string }>("library_import_pdf", {
    sourcePath,
    expectedProject: projectPath,
  });
  return imported.relativePath;
}

async function readBibliography(files: ProjectFiles, path: string) {
  try {
    return (await files.readFile(path)) ?? "";
  } catch {
    return "";
  }
}

/**
 * Adds a reference to the project bibliography and returns its citation key. A paper whose
 * DOI or arXiv id is already in the library is not duplicated; a new PDF is linked to it.
 */
export async function addReference(
  files: ProjectFiles,
  items: readonly KnownReference[],
  bibliographies: Iterable<string>,
  entry: { metadata: PaperMetadata; file?: string } | { bibtex: string; file?: string },
): Promise<string> {
  const parsed = "bibtex" in entry ? parseBibliographyRecords(entry.bibtex)[0] : undefined;
  if ("bibtex" in entry && !parsed) throw new Error("LIBRARY_INVALID_BIBTEX");
  const metadata = "metadata" in entry ? entry.metadata : EMPTY_METADATA;
  const doi = (parsed?.fields.doi ?? metadata.doi).toLowerCase();
  const arxiv = (parsed?.fields.eprint ?? metadata.arxiv).toLowerCase();
  const existing = items.find(
    (item) =>
      (doi && item.doi.toLowerCase() === doi) || (arxiv && item.arxiv.toLowerCase() === arxiv),
  );
  if (existing) {
    if (entry.file && !existing.file && existing.source)
      await updateReference(
        files,
        { key: existing.key, source: existing.source },
        { file: entry.file },
      );
    return existing.key;
  }
  const keys = new Set(items.map((item) => item.key));
  const record: BibEntry = parsed
    ? {
        type: parsed.type,
        key: keys.has(parsed.key)
          ? citationKey({ ...metadata, title: parsed.key }, keys)
          : parsed.key,
        fields: parsed.fields,
      }
    : { type: metadata.type, key: citationKey(metadata, keys), fields: metadataFields(metadata) };
  if (entry.file) record.fields = { ...record.fields, file: entry.file };
  const target = bibliographyTarget(bibliographies);
  await files.writeFile(target, upsertBibEntry(await readBibliography(files, target), record));
  return record.key;
}

/** Rewrites fields of an existing entry in its own `.bib` file; empty values remove fields. */
export async function updateReference(
  files: ProjectFiles,
  item: Pick<LibraryItem, "key" | "source">,
  fields: Record<string, string>,
): Promise<void> {
  const content = await readBibliography(files, item.source);
  await files.writeFile(item.source, setBibFields(content, item.key, fields));
}

/** Removes the entry from its `.bib` file. The linked PDF and its notes are kept. */
export async function removeReference(
  files: ProjectFiles,
  item: Pick<LibraryItem, "key" | "source">,
): Promise<void> {
  const content = await readBibliography(files, item.source);
  await files.writeFile(item.source, removeBibEntry(content, item.key));
}
