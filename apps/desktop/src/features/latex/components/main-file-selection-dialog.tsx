"use client";

import { CheckIcon, FileTextIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "@/components/ui/use-modal-dialog";
import { useI18n } from "@/features/i18n";
import type { MainFileDetectionResult } from "@/features/latex/lib/types";

interface MainFileSelectionDialogProps {
  open: boolean;
  detectionResult: MainFileDetectionResult;
  onSelect: (mainFile: string) => void;
  onCancel: () => void;
}

export function MainFileSelectionDialog(props: MainFileSelectionDialogProps) {
  // Mounted only while open, so focus is captured on open and returned on close.
  return props.open ? <MainFileSelection {...props} /> : null;
}

function MainFileSelection({ detectionResult, onSelect, onCancel }: MainFileSelectionDialogProps) {
  const { t } = useI18n();
  const files = detectionResult.tex_files;
  const [selected, setSelected] = useState<string | null>(
    detectionResult.main_file || files[0] || null,
  );
  const titleId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSelected(detectionResult.main_file || detectionResult.tex_files[0] || null);
  }, [detectionResult]);

  const panelRef = useModalDialog<HTMLDivElement>({
    onCancel,
    onConfirm: () => {
      if (selected) onSelect(selected);
    },
    initialFocus: files.length > 0 ? listRef : cancelRef,
  });

  const move = (event: React.KeyboardEvent) => {
    const index = selected ? files.indexOf(selected) : -1;
    const target =
      event.key === "ArrowDown"
        ? Math.min(index + 1, files.length - 1)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? files.length - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    const file = files[target];
    if (!file) return;
    setSelected(file);
    listRef.current?.children[target]?.scrollIntoView?.({ block: "nearest" });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="motion-fade absolute inset-0 bg-black/45" onClick={onCancel} aria-hidden />

      <div
        ref={panelRef}
        className="motion-pop relative z-10 w-full max-w-md rounded-lg border border-border bg-background text-foreground shadow-2xl"
      >
        <div className="px-5 pt-4 pb-3">
          <h3 id={titleId} className="font-medium text-sm">
            {t("latex.selectMainTitle")}
          </h3>
          <p className="mt-1 text-[13px] text-muted">{t("latex.selectMainDesc")}</p>
        </div>

        <div className="max-h-64 overflow-y-auto border-border border-t px-2 py-2">
          {files.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted">{t("latex.noTexFiles")}</p>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              tabIndex={0}
              aria-labelledby={titleId}
              aria-activedescendant={selected ? `${titleId}-${files.indexOf(selected)}` : undefined}
              onKeyDown={move}
              className="rounded-md outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {files.map((file, index) => {
                const isSelected = selected === file;
                return (
                  <div
                    key={file}
                    id={`${titleId}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    data-active={isSelected ? "true" : undefined}
                    onClick={() => setSelected(file)}
                    onDoubleClick={() => onSelect(file)}
                    onKeyDown={move}
                    className="list-row flex min-h-7 cursor-default items-center gap-2 rounded px-3 py-1 text-[13px]"
                  >
                    <FileTextIcon className="size-4 flex-shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={file}>
                      {file}
                    </span>
                    {file === detectionResult.main_file && (
                      <span className="flex-shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[11px] text-success">
                        {t("latex.recommended")}
                      </span>
                    )}
                    <CheckIcon
                      className={`size-4 flex-shrink-0 text-accent ${isSelected ? "" : "invisible"}`}
                      aria-hidden
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-border border-t px-5 py-3">
          <p className="text-muted text-xs">{t("latex.filesFound", { count: files.length })}</p>
          <div className="flex items-center gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              className="btn btn-sm btn-secondary"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => selected && onSelect(selected)}
              disabled={!selected}
              className="btn btn-sm btn-primary"
            >
              {t("latex.compile")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
