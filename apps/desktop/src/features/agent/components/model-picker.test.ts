import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import {
  modelCapabilityScope,
  resolveModelCapabilities,
} from "../../../../../../packages/academic-agent/src/model-capabilities.mjs";
import { DEFAULT_ACADEMIC_CONFIG } from "../lib/academic-config";
import { ModelCapabilityIcons } from "./model-capability-icons";
import { ModelPicker, modelCapabilitiesForSelection, selectModel } from "./model-picker";

describe("model capabilities in the picker", () => {
  const config = { ...DEFAULT_ACADEMIC_CONFIG, model: "unlisted" };
  it("renders three gray icons with distinct unknown and unsupported tooltips", () => {
    const markup = renderToStaticMarkup(
      createElement(ModelPicker, {
        config,
        onChange: () => {},
        models: null,
        label: "Model",
        inputId: "model",
      }),
    );
    expect(markup).toContain("Images and PDFs: unknown");
    expect(markup).toContain("Reasoning: unknown");
    expect(markup).toContain("Web search: not supported (no search service is connected)");
    expect(markup.match(/data-capability=/g)).toHaveLength(3);
    expect(markup).toContain('role="combobox"');
    expect(markup).not.toContain("Automatic");
    expect(markup).not.toContain("Model capabilities");
    expect(markup).not.toContain("Capabilities come from");
    expect(markup).not.toContain("aria-pressed=");
  });
  it("persists discovered capabilities for the selected model and leaves unknown typing alone", () => {
    const discovered = {
      unlisted: resolveModelCapabilities(config, [], { input: ["text", "image"], reasoning: true }),
    };
    const selected = selectModel(config, "unlisted", discovered);
    expect(selected.modelCapabilities?.[modelCapabilityScope(config)]?.vision.supported).toBe(true);
    expect(selectModel(config, "unfinished").modelCapabilities).toBeUndefined();
    const other = { ...selected, model: "other" };
    expect(modelCapabilitiesForSelection(other).vision.supported).toBeNull();
  });
  it("allows icon declarations only after discovery fails or leaves a capability unknown", () => {
    const markup = (extra: Partial<Parameters<typeof ModelPicker>[0]>) =>
      renderToStaticMarkup(
        createElement(ModelPicker, {
          config,
          onChange: () => {},
          models: null,
          label: "Model",
          inputId: "model",
          ...extra,
        }),
      );
    expect(markup({ discoveryFailed: true }).match(/aria-pressed=/g)).toHaveLength(2);
    expect(markup({ models: ["unlisted"] }).match(/aria-pressed=/g)).toHaveLength(2);
    expect(markup({ models: ["unlisted"], loading: true })).not.toContain("aria-pressed=");
    const known = resolveModelCapabilities(config, [], { input: ["text"], reasoning: true });
    expect(markup({ models: ["unlisted"], discovered: { unlisted: known } })).not.toContain(
      "aria-pressed=",
    );
  });
  it("activates unknown capabilities through the icon and keeps known capabilities locked", () => {
    const capabilities = resolveModelCapabilities(config);
    capabilities.reasoning = { supported: false, source: "catalog" };
    const onToggle = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(ModelCapabilityIcons, { capabilities, onToggle }),
    );
    const buttons = [...markup.matchAll(/<button\b[^>]*data-capability="(\w+)"/g)];
    expect(buttons.map((button) => button[1])).toEqual(["vision"]);
    expect(markup).toContain('aria-label="Mark “Images and PDFs” as supported"');
    expect(markup).toContain(
      'aria-label="Reasoning: not supported (from the built-in model list)"',
    );
    expect(onToggle).not.toHaveBeenCalled();
  });
  it("keeps manual declarations when refreshing and selecting models", () => {
    const manual = resolveModelCapabilities(config);
    manual.vision = { supported: true, source: "manual" };
    const declared = { ...config, modelCapabilities: { [modelCapabilityScope(config)]: manual } };
    const discovered = { unlisted: resolveModelCapabilities(config, [], { input: ["text"] }) };
    const refreshed = selectModel(declared, "unlisted", discovered);
    expect(modelCapabilitiesForSelection(refreshed).vision).toEqual({
      supported: true,
      source: "manual",
    });
    const markup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { locale: "zh" },
        createElement(ModelPicker, {
          config: refreshed,
          onChange: () => {},
          models: ["unlisted"],
          discovered,
          label: "模型",
          inputId: "model",
        }),
      ),
    );
    expect(markup).toContain('aria-label="将「图片和 PDF」标记为不支持"');
    expect(markup).toContain('data-supported="true"');
  });
});
