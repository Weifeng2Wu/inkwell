import { type PdfPageGlyphs, pdfGlyphLines, pdfRectUnion } from "./pdf-glyph-geometry";
import type { PdfAnnotationRect } from "./pdf-notes";
import type { PdfGlyphLine } from "./pdf-text-layout";

type Line = PdfGlyphLine & { localRects: PdfAnnotationRect[] };
type Layout = {
  lines: Line[];
  following: Map<Line, Line>;
  preceding: Map<Line, Line[]>;
};
const layouts = new WeakMap<PdfPageGlyphs, Layout>();
const EPSILON = 0.000001;

function toReadingAxes(rect: PdfAnnotationRect, page: PdfPageGlyphs) {
  const axes = page.vertical
    ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width }
    : { ...rect };
  if (page.reverseLines) axes.y = 1 - axes.y - axes.height;
  return axes;
}

function fromReadingAxes(rect: PdfAnnotationRect, page: PdfPageGlyphs) {
  const axes = { ...rect };
  if (page.reverseLines) axes.y = 1 - axes.y - axes.height;
  return page.vertical ? { x: axes.y, y: axes.x, width: axes.height, height: axes.width } : axes;
}

function horizontalOverlap(a: PdfAnnotationRect, b: PdfAnnotationRect) {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
}

function sameRow(a: PdfAnnotationRect, b: PdfAnnotationRect) {
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return (
    overlap >= Math.min(a.height, b.height) * 0.5 &&
    Math.max(a.height, b.height) <= Math.min(a.height, b.height) * 2.5
  );
}

function sameColumn(a: Line, b: Line) {
  return horizontalOverlap(a.rect, b.rect) >= Math.min(a.rect.width, b.rect.width) * 0.2;
}

function linePitch(a: Line, b: Line) {
  return a.baseline !== undefined && b.baseline !== undefined
    ? b.baseline - a.baseline
    : b.rect.y + b.rect.height / 2 - a.rect.y - a.rect.height / 2;
}

function below(a: Line, b: Line) {
  if (a.baseline !== undefined && b.baseline !== undefined) return linePitch(a, b) > EPSILON;
  return (
    b.rect.y > a.rect.y + EPSILON && linePitch(a, b) > Math.min(a.rect.height, b.rect.height) * 0.5
  );
}

function pageLines(page: PdfPageGlyphs) {
  let layout = layouts.get(page);
  if (!layout) {
    const lines: Line[] = pdfGlyphLines(page)
      .map((line) => ({
        ...line,
        rect: toReadingAxes(line.rect, page),
        bounds: toReadingAxes(line.bounds, page),
        localRects: line.localGlyphs.flatMap((id) => {
          const rect = page.glyphs[id]?.rect;
          return rect ? [toReadingAxes(rect, page)] : [];
        }),
      }))
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    layout = { lines, following: new Map(), preceding: new Map() };
    for (const line of lines) {
      // Find the first physical row, INCLUDING different styles and unselected
      // scripts. Style checks may cut an edge but must never skip an obstacle.
      const next = lines.find((candidate) => below(line, candidate) && sameColumn(line, candidate));
      if (!next) continue;
      layout.following.set(line, next);
      const previous = layout.preceding.get(next) ?? [];
      previous.push(line);
      layout.preceding.set(next, previous);
    }
    layouts.set(page, layout);
  }
  return layout;
}

function compatibleStyle(a: Line, b: Line) {
  if (
    a.fontSize !== undefined &&
    b.fontSize !== undefined &&
    Math.abs(a.fontSize - b.fontSize) > Math.max(0.5, Math.min(a.fontSize, b.fontSize) * 0.15)
  )
    return false;
  return !(
    a.fontKey !== undefined &&
    b.fontKey !== undefined &&
    a.fontKey !== b.fontKey &&
    (a.fontConfidence ?? 0) >= 0.85 &&
    (b.fontConfidence ?? 0) >= 0.85
  );
}

function plausibleSpacing(a: Line, b: Line, crossSize: number) {
  if (!compatibleStyle(a, b)) return false;
  const pitch = linePitch(a, b);
  if (pitch <= EPSILON) return false;
  if (a.fontSize !== undefined && b.fontSize !== undefined) {
    // Real font size, unlike lowercase ink height, can safely accommodate
    // double-spaced prose without treating a small glyph as a tiny font.
    return pitch <= (Math.max(a.fontSize, b.fontSize) * 3) / crossSize + EPSILON;
  }
  if (Math.max(a.rect.height, b.rect.height) > Math.min(a.rect.height, b.rect.height) * 2)
    return false;
  const gap = Math.max(0, b.rect.y - a.rect.y - a.rect.height);
  return gap <= Math.max(a.rect.height, b.rect.height) * 2 + EPSILON;
}

