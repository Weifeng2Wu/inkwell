"use client";

import { ArrowCounterClockwiseIcon, XIcon } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import {
  DEFAULT_SHORTCUTS,
  displayShortcut,
  SHORTCUTS,
  type ShortcutId,
  shortcutConflict,
  shortcutFromEvent,
  validShortcut,
} from "../lib/keyboard-shortcuts";
import { useKeyboardShortcuts } from "../lib/use-keyboard-shortcuts";

export function KeyboardShortcutSettings({ query = "" }: { query?: string }) {
  const { t } = useI18n();
  const { bindings, updateShortcut, resetShortcuts } = useKeyboardShortcuts();
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const customized = SHORTCUTS.some((item) => bindings[item.id] !== DEFAULT_SHORTCUTS[item.id]);
  const normalizedQuery = query.trim().toLowerCase();
  const matching = SHORTCUTS.filter((item) =>
    `${t("shortcuts.title")} ${t(`shortcuts.actions.${item.id}`)} ${t(`shortcuts.categories.${item.category}`)} ${displayShortcut(bindings[item.id], mac)}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
  function update(id: ShortcutId, binding: string) {
    if (!validShortcut(binding, id)) {
      setError(t("shortcuts.invalid"));
      return;
    }
    const conflict = shortcutConflict(bindings, id, binding);
    if (conflict) {
      setError(t("shortcuts.conflict", { action: t(`shortcuts.actions.${conflict}`) }));
      return;
    }
    try {
      if (updateShortcut(id, binding)) {
        setRecording(null);
        setError(null);
      }
    } catch {
      setError(t("shortcuts.saveFailed"));
    }
  }
  if (!matching.length) return null;
  return (
    <section className="space-y-5" aria-label={t("shortcuts.title")}>
      <div className="flex items-start justify-between gap-4">
        <button
          type="button"
          className="btn btn-sm shrink-0"
          disabled={!customized}
          onClick={() => setConfirmReset(true)}
        >
          <ArrowCounterClockwiseIcon className="size-4" aria-hidden="true" />
          {t("shortcuts.reset")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {(["workspace", "latex", "markdown", "chat"] as const).map((category) => {
        const items = matching.filter((item) => item.category === category);
        if (!items.length) return null;
        return (
          <section
            key={category}
            className="overflow-hidden rounded-lg border border-border bg-background"
          >
            <h3 className="border-b border-border bg-surface-secondary px-4 py-3 text-sm font-semibold">
              {t(`shortcuts.categories.${category}`)}
            </h3>
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="text-sm text-foreground-secondary">
                    {t(`shortcuts.actions.${item.id}`)}
                    {bindings[item.id] !== item.default && (
                      <span className="ml-2 text-xs text-accent">{t("shortcuts.custom")}</span>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      data-shortcut-recorder="true"
                      className={`settings-control min-w-32 text-center ${recording === item.id ? "border-accent text-accent" : ""}`}
                      aria-label={t("shortcuts.edit", {
                        action: t(`shortcuts.actions.${item.id}`),
                      })}
                      aria-pressed={recording === item.id}
                      onClick={() => {
                        setRecording(item.id);
                        setError(null);
                      }}
                      onBlur={() => setRecording(null)}
                      onKeyDown={(event) => {
                        if (recording !== item.id) return;
                        if (event.key === "Tab") {
                          setRecording(null);
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.key === "Escape") {
                          setRecording(null);
                          return;
                        }
                        if (event.key === "Backspace" || event.key === "Delete") {
                          update(item.id, "");
                          return;
                        }
                        const binding = shortcutFromEvent(event.nativeEvent);
                        if (binding) update(item.id, binding);
                      }}
                    >
                      {recording === item.id ? (
                        t("shortcuts.recording")
                      ) : (
                        <kbd>
                          {displayShortcut(bindings[item.id], mac) || t("shortcuts.unassigned")}
                        </kbd>
                      )}
                    </button>
                    <button
                      type="button"
                      className="toolbar-icon-button"
                      disabled={bindings[item.id] === item.default}
                      title={t("shortcuts.restoreOne")}
                      aria-label={t("shortcuts.restoreOneAction", {
                        action: t(`shortcuts.actions.${item.id}`),
                      })}
                      onClick={() => update(item.id, item.default)}
                    >
                      <ArrowCounterClockwiseIcon className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <Dialog.Root open={confirmReset} onOpenChange={setConfirmReset}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/45" />
          <Dialog.Content
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelReset.current?.focus();
            }}
            className="fixed top-1/2 left-1/2 z-[61] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-5 text-foreground shadow-2xl"
          >
            <Dialog.Title className="pr-8 text-sm font-semibold">
              {t("shortcuts.resetTitle")}
            </Dialog.Title>
            <Dialog.Description className="mt-3 text-sm leading-relaxed text-muted">
              {t("shortcuts.resetMessage")}
            </Dialog.Description>
            <Dialog.Close
              className="toolbar-icon-button absolute top-3 right-3"
              aria-label={t("common.close")}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Dialog.Close>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close ref={cancelReset} className="btn btn-sm">
                {t("common.cancel")}
              </Dialog.Close>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  try {
                    resetShortcuts();
                    setConfirmReset(false);
                    setError(null);
                  } catch {
                    setError(t("shortcuts.saveFailed"));
                    setConfirmReset(false);
                  }
                }}
              >
                {t("shortcuts.confirmReset")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
