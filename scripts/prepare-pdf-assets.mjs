import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const requireFromDesktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const pdfjsDirectory = dirname(requireFromDesktop.resolve("pdfjs-dist/package.json"));
const publicDirectory = fileURLToPath(new URL("../apps/desktop/public/pdfjs/", import.meta.url));

// Keep resources matched to the installed PDF.js version and available offline in Tauri.
export function preparePdfAssets(destination = publicDirectory) {
  mkdirSync(destination, { recursive: true });
  for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
    cpSync(join(pdfjsDirectory, directory), join(destination, directory), { recursive: true });
  }
  cpSync(join(pdfjsDirectory, "LICENSE"), join(destination, "LICENSE"));
}
