import type { PdfAnnotationRect } from "./pdf-notes";
import { type PdfGlyphLine, pdfTextLayout } from "./pdf-text-layout";

export type PdfViewportGeometry = {
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
};
export type PdfGlyph = {
  text: string;
  rect?: PdfAnnotationRect;
  /** Actual PDF text origin, normalized with the same viewport as the ink. */
  origin?: { x: number; y: number };
  /** Font size in scale-one viewport points, not a browser font/line box. */
  fontSize?: number;
  /** Page-local PDFium font identity, used only for transient layout. */
  fontKey?: number;
  generated?: boolean;
  /** PDFium can omit the newline after a discretionary wrap hyphen. */
  lineBreakAfter?: boolean;
};
export type PdfPageGlyphs = {
  width: number;
  height: number;
  vertical?: boolean;
  reverseLines?: boolean;
  glyphs: PdfGlyph[];
};
export type PdfTextRunSelection = {
  text: string;
  start: number;
  end: number;
  bounds: PdfAnnotationRect;
};
type Index = { text: string; owners: number[][] };
const indexes = new WeakMap<PdfPageGlyphs, Index>();
const visualIndexes = new WeakMap<PdfPageGlyphs, Index | null>();
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function indexText(text: string, owners: number[]): Index {
  let normalized = "";
  const positions: number[][] = [];
  for (const { segment, index } of segmenter.segment(text)) {
    const value = segment.normalize("NFKC").replace(/[\s\u200b\u2060\u00ad]/gu, "");
    const source = [...new Set(owners.slice(index, index + segment.length))];
    normalized += value;
    for (let unit = 0; unit < value.length; unit++) positions.push(source);
  }
  return { text: normalized, owners: positions };
}

function pageIndex(page: PdfPageGlyphs) {
  let indexed = indexes.get(page);
  if (!indexed) {
    let text = "";
    const owners: number[] = [];
    page.glyphs.forEach((glyph, index) => {
      text += glyph.text;
      for (let unit = 0; unit < glyph.text.length; unit++) owners.push(index);
    });
    indexed = indexText(text, owners);
    indexes.set(page, indexed);
  }
  return indexed;
}

function visualPageIndex(page: PdfPageGlyphs) {
  let indexed = visualIndexes.get(page);
  if (indexed === undefined) {
    const layout = pdfTextLayout(page);
    // Visual fallback may reorder glyphs, never delete semantic text. Without
    // ink we cannot safely place such a character; whitespace normalizes away.
    const missingInk = page.glyphs.some((glyph) => !glyph.rect && indexText(glyph.text, []).text);
    if (!layout || missingInk) indexed = null;
    else {
      let text = "";
      const owners: number[] = [];
      const direction = page.vertical ? (page.reverseLines ? 1 : -1) : page.reverseLines ? -1 : 1;
      for (const line of layout) {
        const ids = [...line.glyphs].sort((a, b) => {
          const first = page.glyphs[a]?.origin;
          const second = page.glyphs[b]?.origin;
          if (!first || !second) return a - b;
          const offset = page.vertical ? first.y - second.y : first.x - second.x;
          return offset * direction || a - b;
        });
        for (const id of ids) {
          const glyph = page.glyphs[id];
          if (!glyph) continue;
          text += glyph.text;
          for (let unit = 0; unit < glyph.text.length; unit++) owners.push(id);
        }
      }
      indexed = indexText(text, owners);
    }
    visualIndexes.set(page, indexed);
  }
  return indexed;
}

export function pdfRectUnion(rects: PdfAnnotationRect[]): PdfAnnotationRect | undefined {
  if (!rects.length) return;
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const rect of rects) {
    x = Math.min(x, rect.x);
    y = Math.min(y, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x, y, width: right - x, height: bottom - y };
}

