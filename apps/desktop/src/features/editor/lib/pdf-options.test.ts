import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { preparePdfAssets } from "../../../../../../scripts/prepare-pdf-assets.mjs";
import type { PdfPageGlyphs } from "./pdf-glyph-geometry";
import { PDF_DOCUMENT_OPTIONS } from "./pdf-options";

it("ships the CMaps needed to read embedded Japanese and Korean fonts offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inkwell-pdf-assets-"));
  try {
    preparePdfAssets(directory);
    for (const resource of [
      "cmaps/Adobe-Japan1-UCS2.bcmap",
      "cmaps/Adobe-Korea1-UCS2.bcmap",
      "standard_fonts/FoxitSerif.pfb",
      "wasm/openjpeg.wasm",
      "LICENSE",
      "geometry/worker.js",
      "geometry/pdfium.js",
      "geometry/pdfium.wasm",
      "geometry/LICENSE",
      "geometry/LICENSE.pdfium",
    ]) {
      expect((await stat(join(directory, resource))).size).toBeGreaterThan(0);
    }
    const worker = await readFile(join(directory, "geometry/worker.js"), "utf8");
    expect(worker).toContain('from "./pdfium.js"');
    expect(worker).toContain("FPDFText_GetCharBox");
    expect(worker).not.toContain("@embedpdf/pdfium");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      ...PDF_DOCUMENT_OPTIONS,
      data: new Uint8Array(await readFile(new URL("./fixtures/cjk-fonts.pdf", import.meta.url))),
      cMapUrl: `${join(directory, "cmaps").split(sep).join("/")}/`,
      standardFontDataUrl: `${join(directory, "standard_fonts").split(sep).join("/")}/`,
      wasmUrl: `${join(directory, "wasm").split(sep).join("/")}/`,
    });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const text = (await page.getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join("");
      expect(text).toContain("日本語の研究");
      expect(text).toContain("한국어");
      expect(text).toContain("연구");
    } finally {
      await task.destroy();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("runs the packaged browser PDFium module and local WASM through the actual worker protocol", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inkwell-pdf-worker-assets-"));
  let worker: Worker | undefined;
  try {
    preparePdfAssets(directory);
    // Supply only Web Worker messaging/file-fetch shims in Node. Import the
    // shipped browser distribution, not PDFium's Node-specific entrypoint.
    worker = new Worker(
      `
      const { parentPort } = require("node:worker_threads");
      const { readFile } = require("node:fs/promises");
      globalThis.self = { postMessage: (data) => parentPort.postMessage(data) };
      globalThis.fetch = async (url) => new Response(await readFile(url));
      import(${JSON.stringify(pathToFileURL(join(directory, "geometry/worker.js")).href)}).then(() => {
        parentPort.on("message", (data) => self.onmessage({ data }));
      }).catch((error) => { throw error; });
    `,
      { eval: true },
    );
    const request = (payload: object) =>
      new Promise<{ id: number; page?: PdfPageGlyphs; error?: string }>((resolve, reject) => {
        const onError = (error: Error) => {
          worker?.off("message", onMessage);
          reject(error);
        };
        const onMessage = (message: { id: number; page?: PdfPageGlyphs; error?: string }) => {
          worker?.off("error", onError);
          resolve(message);
        };
        worker?.once("error", onError);
        worker?.once("message", onMessage);
        worker?.postMessage(payload);
      });
    const opened = await request({
      id: 1,
      kind: "open",
      bytes: new Uint8Array(await readFile(new URL("./fixtures/cjk-fonts.pdf", import.meta.url))),
    });
    expect(opened).toEqual({ id: 1 });
    const result = await request({
      id: 2,
      kind: "page",
      page: 1,
      viewport: { width: 283.465, height: 141.732, transform: [1, 0, 0, -1, 0, 141.732] },
    });
    expect(result.error).toBeUndefined();
    expect(result.page?.glyphs.map((glyph) => glyph.text).join("")).toContain("日本語の研究");
    expect(result.page?.glyphs.filter((glyph) => glyph.rect).length).toBeGreaterThanOrEqual(11);
  } finally {
    await worker?.terminate();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
