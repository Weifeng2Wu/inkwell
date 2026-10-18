import { BrainIcon, GlobeIcon, ImageIcon } from "@phosphor-icons/react";
import type { ModelCapabilities } from "../lib/academic-client";
import { modelCapabilityLabels } from "../lib/model-capability-labels";

export function ModelCapabilityIcons({
  capabilities,
  locale,
  onToggle,
}: {
  capabilities: ModelCapabilities;
  locale: "zh" | "en" | "ko";
  onToggle?: (key: "vision" | "reasoning") => void;
}) {
  const labels = modelCapabilityLabels[locale];
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      {(
        [
          ["vision", ImageIcon],
          ["web", GlobeIcon],
          ["reasoning", BrainIcon],
        ] as const
      ).map(([key, Icon]) => {
        const value = capabilities[key];
        const status =
          value.supported === null
            ? labels.unknown
            : value.supported
              ? labels.supported
              : labels.unsupported;
        const source = value.source === "unknown" ? "" : labels[value.source];
        const title = `${labels[key]}: ${status}${source ? ` · ${source}` : ""}`;
        const editable =
          onToggle && key !== "web" && (value.source === "unknown" || value.source === "manual");
        const icon = (
          <Icon
            className="size-4"
            weight={value.supported === true ? "fill" : "regular"}
            aria-hidden="true"
          />
        );
        if (editable)
          return (
            <button
              key={key}
              type="button"
              title={`${title} · ${value.supported === true ? labels.disable : labels.enable}`}
              aria-label={`${labels[key]} · ${value.supported === true ? labels.disable : labels.enable}`}
              aria-pressed={value.supported === true}
              data-capability={key}
              data-supported={String(value.supported)}
              className={`inline-flex size-6 items-center justify-center rounded hover:bg-surface-secondary focus-visible:outline focus-visible:outline-accent ${value.supported === true ? "text-accent" : "text-muted-foreground"}`}
              onClick={() => onToggle(key)}
            >
              {icon}
            </button>
          );
        return (
          <span
            key={key}
            title={title}
            role="img"
            aria-label={title}
            data-capability={key}
            data-supported={String(value.supported)}
            className={
              value.supported === true ? "text-accent" : "text-muted-foreground opacity-40"
            }
          >
            {icon}
          </span>
        );
      })}
    </span>
  );
}
