"use client";

import {
  ArchiveIcon,
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowUUpLeftIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useId, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { errorMessage, formatDateTime, formatRelativeTime, useI18n } from "@/features/i18n";
import { readArchive, setArchived } from "../lib/conversation-archive";
import type { AcademicAgentController } from "../lib/use-academic-agent";

export function ConversationHistory({
  agent,
  onClose,
  storageKey,
  onNew,
}: {
  agent: Pick<
    AcademicAgentController,
    | "working"
    | "conversations"
    | "historyPreview"
    | "session"
    | "error"
    | "loadHistory"
    | "previewConversation"
    | "configure"
    | "renameConversation"
    | "deleteConversation"
  >;
  onClose: () => void;
  storageKey?: string;
  onNew?: () => Promise<unknown>;
}) {
  const { locale, t } = useI18n();
  const [archived, setArchive] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload only when the archive changes, not on a language switch.
  useEffect(() => {
    setUndoId(null);
    setArchiveError(null);
    try {
      setArchive(storageKey ? readArchive(storageKey) : []);
    } catch (caught) {
      setArchiveError(errorMessage(caught, t));
    }
  }, [storageKey]);
  function archive(id: string, value: boolean) {
    if (!storageKey) return false;
    try {
      setArchive(setArchived(storageKey, id, value));
      setArchiveError(null);
      return true;
    } catch (caught) {
      setArchiveError(errorMessage(caught, t));
      return false;
    }
  }
  async function open(id: string) {
    if (pending) return;
    setPending(true);
    try {
      if (archived.includes(id) && !archive(id, false)) return;
      if (await agent.configure(true, id)) onClose();
    } finally {
      setPending(false);
    }
  }
  const { working, conversations, session, error } = agent;
  const [query, setQuery] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const searchId = useId();
  const titleId = useId();
  const search = query.trim().toLowerCase();
  const matches = conversations.filter(
    (item) =>
      archived.includes(item.key) === showArchived &&
      `${item.title} ${item.sessionId}`.toLowerCase().includes(search),
  );
  const busy = working || pending;
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label={t("agent.history.title")}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Tooltip label={t("agent.history.back")}>
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label={t("agent.history.back")}
            onClick={onClose}
          >
            <ArrowLeftIcon size={16} aria-hidden="true" />
          </button>
        </Tooltip>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{t("agent.history.title")}</h2>
        <div className="flex items-center gap-1">
          <Tooltip label={t("common.refresh")}>
            <button
              type="button"
              className="toolbar-icon-button"
              disabled={busy}
              aria-label={t("common.refresh")}
              onClick={() => void agent.loadHistory()}
            >
              <ArrowClockwiseIcon size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          {onNew && (
            <Tooltip label={t("agent.newConversation")}>
              <button
                type="button"
                className="toolbar-icon-button"
                disabled={busy}
                aria-label={t("agent.newConversation")}
                onClick={async () => {
                  if (await onNew()) onClose();
                }}
              >
                <PlusIcon size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-busy={busy}>
        {storageKey && (
          <div className="flex gap-1 rounded-lg bg-surface-secondary p-1">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${showArchived === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                aria-pressed={showArchived === value}
                onClick={() => setShowArchived(value)}
              >
                {t(value ? "agent.history.archived" : "agent.history.recent")}
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <MagnifyingGlassIcon
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <label className="sr-only" htmlFor={searchId}>
            {t("agent.history.search")}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("agent.history.search")}
            className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-[13px] text-foreground outline-none focus:border-accent"
          />
        </div>
        {archiveError && (
          <p role="alert" className="text-xs text-error">
            {archiveError}
          </p>
        )}
        {undoId && (
          <div role="status" className="motion-fade flex items-center gap-2 text-xs text-muted">
            <span>{t("agent.history.archivedNotice")}</span>
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => {
                if (archive(undoId, false)) setUndoId(null);
              }}
            >
              {t("common.undo")}
            </button>
          </div>
        )}
        {busy && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("agent.working")}
          </p>
        )}
        {error && (
          <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
            {error}
          </p>
        )}
        {!working && matches.length === 0 && (
          <p className="px-2 py-6 text-center text-[13px] leading-6 text-muted-foreground">
            {t(
              search
                ? "agent.history.emptySearch"
                : showArchived
                  ? "agent.history.emptyArchived"
                  : "agent.history.empty",
            )}
          </p>
        )}
        <div className="divide-y divide-border/60">
          {matches.map((item) => {
            const name = item.title || t("agent.history.untitled");
            return (
              <article key={item.key} className="list-row space-y-1 rounded-md px-2 py-2.5">
                <div className="flex min-w-0 items-center gap-1">
                  <h3 className="min-w-0 truncate text-[13px] font-medium">
                    <button
                      type="button"
                      disabled={busy}
                      className="block max-w-full truncate text-left transition-colors hover:text-accent disabled:cursor-wait"
                      aria-label={t("agent.history.open", { title: name })}
                      title={name}
                      onClick={() => void open(item.key)}
                    >
                      {name}
                    </button>
                  </h3>
                  {session?.sessionId === item.sessionId && (
                    <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
                      {t("agent.history.current")}
                    </span>
                  )}
                  <div className="ml-auto flex shrink-0 items-center">
                    <Tooltip label={t("agent.history.rename")}>
                      <button
                        type="button"
                        className="toolbar-icon-button"
                        disabled={busy}
                        aria-label={t("agent.history.renameItem", { title: name })}
                        onClick={() => {
                          setEditingKey(item.key);
                          setTitle(item.title);
                          setDeletingKey(null);
                        }}
                      >
                        <PencilSimpleIcon size={14} aria-hidden="true" />
                      </button>
                    </Tooltip>
                    {storageKey && (
                      <Tooltip
                        label={t(
                          showArchived ? "agent.history.unarchive" : "agent.history.archive",
                        )}
                      >
                        <button
                          type="button"
                          className="toolbar-icon-button"
                          disabled={pending}
                          aria-label={t(
                            showArchived
                              ? "agent.history.unarchiveItem"
                              : "agent.history.archiveItem",
                            { title: name },
                          )}
                          onClick={() => {
                            if (archive(item.key, !showArchived))
                              setUndoId(showArchived ? null : item.key);
                          }}
                        >
                          {showArchived ? (
                            <ArrowUUpLeftIcon size={15} aria-hidden="true" />
                          ) : (
                            <ArchiveIcon size={15} aria-hidden="true" />
                          )}
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip label={t("common.delete")}>
                      <button
                        type="button"
                        className="toolbar-icon-button hover:text-error"
                        disabled={busy}
                        aria-label={t("agent.history.deleteItem", { title: name })}
                        onClick={() => {
                          setDeletingKey(item.key);
                          setEditingKey(null);
                        }}
                      >
                        <TrashIcon size={15} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
                <time
                  className="block text-xs text-muted-foreground"
                  dateTime={item.modified}
                  title={formatDateTime(item.modified, locale)}
                >
                  {formatRelativeTime(item.modified, locale)}
                </time>
                {editingKey === item.key && (
                  <form
                    className="motion-fade flex items-center gap-1 pt-1"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (await agent.renameConversation(item.key, title)) setEditingKey(null);
                    }}
                  >
                    <label className="sr-only" htmlFor={titleId}>
                      {t("agent.history.titleLabel")}
                    </label>
                    <input
                      id={titleId}
                      value={title}
                      maxLength={200}
                      required
                      disabled={busy}
                      onChange={(event) => setTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setEditingKey(null);
                      }}
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-accent"
                    />
                    <Tooltip label={t("common.save")}>
                      <button
                        type="submit"
                        className="toolbar-icon-button"
                        disabled={busy || !title.trim()}
                        aria-label={t("common.save")}
                      >
                        <CheckIcon size={16} aria-hidden="true" />
                      </button>
                    </Tooltip>
                    <Tooltip label={t("common.cancel")}>
                      <button
                        type="button"
                        className="toolbar-icon-button"
                        aria-label={t("common.cancel")}
                        onClick={() => setEditingKey(null)}
                      >
                        <XIcon size={16} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </form>
                )}
                {deletingKey === item.key && (
                  <div
                    role="alertdialog"
                    aria-label={t("agent.history.deleteItem", { title: name })}
                    className="motion-fade mt-1 space-y-2 rounded-md border border-error/20 bg-error/5 p-3"
                  >
                    <p className="text-xs leading-5 text-foreground-secondary">
                      {t("agent.history.confirmDelete")}
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => setDeletingKey(null)}
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm border-error/40 text-error hover:bg-error/10"
                        disabled={busy}
                        onClick={async () => {
                          if (await agent.deleteConversation(item.key)) {
                            if (archived.includes(item.key)) archive(item.key, false);
                            setDeletingKey(null);
                          }
                        }}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
