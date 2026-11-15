"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import type { SelectionAttachment } from "@/types/editor-selection";
import type { FileNode } from "@/types/files";
import type { Paper } from "@/types/papers";
import { archiveKey } from "../lib/conversation-archive";
import type { AcademicAgentController } from "../lib/use-academic-agent";
import { useChatScroll } from "../lib/use-chat-scroll";
import { ChatComposer } from "./chat-composer";
import { ChatEmptyState, ChatMessage } from "./chat-presentation";
import { ConversationActions } from "./conversation-actions";
import { ConversationHistory } from "./conversation-history";
import { MarkdownText } from "./markdown-text";

export function AcademicAgentPanel({
  agent,
  files = [],
  onOpenSettings,
  papers,
  selections,
  onRemoveSelection,
  onRevealSelection,
}: {
  agent: AcademicAgentController;
  files?: FileNode[];
  onOpenSettings?: () => void;
  /** Library papers that can be mentioned with `@paper:"key"`. */
  papers?: readonly Paper[];
  selections?: SelectionAttachment[];
  onRemoveSelection?: (id: string) => void;
  onRevealSelection?: (selection: SelectionAttachment) => void;
}) {
  const { t } = useI18n();
  const [showHistory, setShowHistory] = useState(false);
  const latestSelection = selections?.at(-1)?.id;
  useEffect(() => {
    if (latestSelection) setShowHistory(false);
  }, [latestSelection]);
  const panel = useRef<HTMLElement>(null);
  const {
    directory,
    config,
    connected,
    working,
    session,
    dirty,
    messages,
    permissions,
    input,
    setInput,
    error,
    activity,
    streaming,
    configure,
    send,
    permission,
    stop,
  } = agent;
  const scroll = useChatScroll(showHistory ? "" : JSON.stringify([directory, session?.sessionId]));
  const needsSetup =
    agent.configReady &&
    !session &&
    messages.length === 0 &&
    (!config.model.trim() || (!config.protocol && !config.provider.trim()));
  const showExamples = !needsSetup && messages.length === 0 && !working && Boolean(directory);
  if (showHistory)
    return (
      <ConversationHistory
        agent={agent}
        storageKey={directory ? archiveKey(directory, "builtin") : undefined}
        onNew={() => configure(false)}
        onClose={() => setShowHistory(false)}
      />
    );
  return (
    <section
      ref={panel}
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label={t("agent.title")}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="min-w-0 truncate text-sm font-medium">{t("agent.title")}</h2>
        <ConversationActions
          disabled={working || !directory}
          onNew={async () => {
            if (needsSetup) onOpenSettings?.();
            else await configure(false);
          }}
          onHistory={() => {
            agent.setHistoryPreview(null);
            setShowHistory(true);
            void agent.loadHistory();
          }}
        />
      </header>
      <div
        ref={scroll.viewport}
        className={`min-h-0 flex-1 overflow-y-auto p-3 ${showExamples ? "flex flex-col" : ""}`}
        style={{ overflowAnchor: "none", scrollBehavior: "auto" }}
      >
        {needsSetup ? (
          <div
            data-agent-setup
            className="motion-rise rounded-lg border border-border bg-surface p-3"
          >
            <h3 className="text-[13px] font-medium text-foreground">{t("agent.setup.title")}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{t("agent.setup.description")}</p>
            {onOpenSettings && (
              <button
                type="button"
                className="btn btn-primary btn-sm mt-3"
                onClick={onOpenSettings}
              >
                {t("agent.setup.action")}
              </button>
            )}
          </div>
        ) : (
          <div
            ref={scroll.content}
            className={showExamples ? "flex flex-1 flex-col gap-4" : "flow-root space-y-4"}
          >
            {!directory && (
              <p className="text-[13px] text-muted-foreground">{t("agent.openProject")}</p>
            )}
            {session && dirty && <p className="text-xs text-warning">{t("agent.dirty")}</p>}
            {showExamples && (
              <ChatEmptyState
                onSelect={(prompt) => {
                  setInput(prompt);
                  requestAnimationFrame(() => {
                    const field = panel.current?.querySelector("textarea");
                    field?.focus();
                    field?.setSelectionRange(prompt.length, prompt.length);
                  });
                }}
              />
            )}
            <div aria-live="polite" aria-busy={working} className="space-y-4">
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  role={message.role}
                  label={t(message.role === "user" ? "agent.you" : "agent.reply")}
                  entering={working && index >= messages.length - 2}
                >
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap">
                      {message.content || (working ? t("agent.working") : "")}
                    </p>
                  ) : (
                    <>
                      <MarkdownText text={message.content || (working ? t("agent.working") : "")} />
                      {message.generatedImages?.map((image) => (
                        <figure key={image.path} className="mt-3 max-w-lg">
                          <a href={image.src} target="_blank" rel="noreferrer">
                            <Image
                              unoptimized
                              src={image.src ?? ""}
                              alt={t("agent.generatedImage")}
                              width={512}
                              height={768}
                              className="max-h-[28rem] w-auto max-w-full rounded-md border border-border object-contain"
                            />
                          </a>
                          <figcaption className="mt-1 break-all font-mono text-xs text-muted-foreground">
                            {image.relativePath}
                          </figcaption>
                        </figure>
                      ))}
                    </>
                  )}
                </ChatMessage>
              ))}
            </div>
            {activity && (
              <p className="motion-fade text-xs text-muted-foreground">
                {t("agent.statusLabel")} <span className="font-mono">{activity}</span>
              </p>
            )}
            {permissions.map((change) => {
              const title = t(
                change.kind === "python"
                  ? "agent.permission.pythonRequest"
                  : "agent.permission.editRequest",
              );
              return (
                <section
                  key={change.id}
                  className="motion-rise space-y-2 rounded-lg border border-border bg-surface p-3"
                  aria-label={title}
                >
                  <h3 className="text-xs font-medium">{title}</h3>
                  <p className="break-all font-mono text-xs text-muted">{change.path}</p>
                  {change.kind !== "python" && (
                    <details>
                      <summary className="cursor-pointer text-xs">
                        {t("agent.permission.original")}
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-secondary p-2 font-mono text-xs">
                        {change.before}
                      </pre>
                    </details>
                  )}
                  <p className="text-xs">
                    {t(
                      change.kind === "python"
                        ? "agent.permission.pythonCode"
                        : "agent.permission.proposed",
                    )}
                  </p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-secondary p-2 font-mono text-xs">
                    {change.after}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => permission(change.id, true)}
                    >
                      {t("agent.permission.approve")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => permission(change.id, false)}
                    >
                      {t("agent.permission.deny")}
                    </button>
                  </div>
                </section>
              );
            })}
            {error && (
              <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
                {t("agent.error", { error })}
              </p>
            )}
          </div>
        )}
      </div>
      {session && (
        <p className="shrink-0 break-words px-3 pb-2 text-xs text-muted-foreground">
          {t("agent.toolsLabel")}{" "}
          <span className="font-mono">{session.tools.join(", ") || t("common.none")}</span>
        </p>
      )}
      <ChatComposer
        selections={selections}
        onRemoveSelection={onRemoveSelection}
        onRevealSelection={onRevealSelection}
        value={input}
        onChange={setInput}
        onSend={(text, images, excerpts) => {
          scroll.scrollToBottom();
          return send(text, images, excerpts, papers);
        }}
        onStop={stop}
        working={working}
        canStop={Boolean(session && streaming)}
        disabled={needsSetup || !connected || !session || dirty}
        placeholder={t(needsSetup ? "agent.setup.placeholder" : "agent.composer.placeholder")}
        files={files}
        papers={papers}
        skills={agent.catalog.filter((skill) => config.skillIds.includes(skill.id))}
        directory={directory}
      />
    </section>
  );
}
