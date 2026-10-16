"use client";

import { useState } from "react";
import type { FileNode } from "@/types/files";
import { archiveKey } from "../lib/conversation-archive";
import type { AcademicAgentController } from "../lib/use-academic-agent";
import { useChatScroll } from "../lib/use-chat-scroll";
import { ChatComposer } from "./chat-composer";
import { ConversationActions } from "./conversation-actions";
import { ConversationHistory } from "./conversation-history";
import { MarkdownText } from "./markdown-text";

export function AcademicAgentPanel({
  agent,
  files = [],
}: {
  agent: AcademicAgentController;
  files?: FileNode[];
}) {
  const [showHistory, setShowHistory] = useState(false);
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
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label={labels.title}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="min-w-0 truncate text-sm font-medium">{labels.title}</h2>
        <ConversationActions
          disabled={working || !directory}
          newLabel={labels.newSession}
          historyLabel={labels.history}
          onNew={() => configure(false)}
          onHistory={() => {
            agent.setHistoryPreview(null);
            setShowHistory(true);
            void agent.loadHistory();
          }}
        />
      </header>
      <div
        ref={scroll.viewport}
        className="min-h-0 flex-1 overflow-y-auto p-3"
        style={{ overflowAnchor: "none", scrollBehavior: "auto" }}
      >
        <div ref={scroll.content} className="flow-root space-y-4">
          {!directory && <p className="text-sm text-muted-foreground">{labels.openProject}</p>}

          {session && (
            <p className="text-xs text-muted-foreground">
              {labels.tools}:{" "}
              <span className="font-mono">{session.tools.join(", ") || labels.none}</span>
            </p>
          )}
          {session && dirty && <p className="text-xs text-warning">{labels.dirty}</p>}
          {!session && <p className="text-sm text-muted-foreground">{labels.start}</p>}
          <div aria-live="polite" aria-busy={working} className="space-y-4">
            {messages.map((message) => (
              <article key={message.id} className="space-y-1">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {message.role === "user" ? labels.you : labels.assistant}
                </h3>
                <div
                  className="min-w-0 break-words text-sm"
                  style={{ fontFamily: "var(--font-family-body)" }}
                >
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap">
                      {message.content || (working ? labels.busy : "")}
                    </p>
                  ) : (
                    <MarkdownText text={message.content || (working ? labels.busy : "")} />
                  )}
                </div>
              </article>
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
              aria-label={labels.editRequest}
            >
              <h3 className="text-xs font-medium">
                {labels.editRequest}: <span className="font-mono break-all">{change.path}</span>
              </h3>
              <details>
                <summary className="cursor-pointer text-xs">{labels.original}</summary>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                  {change.before}
                </pre>
              </details>
              <p className="text-xs">{labels.proposed}</p>
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
      </div>
      <ChatComposer
        value={input}
        onChange={setInput}
        onSend={send}
        onStop={stop}
        working={working}
        canStop={Boolean(session && streaming)}
        disabled={!connected || !session || dirty}
        placeholder={labels.placeholder}
        sendLabel={labels.send}
        stopLabel={labels.stop}
        files={files}
        skills={agent.catalog.filter((skill) => config.skillIds.includes(skill.id))}
        directory={directory}
      />
    </section>
  );
}
