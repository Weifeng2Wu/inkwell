"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  /** Shortcut hint shown on the right, already formatted for the platform. */
  keys?: string;
  /** Draw a hairline above this item to start a new group. */
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MARGIN = 8;

/** Index of the next enabled item from `from` in `direction`, wrapping; -1 when none. */
export function nextEnabledIndex(
  items: readonly { disabled?: boolean }[],
  from: number,
  direction: 1 | -1,
): number {
  const count = items.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (((from + direction * step) % count) + count) % count;
    if (!items[index]?.disabled) return index;
  }
  return -1;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [activeIndex, setActiveIndex] = useState(-1);
  const menuId = useId();

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      setPosition({ x, y });
      return;
    }
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - MARGIN;
    const maxY = window.innerHeight - rect.height - MARGIN;
    setPosition({
      x: Math.max(MARGIN, Math.min(x, maxX)),
      y: Math.max(MARGIN, Math.min(y, maxY)),
    });
  }, [x, y]);

  // Take focus while open and hand it back on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = menuRef.current;
    menu?.focus({ preventScroll: true });
    return () => {
      const current = document.activeElement;
      const lostFocus = !current || current === document.body || menu?.contains(current);
      if (lostFocus && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const activate = useCallback(
    (item: ContextMenuItem | undefined) => {
      if (!item || item.disabled) return;
      item.onClick();
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };

    // Captured at the document so the list underneath never sees these keys.
    const handleKeyDown = (event: KeyboardEvent) => {
      let handled = true;
      switch (event.key) {
        case "Escape":
        case "Tab":
          onClose();
          break;
        case "ArrowDown":
          setActiveIndex((index) => nextEnabledIndex(items, index, 1));
          break;
        case "ArrowUp":
          setActiveIndex((index) => nextEnabledIndex(items, index < 0 ? 0 : index, -1));
          break;
        case "Home":
          setActiveIndex(nextEnabledIndex(items, -1, 1));
          break;
        case "End":
          setActiveIndex(nextEnabledIndex(items, 0, -1));
          break;
        case "Enter":
        case " ":
          activate(items[activeIndex]);
          break;
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activate, activeIndex, items, onClose]);

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-activedescendant={activeIndex >= 0 ? `${menuId}-${activeIndex}` : undefined}
      // The menu is a React child of its list: keep typed keys from reaching the list's handler.
      onKeyDown={(event) => event.stopPropagation()}
      className="motion-pop fixed z-50 min-w-[180px] rounded-lg border border-border bg-background py-1 text-foreground shadow-2xl outline-none"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      {items.map((item, index) => (
        <div key={item.label} role="none">
          {item.separator && index > 0 && <hr className="my-1 border-border" />}
          <button
            type="button"
            role="menuitem"
            id={`${menuId}-${index}`}
            tabIndex={-1}
            disabled={item.disabled}
            data-active={index === activeIndex ? "true" : undefined}
            onClick={() => activate(item)}
            onMouseEnter={() => setActiveIndex(item.disabled ? -1 : index)}
            className={`list-row flex min-h-7 w-full items-center gap-2 px-3 py-1 text-left text-[13px] outline-none ${
              item.disabled ? "pointer-events-none opacity-50" : item.danger ? "text-error" : ""
            }`}
          >
            {item.icon && <span className="h-4 w-4 shrink-0">{item.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.keys && <kbd className="kbd-quiet ml-4 shrink-0 text-muted">{item.keys}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );

  if (typeof document === "undefined") return menu;
  return createPortal(menu, document.body);
}
