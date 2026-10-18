"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  modelCapabilityScope,
  resolveModelCapabilities,
} from "../../../../../../packages/academic-agent/src/model-capabilities.mjs";
import type { AcademicConfig, ModelCapabilities } from "../lib/academic-client";
import { modelCapabilityLabels } from "../lib/model-capability-labels";
import { ModelCapabilityIcons } from "./model-capability-icons";

export function modelCapabilitiesForSelection(
  config: AcademicConfig,
  discovered?: Record<string, ModelCapabilities>,
  webSearchAvailable = false,
): ModelCapabilities {
  const saved = resolveModelCapabilities(config);
  const automatic = discovered?.[config.model.trim()];
  return {
    vision: saved.vision.source === "manual" ? saved.vision : (automatic?.vision ?? saved.vision),
    reasoning:
      saved.reasoning.source === "manual"
        ? saved.reasoning
        : (automatic?.reasoning ?? saved.reasoning),
    web: webSearchAvailable ? { supported: true, source: "runtime" } : saved.web,
  };
}

export function selectModel(
  config: AcademicConfig,
  model: string,
  discovered?: Record<string, ModelCapabilities>,
): AcademicConfig {
  const next = { ...config, model };
  if (!discovered?.[model.trim()] && !config.modelCapabilities?.[modelCapabilityScope(next)])
    return next;
  return {
    ...next,
    modelCapabilities: {
      ...config.modelCapabilities,
      [modelCapabilityScope(next)]: modelCapabilitiesForSelection(next, discovered),
    },
  };
}

export function ModelPicker({
  config,
  onChange,
  models,
  discovered,
  locale,
  label,
  inputId,
  loading = false,
  discoveryFailed = false,
  webSearchAvailable = false,
}: {
  config: AcademicConfig;
  onChange: (config: AcademicConfig) => void;
  models: string[] | null;
  discovered?: Record<string, ModelCapabilities>;
  locale: "zh" | "en" | "ko";
  label: string;
  inputId: string;
  loading?: boolean;
  discoveryFailed?: boolean;
  webSearchAvailable?: boolean;
}) {
  const id = useId();
  const labels = modelCapabilityLabels[locale];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const capabilities = modelCapabilitiesForSelection(config, discovered, webSearchAvailable);
  const options =
    models?.filter((model) => model.toLowerCase().includes(query.toLowerCase())).slice(0, 100) ??
    [];
  const expanded = open && models !== null;
  useEffect(() => {
    if (expanded) list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active, expanded]);
  const choose = (model: string) => {
    onChange(selectModel(config, model, discovered));
    setOpen(false);
    input.current?.focus();
  };
  return (
    <div className="space-y-2">
      <label className="block text-xs" htmlFor={inputId}>
        {label}
      </label>
      <div className="relative">
        <div className="flex items-center gap-3 rounded border border-border bg-background pr-3 focus-within:border-accent">
          <input
            ref={input}
            id={inputId}
            role="combobox"
            aria-autocomplete="list"
            aria-busy={loading}
            aria-expanded={expanded}
            aria-controls={`${id}-list`}
            aria-activedescendant={
              expanded && options.length ? `${id}-option-${active}` : undefined
            }
            className="settings-control min-w-0 flex-1 border-0"
            value={config.model}
            autoComplete="off"
            maxLength={200}
            onFocus={() => {
              setQuery("");
              setActive(0);
              setOpen(true);
            }}
            onBlur={() => setOpen(false)}
            onChange={(event) => {
              onChange(selectModel(config, event.target.value, discovered));
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setActive((index) =>
                  Math.max(
                    0,
                    Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
                  ),
                );
              } else if (event.key === "Enter" && expanded && options[active]) {
                event.preventDefault();
                choose(options[active]);
              }
            }}
          />
          <ModelCapabilityIcons
            capabilities={capabilities}
            locale={locale}
            onToggle={
              config.model.trim() && !loading && (models !== null || discoveryFailed)
                ? (key) => {
                    const next: ModelCapabilities = {
                      ...capabilities,
                      [key]: { supported: capabilities[key].supported !== true, source: "manual" },
                    };
                    onChange({
                      ...config,
                      modelCapabilities: {
                        ...config.modelCapabilities,
                        [modelCapabilityScope(config)]: next,
                      },
                    });
                  }
                : undefined
            }
          />
        </div>
        {expanded && (
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded border border-border bg-background p-1 shadow-lg"
          >
            {options.map((model, index) => (
              <div
                key={model}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={index === active}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-sm ${index === active ? "bg-surface-secondary" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(model)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") choose(model);
                }}
                tabIndex={-1}
              >
                <span className="min-w-0 truncate">{model}</span>
                <ModelCapabilityIcons
                  capabilities={modelCapabilitiesForSelection(
                    { ...config, model },
                    discovered,
                    webSearchAvailable,
                  )}
                  locale={locale}
                />
              </div>
            ))}
            {!options.length && <p className="p-3 text-xs text-muted-foreground">{labels.empty}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
