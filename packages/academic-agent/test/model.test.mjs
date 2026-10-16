import assert from "node:assert/strict";
import { test } from "node:test";
import { PROTOCOLS, responseLanguagePrompt, validateModelConfig } from "../src/model.mjs";

test("validates response languages and supplies explicit language instructions", () => {
  for (const [answerLanguage, name] of [
    ["zh", "Chinese"],
    ["en", "English"],
    ["ko", "Korean"],
  ]) {
    const config = validateModelConfig({ protocol: "openai", model: "fixture", answerLanguage });
    assert.equal(config.answerLanguage, answerLanguage);
    assert.ok(responseLanguagePrompt(config.answerLanguage).includes(`Respond in ${name}.`));
  }
  assert.equal(validateModelConfig({ protocol: "openai", model: "fixture" }).answerLanguage, "zh");
  for (const answerLanguage of ["fr", "", 1, {}])
    assert.throws(() =>
      validateModelConfig({ protocol: "openai", model: "fixture", answerLanguage }),
    );
});

test("all three API protocols have working configuration mappings", () => {
  for (const protocol of Object.keys(PROTOCOLS)) {
    const config = validateModelConfig({
      protocol,
      model: "custom-model",
      apiKey: "dummy",
      personalPrompt: " reply briefly ",
    });
    assert.equal(config.baseUrl, PROTOCOLS[protocol].baseUrl);
    assert.equal(config.personalPrompt, "reply briefly");
  }
});

test("rejects unsafe endpoints, unsupported protocols, and malformed configuration", () => {
  for (const baseUrl of [
    "file:///etc/passwd",
    "http://example.com/v1",
    "https://user:secret@example.com",
    "https://example.com?key=secret",
  ]) {
    assert.throws(() => validateModelConfig({ protocol: "openai", model: "fixture", baseUrl }));
  }
  assert.throws(() => validateModelConfig({ protocol: "other", model: "fixture" }));
  assert.throws(() => validateModelConfig({ protocol: "openai", model: "" }));
  assert.equal(
    validateModelConfig({
      protocol: "openai",
      model: "local",
      baseUrl: "http://localhost:1234/v1/",
    }).baseUrl,
    "http://localhost:1234/v1",
  );
  assert.equal(validateModelConfig({ provider: "fixture", model: "fixture" }).protocol, "");
});