function matchingGlyphs(
  page: PdfPageGlyphs,
  text: string,
  hint: PdfAnnotationRect,
  rejectAmbiguous: boolean,
) {
  const needle = indexText(
    text,
    Array.from({ length: text.length }, (_, i) => i),
  ).text;
  if (!needle) return;
  function search(indexed: Index) {
    let best: { offset: number; score: number } | undefined;
    let runnerUp = Infinity;
    for (
      let offset = indexed.text.indexOf(needle);
      offset >= 0;
      offset = indexed.text.indexOf(needle, offset + 1)
    ) {
      const ids = [...new Set(indexed.owners.slice(offset, offset + needle.length).flat())];
      const bounds = pdfRectUnion(
        ids.flatMap((id) => {
          const rect = page.glyphs[id]?.rect;
          return rect ? [rect] : [];
        }),
      );
      if (!bounds) continue;
      // Full text-run context disambiguates repeated words; geometry disambiguates
      // repeated runs/quotes. Never match a passage elsewhere on the page.
      const dx = Math.max(0, hint.x - bounds.x - bounds.width, bounds.x - hint.x - hint.width);
      const dy = Math.max(0, hint.y - bounds.y - bounds.height, bounds.y - hint.y - hint.height);
      if (dx > 0.015 || dy > 0.015) continue;
      const score =
        (bounds.x + bounds.width / 2 - hint.x - hint.width / 2) ** 2 +
        (bounds.y + bounds.height / 2 - hint.y - hint.height / 2) ** 2;
      if (!best || score < best.score) {
        runnerUp = best?.score ?? Infinity;
        best = { offset, score };
      } else runnerUp = Math.min(runnerUp, score);
    }
    return { indexed, best, runnerUp };
  }
  let result = search(pageIndex(page));
  if (!result.best) {
    // PDFium can reorder separate text objects on a rotated page. Only retry
    // with known physical row/origin order when the original index has no match;
    // an ambiguous original quote is still rejected, never silently reassigned.
    const visual = visualPageIndex(page);
    if (visual) result = search(visual);
  }
  if (rejectAmbiguous && result.best && result.runnerUp - result.best.score < 0.000009) return;
  return result.best ? { indexed: result.indexed, offset: result.best.offset } : undefined;
}

/** Lattiora-style tight glyph union, with line/gap limits, not a whole-span box. */
export function mergeTightGlyphs(rects: PdfAnnotationRect[], aspect: number, vertical = false) {
  return mergeGlyphFragments(
    rects.map((rect) => ({ rect, punctuation: false })),
    aspect,
    vertical,
  );
}

type GlyphFragment = {
  rect: PdfAnnotationRect;
  punctuation: boolean;
  breakBefore?: boolean;
  line?: PdfGlyphLine;
  local?: boolean;
  bridgeWidth?: number;
};

function glyphFragments(page: PdfPageGlyphs, selected?: ReadonlySet<number>) {
  const fragments: GlyphFragment[] = [];
  let breakBefore = false;
  for (const [id, glyph] of page.glyphs.entries()) {
    if (glyph.rect && (!selected || selected.has(id))) {
      fragments.push({
        rect: glyph.rect,
        punctuation: /^\p{P}+$/u.test(glyph.text) || /^\u00ad+$/u.test(glyph.text),
        breakBefore,
      });
      breakBefore = false;
    }
    // Inspect the original stream, including unselected glyphs and whitespace.
    // A tiny dash/period must never attach to the next tightly spaced row.
    if (glyph.lineBreakAfter || /[\r\n\u2028\u2029]/u.test(glyph.text)) breakBefore = true;
  }
  return fragments;
}

function selectedLayoutFragments(
  page: PdfPageGlyphs,
  lines: PdfGlyphLine[],
  selected: ReadonlySet<number>,
) {
  const fragments: GlyphFragment[] = [];
  for (const line of lines) {
    const localIds = new Set(line.localGlyphs);
    const core: GlyphFragment[] = [];
    const local: GlyphFragment[] = [];
    let coreBreak = true,
      localBreak = true,
      bridgeWidth = 0;
    for (const id of line.glyphs) {
      const glyph = page.glyphs[id];
      if (!glyph?.rect) continue;
      if (!selected.has(id)) {
        coreBreak = localBreak = true;
        bridgeWidth = 0;
        continue;
      }
      const punctuation = /^\p{P}+$/u.test(glyph.text) || /^\u00ad+$/u.test(glyph.text);
      if (localIds.has(id)) {
        local.push({ rect: glyph.rect, punctuation, line, local: true, breakBefore: localBreak });
        localBreak = false;
        bridgeWidth += page.vertical ? glyph.rect.height : glyph.rect.width;
      } else {
        const alongSize = page.vertical ? page.height : page.width;
        core.push({
          rect: glyph.rect,
          punctuation,
          line,
          breakBefore: coreBreak,
          bridgeWidth: bridgeWidth ? bridgeWidth + ((line.fontSize ?? 0) * 0.75) / alongSize : 0,
        });
        coreBreak = false;
        localBreak = true;
        bridgeWidth = 0;
      }
    }
    // Body text can remain continuous underneath selected scripts, but the
    // script's extra height stays confined to its own horizontal span.
    fragments.push(...core, ...local);
  }
  return fragments;
}

/** Main text rows and local glyph ownership, never persisted as annotations. */
export function pdfGlyphLines(page: PdfPageGlyphs): PdfGlyphLine[] {
  const layout = pdfTextLayout(page);
  if (layout) return layout;
  return mergeGlyphFragments(
    glyphFragments(page),
    page.height / page.width,
    page.vertical ?? false,
  ).map((rect) => ({ rect, bounds: rect, glyphs: [], localGlyphs: [] }));
}

