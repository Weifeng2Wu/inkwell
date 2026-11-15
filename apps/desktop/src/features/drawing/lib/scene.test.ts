import { describe, expect, it } from "vitest";
import { isDrawingFile, parseDrawing } from "./scene";

describe("Excalidraw documents", () => {
  const element = { id: "shape", type: "rectangle", x: 0, y: 0, width: 120, height: 80 };
  const scene = {
    type: "excalidraw",
    version: 2,
    elements: [element],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };

  it("opens empty files and preserves official scene data", () => {
    expect(parseDrawing("").elements).toEqual([]);
    expect(parseDrawing(JSON.stringify(scene))).toMatchObject({
      elements: [element],
      appState: scene.appState,
      files: {},
      scrollToContent: true,
    });
    expect(isDrawingFile("figures/Diagram.EXCALIDRAW")).toBe(true);
    expect(isDrawingFile("diagram.excalidraw.bak")).toBe(false);
  });

  it("rejects malformed scenes, duplicate ids and remote image payloads", () => {
    for (const invalid of [
      "{",
      "null",
      JSON.stringify({ ...scene, type: "other" }),
      JSON.stringify({ ...scene, elements: [element, element] }),
      JSON.stringify({ ...scene, elements: [{ ...element, x: "NaN" }] }),
      JSON.stringify({ ...scene, files: { image: { dataURL: "https://example.com/image.png" } } }),
      JSON.stringify({ ...scene, appState: [] }),
    ]) {
      expect(() => parseDrawing(invalid)).toThrow();
    }
  });
});
