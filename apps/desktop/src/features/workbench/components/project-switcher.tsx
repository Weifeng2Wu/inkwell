"use client";

import { CaretUpDownIcon, FolderOpenIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import { pathSync } from "@/lib/path";

type Props = {
  projectPath: string | null;
  recent: readonly { path: string; name: string }[];
  disabled: boolean;
  /** Shortcut label for opening a folder. */
  keys?: string;
  onOpenFolder: () => void;
  onSelect: (path: string) => void;
};

/** The project name in the header; opens a menu of recent projects. */
export function ProjectSwitcher({
  projectPath,
  recent,
  disabled,
  keys,
  onOpenFolder,
  onSelect,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const others = recent.filter((project) => project.path !== projectPath).slice(0, 6);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  const item =
    "list-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]";

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (projectPath || others.length ? setOpen((shown) => !shown) : onOpenFolder())}
        className="flex min-w-0 max-w-64 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors duration-150 hover:bg-surface-secondary disabled:opacity-50"
      >
        <span className="truncate">
          {projectPath ? pathSync.basename(projectPath) : t("workbench.project.open")}
        </span>
        <CaretUpDownIcon className="size-3.5 flex-shrink-0 text-muted" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="motion-pop absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-background p-1 shadow-2xl"
        >
          {others.length > 0 && (
            <>
              <div className="section-label px-2 pb-1 pt-1.5">{t("workbench.project.recent")}</div>
              {others.map((project) => (
                <button
                  key={project.path}
                  type="button"
                  role="menuitem"
                  className={item}
                  title={project.path}
                  onClick={() => choose(() => onSelect(project.path))}
                >
                  <span className="truncate">{project.name}</span>
                  <span className="ml-auto max-w-[55%] flex-shrink-0 truncate font-mono text-[11px] text-muted">
                    {pathSync.dirname(project.path)}
                  </span>
                </button>
              ))}
              <div className="my-1 border-t border-border" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => choose(onOpenFolder)}
          >
            <FolderOpenIcon className="size-4 flex-shrink-0 text-muted" aria-hidden="true" />
            <span className="flex-1">{t("workbench.project.openFolder")}</span>
            {keys && <kbd className="kbd-quiet">{keys}</kbd>}
          </button>
        </div>
      )}
    </div>
  );
}
