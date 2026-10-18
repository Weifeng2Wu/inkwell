import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { listModels } from "../src/model.mjs";
import { resolveModelCapabilities } from "../src/model-capabilities.mjs";

const expected = (protocol, models) => ({
  models,
  capabilities: Object.fromEntries(
    models.map((model) => [model, resolveModelCapabilities({ protocol, model })]),
  ),
});

test("returns provider capabilities and exact catalog matches for the model picker", async (context) => {
  const baseUrl = await mockEndpoint(context, (_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        data: [
          { id: "reported", input_modalities: ["text", "image"], reasoning: true },
          { id: "listed" },
          { id: "unknown" },
        ],
      }),
    );
  });
  const result = await listModels({ protocol: "openai", baseUrl }, AbortSignal.timeout(5000), [
    { id: "listed", provider: "openai", input: ["text"], reasoning: false },
  ]);
  assert.deepEqual(result.capabilities.reported.vision, { supported: true, source: "provider" });
  assert.deepEqual(result.capabilities.reported.reasoning, { supported: true, source: "provider" });
  assert.deepEqual(result.capabilities.listed.vision, { supported: false, source: "catalog" });
  assert.deepEqual(result.capabilities.unknown.vision, { supported: null, source: "unknown" });
});

async function mockEndpoint(context, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("discovers models without a selected model, using protocol-specific authentication and pagination", async (context) => {
  const seen = [];
  const baseUrl = await mockEndpoint(context, (request, response) => {
    seen.push({ url: request.url, headers: request.headers });
    response.setHeader("Content-Type", "application/json");
    if (request.headers["x-goog-api-key"]) {
      response.end(
        JSON.stringify(
          request.url.includes("pageToken")
            ? {
                models: [
                  { name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] },
                ],
              }
            : {
                models: [
                  { name: "models/gemini-a" },
                  { name: "models/embedding", supportedGenerationMethods: ["embedContent"] },
                ],
                nextPageToken: "next page",
              },
        ),
      );
    } else if (request.headers["x-api-key"]) {
      response.end(
        JSON.stringify(
          request.url.includes("after_id")
            ? { data: [{ id: "claude-b" }], has_more: false }
            : { data: [{ id: "claude-a" }], has_more: true, last_id: "claude-a" },
        ),
      );
    } else
      response.end(
        JSON.stringify({ data: [{ id: "gpt-b" }, { id: "gpt-a" }, { id: "gpt-a" }, { id: 1 }] }),
      );
  });
  const signal = AbortSignal.timeout(5000);
  assert.deepEqual(
    await listModels({ protocol: "openai", baseUrl: `${baseUrl}/v1`, apiKey: "dummy" }, signal),
    expected("openai", ["gpt-a", "gpt-b"]),
  );
  assert.equal(seen[0].url, "/v1/models");
  assert.equal(seen[0].headers.authorization, "Bearer dummy");
  assert.deepEqual(
    await listModels({ protocol: "anthropic", baseUrl, apiKey: "dummy" }, signal),
    expected("anthropic", ["claude-a", "claude-b"]),
  );
  assert.equal(seen[1].url, "/v1/models");
  assert.equal(seen[1].headers["anthropic-version"], "2023-06-01");
  assert.equal(seen[2].url, "/v1/models?after_id=claude-a");
  assert.deepEqual(
    await listModels({ protocol: "gemini", baseUrl: `${baseUrl}/v1beta`, apiKey: "dummy" }, signal),
    expected("gemini", ["gemini-a", "gemini-b"]),
  );
  assert.equal(seen[3].url, "/v1beta/models");
  assert.equal(seen[4].url, "/v1beta/models?pageToken=next+page");
  assert.ok(seen.every((request) => !request.url.includes("dummy")));
});

test("rejects listing failures, redirects, malformed responses and excessive response sizes", async (context) => {
  let mode = "unauthorized";
  const baseUrl = await mockEndpoint(context, (_request, response) => {
    if (mode === "unauthorized") {
      response.writeHead(401);
      response.end("sensitive error details");
    } else if (mode === "redirect") {
      response.writeHead(302, { Location: `${baseUrl}/elsewhere` });
      response.end();
    } else if (mode === "oversized") response.end("x".repeat(1_048_577));
    else if (mode === "invalid") response.end('{"error":"bad"}');
    else response.end('{"data":[],"has_more":true,"last_id":"repeat"}');
  });
  const config = { protocol: "openai", baseUrl, apiKey: "dummy" };
  const signal = AbortSignal.timeout(5000);
  await assert.rejects(listModels(config, signal), /HTTP 401/);
  mode = "redirect";
  await assert.rejects(listModels(config, signal));
  mode = "oversized";
  await assert.rejects(listModels(config, signal), /too large/);
  mode = "invalid";
  await assert.rejects(listModels(config, signal), /Invalid model listing/);
  mode = "repeat";
  await assert.rejects(listModels({ ...config, protocol: "anthropic" }, signal), /pagination/);
  await assert.rejects(listModels({ ...config, baseUrl: "file:///tmp" }, signal));
  await assert.rejects(listModels(config, AbortSignal.abort()));
});
