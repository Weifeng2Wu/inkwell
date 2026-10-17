import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { posterPptx, posterSvg } from "./export";
import {
  createPoster,
  isPosterFile,
  POSTER_SIZES,
  POSTER_STYLES,
  parsePoster,
  resizePoster,
  restylePoster,
  serializePoster,
  textOverflows,
  validImageSource,
  wrapText,
} from "./model";

const require = createRequire(import.meta.url);
const JSZip = require(require.resolve("jszip", { paths: [require.resolve("pptxgenjs")] }));
describe("editable poster format", () => {
  it("opens only the dedicated suffix", () => {
    expect(isPosterFile("POSTER.poster.JSON")).toBe(true);
    expect(isPosterFile("paper.json")).toBe(false);
  });
  it("creates valid templates without overflow across all styles, sizes and orientations", () => {
    for (const style of Object.keys(POSTER_STYLES) as (keyof typeof POSTER_STYLES)[])
      for (const size of Object.keys(POSTER_SIZES) as (keyof typeof POSTER_SIZES)[])
        for (const landscape of [false, true]) {
          const p = createPoster(style, size, landscape);
          expect(parsePoster(serializePoster(p))).toEqual(p);
          expect(p.elements.filter(textOverflows)).toEqual([]);
        }
  });
  it("rejects duplicate IDs, invalid bounds, nonfinite values, unsafe images and unknown versions", () => {
    const p = createPoster();
    const first = p.elements[0];
    expect(() => parsePoster(JSON.stringify({ ...p, version: 2 }))).toThrow();
    expect(() => parsePoster(JSON.stringify({ ...p, style: "toString" }))).toThrow();
    expect(() => parsePoster(JSON.stringify({ ...p, elements: [first, first] }))).toThrow();
    expect(() =>
      parsePoster(JSON.stringify({ ...p, elements: [{ ...first, x: p.width }] })),
    ).toThrow();
    expect(() => parsePoster(JSON.stringify({ ...p, width: Infinity }))).toThrow();
    expect(validImageSource("https://host/figure.png")).toBe(false);
    expect(validImageSource("javascript:alert(1).png")).toBe(false);
    expect(validImageSource("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(validImageSource("../figures/plot.png")).toBe(true);
  });
  it("resizes geometry within bounds and remaps theme colors without changing content", () => {
    const p = createPoster();
    const resized = resizePoster(p, 1189, 841);
    expect(() => parsePoster(serializePoster(resized))).not.toThrow();
    const styled = restylePoster(p, "modern");
    expect(styled.background).toBe("#101c2c");
    expect(styled.elements.find((e) => e.id === "heading-0")?.color).toBe("#42d5c4");
    expect(styled.elements.map((e) => e.text)).toEqual(p.elements.map((e) => e.text));
  });
  it("wraps CJK, long tokens and explicit line breaks and detects overflow", () => {
    expect(wrapText("研究结果\nαβγδ", 16, 8)).toEqual(["研究", "结果", "αβ", "γδ"]);
    expect(wrapText("one two", 20, 8).length).toBe(2);
    expect(
      textOverflows({
        id: "long",
        type: "text",
        text: "abcd\nabcd",
        x: 0,
        y: 0,
        width: 100,
        height: 10,
        fontSize: 8,
      }),
    ).toBe(true);
  });
});
describe("editable exports", () => {
  it("exports SVG with real escaped text, shapes and physical page dimensions", () => {
    const p = createPoster();
    p.title = "Research <title>";
    p.elements.push({
      id: "unsafe",
      type: "text",
      text: '<script>&"',
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      fontSize: 8,
    });
    const svg = posterSvg(p);
    expect(svg).toContain('width="841mm" height="1189mm"');
    expect(svg).toContain("<text");
    expect(svg).toContain("&lt;script&gt;&amp;&quot;");
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("foreignObject");
  });
  it("writes independent PPTX text/shape objects with the correct physical slide size", async () => {
    const p = createPoster("minimal", "A1", true);
    p.elements.push({
      id: "figure",
      type: "image",
      x: 10,
      y: 10,
      width: 50,
      height: 30,
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      alt: "A figure",
    });
    const zip = await JSZip.loadAsync(await posterPptx(p));
    const xml = await zip.file("ppt/slides/slide1.xml").async("string");
    expect(xml).toContain("Your research title");
    expect(xml.match(/<p:sp>/g)?.length).toBe(p.elements.filter((e) => e.type !== "image").length);
    expect(xml.match(/<p:pic>/g)?.length).toBe(1);
    expect(
      Object.keys(zip.files).filter((p) => p.startsWith("ppt/media/") && !zip.files[p].dir),
    ).toHaveLength(1);
    const presentation = await zip.file("ppt/presentation.xml").async("string");
    expect(presentation).toContain(
      `cx="${Math.round(p.width * 36000)}" cy="${Math.round(p.height * 36000)}"`,
    );
  });
});