/** Whole-page text-line spans for layout only, never persisted as selections. */
export function pdfGlyphLineFragments(page: PdfPageGlyphs) {
  return pdfGlyphLines(page).map((line) => line.rect);
}

function punctuationSharesLine(mark: PdfAnnotationRect, text: PdfAnnotationRect) {
  // A period/dash can be much shorter than a letter. Keep the normal font-size
  // and superscript guards; only selected punctuation may join its nearby line.
  const tolerance = text.height * 0.35;
  return (
    mark.height <= text.height &&
    mark.y >= text.y - tolerance &&
    mark.y + mark.height <= text.y + text.height + tolerance
  );
}

function mergeGlyphFragments(fragments: GlyphFragment[], aspect: number, vertical: boolean) {
  const merged: {
    rect: PdfAnnotationRect;
    count: number;
    width: number;
    hasText: boolean;
    line?: PdfGlyphLine;
    local?: boolean;
  }[] = [];
  for (const { rect: original, punctuation, breakBefore, line, local, bridgeWidth } of fragments) {
    const rect = vertical
      ? { x: original.y, y: original.x, width: original.height, height: original.width }
      : original;
    const previous = merged.at(-1);
    if (previous && !breakBefore) {
      const before = previous.rect;
      const overlap =
        Math.min(before.y + before.height, rect.y + rect.height) - Math.max(before.y, rect.y);
      // Reading order can go right-to-left after a 180-degree page rotation.
      const gap = Math.max(0, rect.x - before.x - before.width, before.x - rect.x - rect.width);
      const limit = Math.min(0.025, Math.max(previous.width / previous.count, rect.width) * 2.5);
      const sameLayoutLine = !!line && previous.line === line && !local && !previous.local;
      const maximumGap =
        sameLayoutLine && bridgeWidth
          ? Math.max(
              limit,
              bridgeWidth + Math.max(previous.width / previous.count, rect.width) * 1.5,
            )
          : limit;
      const sameLine =
        overlap >= Math.min(before.height, rect.height) * 0.5 &&
        Math.max(before.height, rect.height) <= Math.min(before.height, rect.height) * 2.5 &&
        Math.abs(before.y + before.height / 2 - rect.y - rect.height / 2) <=
          Math.max(before.height, rect.height) * 0.75;
      const attachedPunctuation =
        punctuation && previous.hasText
          ? punctuationSharesLine(rect, before)
          : !punctuation && !previous.hasText && punctuationSharesLine(before, rect);
      if (
        (previous.local ?? false) === (local ?? false) &&
        (sameLayoutLine || sameLine || attachedPunctuation) &&
        gap <= maximumGap
      ) {
        const union = pdfRectUnion([before, rect]);
        if (union) previous.rect = union;
        previous.count++;
        previous.width += rect.width;
        previous.hasText ||= !punctuation;
        continue;
      }
    }
    merged.push({
      rect: { ...rect },
      count: 1,
      width: rect.width,
      hasText: !punctuation,
      line,
      local,
    });
  }
  // Aspect is kept explicit so callers cannot accidentally feed pixel rectangles.
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("PDF_GEOMETRY_FAILED");
  return merged.map(({ rect }) =>
    vertical ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width } : rect,
  );
}

export function tightPdfTextSelection(
  page: PdfPageGlyphs,
  selections: PdfTextRunSelection[],
  rejectAmbiguous = false,
) {
  const ids = new Set<number>();
  for (const selection of selections) {
    const match = matchingGlyphs(page, selection.text, selection.bounds, rejectAmbiguous);
    if (!match) throw new Error("PDF_GEOMETRY_FAILED");
    const source = indexText(
      selection.text,
      Array.from({ length: selection.text.length }, (_, i) => i),
    );
    source.owners.forEach((units, index) => {
      if (units.some((unit) => unit >= selection.start && unit < selection.end))
        for (const id of match.indexed.owners[match.offset + index] ?? []) ids.add(id);
    });
  }
  const layout = pdfTextLayout(page);
  const fragments = layout ? selectedLayoutFragments(page, layout, ids) : glyphFragments(page, ids);
  const merged = mergeGlyphFragments(fragments, page.height / page.width, page.vertical ?? false);
  if (!merged.length || merged.length > 500) throw new Error("PDF_GEOMETRY_FAILED");
  return merged;
}

export function tightSavedPdfQuote(
  page: PdfPageGlyphs,
  quote: string,
  previous: PdfAnnotationRect[],
) {
  const hint = pdfRectUnion(previous);
  if (!hint) return previous;
  try {
    return tightPdfTextSelection(
      page,
      [{ text: quote, start: 0, end: quote.length, bounds: hint }],
      true,
    );
  } catch {
    return previous;
  } // An ambiguous/unresolvable old quote is never reassigned.
}
