import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutParser } from "../src/layout-parser.mjs";

const custom = {
  provider: "custom",
  language: "ch",
  forceOcr: false,
  baseUrl: "https://vision.example/v1",
  model: "vision",
  prompt: "Transcribe faithfully",
};
const mineru = { ...custom, provider: "mineru" };
const json = (value) => new Response(JSON.stringify(value));

test("custom parser accepts PNG, JPEG and WebP and sends only its own key", async () => {
  const calls = [];
  const result = await layoutParser(
    {
      type: "parse",
      config: custom,
      apiKey: "parser-only",
      images: [
        "data:image/png;base64,eA==",
        "data:image/jpeg;base64,eA==",
        "data:image/webp;base64,eA==",
      ],
    },
    {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return json({
          choices: [{ finish_reason: "stop", message: { content: "Parsed chart labels" } }],
        });
      },
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://vision.example/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer parser-only");
  assert.match(result.text, /\[Page 3\]/);
  assert.match(JSON.parse(calls[0].options.body).messages[0].content, /untrusted/);
});
test("parser failures, truncated output and invalid formats are not treated as successful vision", async () => {
  const request = {
    type: "parse",
    config: custom,
    apiKey: "parser-only",
    images: ["data:image/png;base64,eA=="],
  };
  await assert.rejects(
    layoutParser(request, { fetch: async () => new Response("bad", { status: 401 }) }),
    /401/,
  );
  await assert.rejects(
    layoutParser(request, {
      fetch: async () =>
        json({ choices: [{ finish_reason: "length", message: { content: "partial" } }] }),
    }),
    /truncated/,
  );
  await assert.rejects(
    layoutParser({ ...request, images: ["data:image/svg+xml;base64,eA=="] }),
    /Invalid rendered/,
  );
  await assert.rejects(
    layoutParser(request, { fetch: async () => json({ choices: [] }) }),
    /no text/,
  );
});
test("MinerU accepts images, uploads without Authorization and forwards language/OCR options", async () => {
  const calls = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await assert.rejects(
    layoutParser(
      {
        type: "parse",
        config: { ...mineru, language: "en", forceOcr: true },
        apiKey: "mineru-only",
        name: "figure.png",
        data: png.toString("base64"),
      },
      {
        fetch: async (url, options) => {
          calls.push({ url, options });
          if (calls.length === 1)
            return json({
              code: 0,
              data: {
                batch_id: "batch-1",
                file_urls: ["https://cdn-mineru.openxlab.org.cn/upload"],
              },
            });
          if (calls.length === 2) return new Response("");
          return json({ code: 0, data: { extract_result: [{ state: "failed" }] } });
        },
      },
    ),
    /parsing failed/,
  );
  const submitted = JSON.parse(calls[0].options.body);
  assert.equal(submitted.files[0].is_ocr, true);
  assert.equal(submitted.language, "en");
  assert.equal(calls[1].options.method, "PUT");
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[2].options.headers.Authorization, "Bearer mineru-only");
});
test("MinerU rejects malformed images and untrusted upload URLs before uploading", async () => {
  await assert.rejects(
    layoutParser({ type: "parse", config: mineru, apiKey: "key", name: "fake.png", data: "eA==" }),
    /Invalid document data/,
  );
  await assert.rejects(
    layoutParser(
      { type: "test", config: mineru, apiKey: "key" },
      {
        fetch: async () =>
          json({
            code: 0,
            data: { batch_id: "batch", file_urls: ["https://attacker.example/upload"] },
          }),
      },
    ),
    /Untrusted/,
  );
});
