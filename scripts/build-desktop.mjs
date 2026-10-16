import path from "node:path";
import {
  prepareRuntime,
  root,
  run,
  runtimeTarget,
  validateTarget,
  withRuntimeBundleConfig,
} from "./desktop-runtime.mjs";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
validateTarget(args, runtimeTarget(process.platform, process.arch));
await prepareRuntime();
await withRuntimeBundleConfig((filename) =>
  run(
    "pnpm",
    ["exec", "tauri", "build", "--config", filename, ...args],
    path.join(root, "apps/desktop"),
  ),
);
