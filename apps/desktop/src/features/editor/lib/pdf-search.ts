export type PdfSearchPart = { text: string; eol?: boolean };
/** Normalized text plus, per character, the part and offset it came from. */
export type PdfSearchSource = { text: string; parts: number[]; offsets: number[] };
/** `index` is the 0-based ordinal of the match within its 1-based `page`. */
export type PdfSearchMatch = { page: number; index: number };
export type PdfSearchSegment = { part: number; start: number; end: number };

export const PDF_SEARCH_LIMIT = 1000;

/**
 * Lower-case the text and collapse whitespace and line ends into single spaces,
 * so a query matches across text runs and line breaks. Offsets of -1 mark the
 * synthetic space of a line end, which has no character in its part.
 */
export function buildPdfSearchSource(parts: readonly PdfSearchPart[]): PdfSearchSource {
  const chars: string[] = [];
  const owners: number[] = [];
  const offsets: number[] = [];
  const space = (part: number, offset: number) => {
    if (!chars.length || chars.at(-1) === " ") return;
    chars.push(" ");
    owners.push(part);
    offsets.push(offset);
  };
  for (const [index, part] of parts.entries()) {
    for (let offset = 0; offset < part.text.length; offset += 1) {
      const char = part.text.charAt(offset);
      if (/\s/.test(char)) {
        space(index, offset);
        continue;
      }
      // Lower-casing can lengthen a character; every unit maps to its source.
      for (const unit of char.toLowerCase().split("")) {
        chars.push(unit);
        owners.push(index);
        offsets.push(offset);
      }
    }
    if (part.eol) space(index, -1);
  }
  return { text: chars.join(""), parts: owners, offsets };
}

export function normalizePdfQuery(query: string) {
  return buildPdfSearchSource([{ text: query }]).text.trimEnd();
}

/** Searchable text of one page from PDF.js `getTextContent().items`. */
export function pdfPageSearchText(items: readonly unknown[]) {
  const parts: PdfSearchPart[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string")
      continue;
    parts.push({ text: item.str, eol: "hasEOL" in item && item.hasEOL === true });
  }
  return buildPdfSearchSource(parts).text;
}

/** Start offsets of non-overlapping matches of an already normalized query. */
export function findPdfMatches(text: string, needle: string, limit = Number.POSITIVE_INFINITY) {
  const starts: number[] = [];
  if (!needle) return starts;
  for (
    let start = text.indexOf(needle);
    start >= 0 && starts.length < limit;
    start = text.indexOf(needle, start + needle.length)
  )
    starts.push(start);
  return starts;
}

/** The runs of original characters covered by a match, one per touched part. */
export function pdfMatchSegments(source: PdfSearchSource, start: number, length: number) {
  const segments: PdfSearchSegment[] = [];
  for (let index = start; index < start + length; index += 1) {
    const part = source.parts[index];
    const offset = source.offsets[index];
    if (part === undefined || offset === undefined || offset < 0) continue;
    const last = segments.at(-1);
    // Within one part a gap can only be whitespace that was collapsed away.
    if (last && last.part === part) last.end = Math.max(last.end, offset + 1);
    else segments.push({ part, start: offset, end: offset + 1 });
  }
  return segments;
}

/** Next or previous match index, wrapping around; -1 when there are none. */
export function stepPdfMatch(current: number, total: number, delta: number) {
  if (total <= 0) return -1;
  if (current < 0 || current >= total) return delta < 0 ? total - 1 : 0;
  return (((current + delta) % total) + total) % total;
}

/** Start from the first match on or after the page being read. */
export function initialPdfMatch(matches: readonly PdfSearchMatch[], page: number) {
  const index = matches.findIndex((match) => match.page >= page);
  return index >= 0 ? index : matches.length ? 0 : -1;
}

type SearchDocument = {
  numPages: number;
  getPage: (page: number) => Promise<{
    getTextContent: () => Promise<{ items: readonly unknown[] }>;
  }>;
};

/**
 * Extract the searchable text of every page in small batches, yielding to the
 * event loop between them. Resolves to null as soon as `cancelled` reports true.
 */
export async function extractPdfSearchText(
  pdf: SearchDocument,
  cancelled: () => boolean,
  batch = 8,
) {
  const texts: string[] = [];
  for (let first = 1; first <= pdf.numPages; first += batch) {
    if (cancelled()) return null;
    const count = Math.min(batch, pdf.numPages - first + 1);
    const pages = await Promise.all(
      Array.from({ length: count }, async (_, offset) => {
        try {
          const page = await pdf.getPage(first + offset);
          return pdfPageSearchText((await page.getTextContent()).items);
        } catch {
          return "";
        }
      }),
    );
    texts.push(...pages);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return cancelled() ? null : texts;
}

export type PdfSearchResult = { matches: PdfSearchMatch[]; capped: boolean };

/** Every match of a normalized query; `texts[n]` is the text of page n + 1. */
export function searchPdfPages(
  texts: readonly string[],
  needle: string,
  limit = PDF_SEARCH_LIMIT,
): PdfSearchResult {
  const matches: PdfSearchMatch[] = [];
  for (const [index, text] of texts.entries()) {
    const found = findPdfMatches(text, needle, limit + 1 - matches.length);
    for (const ordinal of found.keys()) matches.push({ page: index + 1, index: ordinal });
    if (matches.length > limit) return { matches: matches.slice(0, limit), capped: true };
  }
  return { matches, capped: false };
}
