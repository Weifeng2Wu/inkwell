import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const requireFromDesktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const pdfjsDirectory = dirname(requireFromDesktop.resolve("pdfjs-dist/package.json"));
const publicDirectory = fileURLToPath(new URL("../apps/desktop/public/pdfjs/", import.meta.url));
const geometryWorker = fileURLToPath(
  new URL("../apps/desktop/src/features/editor/lib/pdf-geometry-worker.ts", import.meta.url),
);

// Keep resources matched to the installed PDF.js version and available offline in Tauri.
export function preparePdfAssets(destination = publicDirectory) {
  mkdirSync(destination, { recursive: true });
  for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
    cpSync(join(pdfjsDirectory, directory), join(destination, directory), { recursive: true });
  }
  cpSync(join(pdfjsDirectory, "LICENSE"), join(destination, "LICENSE"));
  const pdfiumDirectory = dirname(requireFromDesktop.resolve("@embedpdf/pdfium"));
  const geometryDirectory = join(destination, "geometry");
  mkdirSync(geometryDirectory, { recursive: true });
  // The browser-only distribution never imports Node built-ins or a remote CDN.
  cpSync(join(pdfiumDirectory, "index.browser.js"), join(geometryDirectory, "pdfium.js"));
  cpSync(join(pdfiumDirectory, "pdfium.wasm"), join(geometryDirectory, "pdfium.wasm"));
  cpSync(join(pdfiumDirectory, "../LICENSE"), join(geometryDirectory, "LICENSE"));
  cpSync(join(pdfiumDirectory, "../LICENSE.pdfium"), join(geometryDirectory, "LICENSE.pdfium"));
  const { transpileModule, ModuleKind, ScriptTarget } = requireFromDesktop("typescript");
  const worker = transpileModule(readFileSync(geometryWorker, "utf8"), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText.replace(/from ["']@embedpdf\/pdfium["']/g, 'from "./pdfium.js"');
  writeFileSync(join(geometryDirectory, "worker.js"), worker);
}
