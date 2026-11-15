"use client";

import {
  ArrowSquareOutIcon,
  DotsThreeIcon,
  FilePdfIcon,
  NotebookIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  QuotesIcon,
  SquareSplitHorizontalIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { pdfNotesPath } from "@/features/editor/lib/pdf-notes";
import { useI18n } from "@/features/i18n";
import { type LibraryItem, referenceLinks } from "../lib/library";
import { STATUS_DOT } from "./library-row";

type Props = {
  item: LibraryItem;
  /** The tag the list is filtered by, if any. */
  tag: string | null;
  /** Shortcut label for citing the current row. */
  citeKeys: string;
  onOpenFile: (path: string) => void;
  onOpenBeside: (path: string) => void;
  onCite: (item: LibraryItem) => void;
  onEditEntry: (item: LibraryItem) => void;
  onAttach: (item: LibraryItem) => void;
  onTag: (tag: string) => void;
  onMenu: (item: LibraryItem, x: number, y: number) => void;
};

const ACTION =
  "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2 text-xs text-foreground transition-colors duration-150 hover:border-border-dark hover:bg-surface-secondary";

function Action({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={ACTION} onClick={onClick}>
      {children}
    </button>
  );
}

function openExternal(url: string) {
  void import("@tauri-apps/plugin-shell").then(({ open }) => open(url));
}

/** The selected reference in full: title, every author, venue, links, tags and actions. */
export function LibraryDetails({
  item,
  tag,
  citeKeys,
  onOpenFile,
  onOpenBeside,
  onCite,
  onEditEntry,
  onAttach,
  onTag,
  onMenu,
}: Props) {
  const { t } = useI18n();
  const { file } = item;
  const links = referenceLinks(item);
  const published = [item.venue, item.year].filter(Boolean);

  return (
    <section
      aria-label={t("library.details")}
      className="motion-rise max-h-[46%] flex-shrink-0 overflow-y-auto border-t border-border bg-surface-secondary/40 px-3 py-3"
    >
      <h3 className="font-reading select-text text-[15px] leading-snug text-foreground">
        {item.title || item.key}
      </h3>
      {item.authors.length > 0 && (
        <p className="mt-1.5 select-text text-xs leading-relaxed text-foreground/80">
          {item.authors.join(", ")}
        </p>
      )}
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs leading-relaxed text-muted">
        <span
          aria-hidden="true"
          className={`size-2 flex-shrink-0 rounded-full ${STATUS_DOT[item.status]}`}
        />
        <span>{t(`library.status.${item.status}`)}</span>
        {published.length > 0 && <span className="select-text">· {published.join(" · ")}</span>}
      </p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="select-text break-all font-mono text-[11px] text-muted">{item.key}</span>
        {links.map((link) => (
          <button
            key={link.kind}
            type="button"
            title={link.url}
            className="inline-flex max-w-full items-center gap-1 text-accent hover:underline"
            onClick={() => openExternal(link.url)}
          >
            <span className="truncate">{link.label}</span>
            <ArrowSquareOutIcon aria-hidden="true" className="size-3 flex-shrink-0" />
          </button>
        ))}
      </p>
      {item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={t("library.filterByTag", { tag: value })}
              aria-pressed={tag?.toLowerCase() === value.toLowerCase()}
              className={`max-w-full truncate rounded-full px-2 py-0.5 text-[11px] transition-colors duration-150 ${
                tag?.toLowerCase() === value.toLowerCase()
                  ? "bg-accent-hover text-accent"
                  : "bg-surface-tertiary text-muted hover:text-foreground"
              }`}
              onClick={() => onTag(value)}
            >
              {value}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {file ? (
          <>
            <Action onClick={() => onOpenFile(file)}>
              <FilePdfIcon aria-hidden="true" className="size-3.5" />
              {t("library.openPdf")}
            </Action>
            <Action onClick={() => onOpenBeside(file)}>
              <SquareSplitHorizontalIcon aria-hidden="true" className="size-3.5" />
              {t("library.openBeside")}
            </Action>
            <Action onClick={() => onOpenBeside(pdfNotesPath(file))}>
              <NotebookIcon aria-hidden="true" className="size-3.5" />
              {t("library.openNotes")}
            </Action>
          </>
        ) : (
          <Action onClick={() => onAttach(item)}>
            <PaperclipIcon aria-hidden="true" className="size-3.5" />
            {t("library.attachPdf")}
          </Action>
        )}
        <Tooltip label={t("library.cite")} keys={citeKeys}>
          <Action onClick={() => onCite(item)}>
            <QuotesIcon aria-hidden="true" className="size-3.5" />
            {t("library.cite")}
          </Action>
        </Tooltip>
        <Action onClick={() => onEditEntry(item)}>
          <PencilSimpleIcon aria-hidden="true" className="size-3.5" />
          {t("library.editBibtex")}
        </Action>
        <Tooltip label={t("library.moreActions")}>
          <button
            type="button"
            aria-label={t("library.moreActions")}
            className={`${ACTION} px-1.5`}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              onMenu(item, box.left, box.bottom + 4);
            }}
          >
            <DotsThreeIcon aria-hidden="true" weight="bold" className="size-4" />
          </button>
        </Tooltip>
      </div>
    </section>
  );
}
