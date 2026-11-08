import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PdfiumGlyphDocument } from "./pdf-geometry-worker";
import { pdfRectUnion, tightPdfTextSelection } from "./pdf-glyph-geometry";
import { connectedPdfHighlightRects } from "./pdf-highlight-geometry";
import { pdfTypographyFixture } from "./pdf-typography-fixture";

// A real PDF, not mocked browser font boxes: deliberately large text advances
// and trailing spaces recreate the line-end overflow reported by readers.
function fixture(
  rotation = 0,
  crop = false,
  sentence = "Reading paper   ",
  secondLine = "Second line.",
  leading = 28,
) {
  const literal = (value: string) => value.replace(/[\\()]/g, "\\$&");
  const stream = `BT /F1 16 Tf 72 720 Td (${literal(sentence)}) Tj 0 -${leading} Td (${literal(secondLine)}) Tj 0 -${leading} Td (Normal text below.) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${crop ? "/CropBox [20 30 592 762]" : ""} /Rotate ${rotation} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

let api: WrappedPdfiumModule;
beforeAll(async () => {
  const directory = dirname(createRequire(import.meta.url).resolve("@embedpdf/pdfium"));
  api = await init({ wasmBinary: new Uint8Array(readFileSync(join(directory, "pdfium.wasm"))) });
  api.FPDF_InitLibrary();
});
afterAll(() => api?.FPDF_DestroyLibrary());

describe("real PDFium glyph geometry", () => {
  it.each([
    { rotation: 0, crop: false },
    { rotation: 0, crop: true },
    { rotation: 90, crop: false },
    { rotation: 90, crop: true },
    { rotation: 180, crop: false },
    { rotation: 180, crop: true },
    { rotation: 270, crop: false },
    { rotation: 270, crop: true },
  ])("extracts exact origins, fonts and generated inline breaks at $rotation degrees (crop $crop)", async ({
    rotation,
    crop,
  }) => {
    const bytes = pdfTypographyFixture({ rotation, crop });
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
      const runs = content.items.flatMap((item) => ("str" in item ? [item] : []));
      expect(runs.find((run) => run.str === "Body")?.hasEOL).toBe(false);
      expect(runs.find((run) => run.str === "1")?.hasEOL).toBe(false);
      expect(runs.find((run) => run.str === "(paper).")?.hasEOL).toBe(true);
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = viewport.transform;
      pdf.open(bytes);
      const source = pdf.page(0, {
        width: viewport.width,
        height: viewport.height,
        transform: [a, b, c, d, e, f],
      });
      const body = source.glyphs.find((glyph) => glyph.text === "B");
      const scriptIndex = source.glyphs.findIndex((glyph) => glyph.text === "1");
      const parenIndex = source.glyphs.findIndex((glyph) => glyph.text === "(");
      const script = source.glyphs[scriptIndex];
      const paren = source.glyphs[parenIndex];
      const heading = source.glyphs.find((glyph) => glyph.text === "H");
      if (!body?.origin || !script?.origin || !paren?.origin || !heading?.origin)
        throw new Error("Missing fixture typography");
      expect(body.fontSize).toBe(16);
      expect(paren.fontSize).toBe(16);
      expect(script.fontSize).toBe(8);
      expect(heading.fontSize).toBe(16);
      expect(body.fontKey).toBeDefined();
      expect(body.fontKey).toBe(paren.fontKey);
      expect(body.fontKey).toBe(script.fontKey);
      // Same em size does not mean the same font: a bold heading is distinct.
      expect(heading.fontKey).toBeDefined();
      expect(heading.fontKey).not.toBe(body.fontKey);
      expect(body.generated).toBeUndefined();
      expect(script.generated).toBeUndefined();
      expect(paren.generated).toBeUndefined();
      const expected = (x: number, y: number) => {
        const [vx = 0, vy = 0] = viewport.convertToViewportPoint(x, y);
        return { x: vx / viewport.width, y: vy / viewport.height };
      };
      expect(body.origin.x).toBeCloseTo(expected(72, 720).x, 6);
      expect(body.origin.y).toBeCloseTo(expected(72, 720).y, 6);
      const scriptRun = runs.find((run) => run.str === "1");
      const parenRun = runs.find((run) => run.str === "(paper).");
      if (!scriptRun || !parenRun) throw new Error("Missing PDF.js runs");
      expect(script.origin.x).toBeCloseTo(expected(scriptRun.transform[4] ?? 0, 727).x, 6);
      expect(script.origin.y).toBeCloseTo(expected(scriptRun.transform[4] ?? 0, 727).y, 6);
      expect(paren.origin.x).toBeCloseTo(expected(parenRun.transform[4] ?? 0, 720).x, 6);
      expect(paren.origin.y).toBeCloseTo(expected(parenRun.transform[4] ?? 0, 720).y, 6);
      expect(heading.origin.x).toBeCloseTo(expected(72, 754).x, 6);
      expect(heading.origin.y).toBeCloseTo(expected(72, 754).y, 6);
      // PDFium inserts a fake CRLF after this small raised digit, despite
      // the following bracket returning to the Body's actual baseline.
      expect(parenIndex).toBeGreaterThan(scriptIndex);
      const generatedBreaks = source.glyphs
        .slice(scriptIndex + 1, parenIndex)
        .filter((glyph) => /[\r\n]/u.test(glyph.text));
      expect(generatedBreaks).toHaveLength(2);
      expect(generatedBreaks.every((glyph) => glyph.generated === true && !glyph.rect)).toBe(true);
      if (!script.rect) throw new Error("Missing script ink");
      const scriptInk = source.vertical
        ? script.rect.width * source.width
        : script.rect.height * source.height;
      expect(scriptInk).toBeCloseTo(5.624, 3);
    } finally {
      pdf.close();
      await loading.destroy();
    }
  });

  it("distinguishes font identities without changing tight ink or unclamped origins", () => {
    const pdf = new PdfiumGlyphDocument(api);
    try {
      pdf.open(pdfTypographyFixture({ scriptFont: "F2" }));
      const source = pdf.page(0, {
        width: 612,
        height: 792,
        transform: [1, 0, 0, -1, -100, 792],
      });
      const body = source.glyphs.find((glyph) => glyph.text === "B");
      const script = source.glyphs.find((glyph) => glyph.text === "1");
      expect(body?.origin?.x).toBeCloseTo(-28 / 612, 6);
      expect(body?.origin?.y).toBeCloseTo(72 / 792, 6);
      expect(body?.fontSize).toBe(16);
      expect(script?.fontSize).toBe(8);
      expect(body?.fontKey).toBeDefined();
      expect(script?.fontKey).toBeDefined();
      expect(script?.fontKey).not.toBe(body?.fontKey);
    } finally {
      pdf.close();
    }
  });

  it.each([
    0, 90, 180, 270,
  ])("scales font em sizes with the cross axis at %i degrees", (rotation) => {
    const scale = 1.75;
    const vertical = rotation % 180 !== 0;
    const transform: [number, number, number, number, number, number] =
      rotation === 90
        ? [0, scale, scale, 0, 0, 0]
        : rotation === 180
          ? [-scale, 0, 0, scale, 612 * scale, 0]
          : rotation === 270
            ? [0, -scale, -scale, 0, 792 * scale, 612 * scale]
            : [scale, 0, 0, -scale, 0, 792 * scale];
    const pdf = new PdfiumGlyphDocument(api);
    try {
      pdf.open(pdfTypographyFixture({ rotation }));
      const source = pdf.page(0, {
        width: (vertical ? 792 : 612) * scale,
        height: (vertical ? 612 : 792) * scale,
        transform,
      });
      expect(source.glyphs.find((glyph) => glyph.text === "B")?.fontSize).toBe(16 * scale);
      expect(source.glyphs.find((glyph) => glyph.text === "1")?.fontSize).toBe(8 * scale);
    } finally {
      pdf.close();
    }
  });

  it.each([
    0, 90, 180, 270,
  ])("preserves wrapped hyphens and their separate tight lines at rotation %i", async (rotation) => {
    const firstLine = "hy-";
    const secondLine = "phenation example.";
    const bytes = fixture(rotation, true, firstLine, secondLine, 18);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({ data: bytes.slice() });
    const pdf = new PdfiumGlyphDocument(api);
    try {
      const original = await loading.promise;
      const pdfPage = await original.getPage(1);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const content = await pdfPage.getTextContent();
      const runs = content.items.flatMap((item) =>
        "str" in item && item.str.trim() ? [item.str] : [],
      );
      expect(runs).toContain(firstLine);
      expect(runs).toContain(secondLine);
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = viewport.transform;
      pdf.open(bytes);
      const source = pdf.page(0, {
        width: viewport.width,
        height: viewport.height,
        transform: [a, b, c, d, e, f],
      });
      const hyphen = source.glyphs.find((glyph) => glyph.text === "-");
      expect(hyphen?.rect).toBeDefined();
      expect(source.glyphs.some((glyph) => glyph.text === "\u0002")).toBe(false);
      if (rotation !== 90) expect(hyphen?.lineBreakAfter).toBe(true);
      const hint = pdfRectUnion(source.glyphs.flatMap((glyph) => (glyph.rect ? [glyph.rect] : [])));
      if (!hint || !hyphen?.rect) throw new Error("Missing fixture bounds");
      const select = (text: string, start = 0, end = text.length) => ({
        text,
        start,
        end,
        bounds: hint,
      });
      const first = tightPdfTextSelection(source, [select(firstLine)]);
      expect(first).toHaveLength(1);
      const hyphenOnly = tightPdfTextSelection(source, [select(firstLine, firstLine.length - 1)]);
      expect(hyphenOnly).toEqual([hyphen.rect]);
      const second = tightPdfTextSelection(source, [select(secondLine)]);
      expect(second).toHaveLength(1);
      const tight = tightPdfTextSelection(source, [select(firstLine), select(secondLine)]);
      expect(tight).toHaveLength(2);
      expect(tight).toEqual(expect.arrayContaining([...first, ...second]));
      // A partial selection starting at the dash must not form a tall, wide
      // union around the dash and the next line's first word.
      expect(
        tightPdfTextSelection(source, [
          select(firstLine, firstLine.length - 1),
          select(secondLine, 0, 4),
        ]),
      ).toHaveLength(2);
      const bands = connectedPdfHighlightRects(source, tight);
      const axes = (rect: { x: number; y: number; width: number; height: number }) => {
        let y = source.vertical ? rect.x : rect.y;
        const height = source.vertical ? rect.width : rect.height;
        if (source.reverseLines) y = 1 - y - height;
        return { y, height };
      };
      const normalized = bands.map(axes).sort((left, right) => left.y - right.y);
      const originals = tight.map(axes).sort((left, right) => left.y - right.y);
      const [top, last] = normalized;
      const [oldTop, oldLast] = originals;
      if (!top || !last || !oldTop || !oldLast) throw new Error("Missing selected lines");
      expect(top.y + top.height).toBeCloseTo(last.y, 6);
      const gap = Math.max(0, oldLast.y - oldTop.y - oldTop.height);
      expect(last.height - oldLast.height).toBeLessThanOrEqual(gap / 2 + 0.000001);
      const normal = source.glyphs.find((glyph) => glyph.text === "N")?.rect;
      if (!normal) throw new Error("Missing normal line");
      expect(last.y + last.height).toBeLessThan(axes(normal).y);
      const alongLine = (rect: { x: number; y: number; width: number; height: number }) =>
        source.vertical ? { x: rect.y, width: rect.height } : { x: rect.x, width: rect.width };
      expect(bands.map(alongLine)).toEqual(tight.map(alongLine));
    } finally {
      pdf.close();
      await loading.destroy();
    }
  });

  it.each([
    "state-of-the-art study",
    "hy--",
    "hy---",
  ])("keeps ordinary %s hyphens distinct from wrapped hyphens", (sentence) => {
    const pdf = new PdfiumGlyphDocument(api);
    try {
      pdf.open(fixture(0, false, sentence));
      const source = pdf.page(0, {
        width: 612,
        height: 792,
        transform: [1, 0, 0, -1, 0, 792],
      });
      const hyphens = source.glyphs.filter((glyph) => glyph.text === "-");
      expect(hyphens).toHaveLength(sentence.split("-").length - 1);
      expect(hyphens.every((glyph) => !glyph.lineBreakAfter)).toBe(true);
      const hint = pdfRectUnion(source.glyphs.flatMap((glyph) => (glyph.rect ? [glyph.rect] : [])));
      if (!hint) throw new Error("Missing fixture bounds");
      expect(
        tightPdfTextSelection(source, [
          { text: sentence, start: 0, end: sentence.length, bounds: hint },
        ]),
      ).toHaveLength(1);
    } finally {
      pdf.close();
    }
  });

  it.each([
    0, 90, 180, 270,
  ])("fills selected line gaps while protecting the next normal line at rotation %i", async (rotation) => {
    const bytes = fixture(rotation, true);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({ data: bytes.slice() });
    const pdf = new PdfiumGlyphDocument(api);
    try {
      const original = await loading.promise;
      const viewport = (await original.getPage(1)).getViewport({ scale: 1 });
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = viewport.transform;
      pdf.open(bytes);
      const source = pdf.page(0, {
        width: viewport.width,
        height: viewport.height,
        transform: [a, b, c, d, e, f],
      });
      const hint = pdfRectUnion(source.glyphs.flatMap((glyph) => (glyph.rect ? [glyph.rect] : [])));
      if (!hint) throw new Error("Missing fixture bounds");
      const tight = tightPdfTextSelection(
        source,
        ["Reading paper", "Second line."].map((text) => ({
          text,
          start: 0,
          end: text.length,
          bounds: hint,
        })),
      );
      const bands = connectedPdfHighlightRects(source, tight);
      const axes = (rect: { x: number; y: number; width: number; height: number }) => {
        let y = source.vertical ? rect.x : rect.y;
        const height = source.vertical ? rect.width : rect.height;
        if (source.reverseLines) y = 1 - y - height;
        return { y, height };
      };
      const normalized = bands.map(axes).sort((first, second) => first.y - second.y);
      expect(normalized).toHaveLength(2);
      const [first, last] = normalized;
      if (!first || !last) throw new Error("Missing highlight bands");
      expect(first.y + first.height).toBeCloseTo(last.y, 6);
      const originals = tight.map(axes).sort((first, second) => first.y - second.y);
      const oldFirst = originals[0];
      const oldLast = originals[1];
      if (!oldFirst || !oldLast) throw new Error("Missing tight lines");
      const lineGap = Math.max(0, oldLast.y - oldFirst.y - oldFirst.height);
      // At every display rotation, the final extra leading is half, not a full row.
      expect(last.height - oldLast.height).toBeGreaterThan(0);
      expect(last.height - oldLast.height).toBeLessThanOrEqual(lineGap / 2 + 0.000001);
      const normalStart = source.glyphs.find((glyph) => glyph.text === "N")?.rect;
      if (!normalStart) throw new Error("Missing normal line");
      expect(last.y + last.height).toBeLessThan(axes(normalStart).y);
      const alongLine = (rect: { x: number; y: number; width: number; height: number }) =>
        source.vertical ? { x: rect.y, width: rect.height } : { x: rect.x, width: rect.width };
      expect(bands.map(alongLine)).toEqual(tight.map(alongLine));
    } finally {
      pdf.close();
      await loading.destroy();
    }
  });

  it.each([
    0, 90, 180, 270,
  ])("includes small punctuation in a continuous sentence highlight at rotation %i", (rotation) => {
    const sentence = '"Reading paper, e.g. it works..."';
    const pdf = new PdfiumGlyphDocument(api);
    try {
      pdf.open(fixture(rotation, false, sentence));
      const transform: [number, number, number, number, number, number] =
        rotation === 90
          ? [0, 1, 1, 0, 0, 0]
          : rotation === 180
            ? [-1, 0, 0, 1, 612, 0]
            : rotation === 270
              ? [0, -1, -1, 0, 792, 612]
              : [1, 0, 0, -1, 0, 792];
      const vertical = rotation % 180 !== 0;
      const source = pdf.page(0, {
        width: vertical ? 792 : 612,
        height: vertical ? 612 : 792,
        transform,
      });
      const full = source.glyphs.map((glyph) => glyph.text).join("");
      const start = full.indexOf(sentence);
      expect(start).toBeGreaterThanOrEqual(0);
      const selected = source.glyphs.slice(start, start + sentence.length);
      const bounds = pdfRectUnion(selected.flatMap((glyph) => (glyph.rect ? [glyph.rect] : [])));
      if (!bounds) throw new Error("Missing fixture bounds");
      const marks = tightPdfTextSelection(source, [
        { text: sentence, start: 0, end: sentence.length, bounds },
      ]);
      expect(marks).toHaveLength(1);
      expect(marks[0]).toEqual(bounds);
      const dot = selected.find((glyph) => glyph.text === ".")?.rect;
      expect(dot).toBeDefined();
      if (!dot) return;
      expect(vertical ? dot.width : dot.height).toBeLessThan(
        (vertical ? bounds.width : bounds.height) / 2.5,
      );
    } finally {
      pdf.close();
    }
  });

  it.each([
    0, 90, 180, 270,
  ])("aligns tight ink bounds with PDF.js at rotation %i and crop offsets", async (rotation) => {
    const bytes = fixture(rotation, true);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({ data: bytes.slice() });
    const glyphDocument = new PdfiumGlyphDocument(api);
    try {
      const pdf = await loading.promise;
      const pdfPage = await pdf.getPage(1);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = viewport.transform;
      glyphDocument.open(bytes);
      const page = glyphDocument.page(0, {
        width: viewport.width,
        height: viewport.height,
        transform: [a, b, c, d, e, f],
      });
      expect(page.glyphs.map((glyph) => glyph.text).join("")).toContain("Reading paper");
      const first = page.glyphs.find((glyph) => glyph.text === "R")?.rect;
      expect(first).toBeDefined();
      if (!first) return;
      const expected = viewport.convertToViewportPoint(72, 720);
      const [baselineX = 0, baselineY = 0] = expected;
      expect(Math.abs(first.x * page.width - baselineX)).toBeLessThan(17);
      expect(Math.abs(first.y * page.height - baselineY)).toBeLessThan(17);
      const inkHeight =
        rotation % 180 === 0 ? first.height * page.height : first.width * page.width;
      expect(inkHeight).toBeGreaterThan(7);
      expect(inkHeight).toBeLessThan(13); // 16pt font, but no full-height line padding.
      expect(
        page.glyphs.filter((glyph) => /^\s+$/u.test(glyph.text)).every((glyph) => !glyph.rect),
      ).toBe(true);
      const start = page.glyphs.findIndex((glyph) => glyph.text === "R");
      const hint = pdfRectUnion(
        page.glyphs.slice(start, start + 13).flatMap((glyph) => (glyph.rect ? [glyph.rect] : [])),
      );
      if (!hint) throw new Error("Missing text bounds");
      expect(
        tightPdfTextSelection(page, [{ text: "Reading paper", start: 0, end: 13, bounds: hint }]),
      ).toHaveLength(1);
      if (rotation === 0) {
        const loose = {
          x: 52 / page.width,
          y: 24 / page.height,
          width: 150 / page.width,
          height: 24 / page.height,
        };
        const selection = tightPdfTextSelection(page, [
          { text: "Reading paper   ", start: 0, end: 16, bounds: loose },
        ]);
        const ink = pdfRectUnion(selection);
        expect(ink?.height ?? 1).toBeLessThan(loose.height * 0.7);
        expect((ink?.width ?? 1) * page.width).toBeLessThan(110);
        expect(selection).toHaveLength(1);
      }
    } finally {
      glyphDocument.close();
      await loading.destroy();
    }
  });

  it("extracts embedded Japanese and Korean glyphs without a CDN/font request", async () => {
    const pdf = new PdfiumGlyphDocument(api);
    const bytes = new Uint8Array(
      readFileSync(new URL("./fixtures/cjk-fonts.pdf", import.meta.url)),
    );
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({ data: bytes.slice() });
    try {
      const original = await loading.promise;
      const viewport = (await original.getPage(1)).getViewport({ scale: 1 });
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = viewport.transform;
      pdf.open(bytes);
      const page = pdf.page(0, {
        width: viewport.width,
        height: viewport.height,
        transform: [a, b, c, d, e, f],
      });
      const text = page.glyphs.map((glyph) => glyph.text).join("");
      expect(text).toContain("日本語の研究");
      expect(text).toContain("한국어");
      expect(page.glyphs.filter((glyph) => glyph.rect).length).toBeGreaterThanOrEqual(11);
    } finally {
      pdf.close();
      await loading.destroy();
    }
  });

  it("rejects broken PDFs and invalid page indices, and permits safe reopen/close", () => {
    const pdf = new PdfiumGlyphDocument(api);
    expect(() => pdf.open(new Uint8Array())).toThrow("PDF_GEOMETRY_FAILED");
    expect(() => pdf.open(new TextEncoder().encode("not a pdf"))).toThrow("PDF_GEOMETRY_FAILED");
    pdf.open(fixture());
    expect(() =>
      pdf.page(-1, { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }),
    ).toThrow();
    pdf.open(fixture());
    pdf.close();
    pdf.close();
  });
});
