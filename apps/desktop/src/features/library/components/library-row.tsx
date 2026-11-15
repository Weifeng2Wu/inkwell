"use client";

import { FilePdfIcon, QuotesIcon, SquareSplitHorizontalIcon } from "@phosphor-icons/react";
import type { CSSProperties, MouseEvent } from "react";
import { RowAction } from "@/components/ui/row-action";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";
import {
  type LibraryItem,
  nextReadingStatus,
  type ReadingStatus,
  shortAuthors,
} from "../lib/library";

export const STATUS_DOT: Record<ReadingStatus, string> = {
  unread: "border border-border-dark",
  reading: "bg-warning",
  read: "bg-success",
};

/** Tags shown on a row; the rest are counted. */
const ROW_TAGS = 3;

type Props = {
  item: LibraryItem;
  /** Position in the list, for the staggered entrance. */
  index: number;
  /** The current row: its details are shown and it is the list's tab stop. */
  active: boolean;
  tabbable: boolean;
  /** Its PDF is the document in front. */
  open: boolean;
  /** The tag the list is filtered by, if any. */
  tag: string | null;
  /** Another library operation is running; status changes wait for it. */
  busy: boolean;
  /** Shortcut label for citing the current row. */
  citeKeys: string;
  onSelect: (item: LibraryItem) => void;
  onOpen: (item: LibraryItem) => void;
  onOpenBeside: (path: string) => void;
  onCite: (item: LibraryItem) => void;
  onStatus: (item: LibraryItem, status: ReadingStatus) => void;
  onTag: (tag: string) => void;
  onMenu: (item: LibraryItem, x: number, y: number) => void;
};

/** One reference in the library list: status, title, byline, tags and hover actions. */
export function LibraryRow({
  item,
  index,
  active,
  tabbable,
  open,
  tag,
  busy,
  citeKeys,
  onSelect,
  onOpen,
  onOpenBeside,
  onCite,
  onStatus,
  onTag,
  onMenu,
}: Props) {
  const { t } = useI18n();
  const { file } = item;
  const next = nextReadingStatus(item.status);
  const statusHint = t("library.statusHint", {
    status: t(`library.status.${item.status}`),
    next: t(`library.status.${next}`),
  });
  const byline = [shortAuthors(item), item.year, item.venue].filter(Boolean).join(" · ");
  const hidden = item.tags.length - ROW_TAGS;

  return (
    <li
      data-active={active}
      className="list-row motion-stagger group relative flex items-start gap-2 border-b border-border px-3 py-2"
      style={{ "--i": index } as CSSProperties}
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        onMenu(item, event.clientX, event.clientY);
      }}
    >
      <Tooltip label={statusHint} className="relative z-10 mt-[3px] inline-flex flex-shrink-0">
        <button
          type="button"
          tabIndex={-1}
          aria-label={statusHint}
          disabled={busy}
          onClick={() => onStatus(item, next)}
          className="flex size-4 items-center justify-center rounded-full transition-colors duration-150 hover:bg-surface-tertiary disabled:pointer-events-none"
        >
          <span className={`size-2 rounded-full ${STATUS_DOT[item.status]}`} />
        </button>
      </Tooltip>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          data-list-row
          data-key={item.key}
          tabIndex={tabbable ? 0 : -1}
          aria-current={open ? "true" : undefined}
          className="block w-full text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-1 focus-visible:after:ring-inset focus-visible:after:ring-accent"
          onFocus={() => onSelect(item)}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onOpen(item);
          }}
        >
          <span className="font-reading line-clamp-2 text-sm leading-snug text-foreground">
            {item.title || item.key}
          </span>
          {(byline || file) && (
            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <span className="truncate">{byline}</span>
              {file && (
                <FilePdfIcon
                  aria-hidden="true"
                  className={`size-3 flex-shrink-0 ${open ? "text-accent" : ""}`}
                />
              )}
            </span>
          )}
        </button>
        {item.tags.length > 0 && (
          <div className="relative z-10 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            {item.tags.slice(0, ROW_TAGS).map((value) => (
              <button
                key={value}
                type="button"
                tabIndex={-1}
                aria-label={t("library.filterByTag", { tag: value })}
                className={`max-w-full truncate transition-colors duration-150 hover:text-accent ${
                  tag?.toLowerCase() === value.toLowerCase()
                    ? "text-accent"
                    : "text-muted-foreground"
                }`}
                onClick={() => onTag(value)}
              >
                #{value}
              </button>
            ))}
            {hidden > 0 && <span className="text-muted-foreground">+{hidden}</span>}
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute right-2 top-1.5 z-10 flex gap-0.5 rounded-md bg-background opacity-0 ring-1 ring-border transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100">
        <RowAction label={t("library.cite")} keys={citeKeys} onClick={() => onCite(item)}>
          <QuotesIcon className="size-4" aria-hidden="true" />
        </RowAction>
        {file && (
          <RowAction label={t("library.openBeside")} onClick={() => onOpenBeside(file)}>
            <SquareSplitHorizontalIcon className="size-4" aria-hidden="true" />
          </RowAction>
        )}
      </div>
    </li>
  );
}