function ordinaryPitch(layout: Layout, a: Line, b: Line, crossSize: number) {
  const samples: number[] = [];
  let after = b;
  for (let count = 0; count < 3; count++) {
    const next = layout.following.get(after);
    if (!next || !sameColumn(b, next) || !plausibleSpacing(after, next, crossSize)) break;
    samples.push(linePitch(after, next));
    after = next;
  }
  let before = a;
  for (let count = 0; count < 3; count++) {
    const previous = layout.preceding
      .get(before)
      ?.filter((candidate) => sameColumn(candidate, b))
      .sort((left, right) => linePitch(left, before) - linePitch(right, before))[0];
    if (!previous || !plausibleSpacing(previous, before, crossSize)) break;
    samples.push(linePitch(previous, before));
    before = previous;
  }
  let reference: number | undefined;
  let support = 1;
  for (const sample of samples) {
    const cluster = samples.filter((pitch) => Math.abs(pitch - sample) <= sample * 0.2);
    if (cluster.length < 2) continue;
    cluster.sort((left, right) => left - right);
    const middle = cluster[Math.floor(cluster.length / 2)];
    if (
      middle !== undefined &&
      (cluster.length > support || (cluster.length === support && middle > (reference ?? 0)))
    ) {
      support = cluster.length;
      reference = middle;
    }
  }
  return reference;
}

function canConnect(layout: Layout, a: Line, b: Line, crossSize: number) {
  if (!plausibleSpacing(a, b, crossSize)) return false;
  const reference = ordinaryPitch(layout, a, b, crossSize);
  // This is an evidence-backed veto, not a requirement to find more rows.
  // Two ordinary selected lines still connect when neighboring data is absent.
  return (
    reference === undefined ||
    linePitch(a, b) <= reference * 1.4 + Math.min(a.rect.height, b.rect.height) * 0.1 + EPSILON
  );
}

function localInkMatch(line: Line, rect: PdfAnnotationRect) {
  const overlap = pdfRectUnion(
    line.localRects.flatMap((local) => {
      const x = Math.max(local.x, rect.x);
      const y = Math.max(local.y, rect.y);
      const width = Math.min(local.x + local.width, rect.x + rect.width) - x;
      const height = Math.min(local.y + local.height, rect.y + rect.height) - y;
      return width > 0 && height > 0 ? [{ x, y, width, height }] : [];
    }),
  );
  return overlap ? (overlap.width * overlap.height) / (rect.width * rect.height) : 0;
}

type Row = {
  line: Line;
  top: number;
  coreSelected: boolean;
  next?: Row;
  following?: Line;
  incomingGap?: number;
};

/**
 * Paint only: retain tight horizontal anchors, fill intervening line whitespace,
 * and give the final line half a gap, never the next unselected line's ink.
 * Different columns, paragraphs and isolated selections remain independent.
 */
export function connectedPdfHighlightRects(page: PdfPageGlyphs, tight: PdfAnnotationRect[]) {
  if (tight.length < 2) return tight;
  const layout = pageLines(page);
  const rows = new Map<Line, Row>();
  const items = tight.map((rect) => {
    const axes = toReadingAxes(rect, page);
    let line: Line | undefined;
    let local = false;
    let score = -Infinity;
    for (const candidate of layout.lines) {
      const localCoverage = localInkMatch(candidate, axes);
      const isLocal = localCoverage >= 0.9;
      const overlap = horizontalOverlap(candidate.rect, axes);
      if (!isLocal && (overlap <= 0 || !sameRow(candidate.rect, axes))) continue;
      const rank = isLocal ? 2 + localCoverage : overlap / axes.width + candidate.rect.width * 0.01;
      if (rank > score) {
        line = candidate;
        local = isLocal;
        score = rank;
      }
    }
    let row = line ? rows.get(line) : undefined;
    if (line && !row) {
      row = { line, top: line.rect.y, coreSelected: false };
      rows.set(line, row);
    }
    if (row && !local) row.coreSelected = true;
    return { original: rect, axes, row, local };
  });
  const selectedRows = [...rows.values()].filter((row) => row.coreSelected);
  if (selectedRows.length < 2) return tight;
  const crossSize = page.vertical ? page.width : page.height;
  for (const row of selectedRows) {
    const bottom = row.line.rect.y + row.line.rect.height;
    row.following = layout.following.get(row.line);
    const following = row.following;
    if (!following || !canConnect(layout, row.line, following, crossSize)) continue;
    const gap = Math.max(0, following.rect.y - bottom);
    const next = selectedRows.find(
      (candidate) => candidate !== row && candidate.line === following,
    );
    if (!next) continue;
    row.next = next;
    next.top = Math.min(next.top, following.rect.y);
    next.incomingGap = Math.min(next.incomingGap ?? Infinity, gap);
  }
  return items.map(({ original, axes, row, local }) => {
    if (local || !row || (!row.next && row.incomingGap === undefined)) return original;
    const bottom = Math.max(axes.y + axes.height, row.line.rect.y + row.line.rect.height);
    const available = row.following ? Math.max(0, row.following.bounds.y - bottom) : Infinity;
    const padding = Math.min(row.incomingGap ?? 0, available) / 2;
    const end = row.next ? row.next.top : Math.min(1, bottom + padding);
    const y = Math.max(0, Math.min(axes.y, row.top));
    return fromReadingAxes({ ...axes, y, height: Math.max(axes.y + axes.height, end) - y }, page);
  });
}
