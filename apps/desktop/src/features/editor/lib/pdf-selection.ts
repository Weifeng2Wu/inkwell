import { type PdfTextRunSelection, pdfRectUnion } from "./pdf-glyph-geometry";
import { normalizedPdfRect, type PdfAnnotationRect } from "./pdf-notes";

export type PdfSelectionPage = {
  element: HTMLElement;
  page: number;
  quote: string;
  rects: PdfAnnotationRect[];
  /** Transient paint bands; never replace the tight selection/notes anchors. */
  highlightRects?: PdfAnnotationRect[];
  runs: PdfTextRunSelection[];
};

/** Viewport positions of the pointer at the two ends of a dragged selection. */
export type PdfSelectionPointers = {
  start?: { x: number; y: number };
  end?: { x: number; y: number };
};

export function samePdfRange(first: Range, second: Range) {
  return (
    first.startContainer === second.startContainer &&
    first.startOffset === second.startOffset &&
    first.endContainer === second.endContainer &&
    first.endOffset === second.endOffset
  );
}

/** Async glyph results must still belong to the current native text selection. */
export function isCurrentPdfSelection(range: Range) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return false;
  return samePdfRange(selection.getRangeAt(0), range);
}

function sameLine(first: PdfAnnotationRect, second: PdfAnnotationRect) {
  const height = Math.min(first.height, second.height);
  const overlap =
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return (
    Math.max(first.height, second.height) <= height * 1.8 &&
    overlap >= height * 0.5 &&
    Math.abs(first.y + first.height / 2 - second.y - second.height / 2) <= height * 0.5
  );
}

/** Join neighboring text runs, not different lines or the gutter between columns. */
export function mergePdfSelectionRects(rects: PdfAnnotationRect[], pageAspectRatio: number) {
  const lines: { reference: PdfAnnotationRect; rects: PdfAnnotationRect[] }[] = [];
  for (const rect of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((candidate) => sameLine(candidate.reference, rect));
    if (line) line.rects.push(rect);
    else lines.push({ reference: rect, rects: [rect] });
  }
  return lines.flatMap((line) => {
    const merged: PdfAnnotationRect[] = [];
    for (const rect of line.rects.sort((a, b) => a.x - b.x)) {
      const previous = merged.at(-1);
      const gap = previous ? rect.x - previous.x - previous.width : Infinity;
      const maximumGap = previous
        ? Math.min(0.01, Math.min(previous.height, rect.height) * pageAspectRatio * 0.5)
        : 0;
      if (!previous || gap > maximumGap) {
        merged.push({ ...rect });
        continue;
      }
      const right = Math.max(previous.x + previous.width, rect.x + rect.width);
      const bottom = Math.max(previous.y + previous.height, rect.y + rect.height);
      previous.y = Math.min(previous.y, rect.y);
      previous.width = right - previous.x;
      previous.height = bottom - previous.y;
    }
    return merged;
  });
}

function visibleTextRanges(node: Node, range: Range) {
  const text = node.textContent ?? "";
  const start = node === range.startContainer ? range.startOffset : 0;
  const end = node === range.endContainer ? range.endOffset : text.length;
  const ranges: Range[] = [];
  // PDF text runs can contain trailing advances, NBSPs and invisible padding.
  // Trim geometry per line, not the quote/native selection or inter-word spaces.
  for (const line of text.slice(start, end).matchAll(/[^\r\n\u2028\u2029]+/gu)) {
    const content = line[0];
    const leading = content.match(/^[\s\u200b\u2060]+/u)?.[0].length ?? 0;
    const trailing = content.match(/[\s\u200b\u2060]+$/u)?.[0].length ?? 0;
    const from = start + line.index + leading;
    const to = start + line.index + content.length - trailing;
    if (from >= to) continue;
    const selected = document.createRange();
    selected.setStart(node, from);
    selected.setEnd(node, to);
    ranges.push(selected);
  }
  return ranges;
}

/**
 * Range.getClientRects() on a whole text layer includes element/container boxes.
 * Measure only selected text nodes, with exact offsets at both selection ends.
 * Native selection/copy still owns the text; this function owns its appearance.
 * `pointers` tags the boundary runs so glyph geometry can correct their offsets.
 */
