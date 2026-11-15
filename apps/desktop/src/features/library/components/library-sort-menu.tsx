"use client";

import { ArrowsDownUpIcon, CheckIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";
import { moveRowFocus } from "@/lib/list-navigation";
import { LIBRARY_SORT_ORDERS, type LibrarySortOrder } from "../lib/library";

type Props = {
  order: LibrarySortOrder;
  onChange: (order: LibrarySortOrder) => void;
};

/** The button that shows how the reference list is ordered, and its menu of orders. */
export function LibrarySortMenu({ order, onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = t("library.sort.current", { order: t(`library.sort.${order}`) });

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      const inside = (element: HTMLElement | null) =>
        event.target instanceof Node && element?.contains(event.target);
      if (!inside(menu.current) && !inside(trigger.current)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="relative flex-shrink-0">
      <Tooltip label={label}>
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((shown) => !shown)}
          className={`flex size-6 items-center justify-center rounded-md transition-colors duration-150 ${
            open || order !== "added"
              ? "bg-accent-hover text-accent"
              : "text-muted hover:bg-surface-secondary hover:text-foreground"
          }`}
        >
          <ArrowsDownUpIcon className="size-4" aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={t("library.sort.label")}
          className="motion-pop absolute right-0 top-full z-30 mt-1 min-w-40 rounded-lg border border-border bg-background py-1 text-foreground shadow-2xl"
          onKeyDown={(event) => {
            if (moveRowFocus(event)) return;
            if (event.key !== "Escape" && event.key !== "Tab") return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <div className="section-label px-3 pb-1 pt-1.5">{t("library.sort.label")}</div>
          {LIBRARY_SORT_ORDERS.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={value === order}
              tabIndex={-1}
              data-list-row
              className="list-row flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none focus-visible:bg-accent-hover"
              onClick={() => {
                onChange(value);
                close();
              }}
            >
              <CheckIcon
                aria-hidden="true"
                weight="bold"
                className={`size-3.5 flex-shrink-0 text-accent ${value === order ? "" : "invisible"}`}
              />
              {t(`library.sort.${value}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
