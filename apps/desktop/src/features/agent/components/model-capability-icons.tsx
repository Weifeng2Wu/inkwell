import { BrainIcon, GlobeIcon, ImageIcon } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";
import type { ModelCapabilities } from "../lib/academic-client";

export function ModelCapabilityIcons({
  capabilities,
  onToggle,
}: {
  capabilities: ModelCapabilities;
  onToggle?: (key: "vision" | "reasoning") => void;
}) {
  const { t } = useI18n();
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
        const capability = t(`agent.capabilities.${key}`);
        const status = t(
          value.supported === null
            ? "agent.capabilities.unknown"
            : value.supported
              ? "agent.capabilities.supported"
              : "agent.capabilities.unsupported",
        );
        const summary =
          value.source === "unknown"
            ? t("agent.capabilities.summary", { capability, status })
            : t("agent.capabilities.summaryWithSource", {
                capability,
                status,
                source: t(`agent.capabilities.${value.source}`),
              });
        const editable =
          onToggle && key !== "web" && (value.source === "unknown" || value.source === "manual");
        const icon = (
          <Icon
            className="size-4"
            weight={value.supported === true ? "fill" : "regular"}
            aria-hidden="true"
          />
        );
        if (editable) {
          const action = t(
            value.supported === true ? "agent.capabilities.disable" : "agent.capabilities.enable",
            { capability },
          );
          return (
            <Tooltip key={key} label={action} side="top">
              <button
                type="button"
                aria-label={action}
                aria-pressed={value.supported === true}
                data-capability={key}
                data-supported={String(value.supported)}
                className={`inline-flex size-6 items-center justify-center rounded transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-accent ${value.supported === true ? "text-accent" : "text-muted-foreground"}`}
                onClick={() => onToggle(key)}
              >
                {icon}
              </button>
            </Tooltip>
          );
        }
        return (
          <Tooltip key={key} label={summary} side="top">
            <span
              role="img"
              aria-label={summary}
              data-capability={key}
              data-supported={String(value.supported)}
              className={
                value.supported === true ? "text-accent" : "text-muted-foreground opacity-40"
              }
            >
              {icon}
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}
