import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

type Options = {
  onCancel: () => void;
  onConfirm: () => void;
  /** Receives focus when the dialog opens. */
  initialFocus: RefObject<HTMLElement | null>;
};

/**
 * Shared keyboard and focus behaviour for modal dialogs: focus moves in on open and
 * returns to the previous element on close, Tab stays inside, Esc cancels and Enter
 * confirms (unless a button has focus, which then acts as itself, or an IME is composing).
 */
export function useModalDialog<T extends HTMLElement>({
  onCancel,
  onConfirm,
  initialFocus,
}: Options) {
  const containerRef = useRef<T>(null);
  const handlers = useRef({ onCancel, onConfirm });
  handlers.current = { onCancel, onConfirm };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    initialFocus.current?.focus({ preventScroll: true });
    return () => {
      const current = document.activeElement;
      const lostFocus = !current || current === document.body || container?.contains(current);
      if (lostFocus && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [initialFocus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onCancel();
        return;
      }
      if (event.key === "Enter") {
        if (event.isComposing || event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onConfirm();
        return;
      }
      if (event.key !== "Tab" || !container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const outside = !container.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  return containerRef;
}
