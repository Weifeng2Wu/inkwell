import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PdfiumGlyphDocument } from "./pdf-geometry-worker";
import {
  type PdfPageGlyphs,
  type PdfTextRunSelection,
  pdfGlyphLines,
  pdfRectUnion,
  tightPdfTextSelection,
} from "./pdf-glyph-geometry";
import type { PdfAnnotationRect } from "./pdf-notes";
import { pdfTypographyFixture } from "./pdf-typography-fixture";

type FixtureOptions = NonNullable<Parameters<typeof pdfTypographyFixture>[0]>;
type TypographyCase = { name: string; options: FixtureOptions; local: boolean };
const variants: TypographyCase[] = [
  { name: "superscript then parentheses", options: {}, local: true },
  { name: "multi-digit superscript", options: { script: "12" }, local: true },
  { name: "three-digit superscript", options: { script: "123" }, local: true },
  {
    name: "high small superscript",
    options: { script: "123", scriptSize: 6, rise: 10 },
    local: true,
  },
  { name: "short body and three digits", options: { body: "i", script: "123" }, local: true },
  { name: "subscript then parentheses", options: { script: "2", rise: -5 }, local: true },
  {
    name: "multi-digit subscript",
    options: { script: "12", rise: -5, after: "[paper]." },
    local: true,
  },
  { name: "square brackets", options: { after: "[paper]." }, local: true },
  { name: "braces", options: { after: "{paper}." }, local: true },
  { name: "dagger citation", options: { script: "†" }, local: true },
  { name: "double dagger citation", options: { script: "‡" }, local: true },
  { name: "star citation", options: { script: "*" }, local: true },
  { name: "different-font superscript", options: { script: "12", scriptFont: "F2" }, local: true },
  {
    name: "small italic on body baseline",
    options: { script: "x", scriptSize: 10, rise: 0, scriptFont: "F4" },
    local: false,
  },
  {
    name: "native superscript two",
    options: { script: "²", scriptSize: 16, rise: 0 },
    local: false,
  },
  {
    name: "native superscript three",
    options: { script: "³", scriptSize: 16, rise: 0, after: "[paper]." },
    local: false,
  },
  { name: "superscript then letters", options: { after: "paper." }, local: true },
  { name: "superscript then colon", options: { after: ": paper." }, local: true },
  { name: "superscript then comma", options: { after: ", paper." }, local: true },
  {
    name: "large inline math on body baseline",
    options: { script: "(y)", scriptSize: 22, rise: 0, scriptFont: "F2" },
    local: true,
  },
];
const permutations = variants.flatMap((variant) =>
  [0, 90, 180, 270].flatMap((rotation) =>
    [false, true].map((crop) => ({ ...variant, rotation, crop })),
  ),
);

let api: WrappedPdfiumModule;
beforeAll(async () => {
  const directory = dirname(createRequire(import.meta.url).resolve("@embedpdf/pdfium"));
  api = await init({ wasmBinary: new Uint8Array(readFileSync(join(directory, "pdfium.wasm"))) });
  api.FPDF_InitLibrary();
});
afterAll(() => api?.FPDF_DestroyLibrary());

function readingAxes(page: PdfPageGlyphs, rect: PdfAnnotationRect): PdfAnnotationRect {
  const axes = page.vertical
    ? { x: rect.y, y: rect.x, width: rect.height, height: rect.width }
    : { ...rect };
  if (page.reverseLines) axes.y = 1 - axes.y - axes.height;
  return axes;
}

function crossOrigin(page: PdfPageGlyphs, origin: { x: number; y: number }) {
  const cross = page.vertical ? origin.x : origin.y;
  return page.reverseLines ? 1 - cross : cross;
}

function expectRect(actual: PdfAnnotationRect, expected: PdfAnnotationRect) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.width).toBeCloseTo(expected.width, 9);
  expect(actual.height).toBeCloseTo(expected.height, 9);
}

function sameRect(actual: PdfAnnotationRect, expected: PdfAnnotationRect) {
  return (["x", "y", "width", "height"] as const).every(
    (key) => Math.abs(actual[key] - expected[key]) < 0.00000001,
  );
}

type Source = {
  page: PdfPageGlyphs;
  selections: PdfTextRunSelection[];
  prefixIds: number[];
  afterIds: number[];
  scriptIds: number[];
};

