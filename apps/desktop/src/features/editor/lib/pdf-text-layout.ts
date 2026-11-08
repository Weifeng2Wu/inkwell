import type { PdfPageGlyphs } from "./pdf-glyph-geometry";
import type { PdfAnnotationRect } from "./pdf-notes";

/** Transient physical rows; local scripts never enlarge the main text band. */
export type PdfGlyphLine = {
  rect: PdfAnnotationRect;
  bounds: PdfAnnotationRect;
  glyphs: number[];
  localGlyphs: number[];
  /** Normalized cross-line coordinate, in the page's canonical reading axes. */
  baseline?: number;
  fontSize?: number;
  fontKey?: number;
  fontConfidence?: number;
};

type GlyphRecord = {
  id: number;
  rect: PdfAnnotationRect;
  axes: PdfAnnotationRect;
  baseline: number;
  fontSize: number;
  fontKey?: number;
  weight: number;
  block: number;
};

type Candidate = {
  records: GlyphRecord[];
  baseline: number;
  fontSize: number;
  fontKey?: number;
  fontConfidence: number;
  axes: PdfAnnotationRect;
  block: number;
  parent?: Candidate;
  merged?: boolean;
};

const layouts = new WeakMap<PdfPageGlyphs, PdfGlyphLine[] | null>();

function axes(rect: PdfAnnotationRect, page: PdfPageGlyphs): PdfAnnotationRect {
  const result = page.vertical
    ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width }
    : { ...rect };
  if (page.reverseLines) result.y = 1 - result.y - result.height;
  return result;
}

