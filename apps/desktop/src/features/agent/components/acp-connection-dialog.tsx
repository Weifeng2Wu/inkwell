"use client";

import { DropIcon, XIcon } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useI18n } from "@/features/i18n";
import { EXTERNAL_AGENTS, type ExternalAgentId } from "../lib/external-agent-catalog";
import { AgentLogo } from "./agent-logo";

export function AcpConnectionDialog({
  selected,
  directory,
  open,
  onConfirm,
  onCancel,
}: {
  selected: ExternalAgentId;
  directory?: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const name = EXTERNAL_AGENTS.find((entry) => entry.id === selected)?.name ?? selected;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[9999] bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[10000] max-h-[90dvh] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-background text-foreground shadow-2xl focus:outline-none">
          <div className="relative border-b border-border px-6 pb-5 pt-6">
            <Dialog.Close
              aria-label={t("common.close")}
              className="toolbar-icon-button absolute right-3 top-3"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Dialog.Close>
            <div aria-hidden="true" className="mb-4 flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface">
                <AgentLogo id={selected} className="size-6" />
              </span>
              <span className="h-px w-6 bg-border" />
              <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-accent">
                <DropIcon weight="fill" className="size-6" />
              </span>
            </div>
            <Dialog.Title className="text-base font-semibold">
              {t("agent.external.connectionTitle", { agent: name })}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {t("agent.external.connectionDescription")}
            </Dialog.Description>
            {directory && (
              <p className="mt-3 break-all text-xs text-muted-foreground">
                {t("agent.external.project", { path: directory })}
              </p>
            )}
          </div>
          <div className="space-y-4 px-6 py-5">
            {(["access", "data", "control"] as const).map((topic) => (
              <p key={topic} className="text-sm leading-6 text-muted-foreground">
                <strong className="block font-medium text-foreground">
                  {t(`agent.external.${topic}Title`)}
                </strong>
                {t(`agent.external.${topic}Description`)}
              </p>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Dialog.Close className="btn">{t("common.cancel")}</Dialog.Close>
            <button type="button" className="btn btn-primary" onClick={onConfirm}>
              {t("agent.external.connectionAction")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
