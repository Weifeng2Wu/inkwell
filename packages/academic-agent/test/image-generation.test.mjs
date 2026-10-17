import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createImageGenerationTool } from "../src/image-generation.mjs";

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}/v1`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("image generation saves a project image and returns a typed image", async (context) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "inkwell-image-reference-"));
  context.after(() => rm(project, { recursive: true, force: true }));
  const pixel = Buffer.from("fake-png").toString("base64");
  await withServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/images/generations");
    assert.equal(request.headers.authorization, "Bearer image-secret");
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), {
      model: "poster-image-model",
      prompt: "Create an A0 layout reference.",
      n: 1,
      size: "1024x1536",
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ b64_json: pixel, mime_type: "image/png" }] }));
  }, async (baseUrl) => {
    let generated;
    const tool = createImageGenerationTool(
      { baseUrl, model: "poster-image-model" },
      "image-secret",
      project,
      (image) => { generated = image; },
    );
    const result = await tool.execute("call", { prompt: "Create an A0 layout reference." });
    assert.match(tool.description, /direct user request/);
    assert.match(tool.description, /displayed inline in chat/);
    assert.deepEqual(result.content[1], {
      type: "image",
      data: pixel,
      mimeType: "image/png",
    });
    assert.equal(generated.relativePath, "generated-images/image-01.png");
    assert.deepEqual(await readFile(path.join(project, generated.relativePath)), Buffer.from("fake-png"));
    assert.match(result.content[0].text, /generated-images\/image-01\.png/);
    await tool.execute("call-again", { prompt: "Create an A0 layout reference." });
    assert.equal(generated.relativePath, "generated-images/image-02.png");
  });
});

test("image generation is unavailable until both model and API key are configured", () => {
  assert.equal(createImageGenerationTool({ baseUrl: "https://images.example/v1", model: "" }, "key"), null);
  assert.equal(
    createImageGenerationTool({ baseUrl: "https://images.example/v1", model: "image" }, ""),
    null,
  );
});

test("poster references are returned to the model without saving or emitting a project image", async (context) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "inkwell-poster-reference-"));
  context.after(() => rm(project, { recursive: true, force: true }));
  const pixel = Buffer.from("fake-png").toString("base64");
  await withServer(async (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ b64_json: pixel, mime_type: "image/png" }] }));
  }, async (baseUrl) => {
    let generated = false;
    const tool = createImageGenerationTool(
      { baseUrl, model: "poster-image-model" },
      "image-secret",
      project,
      () => { generated = true; },
    );
    const result = await tool.execute("call", {
      prompt: "Create an A0 layout reference.",
      purpose: "poster_reference",
    });
    assert.match(tool.description, /not saved as a project image/);
    assert.deepEqual(result.content[1], {
      type: "image",
      data: pixel,
      mimeType: "image/png",
    });
    assert.match(result.content[0].text, /not saved as a project file/);
    assert.equal(generated, false);
    await assert.rejects(readFile(path.join(project, "generated-images")), { code: "ENOENT" });
  });
});

test("image generation rejects unsafe endpoints and malformed API output", async () => {
  assert.throws(
    () => createImageGenerationTool({ baseUrl: "http://images.example/v1", model: "image" }, "key"),
    /HTTPS/,
  );
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ b64_json: "not base64!" }] }));
  }, async (baseUrl) => {
    const tool = createImageGenerationTool({ baseUrl, model: "image" }, "key");
    await assert.rejects(tool.execute("call", { prompt: "reference" }), /invalid or oversized image data/i);
  });
});
