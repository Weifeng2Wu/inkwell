import test from "node:test";
import assert from "node:assert/strict";
import { createWebSearchTool } from "../src/web-search.mjs";

test("web search sends a bounded Tavily request and preserves sources", async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ results: [{ title: "Example", url: "https://example.com/a", content: "A summary", published_date: "2026-01-02" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const tool = createWebSearchTool({}, "secret-key");
    const output = await tool.execute("call", { query: "  current research  ", maxResults: 2 }, new AbortController().signal);
    const body = JSON.parse(request.options.body);
    assert.equal(request.url, "https://api.tavily.com/search");
    assert.equal(body.api_key, "secret-key");
    assert.equal(body.query, "current research");
    assert.equal(body.max_results, 2);
    assert.match(output.content[0].text, /https:\/\/example.com\/a/);
  } finally {
    globalThis.fetch = original;
  }
});

test("web search rejects unsafe endpoints, invalid queries and provider errors", async () => {
  assert.throws(() => createWebSearchTool({ baseUrl: "http://localhost" }, "key"), /HTTPS/);
  const tool = createWebSearchTool({}, "secret-key");
  await assert.rejects(() => tool.execute("call", { query: "" }, undefined), /1-1000/);
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("bad secret-key", { status: 401 });
  try {
    await assert.rejects(tool.execute("call", { query: "valid" }, undefined), (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /secret-key/);
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("web search distinguishes an empty search from an invalid or oversized response", async () => {
  const original = globalThis.fetch;
  const tool = createWebSearchTool({}, "secret-key");
  try {
    globalThis.fetch = async () => new Response('{"results":[]}');
    assert.deepEqual(JSON.parse((await tool.execute("test", { query: "test" })).content[0].text).results, []);
    globalThis.fetch = async () => new Response('{"error":"invalid key"}');
    await assert.rejects(tool.execute("test", { query: "test" }), /invalid search response/);
    globalThis.fetch = async () => new Response("x".repeat(1_000_001));
    await assert.rejects(tool.execute("test", { query: "test" }), /too large/);
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.redirect, "error");
      options.signal.throwIfAborted();
    };
    await assert.rejects(tool.execute("test", { query: "test" }, controller.signal), { name: "AbortError" });
  } finally {
    globalThis.fetch = original;
  }
});
