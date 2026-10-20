"use client";

import { ArrowRightIcon, GearSixIcon, SparkleIcon } from "@phosphor-icons/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { SelectionAttachment } from "@/types/editor-selection";
import type { FileNode } from "@/types/files";
import { archiveKey } from "../lib/conversation-archive";
import type { AcademicAgentController } from "../lib/use-academic-agent";
import { useChatScroll } from "../lib/use-chat-scroll";
import { ChatComposer } from "./chat-composer";
import { ChatMessage, ChatSuggestions } from "./chat-presentation";
import { ConversationActions } from "./conversation-actions";
import { ConversationHistory } from "./conversation-history";
import { MarkdownText } from "./markdown-text";

export function AcademicAgentPanel({
  agent,
  files = [],
  onOpenSettings,
  selections,
  onRemoveSelection,
  onRevealSelection,
}: {
  agent: AcademicAgentController;
  files?: FileNode[];
  onOpenSettings?: () => void;
  selections?: SelectionAttachment[];
  onRemoveSelection?: (id: string) => void;
  onRevealSelection?: (selection: SelectionAttachment) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const latestSelection = selections?.at(-1)?.id;
  useEffect(() => {
    if (latestSelection) setShowHistory(false);
  }, [latestSelection]);
  const panel = useRef<HTMLElement>(null);
  const {
    labels,
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
  const showSuggestions = !needsSetup && messages.length === 0 && !working;
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
      aria-label={labels.title}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="min-w-0 truncate text-sm font-medium">{labels.title}</h2>
        <ConversationActions
          disabled={working || !directory}
          newLabel={labels.newSession}
          historyLabel={labels.history}
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
        className={`min-h-0 flex-1 overflow-y-auto p-3 ${needsSetup || showSuggestions ? "flex flex-col" : ""}`}
        style={{ overflowAnchor: "none", scrollBehavior: "auto" }}
      >
        {needsSetup ? (
          <div className="m-auto w-full max-w-72 px-3 py-8 text-center">
            <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
              <SparkleIcon className="size-6" weight="duotone" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">{labels.setupTitle}</h3>
            <p className="mt-2 text-xs leading-6 text-muted">{labels.setupDescription}</p>
            <div className="mt-5 rounded-lg border border-border bg-surface px-3 py-3 text-left">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground-secondary">
                <GearSixIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                {labels.setupModel}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-muted">{labels.setupHint}</p>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                className="btn btn-primary mt-4 w-full gap-2"
                onClick={onOpenSettings}
              >
                {labels.setupAction}
                <ArrowRightIcon className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          <div
            ref={scroll.content}
            className={showSuggestions ? "flex flex-1 flex-col gap-4" : "flow-root space-y-4"}
          >
            {!directory && <p className="text-sm text-muted-foreground">{labels.openProject}</p>}

            {session && dirty && <p className="text-xs text-warning">{labels.dirty}</p>}
            {showSuggestions && (
              <ChatSuggestions
                labels={labels}
                onSelect={(prompt) => {
                  setInput(prompt);
                  panel.current?.querySelector("textarea")?.focus();
                }}
              />
            )}
            <div aria-live="polite" aria-busy={working} className="space-y-4">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  role={message.role}
                  label={message.role === "user" ? labels.you : labels.assistant}
                >
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap">
                      {message.content || (working ? labels.busy : "")}
                    </p>
                  ) : (
                    <>
                      <MarkdownText text={message.content || (working ? labels.busy : "")} />
                      {message.generatedImages?.map((image) => (
                        <figure key={image.path} className="mt-3 max-w-lg">
                          <a href={image.src} target="_blank" rel="noreferrer">
                            <Image
                              unoptimized
                              src={image.src ?? ""}
                              alt={labels.generatedReference}
                              width={512}
                              height={768}
                              className="max-h-[28rem] w-auto max-w-full border border-border object-contain"
                            />
                          </a>
                          <figcaption className="mt-1 break-all font-mono text-xs text-muted-foreground">
                            {labels.generatedReference}: {image.relativePath}
                          </figcaption>
                        </figure>
                      ))}
                    </>
                  )}
                </ChatMessage>
              ))}
            </div>
            {activity && (
              <p className="text-xs text-muted-foreground">
                {labels.status}: <span className="font-mono">{activity}</span>
              </p>
            )}
            {permissions.map((change) => (
              <section
                key={change.id}
                className="space-y-2 rounded-md border border-border p-3"
                aria-label={change.kind === "python" ? labels.pythonRequest : labels.editRequest}
              >
                <h3 className="text-xs font-medium">
                  {change.kind === "python" ? labels.pythonRequest : labels.editRequest}:{" "}
                  <span className="font-mono break-all">{change.path}</span>
                </h3>
                {change.kind !== "python" && (
                  <details>
                    <summary className="cursor-pointer text-xs">{labels.original}</summary>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                      {change.before}
                    </pre>
                  </details>
                )}
                <p className="text-xs">
                  {change.kind === "python" ? labels.pythonCode : labels.proposed}
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
                    {labels.approve}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => permission(change.id, false)}
                  >
                    {labels.deny}
                  </button>
                </div>
              </section>
            ))}
            {error && (
              <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
                {labels.error}: {error}
              </p>
            )}
          </div>
        )}
      </div>
      {session && (
        <p className="shrink-0 break-words px-3 pb-2 text-xs text-muted-foreground">
          {labels.tools}:{" "}
          <span className="font-mono">{session.tools.join(", ") || labels.none}</span>
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
          return send(text, images, excerpts);
        }}
        onStop={stop}
        working={working}
        canStop={Boolean(session && streaming)}
        disabled={needsSetup || !connected || !session || dirty}
        placeholder={needsSetup ? labels.setupPlaceholder : labels.placeholder}
        sendLabel={labels.send}
        stopLabel={labels.stop}
        files={files}
        skills={agent.catalog.filter((skill) => config.skillIds.includes(skill.id))}
        directory={directory}
      />
    </section>
  );
}