async function withSource(options: FixtureOptions, check: (source: Source) => void) {
  const bytes = pdfTypographyFixture(options);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const directory = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const loading = getDocument({
    data: bytes.slice(),
    standardFontDataUrl: `${join(directory, "standard_fonts")}/`,
  });
  const engine = new PdfiumGlyphDocument(api);
  try {
    const original = await loading.promise;
    const pdfPage = await original.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const content = await pdfPage.getTextContent();
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = viewport.transform;
    engine.open(bytes);
    const page = engine.page(0, {
      width: viewport.width,
      height: viewport.height,
      transform: [a, b, c, d, e, f],
    });
    const selections = content.items.flatMap((item): PdfTextRunSelection[] => {
      if (!("str" in item) || !item.str.trim()) return [];
      if (item.str === (options.heading ?? "Heading") || item.str === "Normal text below.")
        return [];
      const [x = 0, y = 0] = item.transform.slice(4);
      const points = [
        [x, y],
        [x + item.width, y],
        [x, y + item.height],
        [x + item.width, y + item.height],
      ].map(([px = 0, py = 0]) => viewport.convertToViewportPoint(px, py));
      const left = Math.min(...points.map(([px = 0]) => px)) / viewport.width;
      const right = Math.max(...points.map(([px = 0]) => px)) / viewport.width;
      const top = Math.min(...points.map(([, py = 0]) => py)) / viewport.height;
      const bottom = Math.max(...points.map(([, py = 0]) => py)) / viewport.height;
      return [
        {
          text: item.str,
          start: 0,
          end: item.str.length,
          bounds: { x: left, y: top, width: right - left, height: bottom - top },
        },
      ];
    });
    const [bodyX = 0, bodyY = 0] = viewport.convertToViewportPoint(72, 720);
    const expectedOrigin = { x: bodyX / viewport.width, y: bodyY / viewport.height };
    const prefixStart = page.glyphs.findIndex(
      (glyph) =>
        glyph.origin &&
        Math.abs(glyph.origin.x - expectedOrigin.x) < 0.000001 &&
        Math.abs(glyph.origin.y - expectedOrigin.y) < 0.000001 &&
        glyph.text === (options.body ?? "Body")[0],
    );
    const body = page.glyphs[prefixStart];
    if (!body?.origin) throw new Error("Missing body origin");
    const prefixIds = Array.from(
      { length: (options.body ?? "Body").length },
      (_, offset) => prefixStart + offset,
    );
    const baseline = crossOrigin(page, body.origin);
    const crossSize = page.vertical ? page.width : page.height;
    const scriptBaseline = baseline - (options.rise ?? 7) / crossSize;
    const scriptText = options.script ?? "1";
    const scriptIds = page.glyphs.flatMap((glyph, id) =>
      glyph.rect &&
      glyph.origin &&
      Math.abs(crossOrigin(page, glyph.origin) - scriptBaseline) < 0.000001 &&
      glyph.fontSize === (options.scriptSize ?? 8) &&
      scriptText.includes(glyph.text)
        ? [id]
        : [],
    );
    expect(scriptIds).toHaveLength(scriptText.length);
    const afterIds = page.glyphs.flatMap((glyph, id) =>
      glyph.rect &&
      glyph.origin &&
      Math.abs(crossOrigin(page, glyph.origin) - baseline) < 0.000001 &&
      glyph.fontSize === (options.bodySize ?? 16) &&
      !prefixIds.includes(id) &&
      !scriptIds.includes(id)
        ? [id]
        : [],
    );
    check({ page, selections, prefixIds, afterIds, scriptIds });
  } finally {
    engine.close();
    await loading.destroy();
  }
}

function glyphUnion(page: PdfPageGlyphs, ids: number[]) {
  const rect = pdfRectUnion(
    ids.flatMap((id) => {
      const bounds = page.glyphs[id]?.rect;
      return bounds ? [bounds] : [];
    }),
  );
  if (!rect) throw new Error("Missing expected glyph bounds");
  return rect;
}

function selectText(selections: PdfTextRunSelection[], text: string): PdfTextRunSelection {
  const run = selections.find((selection) => selection.text.includes(text));
  if (!run) throw new Error(`Missing PDF.js context for ${text}`);
  const start = run.text.indexOf(text);
  return { ...run, start, end: start + text.length };
}

