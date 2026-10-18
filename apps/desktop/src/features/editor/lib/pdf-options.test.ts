import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { expect, it } from "vitest";
import { preparePdfAssets } from "../../../../../../scripts/prepare-pdf-assets.mjs";
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
    ]) {
      expect((await stat(join(directory, resource))).size).toBeGreaterThan(0);
    }
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      ...PDF_DOCUMENT_OPTIONS,
      data: new Uint8Array(await readFile(new URL("./fixtures/cjk-fonts.pdf", import.meta.url))),
      cMapUrl: join(directory, "cmaps").split(sep).join("/") + "/",
      standardFontDataUrl: join(directory, "standard_fonts").split(sep).join("/") + "/",
      wasmUrl: join(directory, "wasm").split(sep).join("/") + "/",
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
