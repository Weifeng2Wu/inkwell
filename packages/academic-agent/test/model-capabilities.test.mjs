import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveModel } from "../src/model.mjs";
import {
  modelCapabilityScope,
  readCapabilityProfiles,
  resolveModelCapabilities,
} from "../src/model-capabilities.mjs";

const config = { protocol: "openai", baseUrl: "https://example.com/v1", model: "listed" };
const catalog = [{ id: "listed", provider: "openai", input: ["text", "image"], reasoning: true }];

test("matches exact catalog IDs and never guesses capabilities from names", () => {
  const known = resolveModelCapabilities(config, catalog);
  assert.deepEqual(known.vision, { supported: true, source: "catalog" });
  assert.deepEqual(known.reasoning, { supported: true, source: "catalog" });
  assert.deepEqual(known.web, { supported: false, source: "runtime" });
  const unknown = resolveModelCapabilities({ ...config, model: "listed-thinking-vision" }, catalog);
  assert.equal(unknown.vision.supported, null);
  assert.equal(unknown.reasoning.source, "unknown");
  const conflicting = [...catalog, { ...catalog[0], provider: "other", input: ["text"] }];
  assert.equal(
    resolveModelCapabilities({ ...config, protocol: "", provider: "gateway" }, conflicting).vision
      .supported,
    null,
  );
});

test("provider metadata takes precedence over catalog entries", () => {
  const result = resolveModelCapabilities(config, catalog, {
    architecture: { input_modalities: ["text"] },
    capabilities: { thinking: { supported: false } },
  });
  assert.deepEqual(result.vision, { supported: false, source: "provider" });
  assert.deepEqual(result.reasoning, { supported: false, source: "provider" });
  const configured = { ...config, modelCapabilities: { [modelCapabilityScope(config)]: result } };
  assert.deepEqual(resolveModelCapabilities(configured, catalog).vision, result.vision);
});

test("manual declarations win and are scoped to protocol, endpoint and model", () => {
  const profile = resolveModelCapabilities(config);
  profile.vision = { supported: true, source: "manual" };
  profile.reasoning = { supported: false, source: "manual" };
  const declared = { ...config, modelCapabilities: { [modelCapabilityScope(config)]: profile } };
  assert.equal(
    resolveModelCapabilities(declared, catalog, { input: ["text"] }).vision.supported,
    true,
  );
  assert.equal(resolveModelCapabilities(declared, catalog).reasoning.supported, false);
  assert.equal(
    resolveModelCapabilities({ ...declared, baseUrl: "https://another.example/v1" }).vision
      .supported,
    null,
  );
  assert.equal(
    resolveModelCapabilities({ ...declared, model: "different" }).vision.supported,
    null,
  );
  assert.equal(
    modelCapabilityScope(config),
    modelCapabilityScope({ ...config, baseUrl: `${config.baseUrl}/` }),
  );
  assert.deepEqual(readCapabilityProfiles(declared.modelCapabilities), declared.modelCapabilities);
  assert.deepEqual(readCapabilityProfiles({ bad: { vision: true }, other: null }), {});
});

test("custom runtime model registration uses discovered and manual capabilities", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-capabilities-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  let registered;
  const runtime = {
    getModels: () => catalog,
    registerProvider: (_provider, definition) => {
      registered = definition.models[0];
    },
    getModel: () => registered,
  };
  const sdk = { ModelRuntime: { create: async () => runtime } };
  const known = await resolveModel(sdk, config, directory);
  assert.deepEqual(known.model.input, ["text", "image"]);
  assert.equal(known.model.reasoning, true);
  const unknown = { ...config, model: "unlisted" };
  const profile = resolveModelCapabilities(unknown);
  profile.vision = { supported: true, source: "manual" };
  const manual = await resolveModel(
    sdk,
    { ...unknown, modelCapabilities: { [modelCapabilityScope(unknown)]: profile } },
    directory,
  );
  assert.deepEqual(manual.model.input, ["text", "image"]);
  const plain = await resolveModel(sdk, unknown, directory);
  assert.deepEqual(plain.model.input, ["text"]);
  assert.equal(plain.model.reasoning, false);
  const legacy = { protocol: "", provider: "openai", model: "listed" };
  const legacyProfile = resolveModelCapabilities(legacy, catalog);
  legacyProfile.vision = { supported: false, source: "manual" };
  const legacySdk = {
    ModelRuntime: { create: async () => ({ ...runtime, getModel: () => catalog[0] }) },
  };
  const overridden = await resolveModel(
    legacySdk,
    {
      ...legacy,
      modelCapabilities: { [modelCapabilityScope(legacy)]: legacyProfile },
    },
    directory,
  );
  assert.deepEqual(overridden.model.input, ["text"]);
});
