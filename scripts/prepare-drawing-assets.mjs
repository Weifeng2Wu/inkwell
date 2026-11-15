import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const requireFromDesktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));

export function prepareDrawingAssets(
  destination = fileURLToPath(new URL("../apps/desktop/public/excalidraw/", import.meta.url)),
) {
  const distribution = dirname(requireFromDesktop.resolve("@excalidraw/excalidraw"));
  mkdirSync(destination, { recursive: true });
  cpSync(join(distribution, "fonts"), join(destination, "fonts"), { recursive: true });
  cpSync(
    fileURLToPath(new URL("../assets/excalidraw/licenses/", import.meta.url)),
    join(destination, "licenses"),
    { recursive: true },
  );
}
