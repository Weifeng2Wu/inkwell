"use client";

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom" | "right";
type Props = {
  /** What the control does. The control keeps its own accessible name. */
  label: string;
  /** Keyboard shortcut shown beside the label, already formatted for the platform. */
  keys?: string;
  side?: Side;
  /** Classes for the wrapper, for controls that must stretch in a flex row. */
  className?: string;
  children: ReactNode;
};

const DELAY = 350;
const GAP = 6;
const MARGIN = 6;

/** A hover and focus hint with an optional keyboard shortcut. Purely visual. */
export function Tooltip({
  label,
  keys,
  side = "bottom",
  className = "inline-flex",
  children,
}: Props) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setAnchor(null);
    setPosition(null);
  }, []);
  const show = (element: HTMLElement, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnchor(element.getBoundingClientRect()), delay);
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!anchor) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", hide, true);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", hide, true);
    };
  }, [anchor, hide]);

  useLayoutEffect(() => {
    const size = tip.current?.getBoundingClientRect();
    if (!anchor || !size) return;
    const centerX = anchor.left + anchor.width / 2 - size.width / 2;
    const centerY = anchor.top + anchor.height / 2 - size.height / 2;
    const below = anchor.bottom + GAP;
    const above = anchor.top - GAP - size.height;
    const fitsBelow = below + size.height <= window.innerHeight - MARGIN;
    const raw =
      side === "right"
        ? { left: anchor.right + GAP, top: centerY }
        : {
            left: centerX,
            top: side === "top" && above >= MARGIN ? above : fitsBelow ? below : above,
          };
    setPosition({
      left: Math.max(MARGIN, Math.min(raw.left, window.innerWidth - size.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(raw.top, window.innerHeight - size.height - MARGIN)),
    });
  }, [anchor, side]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only observes hover and focus of its child.
    <span
      className={className}
      onPointerEnter={(event) => event.pointerType !== "touch" && show(event.currentTarget, DELAY)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(event) => event.target.matches(":focus-visible") && show(event.currentTarget, 0)}
      onBlur={hide}
    >
      {children}
      {anchor &&
        createPortal(
          <div
            ref={tip}
            aria-hidden="true"
            className="motion-fade pointer-events-none fixed z-[10002] flex items-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground shadow-lg"
            style={position ?? { left: 0, top: 0, visibility: "hidden" }}
          >
            {label}
            {keys && <kbd className="kbd-quiet">{keys}</kbd>}
          </div>,
          document.body,
        )}
    </span>
  );
}
