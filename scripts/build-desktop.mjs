import path from "node:path";
import { prepareRuntime, root, run, runtimeTarget, validateTarget } from "./desktop-runtime.mjs";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
validateTarget(args, runtimeTarget(process.platform, process.arch));
await prepareRuntime();
run(
  "pnpm",
  ["exec", "tauri", "build", "--config", "src-tauri/tauri.bundle.conf.json", ...args],
  path.join(root, "apps/desktop"),
);
