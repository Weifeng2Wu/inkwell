import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PdfiumGlyphDocument } from "./pdf-geometry-worker";
import {
  type PdfPageGlyphs,
  pdfGlyphLines,
  pdfRectUnion,
  tightPdfTextSelection,
} from "./pdf-glyph-geometry";
import { connectedPdfHighlightRects } from "./pdf-highlight-geometry";
import type { PdfAnnotationRect } from "./pdf-notes";

type FixtureRun = {
  text: string;
  size?: number;
  font?: "regular" | "bold";
  rise?: number;
};
type FixtureLine = { baseline: number; runs: FixtureRun[] };
const ROTATIONS = [0, 90, 180, 270];
const EPSILON = 0.000001;

/** Independent PDF text objects keep typography real, including inline Ts/Tf. */
function fixture(lines: FixtureLine[], rotation = 0) {
  const hex = (text: string) =>
    Array.from(text, (character) => {
      const code = character.charCodeAt(0);
      if (code > 255) throw new Error("Fixture requires WinAnsi text");
      return code.toString(16).padStart(2, "0");
    }).join("");
  const stream = lines
    .map(
      ({ baseline, runs }) =>
        `BT 72 ${baseline} Td ${runs
          .map(
            ({ text, size = 12, font = "regular", rise = 0 }) =>
              `/${font === "bold" ? "F2" : "F1"} ${size} Tf ${rise} Ts <${hex(text)}> Tj`,
          )
          .join(" ")} ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [20 30 592 762] /Rotate ${rotation} /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function readingAxes(source: PdfPageGlyphs, rect: PdfAnnotationRect): PdfAnnotationRect {
  const axes = source.vertical
    ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width }
    : { ...rect };
  if (source.reverseLines) axes.y = 1 - axes.y - axes.height;
  return axes;
}

function bottom(rect: PdfAnnotationRect) {
  return rect.y + rect.height;
}

function sameRect(first: PdfAnnotationRect, second: PdfAnnotationRect) {
  return (
    Math.abs(first.x - second.x) < EPSILON &&
    Math.abs(first.y - second.y) < EPSILON &&
    Math.abs(first.width - second.width) < EPSILON &&
    Math.abs(first.height - second.height) < EPSILON
  );
}

function paintedRect(
  original: PdfAnnotationRect,
  tight: PdfAnnotationRect[],
  bands: PdfAnnotationRect[],
) {
  const index = tight.findIndex((rect) => sameRect(rect, original));
  expect(index).toBeGreaterThanOrEqual(0);
  const band = bands[index];
  if (!band) throw new Error("Missing selected paint fragment");
  return band;
}

let api: WrappedPdfiumModule;
beforeAll(async () => {
  const directory = dirname(createRequire(import.meta.url).resolve("@embedpdf/pdfium"));
  api = await init({ wasmBinary: new Uint8Array(readFileSync(join(directory, "pdfium.wasm"))) });
  api.FPDF_InitLibrary();
});
afterAll(() => api?.FPDF_DestroyLibrary());

async function withPdf(
  bytes: Uint8Array,
  check: (context: {
    source: PdfPageGlyphs;
    select: (texts: string[]) => PdfAnnotationRect[];
    lineAt: (baseline: number) => ReturnType<typeof pdfGlyphLines>[number];
  }) => void,
) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const directory = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const loading = getDocument({
    data: bytes.slice(),
    standardFontDataUrl: `${join(directory, "standard_fonts")}/`,
  });
  const pdf = new PdfiumGlyphDocument(api);
  try {
    const original = await loading.promise;
    const pdfPage = await original.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const content = await pdfPage.getTextContent();
    const runs = content.items.flatMap((item) => ("str" in item && item.str.trim() ? [item] : []));
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = viewport.transform;
    pdf.open(bytes);
    const source = pdf.page(0, {
      width: viewport.width,
      height: viewport.height,
      transform: [a, b, c, d, e, f],
    });
    const hint = pdfRectUnion(source.glyphs.flatMap((glyph) => (glyph.rect ? [glyph.rect] : [])));
    if (!hint) throw new Error("Missing fixture bounds");
    const select = (texts: string[]) =>
      tightPdfTextSelection(
        source,
        texts.map((text) => {
          // PDFium can reorder rows and scripts on rotated pages. Match the
          // independent PDF.js runs, never slices of its extracted glyph text.
          const run = runs.find((item) => item.str.trim() === text.trim());
          expect(run, `Missing independent PDF.js run: ${text}`).toBeDefined();
          if (!run) throw new Error("Missing fixture text run");
          return { text: run.str, start: 0, end: run.str.length, bounds: hint };
        }),
      );
    const lines = pdfGlyphLines(source);
    const lineAt = (baseline: number) => {
      const cross = source.vertical
        ? (a * 72 + c * baseline + e) / source.width
        : (b * 72 + d * baseline + f) / source.height;
      const canonical = source.reverseLines ? 1 - cross : cross;
      const line = lines.find(
        (candidate) =>
          candidate.baseline !== undefined && Math.abs(candidate.baseline - canonical) < EPSILON,
      );
      expect(line, `Missing physical line at PDF baseline ${baseline}`).toBeDefined();
      if (!line) throw new Error("Missing fixture text line");
      return line;
    };
    check({ source, select, lineAt });
  } finally {
    pdf.close();
    await loading.destroy();
  }
}

describe("real PDF typography highlight bands", () => {
  const headings = ROTATIONS.flatMap((rotation) =>
    [
      { size: 12, font: "bold" as const, label: "same-size bold" },
      { size: 16, font: "bold" as const, label: "larger bold" },
      { size: 12, font: "regular" as const, label: "same-style spaced" },
    ].map((heading) => ({ rotation, ...heading })),
  );

  it.each(
    headings,
  )("keeps $label headings separate while connecting body rows at $rotation degrees with crop offsets", async ({
    rotation,
    size,
    font,
  }) => {
    const heading = "Section title";
    const first = "Alpha paragraph starts here.";
    const second = "Following paragraph line.";
    const normal = "Normal text below.";
    const bytes = fixture(
      [
        { baseline: 752, runs: [{ text: heading, size, font }] },
        { baseline: 720, runs: [{ text: first }] },
        { baseline: 702, runs: [{ text: second }] },
        { baseline: 684, runs: [{ text: normal }] },
      ],
      rotation,
    );
    await withPdf(bytes, ({ source, select, lineAt }) => {
      const tight = select([heading, first, second]);
      const saved = structuredClone(tight);
      const bands = connectedPdfHighlightRects(source, tight);
      const headingLine = lineAt(752);
      const firstLine = lineAt(720);
      const lastLine = lineAt(702);
      const normalLine = lineAt(684);
      expect(headingLine.fontSize).toBe(size);
      expect(firstLine.fontSize).toBe(12);
      if (font === "bold") expect(headingLine.fontKey).not.toBe(firstLine.fontKey);
      const headingBand = paintedRect(headingLine.rect, tight, bands);
      expect(headingBand).toEqual(headingLine.rect);
      const firstBand = readingAxes(source, paintedRect(firstLine.rect, tight, bands));
      const lastBand = readingAxes(source, paintedRect(lastLine.rect, tight, bands));
      const firstInk = readingAxes(source, firstLine.rect);
      const lastInk = readingAxes(source, lastLine.rect);
      const gap = Math.max(0, lastInk.y - bottom(firstInk));
      expect(firstBand.y).toBeCloseTo(firstInk.y, 6);
      expect(bottom(firstBand)).toBeCloseTo(lastBand.y, 6);
      expect(bottom(lastBand)).toBeCloseTo(bottom(lastInk) + gap / 2, 6);
      expect(bottom(lastBand)).toBeLessThan(readingAxes(source, normalLine.bounds).y);
      expect(
        bands.map((rect) => {
          const axes = readingAxes(source, rect);
          return { x: axes.x, width: axes.width };
        }),
      ).toEqual(
        tight.map((rect) => {
          const axes = readingAxes(source, rect);
          return { x: axes.x, width: axes.width };
        }),
      );
      expect(tight).toEqual(saved);
    });
  });

  it.each(
    ROTATIONS.flatMap((rotation) => [24, 30].map((leading) => ({ rotation, leading }))),
  )("connects genuinely double-spaced low-ink body rows with $leading pt leading at $rotation degrees", async ({
    rotation,
    leading,
  }) => {
    const first = "some rare nouns.";
    const second = "more common nouns.";
    const bytes = fixture(
      [
        { baseline: 720, runs: [{ text: first }] },
        { baseline: 720 - leading, runs: [{ text: second }] },
        { baseline: 720 - leading * 2, runs: [{ text: "other ordinary body words." }] },
      ],
      rotation,
    );
    await withPdf(bytes, ({ source, select, lineAt }) => {
      const tight = select([first, second]);
      expect(tight).toHaveLength(2);
      const bands = connectedPdfHighlightRects(source, tight);
      const firstLine = lineAt(720);
      const lastLine = lineAt(720 - leading);
      const firstBand = readingAxes(source, paintedRect(firstLine.rect, tight, bands));
      const lastBand = readingAxes(source, paintedRect(lastLine.rect, tight, bands));
      const firstInk = readingAxes(source, firstLine.rect);
      const lastInk = readingAxes(source, lastLine.rect);
      const gap = lastInk.y - bottom(firstInk);
      // These rows have only x-height glyphs. Their large ordinary leading
      // must not be confused with a heading/paragraph break by ink-height caps.
      expect(gap).toBeGreaterThan(firstInk.height * 2);
      expect(firstLine.fontSize).toBe(lastLine.fontSize);
      expect(bottom(firstBand)).toBeCloseTo(lastBand.y, 6);
      const obstacle = readingAxes(source, lineAt(720 - leading * 2).bounds).y;
      const halfGap = Math.min(gap, Math.max(0, obstacle - bottom(lastInk))) / 2;
      expect(bottom(lastBand)).toBeCloseTo(bottom(lastInk) + halfGap, 6);
      expect(bottom(lastBand)).toBeGreaterThan(bottom(lastInk));
      expect(bottom(lastBand)).toBeLessThan(obstacle);
    });
  });

  it.each(
    ROTATIONS,
  )("keeps a selected superscript and following parenthesis local at %i degrees", async (rotation) => {
    const first = "Body";
    const script = "1";
    const after = "(paper).";
    const second = "Following body paragraph.";
    const bytes = fixture(
      [
        {
          baseline: 720,
          runs: [
            { text: first, size: 16 },
            { text: script, size: 8, rise: 7 },
            { text: after, size: 16 },
          ],
        },
        { baseline: 694, runs: [{ text: second, size: 16 }] },
        { baseline: 668, runs: [{ text: "Normal text below.", size: 16 }] },
      ],
      rotation,
    );
    await withPdf(bytes, ({ source, select, lineAt }) => {
      const firstLine = lineAt(720);
      const lastLine = lineAt(694);
      const scriptId = firstLine.localGlyphs.find((id) => source.glyphs[id]?.text === script);
      const scriptGlyph = scriptId !== undefined ? source.glyphs[scriptId] : undefined;
      if (!scriptGlyph?.rect) throw new Error("Missing local superscript");
      const tight = select([first, script, after, second]);
      const bands = connectedPdfHighlightRects(source, tight);
      const firstBand = readingAxes(source, paintedRect(firstLine.rect, tight, bands));
      const lastBand = readingAxes(source, paintedRect(lastLine.rect, tight, bands));
      const firstInk = readingAxes(source, firstLine.rect);
      const scriptInk = readingAxes(source, scriptGlyph.rect);
      expect(scriptInk.y).toBeLessThan(firstInk.y);
      expect(firstBand.y).toBeCloseTo(firstInk.y, 6);
      expect(bottom(firstBand)).toBeCloseTo(lastBand.y, 6);
      expect(paintedRect(scriptGlyph.rect, tight, bands)).toEqual(scriptGlyph.rect);
      const mainText = select([first, after]);
      // A deliberately unselected script can separate the two source ranges;
      // neither normal-text range may inherit its raised ink height.
      expect(pdfRectUnion(mainText)).toEqual(firstLine.rect);
      for (const rect of mainText) {
        const axes = readingAxes(source, rect);
        expect(axes.y).toBeGreaterThanOrEqual(firstInk.y - EPSILON);
        expect(bottom(axes)).toBeLessThanOrEqual(bottom(firstInk) + EPSILON);
      }
      expect(firstLine.fontSize).toBe(16);
    });
  });

  it.each(
    ROTATIONS,
  )("caps final padding before a raised unselected glyph on the next row at %i degrees", async (rotation) => {
    const first = "Alpha body paragraph.";
    const second = "Following body paragraph.";
    const bytes = fixture(
      [
        { baseline: 720, runs: [{ text: first, size: 16 }] },
        { baseline: 694, runs: [{ text: second, size: 16 }] },
        {
          baseline: 668,
          runs: [
            { text: "Nearby unselected", size: 16 },
            { text: "2", size: 8, rise: 12 },
            { text: " text.", size: 16 },
          ],
        },
      ],
      rotation,
    );
    await withPdf(bytes, ({ source, select, lineAt }) => {
      const firstLine = lineAt(720);
      const lastLine = lineAt(694);
      const normalLine = lineAt(668);
      const scriptId = normalLine.localGlyphs.find((id) => source.glyphs[id]?.text === "2");
      const script = scriptId !== undefined ? source.glyphs[scriptId] : undefined;
      if (!script?.rect) throw new Error("Missing unselected superscript obstacle");
      const tight = select([first, second]);
      const bands = connectedPdfHighlightRects(source, tight);
      const lastBand = readingAxes(source, paintedRect(lastLine.rect, tight, bands));
      const firstInk = readingAxes(source, firstLine.rect);
      const lastInk = readingAxes(source, lastLine.rect);
      const scriptInk = readingAxes(source, script.rect);
      const halfGap = Math.max(0, lastInk.y - bottom(firstInk)) / 2;
      expect(scriptInk.y).toBeLessThan(readingAxes(source, normalLine.rect).y);
      expect(bottom(lastInk) + halfGap).toBeGreaterThan(scriptInk.y);
      expect(bottom(lastBand)).toBeLessThan(scriptInk.y);
      expect(bottom(lastBand)).toBeGreaterThanOrEqual(bottom(lastInk));
    });
  });

  it.each(
    ROTATIONS,
  )("does not turn a small inline-bold phrase into a body block boundary at %i degrees", async (rotation) => {
    const before = "A paragraph includes a ";
    const emphasized = "bold";
    const after = " word and regular text.";
    const second = "Following regular paragraph line.";
    const bytes = fixture(
      [
        {
          baseline: 720,
          runs: [{ text: before }, { text: emphasized, font: "bold" }, { text: after }],
        },
        { baseline: 702, runs: [{ text: second }] },
        { baseline: 684, runs: [{ text: "Normal text below." }] },
      ],
      rotation,
    );
    await withPdf(bytes, ({ source, select, lineAt }) => {
      const firstLine = lineAt(720);
      const lastLine = lineAt(702);
      const tight = select([before, emphasized, after, second]);
      const bands = connectedPdfHighlightRects(source, tight);
      expect(firstLine.fontKey).toBe(lastLine.fontKey);
      expect(firstLine.fontConfidence).toBeGreaterThan(0.75);
      const firstBand = readingAxes(source, paintedRect(firstLine.rect, tight, bands));
      const lastBand = readingAxes(source, paintedRect(lastLine.rect, tight, bands));
      const gap =
        readingAxes(source, lastLine.rect).y - bottom(readingAxes(source, firstLine.rect));
      expect(bottom(firstBand)).toBeCloseTo(lastBand.y, 6);
      expect(bottom(lastBand)).toBeCloseTo(bottom(readingAxes(source, lastLine.rect)) + gap / 2, 6);
    });
  });
});
