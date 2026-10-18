"use client";

import { DropIcon, XIcon } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useI18n } from "@/features/i18n";
import { EXTERNAL_AGENTS, type ExternalAgentId } from "../lib/external-agent-catalog";
import { externalAgentLabels } from "../lib/external-agent-labels";
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
  const { locale } = useI18n();
  const labels = externalAgentLabels(locale);
  const name = EXTERNAL_AGENTS.find((entry) => entry.id === selected)?.name ?? selected;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[9999] bg-black/45 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[10000] max-h-[90dvh] w-[min(92vw,36rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-background text-foreground shadow-2xl focus:outline-none">
          <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-accent/20 via-accent/5 to-background px-6 pb-7 pt-10 text-center">
            <Dialog.Close
              aria-label={labels.closeConnection}
              className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <XIcon className="size-4" />
            </Dialog.Close>
            <div aria-hidden="true" className="mb-6 flex items-center justify-center gap-5">
              <span className="flex size-16 items-center justify-center rounded-2xl border border-border bg-background shadow-sm">
                <AgentLogo id={selected} className="size-9" />
              </span>
              <span className="h-10 w-px bg-border" />
              <span className="flex size-16 items-center justify-center rounded-2xl border border-border bg-background text-accent shadow-sm">
                <DropIcon weight="fill" className="size-9" />
              </span>
            </div>
            <Dialog.Title className="text-xl font-semibold tracking-tight">
              {labels.connectionTitle.replace("{agent}", name)}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              {labels.connectionDescription}
            </Dialog.Description>
            {directory && (
              <p className="mt-4 break-all text-xs text-muted-foreground">
                {labels.projectLabel}: {directory}
              </p>
            )}
          </div>
          <div className="space-y-4 px-6 py-5">
            {[
              [labels.accessTitle, labels.accessDescription],
              [labels.dataTitle, labels.dataDescription],
              [labels.controlTitle, labels.controlDescription],
            ].map(([title, description]) => (
              <p key={title} className="text-sm leading-6 text-muted-foreground">
                <strong className="block font-medium text-foreground">{title}</strong>
                {description}
              </p>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Dialog.Close className="btn btn-secondary">{labels.cancel}</Dialog.Close>
            <button type="button" className="btn btn-primary" onClick={onConfirm}>
              {labels.connectionAction}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
