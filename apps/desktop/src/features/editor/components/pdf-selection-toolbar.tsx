"use client";

import {
  CaretDownIcon,
  HighlighterIcon,
  NoteIcon,
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
import { useI18n } from "@/features/i18n";
import type { PdfAnnotationColor } from "../lib/pdf-notes";
import { type PdfToolbarAnchor, pdfToolbarPosition } from "../lib/pdf-toolbar-position";
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
  const activeAction = !writable && focusedAction < 3 ? 3 : focusedAction;

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

  const actions = [
    {
      label: "pdfReading.highlight",
      Icon: HighlighterIcon,
      onClick: onHighlight,
      disabled: !writable,
    },
    {
      label: "pdfReading.underline",
      Icon: TextUnderlineIcon,
      onClick: onUnderline,
      disabled: !writable,
    },
    { label: "pdfReading.addNote", Icon: NoteIcon, onClick: onNote, disabled: !writable },
    { label: "translation.action", Icon: TranslateIcon, onClick: onTranslate, disabled: false },
  ];

  return (
    <>
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label={t("pdfReading.selectionActions")}
        aria-orientation="horizontal"
        className="absolute z-20 flex max-w-[calc(100%-1rem)] select-none items-center gap-1 overflow-x-auto rounded-lg border border-border bg-background p-1 text-foreground shadow-lg"
        style={position}
        onKeyDown={handleToolbarKey}
        onPointerDown={(event) => {
          if (event.button === 0 && event.pointerType !== "touch") event.preventDefault();
        }}
      >
        {actions.map(({ label, Icon, onClick, disabled }, index) => (
          <span key={label} className="contents">
            {index === 2 && (
              <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
            )}
            <button
              type="button"
              className="toolbar-icon-button shrink-0"
              aria-label={t(label)}
              title={t(label)}
              disabled={disabled}
              tabIndex={activeAction === index ? 0 : -1}
              onFocus={() => setFocusedAction(index)}
              onClick={onClick}
            >
              <Icon aria-hidden="true" className="size-4" />
            </button>
          </span>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
        <button
          ref={colorButtonRef}
          type="button"
          className="toolbar-icon-button shrink-0 gap-1"
          aria-label={t("pdfReading.color")}
          title={`${t("pdfReading.color")}: ${t(`pdfReading.colors.${color}`)}`}
          aria-haspopup="dialog"
          aria-expanded={colorOpen}
          aria-controls={colorOpen ? paletteId : undefined}
          data-state={colorOpen ? "open" : "closed"}
          tabIndex={activeAction === 4 ? 0 : -1}
          onFocus={() => setFocusedAction(4)}
          onClick={() => setColorOpen((open) => !open)}
        >
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: `var(--${color})` }}
          />
          <CaretDownIcon aria-hidden="true" className="size-2.5 shrink-0" />
        </button>
      </div>
      {colorOpen && (
        <div
          ref={paletteRef}
          id={paletteId}
          role="dialog"
          aria-label={t("pdfReading.color")}
          className="absolute z-30 max-w-[calc(100%-1rem)] overflow-x-auto rounded-lg border border-border bg-background p-1 text-foreground shadow-lg"
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
