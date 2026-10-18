import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("standalone API checks return independent results and failures without a chat session", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-api-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sdk = path.join(directory, "sdk.mjs");
  await writeFile(sdk, `export const ModelRuntime = { async create() { return {
    getModels: () => [], registerProvider() {}, async setRuntimeApiKey() {},
    getModel: (provider, id) => ({ provider, id }),
    async completeSimple(model) {
      await new Promise(resolve => setTimeout(resolve, 50));
      return model.id === "bad-model"
        ? { stopReason: "error", errorMessage: "Model HTTP 401" }
        : { stopReason: "stop", content: [{ type: "text", text: "OK" }] };
    }
  }; } };`);
  const preload = path.join(directory, "fetch.mjs");
  await writeFile(preload, `globalThis.fetch = async (url) => new Response(JSON.stringify(
    String(url).endsWith("/search") ? { results: [] } : { data: [{ id: "image-model" }] }
  ));`);
  function run(request) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", preload,
        fileURLToPath(new URL("../src/api-check.mjs", import.meta.url)), sdk, directory],
        { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => {
        try { resolve({ code, response: JSON.parse(stdout) }); }
        catch { reject(new Error(`Invalid response: ${stdout}\n${stderr}`)); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
  const config = { protocol: "openai", model: "bad-model", apiKey: "fixture-key" };
  const [model, images, search] = await Promise.all([
    run({ ...config, type: "test_connection" }),
    run({ ...config, type: "list_models" }),
    run({ type: "test_web_search", webSearchApiKey: "fixture-search-key" }),
  ]);
  assert.equal(model.code, 1);
  assert.match(model.response.error, /Model HTTP 401/);
  assert.deepEqual(images.response.result.models, ["image-model"]);
  assert.deepEqual(search.response, { ok: true, result: { ok: true } });
  const retry = await run({ ...config, type: "test_connection", model: "good-model" });
  assert.equal(retry.code, 0);
  assert.equal(retry.response.ok, true);
});
