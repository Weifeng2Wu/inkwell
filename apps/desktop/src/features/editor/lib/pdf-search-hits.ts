import {
  buildPdfSearchSource,
  findPdfMatches,
  type PdfSearchPart,
  pdfMatchSegments,
} from "./pdf-search";

/** One painted rectangle of match `hit`, as fractions of the page box. */
export type PdfSearchHit = {
  id: string;
  hit: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Locate matches in a rendered PDF.js text layer. Returns null while the layer
 * has no text yet, so callers can keep what they already painted.
 */
export function pdfSearchHits(
  layer: Element,
  page: { left: number; top: number; width: number; height: number },
  needle: string,
): PdfSearchHit[] | null {
  if (page.width <= 0 || page.height <= 0) return null;
  const parts: PdfSearchPart[] = [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      if (node.parentElement?.closest(".endOfContent")) continue;
      parts.push({ text: node.data });
      nodes.push(node);
    } else if (node instanceof HTMLBRElement) {
      const last = parts.at(-1);
      if (last) last.eol = true;
    }
  }
  if (!nodes.length) return null;
  const source = buildPdfSearchSource(parts);
  const hits: PdfSearchHit[] = [];
  for (const [hit, start] of findPdfMatches(source.text, needle).entries()) {
    let piece = 0;
    for (const segment of pdfMatchSegments(source, start, needle.length)) {
      const node = nodes[segment.part];
      if (!node) continue;
      const range = document.createRange();
      range.setStart(node, Math.min(segment.start, node.length));
      range.setEnd(node, Math.min(segment.end, node.length));
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        hits.push({
          id: `${hit}-${piece}`,
          hit,
          x: (rect.left - page.left) / page.width,
          y: (rect.top - page.top) / page.height,
          width: rect.width / page.width,
          height: rect.height / page.height,
        });
        piece += 1;
      }
    }
  }
  return hits;
}