describe("real PDF typography line ownership", () => {
  it.each(
    permutations,
  )("keeps $name local to one physical row at $rotation degrees (crop $crop)", async ({
    options,
    local,
    rotation,
    crop,
  }) => {
    await withSource(
      { ...options, rotation, crop },
      ({ page, selections, prefixIds, afterIds, scriptIds }) => {
        const lines = pdfGlyphLines(page);
        expect(lines).toHaveLength(3); // Heading, body-with-script, normal text.
        const firstId = prefixIds[0];
        if (firstId === undefined) throw new Error("Missing selected body");
        const bodyLine = lines.find((line) => line.glyphs.includes(firstId));
        if (!bodyLine) throw new Error("Missing physical body row");
        expect(new Set(bodyLine.glyphs)).toEqual(
          new Set([...prefixIds, ...afterIds, ...scriptIds]),
        );
        expect(new Set(bodyLine.localGlyphs)).toEqual(new Set(local ? scriptIds : []));
        expect(bodyLine.fontSize).toBe(options.bodySize ?? 16);
        expect(bodyLine.fontKey).toBe(page.glyphs[firstId]?.fontKey);
        const primaryIds = [...prefixIds, ...afterIds, ...(local ? [] : scriptIds)];
        const primary = glyphUnion(page, primaryIds);
        expectRect(bodyLine.rect, primary);
        const tight = tightPdfTextSelection(page, selections);
        const main = tight.filter((rect) => sameRect(rect, primary));
        expect(main).toHaveLength(1);
        const mainRect = main[0];
        if (!mainRect) throw new Error("Missing continuous main text band");
        expectRect(mainRect, primary);
        if (local) {
          const extras = tight.filter((rect) => !sameRect(rect, primary));
          expect(extras.length).toBeGreaterThan(0);
          const script = glyphUnion(page, scriptIds);
          const localUnion = pdfRectUnion(extras);
          if (!localUnion) throw new Error("Missing local script ink");
          expectRect(localUnion, script);
          const mainAxes = readingAxes(page, mainRect);
          const scriptAxes = readingAxes(page, script);
          // The body connects UNDER a selected script without extending its
          // normal ink height across the whole passage or into side whitespace.
          expect(mainAxes.x).toBeLessThan(scriptAxes.x);
          expect(mainAxes.x + mainAxes.width).toBeGreaterThan(scriptAxes.x + scriptAxes.width);
          expect(
            scriptAxes.y < mainAxes.y ||
              scriptAxes.y + scriptAxes.height > mainAxes.y + mainAxes.height,
          ).toBe(true);
        } else expect(tight).toHaveLength(1);
      },
    );
  });

  it.each(
    [0, 90, 180, 270].flatMap((rotation) => [false, true].map((crop) => ({ rotation, crop }))),
  )("never adds an unselected script or bracket at $rotation degrees (crop $crop)", async ({
    rotation,
    crop,
  }) => {
    await withSource({ rotation, crop }, ({ page, selections, prefixIds, afterIds, scriptIds }) => {
      const prefix = selectText(selections, "Body");
      const after = selectText(selections, "(paper).");
      const omittedScript = tightPdfTextSelection(page, [prefix, after]);
      expect(omittedScript).toHaveLength(2);
      const prefixRect = glyphUnion(page, prefixIds);
      const afterRect = glyphUnion(page, afterIds);
      expect(omittedScript.filter((rect) => sameRect(rect, prefixRect))).toHaveLength(1);
      expect(omittedScript.filter((rect) => sameRect(rect, afterRect))).toHaveLength(1);
      const script = selectText(selections, "1");
      const scriptOnly = tightPdfTextSelection(page, [script]);
      expect(scriptOnly).toHaveLength(1);
      const scriptRect = scriptOnly[0];
      if (!scriptRect) throw new Error("Missing standalone script");
      expectRect(scriptRect, glyphUnion(page, scriptIds));
      const paper = selectText(selections, "paper");
      const selectedWord = tightPdfTextSelection(page, [paper]);
      expect(selectedWord).toHaveLength(1);
      const wordIds = afterIds.filter((id) => /[\p{L}\p{N}]/u.test(page.glyphs[id]?.text ?? ""));
      const word = selectedWord[0];
      if (!word) throw new Error("Missing selected word");
      expectRect(word, glyphUnion(page, wordIds));
      const wordAxes = readingAxes(page, word);
      const wholeAfter = readingAxes(page, afterRect);
      expect(wordAxes.x).toBeGreaterThan(wholeAfter.x);
      expect(wordAxes.x + wordAxes.width).toBeLessThan(wholeAfter.x + wholeAfter.width);
    });
  });
});
