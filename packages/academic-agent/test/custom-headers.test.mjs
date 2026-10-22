import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCustomHeaders } from "../src/custom-headers.mjs";
import { listModels, resolveModel } from "../src/model.mjs";
import { createImageGenerationTool } from "../src/image-generation.mjs";
import { layoutParser } from "../src/layout-parser.mjs";
import { createWebSearchTool } from "../src/web-search.mjs";

const customHeaders = "CF-Access-Client-Id: client-id\nCF-Access-Client-Secret: client:secret";
function checkHeaders(options) {
  const headers = new Headers(options.headers);
  assert.equal(headers.get("cf-access-client-id"), "client-id");
  assert.equal(headers.get("cf-access-client-secret"), "client:secret");
  return headers;
}
const json = (value) => new Response(JSON.stringify(value));

test("WAF credentials accompany model discovery for every API protocol", async (context) => {
  context.mock.method(globalThis, "fetch", async (_url, options) => {
    checkHeaders(options);
    return json({ data: [{ id: "image-model" }], models: [{ name: "models/vision-model" }] });
  });
  for (const protocol of ["openai", "anthropic", "gemini"]) {
    const result = await listModels({ protocol, apiKey: "model-key", customHeaders });
    assert.equal(result.models.length, 1);
  }
});

test("chat runtime receives custom headers alongside existing model headers", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-header-model-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const sdk = {
    ModelRuntime: {
      create: async () => ({
        getModels: () => [],
        registerProvider() {},
        setRuntimeApiKey() {},
        getModel: () => ({ id: "chat", headers: { "X-Existing": "retained" } }),
      }),
    },
  };
  const { model } = await resolveModel(
    sdk,
    {
      protocol: "openai",
      model: "chat",
      apiKey: "key",
      customHeaders,
    },
    directory,
  );
  assert.equal(checkHeaders(model).get("x-existing"), "retained");
});

test("image generation authenticates through WAF and scopes image downloads to the API origin", async (context) => {
  for (const origin of ["https://images.example", "https://cdn.example"]) {
    let calls = 0;
    context.mock.method(globalThis, "fetch", async (_url, options) => {
      calls++;
      if (calls === 1) {
        assert.equal(checkHeaders(options).get("authorization"), "Bearer image-key");
        return json({ data: [{ url: `${origin}/image.png` }] });
      }
      const headers = new Headers(options.headers);
      if (origin === "https://images.example") checkHeaders(options);
      else assert.equal(headers.get("cf-access-client-secret"), null);
      assert.equal(headers.get("authorization"), null);
      return new Response("png-bytes", { headers: { "content-type": "image/png" } });
    });
    const tool = createImageGenerationTool(
      { baseUrl: "https://images.example/v1", model: "image", customHeaders },
      "image-key",
    );
    await tool.execute("test", { prompt: "draw", purpose: "poster_reference" });
    assert.equal(calls, 2);
    context.mock.restoreAll();
  }
});

test("parser connection tests, page parsing and search include their own WAF headers", async (context) => {
  const config = {
    provider: "custom",
    language: "ch",
    forceOcr: false,
    baseUrl: "https://vision.example/v1",
    model: "vision",
    prompt: "Transcribe",
    customHeaders,
  };
  const fetcher = async (_url, options) => {
    assert.equal(checkHeaders(options).get("authorization"), "Bearer parser-key");
    return json({ choices: [{ finish_reason: "stop", message: { content: "page content" } }] });
  };
  for (const type of ["test", "parse"]) {
    await layoutParser(
      { type, config, apiKey: "parser-key", images: ["data:image/png;base64,eA=="] },
      { fetch: fetcher },
    );
  }
  context.mock.method(globalThis, "fetch", async (_url, options) => {
    checkHeaders(options);
    assert.equal(JSON.parse(options.body).api_key, "search-key");
    return json({ results: [] });
  });
  await createWebSearchTool({ customHeaders }, "search-key").execute("test", { query: "test" });
});

test("malformed headers cannot inject extra HTTP header lines", () => {
  for (const value of [
    "missing colon",
    "Bad Header: value",
    "X-Key: value\rinjected",
    "X-Key: value\0",
    {},
  ]) {
    assert.throws(() => parseCustomHeaders(value), /custom header/i);
  }
  assert.equal(parseCustomHeaders("Authorization: Bearer custom").authorization, "Bearer custom");
});
