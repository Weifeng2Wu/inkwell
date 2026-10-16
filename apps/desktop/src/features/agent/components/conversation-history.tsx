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
import { useI18n } from "@/features/i18n";
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
    | "labels"
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
  const words = {
    recent: t("interface.recent"),
    archived: t("interface.archived"),
    archive: t("interface.archive"),
    restore: t("interface.restore"),
    undo: t("interface.undo"),
    notice: t("interface.notice"),
    localOnly: t("interface.localOnly"),
  };
  const [archived, setArchive] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setUndoId(null);
    setArchiveError(null);
    try {
      setArchive(storageKey ? readArchive(storageKey) : []);
    } catch (caught) {
      setArchiveError(String(caught));
    }
  }, [storageKey]);
  function archive(id: string, value: boolean) {
    if (!storageKey) return false;
    try {
      setArchive(setArchived(storageKey, id, value));
      setArchiveError(null);
      return true;
    } catch (caught) {
      setArchiveError(String(caught));
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
  const { labels, working, conversations, session, error } = agent;
  const [query, setQuery] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const searchId = useId();
  const titleId = useId();
  const matches = conversations.filter(
    (item) =>
      archived.includes(item.key) === showArchived &&
      `${item.title} ${item.sessionId}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label={labels.history}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label={labels.backToChat}
          title={labels.backToChat}
          onClick={onClose}
        >
          <ArrowLeftIcon size={16} aria-hidden="true" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{t("interface.history")}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="toolbar-icon-button"
            disabled={working || pending}
            aria-label={labels.refreshHistory}
            title={labels.refreshHistory}
            onClick={() => void agent.loadHistory()}
          >
            <ArrowClockwiseIcon size={16} aria-hidden="true" />
          </button>
          {onNew && (
            <button
              type="button"
              className="toolbar-icon-button"
              disabled={working || pending}
              aria-label={labels.newSession}
              title={labels.newSession}
              onClick={async () => {
                if (await onNew()) onClose();
              }}
            >
              <PlusIcon size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-busy={working || pending}>
        {storageKey && (
          <div className="flex gap-1 rounded-lg bg-surface-secondary p-1">
            <button
              type="button"
              className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${!showArchived ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              aria-pressed={!showArchived}
              onClick={() => setShowArchived(false)}
            >
              {words.recent}
            </button>
            <button
              type="button"
              className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${showArchived ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              aria-pressed={showArchived}
              onClick={() => setShowArchived(true)}
            >
              {words.archived}
            </button>
          </div>
        )}
        <div className="relative">
          <MagnifyingGlassIcon
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <label className="sr-only" htmlFor={searchId}>
            {labels.searchHistory}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.searchHistory}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm text-foreground outline-none focus:border-accent"
          />
        </div>
        {archiveError && (
          <p role="alert" className="text-xs text-error">
            {archiveError}
          </p>
        )}
        {undoId && (
          <div role="status" className="flex items-center gap-2 text-xs text-muted">
            <span>{words.notice}</span>
            <button
              type="button"
              className="text-accent"
              onClick={() => {
                if (archive(undoId, false)) setUndoId(null);
              }}
            >
              {words.undo}
            </button>
          </div>
        )}
        {(working || pending) && (
          <p role="status" className="text-xs text-muted-foreground">
            {labels.busy}
          </p>
        )}
        {error && (
          <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
            {error}
          </p>
        )}
        {!working && matches.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{labels.noHistory}</p>
        )}
        <div className="divide-y divide-border/60">
          {matches.map((item) => (
            <article
              key={item.key}
              className="space-y-2 rounded-lg px-2 py-3 transition-colors hover:bg-surface/50"
            >
              <div className="flex min-w-0 items-center gap-1">
                <h3 className="min-w-0 truncate text-sm font-medium">
                  <button
                    type="button"
                    disabled={working || pending}
                    className="block max-w-full truncate text-left transition-colors hover:text-accent disabled:cursor-wait"
                    aria-label={`${labels.continueConversation}: ${item.title || labels.untitledConversation}`}
                    title={item.title || labels.untitledConversation}
                    onClick={() => void open(item.key)}
                  >
                    {item.title || labels.untitledConversation}
                  </button>
                </h3>
                <button
                  type="button"
                  className="toolbar-icon-button"
                  disabled={working || pending}
                  aria-label={`${labels.renameConversation}: ${item.title || labels.untitledConversation}`}
                  title={labels.renameConversation}
                  onClick={() => {
                    setEditingKey(item.key);
                    setTitle(item.title);
                    setDeletingKey(null);
                  }}
                >
                  <PencilSimpleIcon size={14} aria-hidden="true" />
                </button>
                {session?.sessionId === item.sessionId && (
                  <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    {labels.currentConversation}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center">
                  {storageKey && (
                    <button
                      type="button"
                      className="toolbar-icon-button"
                      disabled={pending}
                      aria-label={`${showArchived ? words.restore : words.archive}: ${item.title || labels.untitledConversation}`}
                      title={showArchived ? words.restore : words.archive}
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
                  )}
                  <button
                    type="button"
                    className="toolbar-icon-button hover:text-error"
                    disabled={working || pending}
                    aria-label={`${labels.deleteConversation}: ${item.title || labels.untitledConversation}`}
                    title={labels.deleteConversation}
                    onClick={() => {
                      setDeletingKey(item.key);
                      setEditingKey(null);
                    }}
                  >
                    <TrashIcon size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <time
                className="block text-xs tabular-nums text-muted-foreground"
                dateTime={item.modified}
              >
                {new Date(item.modified).toLocaleDateString(
                  locale === "zh" ? "zh-CN" : locale === "ko" ? "ko-KR" : "en-US",
                  { year: "numeric", month: "2-digit", day: "2-digit" },
                )}
              </time>
              {editingKey === item.key && (
                <form
                  className="flex items-center gap-1"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (await agent.renameConversation(item.key, title)) setEditingKey(null);
                  }}
                >
                  <label className="sr-only" htmlFor={titleId}>
                    {labels.conversationTitle}
                  </label>
                  <input
                    id={titleId}
                    value={title}
                    maxLength={200}
                    required
                    disabled={working || pending}
                    onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setEditingKey(null);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                  />
                  <button
                    type="submit"
                    className="toolbar-icon-button"
                    disabled={working || pending || !title.trim()}
                    aria-label={labels.saveConversation}
                    title={labels.saveConversation}
                  >
                    <CheckIcon size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="toolbar-icon-button"
                    aria-label={labels.cancelHistoryAction}
                    title={labels.cancelHistoryAction}
                    onClick={() => setEditingKey(null)}
                  >
                    <XIcon size={16} aria-hidden="true" />
                  </button>
                </form>
              )}
              {deletingKey === item.key && (
                <div className="space-y-2 rounded-lg border border-error/20 bg-error/5 p-3">
                  <p className="break-words text-xs font-medium">
                    {item.title || labels.untitledConversation}
                  </p>
                  <p className="text-xs text-warning">{labels.confirmDeleteConversation}</p>
                  <p className="text-xs text-muted">{words.localOnly}</p>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      className="toolbar-icon-button"
                      disabled={working || pending}
                      aria-label={labels.cancelHistoryAction}
                      title={labels.cancelHistoryAction}
                      onClick={() => setDeletingKey(null)}
                    >
                      <XIcon size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="toolbar-icon-button text-error"
                      disabled={working || pending}
                      aria-label={labels.deleteConversation}
                      title={labels.deleteConversation}
                      onClick={async () => {
                        if (await agent.deleteConversation(item.key)) {
                          if (archived.includes(item.key)) archive(item.key, false);
                          setDeletingKey(null);
                        }
                      }}
                    >
                      <TrashIcon size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
