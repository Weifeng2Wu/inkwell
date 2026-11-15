"use client";

import {
  BooksIcon,
  FileArrowDownIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PlusIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContextMenu } from "@/components/ui/context-menu";
import { InputDialog } from "@/components/ui/input-dialog";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { PanelAction, PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/features/i18n";
import { shortcutLabel } from "@/features/settings";
import { eventRow, isMenuKey, listRows, moveRowFocus, typedCharacter } from "@/lib/list-navigation";
import { pathSync } from "@/lib/path";
import { appStorage } from "@/lib/storage/app-storage";
import {
  LIBRARY_SORT_STORAGE_KEY,
  type LibraryItem,
  type LibrarySortOrder,
  parseSortOrder,
  READING_STATUSES,
  type ReadingStatus,
  searchLibrary,
  sortLibrary,
} from "../lib/library";
import type { LibraryController } from "../lib/use-library";
import { AddReferenceDialog } from "./add-reference-dialog";
import { LibraryDetails } from "./library-details";
import { choosePdfs, libraryMenuItems } from "./library-menu";
import { LibraryRow } from "./library-row";
import { LibrarySortMenu } from "./library-sort-menu";

type Props = {
  projectPath: string | null;
  library: LibraryController;
  selectedFile?: string;
  onOpenFile: (path: string) => void;
  /** Opens a file next to the current document instead of replacing it. */
  onOpenBeside: (path: string) => void;
  /** Opens the entry's BibTeX source at its definition. */
  onEditEntry: (item: LibraryItem) => void;
  /** Inserts a citation at the cursor of the document being written. */
  onCite: (item: LibraryItem) => void;
};

const CITE_KEYS = "Mod+Enter";

function storedSortOrder(): LibrarySortOrder {
  try {
    return parseSortOrder(appStorage.getItem(LIBRARY_SORT_STORAGE_KEY));
  } catch {
    return "added";
  }
}

export function LibrarySidebarPanel({
  projectPath,
  library: controller,
  selectedFile,
  onOpenFile,
  onOpenBeside,
  onEditEntry,
  onCite,
}: Props) {
  const { t } = useI18n();
  const { library, busy, manualAdd } = controller;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ReadingStatus | "all">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [order, setOrder] = useState(storedSortOrder);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
  const [removing, setRemoving] = useState<LibraryItem | null>(null);
  const [tagging, setTagging] = useState<LibraryItem | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const visible = useMemo(
    () => searchLibrary(sortLibrary(library.items, order), query, status, tag),
    [library.items, order, query, status, tag],
  );
  const active = visible.find((item) => item.key === activeKey);
  const citeKeys = shortcutLabel(CITE_KEYS);

  if (!projectPath) {
    return (
      <>
        <PanelHeader title={t("workbench.views.library")} />
        <PanelEmpty icon={<BooksIcon className="size-7" />} title={t("library.noProject")} />
      </>
    );
  }

  const importPdfs = () =>
    void choosePdfs(true).then((sources) => {
      if (sources.length) void controller.importSources(sources);
    });
  const attach = (item: LibraryItem) =>
    void choosePdfs(false).then(([source]) => {
      if (source) void controller.attach(item, source);
    });
  const setReadingStatus = (item: LibraryItem, value: ReadingStatus) =>
    void controller.update(item, { readstatus: value === "unread" ? "" : value });
  const toggleTag = (value: string) =>
    setTag((current) => (current?.toLowerCase() === value.toLowerCase() ? null : value));
  const changeOrder = (value: LibrarySortOrder) => {
    setOrder(value);
    try {
      appStorage.setItem(LIBRARY_SORT_STORAGE_KEY, value);
    } catch {
      // The order still applies for this session.
    }
  };
  const openItem = (item: LibraryItem) => (item.file ? onOpenFile(item.file) : onEditEntry(item));
  const openMenu = (item: LibraryItem, x: number, y: number) => setMenu({ x, y, item });
  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setTag(null);
  };
  const focusSearch = (typed = "") => {
    if (typed) setQuery((current) => current + typed);
    searchInput.current?.focus();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
    if (event.key !== "ArrowDown" || !list.current) return;
    const rows = listRows(list.current);
    const current = rows.find((row) => row.dataset.key === activeKey) ?? rows[0];
    if (!current) return;
    event.preventDefault();
    current.focus();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const row = eventRow(event.target);
    if (!row) return;
    // ↑ on the first row returns to the search field.
    if (event.key === "ArrowUp" && listRows(event.currentTarget)[0] === row) {
      event.preventDefault();
      return focusSearch();
    }
    if (moveRowFocus(event)) return;
    const item = visible.find((candidate) => candidate.key === row.dataset.key);
    if (item && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      return onCite(item);
    }
    if (item && isMenuKey(event)) {
      event.preventDefault();
      const box = row.getBoundingClientRect();
      return openMenu(item, box.left + 24, box.top + 24);
    }
    const typed = typedCharacter(event);
    if (typed === null) return;
    event.preventDefault();
    focusSearch(typed === "/" ? "" : typed);
  };

  const empty = library.items.length === 0 && library.unlinked.length === 0;
  const filtered = visible.length !== library.items.length;
  const count = filtered
    ? t("library.countFiltered", { shown: visible.length, total: library.items.length })
    : t("library.count", { count: library.items.length, s: library.items.length === 1 ? "" : "s" });

  return (
    <>
      <PanelHeader title={t("workbench.views.library")}>
        <LibrarySortMenu order={order} onChange={changeOrder} />
        <PanelAction label={t("library.importPdf")} disabled={!!busy} onClick={importPdfs}>
          <FileArrowDownIcon className="size-4" aria-hidden="true" />
        </PanelAction>
        <PanelAction
          label={t("library.addReference")}
          disabled={!!busy}
          onClick={() => controller.setManualAdd({})}
        >
          <PlusIcon className="size-4" aria-hidden="true" />
        </PanelAction>
        <PanelAction
          label={t("library.digest")}
          disabled={!!busy || library.items.length === 0}
          onClick={() => void controller.writeDigest().then((path) => path && onOpenFile(path))}
        >
          <NotePencilIcon className="size-4" aria-hidden="true" />
        </PanelAction>
      </PanelHeader>
      {busy && (
        <p
          role="status"
          className="motion-fade flex items-center gap-2 border-b border-border bg-surface-secondary px-3 py-1.5 text-xs text-muted"
        >
          <Spinner className="size-3.5 flex-shrink-0" />
          <span className="truncate">{busy}</span>
        </p>
      )}
      {empty ? (
        <PanelEmpty
          icon={<BooksIcon className="size-7" />}
          title={t("library.emptyTitle")}
          description={t("library.emptyDescription")}
        >
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary whitespace-nowrap"
              disabled={!!busy}
              onClick={importPdfs}
            >
              {t("library.importPdf")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary whitespace-nowrap"
              disabled={!!busy}
              onClick={() => controller.setManualAdd({})}
            >
              {t("library.addReference")}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("library.emptyDrop")}</p>
        </PanelEmpty>
      ) : (
        <>
          <div className="space-y-1.5 border-b border-border px-3 py-2">
            <div className="relative">
              <MagnifyingGlassIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted"
              />
              <input
                ref={searchInput}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                aria-label={t("library.search")}
                placeholder={t("library.search")}
                className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[13px] transition-colors duration-150 placeholder:text-muted-foreground focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-0.5">
              {(["all", ...READING_STATUSES] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={status === value}
                  className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs transition-colors duration-150 ${
                    status === value
                      ? "bg-accent-hover text-accent"
                      : "text-muted hover:bg-surface-secondary hover:text-foreground"
                  }`}
                  onClick={() => setStatus(value)}
                >
                  {t(`library.status.${value}`)}
                </button>
              ))}
              <span
                title={count}
                className="ml-auto flex-shrink-0 pl-1 text-[11px] tabular-nums text-muted-foreground"
              >
                <span className="sr-only">{count}</span>
                <span aria-hidden="true">
                  {filtered ? `${visible.length}/${library.items.length}` : library.items.length}
                </span>
              </span>
            </div>
            {tag && (
              <div className="motion-fade flex">
                <button
                  type="button"
                  aria-label={t("library.clearTag", { tag })}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-hover py-0.5 pl-2 pr-1.5 text-[11px] text-accent transition-colors duration-150 hover:bg-accent/20"
                  onClick={() => setTag(null)}
                >
                  <span className="truncate">#{tag}</span>
                  <XIcon aria-hidden="true" weight="bold" className="size-3 flex-shrink-0" />
                </button>
              </div>
            )}
          </div>
          <ScrollArea className="min-h-0 flex-1" autoHide="leave">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: keys bubble up from the rows, which are buttons. */}
            <div ref={list} onKeyDown={onListKeyDown}>
              {visible.length === 0 && library.items.length > 0 && (
                <div className="motion-fade px-4 py-6 text-center text-xs text-muted">
                  <p>{t("library.noMatch")}</p>
                  <button
                    type="button"
                    className="mt-2 text-accent hover:underline"
                    onClick={clearFilters}
                  >
                    {t("library.clearFilters")}
                  </button>
                </div>
              )}
              <ul aria-label={t("library.listLabel")}>
                {visible.map((item, index) => (
                  <LibraryRow
                    key={item.key}
                    item={item}
                    index={index}
                    active={item.key === active?.key}
                    tabbable={active ? item.key === active.key : index === 0}
                    open={!!item.file && item.file === selectedFile}
                    tag={tag}
                    busy={!!busy}
                    citeKeys={citeKeys}
                    onSelect={(selected) => setActiveKey(selected.key)}
                    onOpen={openItem}
                    onOpenBeside={onOpenBeside}
                    onCite={onCite}
                    onStatus={setReadingStatus}
                    onTag={toggleTag}
                    onMenu={openMenu}
                  />
                ))}
              </ul>
              {library.unlinked.length > 0 && (
                <section>
                  <h3 className="section-label px-3 pb-1 pt-3">{t("library.unlinked")}</h3>
                  <ul>
                    {library.unlinked.map((path) => (
                      <li key={path} className="list-row flex h-7 items-center gap-1 pl-3 pr-1.5">
                        <button
                          type="button"
                          data-list-row
                          tabIndex={-1}
                          className="min-w-0 flex-1 truncate text-left text-[13px] outline-none focus-visible:text-accent"
                          title={path}
                          onClick={() => onOpenFile(path)}
                        >
                          {pathSync.basename(path)}
                        </button>
                        <PanelAction
                          label={t("library.identify")}
                          disabled={!!busy}
                          onClick={() => void controller.identify([path])}
                        >
                          <SparkleIcon className="size-4" aria-hidden="true" />
                        </PanelAction>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </ScrollArea>
          {active && (
            <LibraryDetails
              key={active.key}
              item={active}
              tag={tag}
              citeKeys={citeKeys}
              onOpenFile={onOpenFile}
              onOpenBeside={onOpenBeside}
              onCite={onCite}
              onEditEntry={onEditEntry}
              onAttach={attach}
              onTag={toggleTag}
              onMenu={openMenu}
            />
          )}
        </>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={libraryMenuItems(menu.item, {
            t,
            onCite,
            onOpenBeside,
            onAttach: attach,
            onStatus: setReadingStatus,
            onEditTags: setTagging,
            onEditEntry,
            onRemove: setRemoving,
          })}
          onClose={() => setMenu(null)}
        />
      )}
      {manualAdd && (
        <AddReferenceDialog
          initialQuery={manualAdd.query}
          onAdd={(reference) => void controller.add(reference, manualAdd.file)}
          onClose={() => controller.setManualAdd(null)}
        />
      )}
      {tagging && (
        <InputDialog
          title={t("library.editTags")}
          placeholder={t("library.tagsPlaceholder")}
          defaultValue={tagging.tags.join(", ")}
          onCancel={() => setTagging(null)}
          onConfirm={(value) => {
            setTagging(null);
            const tags = value
              .split(/[,;，；]/)
              .map((entry) => entry.trim())
              .filter(Boolean);
            void controller.update(tagging, { keywords: [...new Set(tags)].join(", ") });
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t("library.removeTitle")}
          message={t("library.removeMessage", { key: removing.key })}
          confirmLabel={t("common.remove")}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setRemoving(null);
            void controller.remove(removing);
          }}
        />
      )}
    </>
  );
}
