"use client";

import {
  CaretDownIcon,
  HighlighterIcon,
  NoteIcon,
  QuotesIcon,
  SparkleIcon,
  TextUnderlineIcon,
  TranslateIcon,
} from "@phosphor-icons/react";
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";
import type { PdfAnnotationColor } from "../lib/pdf-notes";
import { type PdfToolbarAnchor, pdfToolbarPosition } from "../lib/pdf-toolbar-position";
import { PDF_SELECTION_ACTIONS_ATTRIBUTE } from "../lib/use-pdf-selection";
import { PdfColorPicker } from "./pdf-color-picker";

type Props = {
  rootRef: RefObject<HTMLDivElement | null>;
  anchor: PdfToolbarAnchor;
  minimumTop: number;
  color: PdfAnnotationColor;
  writable: boolean;
  onColorChange: (color: PdfAnnotationColor) => void;
  onHighlight: () => void;
  onUnderline: () => void;
  onNote: () => void;
  onTranslate: () => void;
  /** Quote the selected passage in the manuscript; hidden when absent. */
  onQuote?: () => void;
  /** Attach the selected passage to the agent chat; hidden when absent. */
  onAddToAgent?: () => void;
};

export function PdfSelectionToolbar({
  rootRef,
  anchor,
  minimumTop,
  color,
  writable,
  onColorChange,
  onHighlight,
  onUnderline,
  onNote,
  onTranslate,
  onQuote,
  onAddToAgent,
}: Props) {
  const { t } = useI18n();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const paletteId = useId();
  const [colorOpen, setColorOpen] = useState(false);
  const [focusedAction, setFocusedAction] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: minimumTop });
  const [palettePosition, setPalettePosition] = useState({ left: 8, top: minimumTop });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const toolbar = toolbarRef.current;
    if (!root || !toolbar) return;
    const measure = () => {
      const panel = root.getBoundingClientRect();
      const size = toolbar.getBoundingClientRect();
      const next = pdfToolbarPosition(
        anchor,
        panel,
        { width: size.width || 204, height: size.height || 42 },
        minimumTop,
      );
      setPosition((current) =>
        current.left === next.left && current.top === next.top ? current : next,
      );
      if (colorOpen) {
        const palette = paletteRef.current?.getBoundingClientRect();
        const nextPalette = pdfToolbarPosition(
          {
            left: next.left,
            right: next.left + size.width,
            top: next.top,
            bottom: next.top + size.height,
          },
          panel,
          { width: palette?.width || 166, height: palette?.height || 46 },
          minimumTop,
          true,
        );
        setPalettePosition((current) =>
          current.left === nextPalette.left && current.top === nextPalette.top
            ? current
            : nextPalette,
        );
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(toolbar);
    if (paletteRef.current) observer.observe(paletteRef.current);
    return () => observer.disconnect();
  }, [rootRef, anchor, minimumTop, colorOpen]);

  useEffect(() => {
    if (!colorOpen) return;
    paletteRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    const dismiss = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        !toolbarRef.current?.contains(event.target) &&
        !paletteRef.current?.contains(event.target)
      )
        setColorOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [colorOpen]);

  function closePalette() {
    setColorOpen(false);
    colorButtonRef.current?.focus();
  }

  function handleToolbarKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && colorOpen) {
      event.preventDefault();
      event.stopPropagation();
      closePalette();
      return;
    }
    if (event.key === "ArrowDown" && event.target === colorButtonRef.current) {
      event.preventDefault();
      setColorOpen(true);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if (!(event.target instanceof HTMLButtonElement)) return;
    const buttons = [
      ...(toolbarRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  // Hairlines separate the marking, reading and hand-off groups.
  const actions = [
    {
      label: "pdfReading.highlight",
      keys: "H",
      Icon: HighlighterIcon,
      onClick: onHighlight,
      disabled: !writable,
      group: "mark",
    },
    {
      label: "pdfReading.underline",
      keys: "U",
      Icon: TextUnderlineIcon,
      onClick: onUnderline,
      disabled: !writable,
      group: "mark",
    },
    {
      label: "pdfReading.addNote",
      keys: "N",
      Icon: NoteIcon,
      onClick: onNote,
      disabled: !writable,
      group: "read",
    },
    {
      label: "translation.action",
      keys: "T",
      Icon: TranslateIcon,
      onClick: onTranslate,
      disabled: false,
      group: "read",
    },
    ...(onQuote
      ? [
          {
            label: "pdfReading.quote",
            keys: "Q",
            Icon: QuotesIcon,
            onClick: onQuote,
            disabled: false,
            group: "send",
          },
        ]
      : []),
    ...(onAddToAgent
      ? [
          {
            label: "pdfReading.addToAgent",
            keys: "A",
            Icon: SparkleIcon,
            onClick: onAddToAgent,
            disabled: false,
            group: "send",
          },
        ]
      : []),
  ];
  // The color trigger follows the actions and shares their roving tab stop.
  const colorAction = actions.length;
  const firstEnabled = actions.findIndex((action) => !action.disabled);
  const activeAction =
    focusedAction >= colorAction
      ? colorAction
      : actions[focusedAction]?.disabled
        ? firstEnabled < 0
          ? colorAction
          : firstEnabled
        : focusedAction;

  return (
    <>
      <div
        ref={toolbarRef}
        role="toolbar"
        {...{ [PDF_SELECTION_ACTIONS_ATTRIBUTE]: "" }}
        aria-label={t("pdfReading.selectionActions")}
        aria-orientation="horizontal"
        className="motion-pop absolute z-20 flex max-w-[calc(100%-1rem)] select-none items-center gap-1 overflow-x-auto rounded-lg border border-border bg-background p-1 text-foreground shadow-lg"
        style={position}
        onKeyDown={handleToolbarKey}
        onPointerDown={(event) => {
          if (event.button === 0 && event.pointerType !== "touch") event.preventDefault();
        }}
      >
        {actions.map(({ label, keys, Icon, onClick, disabled, group }, index) => (
          <span key={label} className="contents">
            {index > 0 && actions[index - 1]?.group !== group && (
              <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
            )}
            <Tooltip label={t(label)} keys={keys} side="top" className="inline-flex shrink-0">
              <button
                type="button"
                className="toolbar-icon-button shrink-0"
                aria-label={t(label)}
                aria-keyshortcuts={keys}
                disabled={disabled}
                tabIndex={activeAction === index ? 0 : -1}
                onFocus={() => setFocusedAction(index)}
                onClick={onClick}
              >
                <Icon aria-hidden="true" className="size-4" />
              </button>
            </Tooltip>
          </span>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
        <Tooltip
          label={t("pdfReading.colorCurrent", { color: t(`pdfReading.colors.${color}`) })}
          side="top"
          className="inline-flex shrink-0"
        >
          <button
            ref={colorButtonRef}
            type="button"
            className="toolbar-icon-button shrink-0 gap-1"
            aria-label={t("pdfReading.color")}
            data-color={color}
            aria-haspopup="dialog"
            aria-expanded={colorOpen}
            aria-controls={colorOpen ? paletteId : undefined}
            data-state={colorOpen ? "open" : "closed"}
            tabIndex={activeAction === colorAction ? 0 : -1}
            onFocus={() => setFocusedAction(colorAction)}
            onClick={() => setColorOpen((open) => !open)}
          >
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--${color})` }}
            />
            <CaretDownIcon aria-hidden="true" className="size-2.5 shrink-0" />
          </button>
        </Tooltip>
      </div>
      {colorOpen && (
        <div
          ref={paletteRef}
          id={paletteId}
          role="dialog"
          {...{ [PDF_SELECTION_ACTIONS_ATTRIBUTE]: "" }}
          aria-label={t("pdfReading.color")}
          className="motion-pop absolute z-30 max-w-[calc(100%-1rem)] overflow-x-auto rounded-lg border border-border bg-background p-1 text-foreground shadow-lg"
          style={palettePosition}
          onPointerDown={(event) => {
            if (event.button === 0 && event.pointerType !== "touch") event.preventDefault();
          }}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              !event.currentTarget.contains(event.relatedTarget) &&
              !toolbarRef.current?.contains(event.relatedTarget)
            )
              setColorOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closePalette();
            }
          }}
        >
          <PdfColorPicker
            value={color}
            onChange={(value) => {
              onColorChange(value);
              closePalette();
            }}
          />
        </div>
      )}
    </>
  );
}
