"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import { quickStartLabels } from "../lib/labels";
import { QUICK_START_STEPS } from "../lib/quick-start-state";
import { placeTourCard, type TourRect } from "../lib/tour-placement";

const TARGETS = ["workspace", "settings", "main-file", "compile"];
interface Props {
  step: number;
  workspaceReady: boolean;
  workspaceError?: string;
  saveError: boolean;
  onOpenFolder: () => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}

export function QuickStart({
  step,
  workspaceReady,
  workspaceError,
  saveError,
  onOpenFolder,
  onNext,
  onBack,
}: Props) {
  const { locale } = useI18n();
  const l = quickStartLabels[locale];
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [placement, setPlacement] = useState<{
    target: TourRect | null;
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Measure again when the tour moves or the workspace becomes ready.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    const target = document.querySelector<HTMLElement>(`[data-tour="${TARGETS[step]}"]`);
    const update = () => {
      const bounds = target?.getBoundingClientRect();
      const rect =
        bounds && bounds.width > 0 && bounds.height > 0
          ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
          : null;
      setPlacement({
        target: rect,
        ...placeTourCard(
          rect,
          window.innerWidth,
          window.innerHeight,
          panelRef.current?.offsetHeight ?? 300,
        ),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (target) observer.observe(target);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [step, workspaceReady, locale]);

  // Pointer shielding and inert prevent workspace actions; keep keyboard navigation in the guide as well.
  useEffect(() => {
    const shells = [...document.querySelectorAll<HTMLElement>("[data-workspace-shell]")];
    const previous = shells.map((shell) => shell.inert);
    for (const shell of shells) shell.inert = true;
    const focusable = () => [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const redirectFocus = (event: FocusEvent) => {
      if (!panelRef.current?.contains(event.target as Node))
        (nextRef.current?.disabled ? focusable()[0] : nextRef.current)?.focus();
    };
    const trap = (event: KeyboardEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusable()[0]?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = focusable();
      const first = buttons[0];
      const last = buttons.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === headingRef.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === headingRef.current)
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("focusin", redirectFocus);
    document.addEventListener("keydown", trap, true);
    return () => {
      shells.forEach((shell, index) => {
        shell.inert = previous[index] ?? false;
      });
      document.removeEventListener("focusin", redirectFocus);
      document.removeEventListener("keydown", trap, true);
    };
  }, []);

  return (
    <div data-quick-start data-tour-step={TARGETS[step]}>
      <div className="fixed inset-0 z-[55]" aria-hidden="true" data-tour-shield />
      {placement?.target && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[56] rounded-lg border-2 border-accent"
          style={{
            left: placement.target.left - 5,
            top: placement.target.top - 5,
            width: placement.target.width + 10,
            height: placement.target.height + 10,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.35)",
          }}
        />
      )}
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-heading"
        className="fixed z-[60] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl"
        style={
          placement
            ? { left: placement.left, top: placement.top, width: placement.width }
            : { right: 16, bottom: 16, width: "min(400px, calc(100vw - 32px))" }
        }
      >
        <p className="mb-3 text-xs text-accent">
          {l.quickStart} · {step + 1} / {QUICK_START_STEPS}
        </p>
        <h2
          ref={headingRef}
          id="tour-heading"
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          {l.steps[step]}
        </h2>
        <p className="mt-3 text-sm leading-7 text-muted">{l.descriptions[step]}</p>
        {step === 0 && (
          <>
            <button
              type="button"
              className="btn btn-primary mt-4"
              disabled={opening || !isTauri()}
              onClick={async () => {
                setOpening(true);
                setOpenError("");
                try {
                  await onOpenFolder();
                } catch (error) {
                  setOpenError(String(error));
                } finally {
                  setOpening(false);
                }
              }}
            >
              {opening ? "…" : l.chooseFolder}
            </button>
            {workspaceReady && (
              <p role="status" className="mt-3 text-xs text-success">
                {l.workspaceReady}
              </p>
            )}
            {!isTauri() && <p className="mt-3 text-xs leading-6 text-muted">{l.webPreview}</p>}
            {(openError || workspaceError) && (
              <p role="alert" className="mt-3 text-xs text-error">
                {openError || workspaceError}
              </p>
            )}
          </>
        )}
        {saveError && (
          <p role="alert" className="mt-3 text-xs text-error">
            {l.storageError}
          </p>
        )}
        <div className="mt-5 flex justify-end border-t border-border pt-4">
          <button
            type="button"
            className="btn mr-2"
            disabled={step === 0 || opening}
            onClick={onBack}
          >
            {l.back}
          </button>
          <button
            ref={nextRef}
            type="button"
            className="btn btn-primary"
            disabled={!workspaceReady || opening}
            onClick={onNext}
          >
            {l.next}
            <ArrowRightIcon className="ml-1 size-3" />
          </button>
        </div>
      </section>
    </div>
  );
}