function union(rects: PdfAnnotationRect[]): PdfAnnotationRect {
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

function typography(records: GlyphRecord[]) {
  const sizes = new Map<number, { weight: number; fontSize: number }>();
  for (const record of records) {
    const size = Math.max(0.05, Math.round(record.fontSize * 20) / 20);
    const group = sizes.get(size);
    if (group) {
      const weight = group.weight + record.weight;
      group.fontSize += (record.fontSize - group.fontSize) * (record.weight / weight);
      group.weight = weight;
    } else sizes.set(size, { weight: record.weight, fontSize: record.fontSize });
  }
  let fontSize = 0,
    sizeWeight = 0;
  for (const group of sizes.values()) {
    if (group.weight > sizeWeight) {
      // Quantization groups nearly identical PDF font sizes; layout thresholds
      // must use their actual size, especially for very small positive fonts.
      fontSize = group.fontSize;
      sizeWeight = group.weight;
    }
  }
  const fonts = new Map<number, number>();
  let total = 0;
  for (const record of records) {
    if (Math.abs(record.fontSize - fontSize) > Math.max(0.05, fontSize * 0.05)) continue;
    total += record.weight;
    if (record.fontKey !== undefined)
      fonts.set(record.fontKey, (fonts.get(record.fontKey) ?? 0) + record.weight);
  }
  let fontKey: number | undefined;
  let fontWeight = 0;
  for (const [key, weight] of fonts) {
    if (weight > fontWeight) {
      fontKey = key;
      fontWeight = weight;
    }
  }
  return { fontSize, fontKey, fontConfidence: total ? fontWeight / total : 0 };
}

function buildLayout(page: PdfPageGlyphs): PdfGlyphLine[] | null {
  const crossSize = page.vertical ? page.width : page.height;
  const alongSize = page.vertical ? page.height : page.width;
  if (![crossSize, alongSize].every((size) => Number.isFinite(size) && size > 0)) return null;
  const records: GlyphRecord[] = [];
  let block = 0;
  for (const [id, glyph] of page.glyphs.entries()) {
    if (glyph.rect) {
      if (
        !glyph.origin ||
        !Number.isFinite(glyph.origin.x) ||
        !Number.isFinite(glyph.origin.y) ||
        !glyph.fontSize ||
        !Number.isFinite(glyph.fontSize) ||
        glyph.fontSize <= 0
      )
        return null;
      const origin = page.vertical ? glyph.origin.x : glyph.origin.y;
      records.push({
        id,
        rect: glyph.rect,
        axes: axes(glyph.rect, page),
        baseline: page.reverseLines ? 1 - origin : origin,
        fontSize: glyph.fontSize,
        fontKey: glyph.fontKey,
        weight: /[\p{L}\p{N}]/u.test(glyph.text) ? 2 : 1,
        block,
      });
    }
    // Authored breaks and restored wrap hyphens remain hard boundaries. PDFium
    // generated CRLFs are only hints: they can appear between an inline script
    // and the rest of the SAME physical row, or reorder scripts on rotated pages.
    if (glyph.lineBreakAfter || (!glyph.generated && /[\r\n\u2028\u2029]/u.test(glyph.text)))
      block++;
  }
  if (!records.length) return null;
  records.sort((a, b) => a.block - b.block || a.baseline - b.baseline || a.axes.x - b.axes.x);
  const baselines: GlyphRecord[][] = [];
  for (const record of records) {
    const previous = baselines.at(-1);
    const reference = previous?.[0];
    const tolerance = reference
      ? (Math.min(reference.fontSize, record.fontSize) * 0.12) / crossSize
      : 0;
    if (
      previous &&
      reference &&
      reference.block === record.block &&
      Math.abs(reference.baseline - record.baseline) <= tolerance
    )
      previous.push(record);
    else baselines.push([record]);
  }
  const candidates: Candidate[] = [];
  for (const row of baselines) {
    row.sort((a, b) => a.axes.x - b.axes.x || a.id - b.id);
    let segment: GlyphRecord[] = [];
    const finish = () => {
      const reference = segment[0];
      if (!reference) return;
      candidates.push({
        records: segment,
        baseline: reference.baseline,
        ...typography(segment),
        axes: union(segment.map((record) => record.axes)),
        block: reference.block,
      });
      segment = [];
    };
    for (const record of row) {
      const previous = segment.at(-1);
      const gap = previous ? record.axes.x - previous.axes.x - previous.axes.width : 0;
      const limit = previous
        ? Math.min(
            0.025,
            Math.max(
              previous.axes.width,
              record.axes.width,
              (Math.min(previous.fontSize, record.fontSize) * 0.4) / alongSize,
            ) * 2.5,
          )
        : 0;
      if (previous && gap > limit) finish();
      segment.push(record);
    }
    finish();
  }

  // Resolve smaller raised/lowered clusters against the whole physical row,
  // not the previous glyph in PDFium's extraction order.
  const bySize = [...candidates].sort((a, b) => b.fontSize - a.fontSize);
  for (const child of bySize) {
    let parent: Candidate | undefined;
    let score = Infinity;
    for (const candidate of bySize) {
      if (child.fontSize > candidate.fontSize * 0.85) break;
      if (
        candidate === child ||
        candidate.parent ||
        candidate.block !== child.block ||
        child.axes.width * alongSize > candidate.fontSize * 3
      )
        continue;
      const offset = (child.baseline - candidate.baseline) * crossSize;
      const rise = Math.abs(offset);
      // A lower small-font line is not a subscript merely because it is close.
      // Real subscripts sit nearer the baseline than raised reference markers.
      if (rise > candidate.fontSize * (offset > 0 ? 0.5 : 0.85)) continue;
      const gap =
        Math.max(
          0,
          child.axes.x - candidate.axes.x - candidate.axes.width,
          candidate.axes.x - child.axes.x - child.axes.width,
        ) * alongSize;
      if (gap > candidate.fontSize * 0.5) continue;
      const rank = rise / candidate.fontSize + (gap / candidate.fontSize) * 2;
      if (rank < score) {
        parent = candidate;
        score = rank;
      }
    }
    if (parent) child.parent = parent;
  }
  const children = new Map<Candidate, Candidate[]>();
  for (const child of candidates) {
    if (!child.parent) continue;
    const attached = children.get(child.parent) ?? [];
    attached.push(child);
    children.set(child.parent, attached);
  }

  // Several selected reference digits can take more advance than a normal
  // inter-word gap. Rejoin the body segments only when an actual inline script
  // occupies that gap; a column gutter with no such bridge stays independent.
  for (const child of candidates) {
    const parent = child.parent;
    if (!parent || parent.merged) continue;
    for (const candidate of candidates) {
      if (
        candidate === parent ||
        candidate.parent ||
        candidate.merged ||
        candidate.block !== parent.block ||
        Math.abs(candidate.baseline - parent.baseline) * crossSize >
          Math.min(candidate.fontSize, parent.fontSize) * 0.12 ||
        Math.max(candidate.fontSize, parent.fontSize) >
          Math.min(candidate.fontSize, parent.fontSize) * 1.15
      )
        continue;
      const left = parent.axes.x < candidate.axes.x ? parent : candidate;
      const right = left === parent ? candidate : parent;
      const gapStart = left.axes.x + left.axes.width;
      const gapEnd = right.axes.x;
      if (
        gapEnd <= gapStart ||
        child.axes.x + child.axes.width < gapStart ||
        child.axes.x > gapEnd ||
        (gapEnd - gapStart - child.axes.width) * alongSize > parent.fontSize * 0.75
      )
        continue;
      parent.records.push(...candidate.records);
      parent.axes = union([parent.axes, candidate.axes]);
      Object.assign(parent, typography(parent.records));
      candidate.merged = true;
      const moved = children.get(candidate);
      if (moved) {
        for (const other of moved) other.parent = parent;
        const attached = children.get(parent) ?? [];
        attached.push(...moved);
        children.set(parent, attached);
        children.delete(candidate);
      }
    }
  }
  const lines: PdfGlyphLine[] = [];
  for (const candidate of candidates) {
    if (candidate.parent || candidate.merged) continue;
    const local = candidate.records.filter((record) => record.fontSize > candidate.fontSize * 1.2);
    const core = candidate.records.filter((record) => record.fontSize <= candidate.fontSize * 1.2);
    if (!core.length) return null;
    for (const child of children.get(candidate) ?? []) local.push(...child.records);
    const all = [...core, ...local].sort((a, b) => a.axes.x - b.axes.x || a.id - b.id);
    lines.push({
      rect: union(core.map((record) => record.rect)),
      bounds: union(all.map((record) => record.rect)),
      glyphs: all.map((record) => record.id),
      localGlyphs: local.map((record) => record.id),
      baseline: candidate.baseline,
      ...typography(core),
    });
  }
  return lines.sort((a, b) => {
    const first = axes(a.rect, page);
    const second = axes(b.rect, page);
    return first.y - second.y || first.x - second.x;
  });
}

export function pdfTextLayout(page: PdfPageGlyphs) {
  let layout = layouts.get(page);
  if (layout === undefined) {
    layout = buildLayout(page);
    layouts.set(page, layout);
  }
  return layout;
}
