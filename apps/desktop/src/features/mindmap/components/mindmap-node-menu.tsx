"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "@/components/ui/use-modal-dialog";
import { useI18n } from "@/features/i18n";
import type { MindmapSide, MindmapStyle } from "../lib/mindmap";
import { MindmapStyleEditor } from "./mindmap-style-editor";

export function MindmapNodeMenu({
  x,
  y,
  root,
  side,
  style,
  onAdd,
  onRemove,
  onEdit,
  onSide,
  onStyle,
  onClose,
}: {
  x: number;
  y: number;
  root: boolean;
  side: MindmapSide;
  style: MindmapStyle;
  onAdd: (sibling: boolean, side?: MindmapSide) => void;
  onRemove: () => void;
  onEdit: () => void;
  onSide: (side: MindmapSide) => void;
  onStyle: (style?: MindmapStyle) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const first = useRef<HTMLButtonElement>(null);
  const panel = useModalDialog<HTMLDivElement>({
    initialFocus: first,
    onCancel: onClose,
    onConfirm: onClose,
  });
  const [position, setPosition] = useState({ x, y });
  useLayoutEffect(() => {
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [x, y, panel, onClose]);
  const run = (action: () => void) => {
    onClose();
    action();
  };
  const buttonClass =
    "list-row flex min-h-7 w-full items-center justify-between gap-4 rounded px-2 py-1 text-left text-[13px]";
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={t("mindmap.nodeActions")}
      aria-modal="true"
      className="motion-pop fixed z-50 w-72 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-border bg-background p-2 text-foreground shadow-lg"
      style={{ left: position.x, top: position.y, maxHeight: "calc(100vh - 16px)" }}
    >
      <button ref={first} type="button" className={buttonClass} onClick={() => run(onEdit)}>
        {t("mindmap.editText")}
        <kbd className="kbd-quiet text-muted">F2</kbd>
      </button>
      {root ? (
        (["left", "right"] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            className={buttonClass}
            onClick={() => run(() => onAdd(false, direction))}
          >
            {t(direction === "left" ? "mindmap.addLeft" : "mindmap.addRight")}
          </button>
        ))
      ) : (
        <>
          <button type="button" className={buttonClass} onClick={() => run(() => onAdd(false))}>
            {t("mindmap.addChild")}
            <kbd className="kbd-quiet text-muted">Tab</kbd>
          </button>
          <button type="button" className={buttonClass} onClick={() => run(() => onAdd(true))}>
            {t("mindmap.addSibling")}
            <kbd className="kbd-quiet text-muted">Enter</kbd>
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => run(() => onSide(side === "left" ? "right" : "left"))}
          >
            {t(side === "left" ? "mindmap.moveRight" : "mindmap.moveLeft")}
          </button>
          <button
            type="button"
            className={`${buttonClass} text-error`}
            onClick={() => run(onRemove)}
          >
            {t("common.delete")}
            <kbd className="kbd-quiet text-muted">Delete</kbd>
          </button>
        </>
      )}
      <MindmapStyleEditor
        style={style}
        disabled={false}
        onChange={onStyle}
        onReset={() => onStyle()}
      />
    </div>,
    document.body,
  );
}