export function collectPdfSelection(
  root: HTMLElement,
  range: Range,
  pointers: PdfSelectionPointers = {},
): PdfSelectionPage[] {
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer))
    return [];
  const pages: PdfSelectionPage[] = [];
  let characters = 0;
  for (const element of root.querySelectorAll<HTMLElement>("[data-pdf-page]")) {
    const layer = element.querySelector(".react-pdf__Page__textContent");
    if (!layer || !range.intersectsNode(layer)) continue;
    const clipped = range.cloneRange();
    if (!layer.contains(range.startContainer)) clipped.setStart(layer, 0);
    if (!layer.contains(range.endContainer)) clipped.setEnd(layer, layer.childNodes.length);
    const quote = clipped.toString().trim();
    if (!quote && !pointers.start && !pointers.end) continue;
    characters += quote.length;
    if (characters > 20000) throw new Error("PDF_SELECTION_TOO_LONG");
    const bounds = element.getBoundingClientRect();
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const fragments: PdfAnnotationRect[] = [];
    const runs: PdfTextRunSelection[] = [];
    let node = walker.nextNode();
    while (node) {
      if (
        node.textContent?.trim() &&
        !node.parentElement?.closest(".endOfContent") &&
        clipped.intersectsNode(node)
      ) {
        const full = document.createRange();
        full.selectNodeContents(node);
        const hint = pdfRectUnion(
          Array.from(full.getClientRects()).flatMap((rect) => {
            const normalized = normalizedPdfRect(rect, bounds);
            return normalized ? [normalized] : [];
          }),
        );
        const local: PdfTextRunSelection[] = [];
        for (const selected of visibleTextRanges(node, clipped)) {
          if (hint)
            local.push({
              text: node.textContent ?? "",
              start: selected.startOffset,
              end: selected.endOffset,
              bounds: hint,
            });
          for (const rect of selected.getClientRects()) {
            const normalized = normalizedPdfRect(rect, bounds);
            if (normalized) fragments.push(normalized);
          }
        }
        if (hint && node instanceof Text) {
          // Only a pointer on this run's own line says where its text should end.
          const onLine = (point?: { x: number; y: number }) => {
            if (!point) return;
            const y = (point.y - bounds.top) / bounds.height;
            const slack = hint.height * 0.25;
            return y >= hint.y - slack && y <= hint.y + hint.height + slack
              ? (point.x - bounds.left) / bounds.width
              : undefined;
          };
          const snapStart = node === range.startContainer ? onLine(pointers.start) : undefined;
          const snapEnd = node === range.endContainer ? onLine(pointers.end) : undefined;
          if (snapStart !== undefined || snapEnd !== undefined) {
            // The browser may have left this boundary run empty; the pointer can refill it.
            if (!local.length) {
              const offset = node === range.endContainer ? range.endOffset : range.startOffset;
              local.push({ text: node.data, start: offset, end: offset, bounds: hint });
            }
            const first = local[0];
            const last = local.at(-1);
            if (first && snapStart !== undefined) first.snapStart = snapStart;
            if (last && snapEnd !== undefined) last.snapEnd = snapEnd;
            for (const run of local) run.node = node;
          }
        }
        runs.push(...local);
      }
      node = walker.nextNode();
    }
    const rects = mergePdfSelectionRects(fragments, bounds.height / bounds.width);
    if (rects.length > 500) throw new Error("PDF_SELECTION_TOO_LONG");
    if (rects.length || runs.some((run) => run.node))
      pages.push({ element, page: Number(element.dataset.pdfPage), quote, rects, runs });
  }
  return pages;
}

/** One SVG path paints the union once, even when its rectangles overlap. */
export function pdfHighlightPath(rects: PdfAnnotationRect[]) {
  return rects
    .map(({ x, y, width, height }) => `M${x} ${y}h${width}v${height}h${-width}Z`)
    .join(" ");
}

export function pdfUnderlinePath(rects: PdfAnnotationRect[]) {
  return rects.map(({ x, y, width, height }) => `M${x} ${y + height}h${width}`).join(" ");
}
