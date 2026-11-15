"use client";

import { ClockCounterClockwiseIcon, PlusIcon } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";

export function ConversationActions({
  disabled,
  onNew,
  onHistory,
}: {
  disabled: boolean;
  onNew: () => Promise<unknown>;
  onHistory: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="ml-auto flex items-center gap-1">
      <Tooltip label={t("agent.newConversation")}>
        <button
          type="button"
          className="toolbar-icon-button"
          disabled={disabled}
          aria-label={t("agent.newConversation")}
          onClick={() => void onNew()}
        >
          <PlusIcon size={16} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip label={t("agent.history.title")}>
        <button
          type="button"
          className="toolbar-icon-button"
          disabled={disabled}
          aria-label={t("agent.history.title")}
          onClick={onHistory}
        >
          <ClockCounterClockwiseIcon size={16} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}
