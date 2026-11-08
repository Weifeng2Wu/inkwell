import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import {
  splitTranslationText,
  tencentHeaders,
  translate,
  translationEndpoint,
  validatedEndpoint,
} from "../src/translation.mjs";

const config = {
  provider: "google",
  source: "en",
  target: "zh-CN",
  baseUrl: "https://translation.googleapis.com",
  model: "",
  region: "",
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const request = (patch = {}) => ({ config, text: "Hello", key: "test-only-key", ...patch });

test("optional Google Cloud uses the official v2 endpoint and an API key header", async () => {
  assert.equal(
    await translate(request(), {
      fetch: async (url, options) => {
        assert.equal(url, "https://translation.googleapis.com/language/translate/v2");
        assert.equal(options.headers["X-Goog-Api-Key"], "test-only-key");
        assert.equal(options.redirect, "error");
        assert.deepEqual(JSON.parse(options.body), {
          q: "Hello",
          source: "en",
          target: "zh-CN",
          format: "text",
        });
        return json({ data: { translations: [{ translatedText: "A &amp; B &#39; C" }] } });
      },
    }),
    "A & B ' C",
  );
});
test("rejects missing BYOK credentials before the network", async () => {
  for (const provider of ["google", "azure", "deepl", "tencent"]) {
    await assert.rejects(
      translate(request({ config: { ...config, provider }, key: undefined }), {
        fetch: () => {
          throw new Error("should not fetch");
        },
      }),
      /TRANSLATION_KEY/,
    );
  }
});
test("retired and invalid providers are not silently routed to any service", async () => {
  for (const provider of ["retired-provider", "unsupported"])
    await assert.rejects(
      translate(request({ config: { ...config, provider } })),
      /TRANSLATION_CONFIG/,
    );
});
test("splits UTF-8 safely and preserves every source character", () => {
  for (const text of [
    "中文😀".repeat(300),
    "An academic sentence. ".repeat(100),
    "x".repeat(1000),
    "a\n".repeat(700),
  ]) {
    const chunks = splitTranslationText(text);
    assert.equal(chunks.join(""), text);
    assert(chunks.length > 1);
    for (const chunk of chunks) {
      assert(Buffer.byteLength(chunk) <= 500);
      assert(!chunk.includes("�"));
    }
  }
});
test("Google web interface is keyless and decodes all returned segments", async () => {
  const web = {
    ...config,
    provider: "google-free",
    baseUrl: "https://translate.googleapis.com/translate_a/single",
  };
  assert.equal(
    await translate(request({ config: web, key: undefined }), {
      fetch: async (url, options) => {
        const parsed = new URL(url);
        assert.equal(parsed.searchParams.get("client"), "gtx");
        assert.equal(parsed.searchParams.get("q"), "Hello");
        assert.equal(parsed.searchParams.get("key"), null);
        assert.equal(options.headers, undefined);
        return json([
          [
            ["你好", "Hello"],
            ["，世界", "world"],
          ],
        ]);
      },
    }),
    "你好，世界",
  );
});
test("keyless Transmart sends no browser cookies or borrowed browser credentials", async () => {
  const web = { ...config, provider: "transmart", baseUrl: "https://transmart.qq.com/api/imt" };
  assert.equal(
    await translate(request({ config: web, key: undefined }), {
      fetch: async (url, options) => {
        assert.equal(url, web.baseUrl);
        assert.equal(options.headers.Cookie, undefined);
        assert.equal(options.headers.Referer, "https://transmart.qq.com/zh-CN/index");
        assert.equal(options.headers.Authorization, undefined);
        const body = JSON.parse(options.body);
        assert.equal(body.header.fn, "auto_translation");
        assert.match(body.header.client_key, /^inkwell-/);
        assert.deepEqual(body.source, { lang: "en", text_list: ["Hello"] });
        assert.deepEqual(body.target, { lang: "zh" });
        return json({ auto_translation: ["", "你好", ""] });
      },
    }),
    "你好",
  );
});
test("Volcano web sends plain translation text without challenge bypass parameters", async () => {
  const web = {
    ...config,
    provider: "volcano",
    baseUrl: "https://translate.example/crx/translate/v1",
  };
  assert.equal(
    await translate(request({ config: web, key: undefined }), {
      fetch: async (url, options) => {
        assert.equal(url, web.baseUrl);
        const body = JSON.parse(options.body);
        assert.equal(body.text, "Hello");
        assert.equal(body.target_language, "zh");
        assert.equal(options.headers.Cookie, undefined);
        return json({ translation: "你好" });
      },
    }),
    "你好",
  );
});
test("web channels require explicit compatible endpoints rather than invented defaults", async () => {
  for (const provider of ["volcano", "deepl-web"]) {
    await assert.rejects(
      translate(request({ config: { ...config, provider, baseUrl: "" }, key: undefined })),
      /TRANSLATION_ENDPOINT/,
    );
    assert.throws(
      () => validatedEndpoint({ provider, baseUrl: "https://translate.example/wrong-protocol" }),
      /TRANSLATION_CONFIG/,
    );
  }
});
test("DeepL web is a keyless JSON-RPC adapter, not standard DeepLX", async () => {
  const web = { ...config, provider: "deepl-web", baseUrl: "https://translate.example/jsonrpc" };
  assert.equal(
    await translate(request({ config: web, key: undefined }), {
      timestamp: 1700000000000,
      fetch: async (url, options) => {
        assert.equal(url, web.baseUrl);
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.headers.Cookie, undefined);
        assert.equal(options.redirect, "error");
        const body = JSON.parse(options.body);
        assert.equal(body.method, "LMT_handle_texts");
        assert.equal(body.jsonrpc, "2.0");
        assert.equal(body.params.texts[0].text, "Hello");
        assert.deepEqual(body.params.lang, { source_lang_user_selected: "EN", target_lang: "ZH" });
        return json({ result: { texts: [{ text: "你好" }] } });
      },
    }),
    "你好",
  );
});
test("both Google keyless hosts use the same protocol without a key or fallback", async () => {
  for (const baseUrl of [
    "https://translate.googleapis.com/translate_a/single",
    "https://translate.google.com/translate_a/single",
  ]) {
    let calls = 0;
    const web = { ...config, provider: "google-free", baseUrl };
    assert.equal(
      await translate(request({ config: web, key: undefined }), {
        fetch: async (url, options) => {
          calls++;
          const parsed = new URL(url);
          assert.equal(`${parsed.origin}${parsed.pathname}`, baseUrl);
          assert.equal(parsed.searchParams.get("key"), null);
          assert.equal(options.headers?.Authorization, undefined);
          return json([[["你好"]]]);
        },
      }),
      "你好",
    );
    assert.equal(calls, 1);
  }
});
test("DeepLX uses the user's local /translate URL and splits anonymous excerpts", async () => {
  const local = { ...config, provider: "deeplx", baseUrl: "http://127.0.0.1:1188/translate" };
  let calls = 0;
  assert.equal(
    await translate(request({ config: local, key: undefined, text: "x".repeat(2500) }), {
      fetch: async (url, options) => {
        calls++;
        assert.equal(url, local.baseUrl);
        assert.equal(options.headers.Authorization, undefined);
        const body = JSON.parse(options.body);
        assert(body.text.length <= 1500);
        assert.equal(body.source_lang, "EN");
        assert.equal(body.target_lang, "ZH");
        return json({ code: 200, data: "译文" });
      },
    }),
    "译文\n译文",
  );
  assert.equal(calls, 2);
});
test("DeepL Free and Pro use official hosts and DeepL-Auth-Key", async () => {
  for (const baseUrl of ["https://api-free.deepl.com", "https://api.deepl.com"]) {
    assert.equal(
      await translate(request({ config: { ...config, provider: "deepl", baseUrl } }), {
        fetch: async (url, options) => {
          assert.equal(url, `${baseUrl}/v2/translate`);
          assert.equal(options.headers.Authorization, "DeepL-Auth-Key test-only-key");
          assert.deepEqual(JSON.parse(options.body), {
            text: ["Hello"],
            source_lang: "EN",
            target_lang: "ZH-HANS",
          });
          return json({ translations: [{ text: "你好" }] });
        },
      }),
      "你好",
    );
  }
});
test("Azure uses v3, the user's region, and separate subscription key headers", async () => {
  const azure = {
    ...config,
    provider: "azure",
    baseUrl: "https://api.cognitive.microsofttranslator.com",
    region: "eastasia",
  };
  assert.equal(
    await translate(request({ config: azure }), {
      fetch: async (url, options) => {
        const parsed = new URL(url);
        assert.equal(parsed.searchParams.get("api-version"), "3.0");
        assert.equal(parsed.searchParams.get("to"), "zh-Hans");
        assert.equal(options.headers["Ocp-Apim-Subscription-Key"], "test-only-key");
        assert.equal(options.headers["Ocp-Apim-Subscription-Region"], "eastasia");
        assert.deepEqual(JSON.parse(options.body), [{ Text: "Hello" }]);
        return json([{ translations: [{ text: "你好" }] }]);
      },
    }),
    "你好",
  );
});
test("LLM uses the selected endpoint/model and treats text as untrusted", async () => {
  const llm = {
    ...config,
    provider: "llm",
    baseUrl: "https://models.example/v1/",
    model: "research-translator",
  };
  assert.equal(
    await translate(request({ config: llm }), {
      fetch: async (url, options) => {
        assert.equal(url, "https://models.example/v1/chat/completions");
        assert.equal(options.headers.Authorization, "Bearer test-only-key");
        const body = JSON.parse(options.body);
        assert.equal(body.model, "research-translator");
        assert.equal(body.messages.length, 2);
        assert.match(body.messages[0].content, /untrusted text/);
        assert.equal(body.messages[1].content, "Hello");
        return json({ choices: [{ message: { content: "译文" }, finish_reason: "stop" }] });
      },
    }),
    "译文",
  );
});
test("keyless local LLM works without inventing a credential", async () => {
  const llm = {
    ...config,
    provider: "llm",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "local-translator",
  };
  await translate(request({ config: llm, key: undefined }), {
    fetch: async (_url, options) => {
      assert.equal(options.headers.Authorization, undefined);
      return json({ choices: [{ message: { content: "译文" } }] });
    },
  });
});
test("restricts secret-bearing URLs and prevents substituting fixed cloud/web hosts", () => {
  for (const baseUrl of [
    "file:///tmp/data",
    "http://remote.example/v1",
    "https://user:secret@example.com",
    "https://example.com?key=secret",
    "https://example.com/#fragment",
  ]) {
    assert.throws(() => translationEndpoint({ baseUrl }));
  }
  for (const provider of [
    "google",
    "google-free",
    "deepl",
    "azure",
    "transmart",
    "volcano",
    "deepl-web",
  ])
    assert.throws(
      () => validatedEndpoint({ provider, baseUrl: "https://evil.example" }),
      /TRANSLATION_CONFIG/,
    );
});
test("rate limits do not leak gateway bodies or trigger fallback", async () => {
  let calls = 0;
  await assert.rejects(
    translate(request(), {
      fetch: async () => {
        calls++;
        return json({ secret: "DO-NOT-ECHO" }, 429);
      },
    }),
    /^Error: TRANSLATION_HTTP 429$/,
  );
  assert.equal(calls, 1);
});
test("TC3 signature agrees with an independent canonical request derivation", () => {
  const payload = JSON.stringify({ SourceText: "Hello", Source: "en", Target: "zh", ProjectId: 0 });
  const timestamp = 1700000000;
  const headers = tencentHeaders(
    payload,
    "test-only-id",
    "test-only-secret",
    "ap-guangzhou",
    timestamp,
  );
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const mac = (key, value) => createHmac("sha256", key).update(value).digest();
  const date = "2023-11-14";
  const signedHeaders = "content-type;host;x-tc-action";
  const canonical = [
    "POST",
    "/",
    "",
    "content-type:application/json; charset=utf-8\nhost:tmt.tencentcloudapi.com\nx-tc-action:texttranslate\n",
    signedHeaders,
    digest(payload),
  ].join("\n");
  const signingKey = mac(mac(mac("TC3test-only-secret", date), "tmt"), "tc3_request");
  const signature = createHmac("sha256", signingKey)
    .update(["TC3-HMAC-SHA256", timestamp, `${date}/tmt/tc3_request`, digest(canonical)].join("\n"))
    .digest("hex");
  assert.equal(
    headers.Authorization,
    `TC3-HMAC-SHA256 Credential=test-only-id/${date}/tmt/tc3_request, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );
});
test("Tencent maps Chinese locales and handles API-level authentication errors", async () => {
  const tencent = {
    ...config,
    provider: "tencent",
    baseUrl: "https://tmt.tencentcloudapi.com",
    region: "ap-guangzhou",
  };
  const input = request({ config: tencent, secretId: "test-only-id" });
  assert.equal(
    await translate(input, {
      timestamp: 1700000000,
      fetch: async (_url, options) => {
        assert.equal(JSON.parse(options.body).Target, "zh");
        return json({ Response: { TargetText: "你好" } });
      },
    }),
    "你好",
  );
  await assert.rejects(
    translate(input, {
      fetch: async () =>
        json({
          Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: "DO-NOT-ECHO" } },
        }),
    }),
    /^Error: TRANSLATION_KEY$/,
  );
});
test("rejects oversized input/output, malformed output and truncated translations", async () => {
  await assert.rejects(translate(request({ text: "a".repeat(5001) })), /TRANSLATION_TOO_LONG/);
  await assert.rejects(
    translate(request(), { fetch: async () => new Response("x".repeat(1024 * 1024 + 1)) }),
    /TRANSLATION_RESPONSE/,
  );
  await assert.rejects(
    translate(request(), { fetch: async () => json({}) }),
    /TRANSLATION_RESPONSE/,
  );
  await assert.rejects(
    translate(
      request({
        config: { ...config, provider: "llm", baseUrl: "https://example.com/v1", model: "test" },
      }),
      {
        fetch: async () =>
          json({ choices: [{ finish_reason: "length", message: { content: "partial" } }] }),
      },
    ),
    /TRANSLATION_TRUNCATED/,
  );
});
test("rejects a service echoing the credential into translation output", async () => {
  await assert.rejects(
    translate(request(), {
      fetch: async () => json({ data: { translations: [{ translatedText: "test-only-key" }] } }),
    }),
    /TRANSLATION_RESPONSE/,
  );
});
test("CLI sanitizes arbitrary failures without exposing configuration or credentials", () => {
  const result = spawnSync(
    process.execPath,
    [new URL("../src/translation.mjs", import.meta.url).pathname],
    {
      input: JSON.stringify(
        request({
          config: { ...config, provider: "llm", baseUrl: "SECRET-URL", model: "test" },
          key: "SECRET-KEY",
        }),
      ),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "TRANSLATION_NETWORK");
  assert(!result.stdout.includes("SECRET"));
  assert(!result.stderr.includes("SECRET"));
});
