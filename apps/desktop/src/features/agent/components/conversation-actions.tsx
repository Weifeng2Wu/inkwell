"use client";

import { ClockCounterClockwiseIcon, PlusIcon } from "@phosphor-icons/react";

export function ConversationActions({
  disabled,
  newLabel,
  historyLabel,
  onNew,
  onHistory,
}: {
  disabled: boolean;
  newLabel: string;
  historyLabel: string;
  onNew: () => Promise<unknown>;
  onHistory: () => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <button
        type="button"
        className="toolbar-icon-button"
        disabled={disabled}
        aria-label={newLabel}
        title={newLabel}
        onClick={() => void onNew()}
      >
        <PlusIcon size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="toolbar-icon-button"
        disabled={disabled}
        aria-label={historyLabel}
        title={historyLabel}
        onClick={onHistory}
      >
        <ClockCounterClockwiseIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
