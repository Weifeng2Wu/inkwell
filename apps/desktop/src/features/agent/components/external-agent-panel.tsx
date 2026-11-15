"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import type { SelectionAttachment } from "@/types/editor-selection";
import type { FileNode } from "@/types/files";
import type { Paper } from "@/types/papers";
import type { SkillMetadata } from "../lib/academic-client";
import { archiveKey } from "../lib/conversation-archive";
import { type AgentSelection, EXTERNAL_AGENTS } from "../lib/external-agent-catalog";
import { useChatScroll } from "../lib/use-chat-scroll";
import type { ExternalAgentController } from "../lib/use-external-agent";
import { AgentLogo } from "./agent-logo";
import { ChatComposer } from "./chat-composer";
import { ChatEmptyState, ChatMessage } from "./chat-presentation";
import { ConversationActions } from "./conversation-actions";
import { ConversationHistory } from "./conversation-history";
import { MarkdownText } from "./markdown-text";

export function ExternalAgentPanel({
  agent,
  selected,
  directory,
  files = [],
  skills = [],
  enabledSkillIds = [],
  papers,
  selections,
  onRemoveSelection,
  onRevealSelection,
}: {
  agent: ExternalAgentController;
  selected: AgentSelection;
  directory?: string;
  files?: FileNode[];
  skills?: SkillMetadata[];
  enabledSkillIds?: string[];
  /** Library papers that can be mentioned with `@paper:"key"`. */
  papers?: readonly Paper[];
  selections?: SelectionAttachment[];
  onRemoveSelection?: (id: string) => void;
  onRevealSelection?: (selection: SelectionAttachment) => void;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLElement>(null);
  const showExamples =
    agent.messages.length === 0 && !agent.working && !agent.authentication && Boolean(directory);
  const [showHistory, setShowHistory] = useState(false);
  const latestSelection = selections?.at(-1)?.id;
  useEffect(() => {
    if (latestSelection) setShowHistory(false);
  }, [latestSelection]);
  const [sharedSkills, setSharedSkills] = useState<SkillMetadata[]>([]);
  const [confirmReconnect, setConfirmReconnect] = useState(false);
  const skillKey = JSON.stringify(enabledSkillIds);
  useEffect(() => {
    let cancelled = false;
    const enabled: string[] = JSON.parse(skillKey);
    void invoke<{ skills: SkillMetadata[] }>("agent_shared_skills", {
      request: { type: "catalog" },
    })
      .then((result) => {
        if (!cancelled)
          setSharedSkills(result.skills.filter((skill) => enabled.includes(skill.id)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [skillKey]);
  const scroll = useChatScroll(
    showHistory ? "" : JSON.stringify([directory, selected, agent.messages[0]?.id]),
  );
  const name = EXTERNAL_AGENTS.find((entry) => entry.id === selected)?.name ?? t("agent.reply");
  const streaming = agent.working && agent.connected;
  if (showHistory)
    return (
      <ConversationHistory
        storageKey={directory ? archiveKey(directory, selected) : undefined}
        onClose={() => setShowHistory(false)}
        onNew={agent.newConversation}
        agent={{
          working: streaming,
          conversations: agent.history.map((record) => ({
            key: record.id,
            sessionId: record.id,
            title: record.title,
            created: record.modified,
            modified: record.modified,
            messageCount: record.messageCount ?? record.messages.length,
          })),
          historyPreview: null,
          session: agent.currentConversationId
            ? { sessionId: agent.currentConversationId, messages: [], tools: [] }
            : null,
          error: agent.error,
          loadHistory: agent.loadHistory,
          configure: async (_resume, key) =>
            key ? agent.restoreHistory(key) : agent.newConversation(),
          previewConversation: async (key) => {
            if (await agent.restoreHistory(key)) setShowHistory(false);
          },
          renameConversation: agent.renameConversation,
          deleteConversation: agent.deleteConversation,
        }}
      />
    );
  return (
    <section
      ref={panel}
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label={name}
    >
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        {selected !== "builtin" && <AgentLogo id={selected} className="size-5" />}
        <h2 className="truncate text-sm font-medium">{name}</h2>
        <ConversationActions
          disabled={!directory || streaming}
          onNew={agent.newConversation}
          onHistory={() => {
            setShowHistory(true);
            void agent.loadHistory();
          }}
        />
      </header>
      <div
        ref={scroll.viewport}
        className={`min-h-0 flex-1 overflow-y-auto p-3 ${showExamples ? "flex flex-col" : ""}`}
        aria-live="polite"
        style={{ overflowAnchor: "none", scrollBehavior: "auto" }}
      >
        <div
          ref={scroll.content}
          className={showExamples ? "flex flex-1 flex-col gap-4" : "flow-root space-y-4"}
        >
          {!agent.connected && agent.working && !agent.authentication && (
            <p role="status" className="text-xs text-muted-foreground">
              {t("agent.external.connecting")}
            </p>
          )}
          {!agent.connected && !agent.working && directory && (
            <div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (agent.replaceRequired) setConfirmReconnect(true);
                  else void agent.connect();
                }}
              >
                {t(agent.error ? "agent.external.reconnect" : "agent.external.connect")}
              </button>
            </div>
          )}
          {!directory && (
            <p className="text-[13px] text-muted-foreground">{t("agent.openProject")}</p>
          )}
          {agent.authentication && (
            <div className="motion-rise space-y-2 rounded-lg border border-border bg-surface p-3">
              <p className="text-[13px] font-medium">
                {t("agent.external.authRequired", { agent: name })}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("agent.external.authExplanation")}
              </p>
              <div className="flex flex-wrap gap-2">
                {agent.authentication.methods.map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => agent.authentication?.choose(method.id)}
                  >
                    {method.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {showExamples && (
            <ChatEmptyState
              onSelect={(prompt) => {
                agent.setInput(prompt);
                requestAnimationFrame(() => {
                  const field = panel.current?.querySelector("textarea");
                  field?.focus();
                  field?.setSelectionRange(prompt.length, prompt.length);
                });
              }}
            />
          )}
          {agent.messages.map((message, index) =>
            message.role === "assistant" &&
            !message.content &&
            !message.generatedImages?.length &&
            !agent.working ? null : (
              <ChatMessage
                key={message.id}
                role={message.role}
                label={message.role === "user" ? t("agent.you") : name}
                entering={streaming && index >= agent.messages.length - 2}
              >
                {message.role === "user" ? (
                  <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                ) : (
                  <>
                    {message.content ? (
                      <MarkdownText text={message.content} />
                    ) : (
                      !message.generatedImages?.length && (
                        <p className="text-sm text-muted-foreground">{t("agent.thinking")}</p>
                      )
                    )}
                    {message.generatedImages?.map((image) => (
                      <figure key={image.path} className="mt-3 max-w-lg">
                        <a href={convertFileSrc(image.path)} target="_blank" rel="noreferrer">
                          <Image
                            unoptimized
                            src={convertFileSrc(image.path)}
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
            ),
          )}
          {agent.activity && (
            <p role="status" className="motion-fade break-words text-xs text-muted-foreground">
              {t("agent.external.activity", { activity: agent.activity })}
            </p>
          )}
          {agent.permissions.map((permission) => (
            <div
              key={permission.id}
              className="motion-rise space-y-2 rounded-lg border border-border bg-surface p-3"
            >
              <p className="break-words text-[13px] font-medium">
                {permission.title || t("agent.external.toolRequest")}
              </p>
              {permission.details && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-secondary p-2 font-mono text-xs">
                  {permission.details}
                </pre>
              )}
              <div className="flex flex-wrap gap-2">
                {permission.options
                  .filter((option) => option.kind === "allow_once")
                  .map((option) => (
                    <button
                      key={option.optionId}
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void agent.permission(permission.id, option.optionId)}
                    >
                      {t("agent.external.approve", { option: option.name })}
                    </button>
                  ))}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void agent.permission(permission.id, null)}
                >
                  {t("agent.external.deny")}
                </button>
              </div>
            </div>
          ))}
          {agent.error && (
            <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
              {agent.error}
            </p>
          )}
        </div>
      </div>
      <Dialog.Root open={confirmReconnect} onOpenChange={setConfirmReconnect}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[9999] bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[10000] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-5 shadow-2xl focus:outline-none">
            <Dialog.Title className="text-base font-semibold">
              {t("agent.external.replaceTitle")}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              {t("agent.external.replaceMessage")}
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="btn btn-sm">{t("common.cancel")}</Dialog.Close>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setConfirmReconnect(false);
                  void agent.connect(true);
                }}
              >
                {t("agent.external.replaceAction")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ChatComposer
        selections={selections}
        onRemoveSelection={onRemoveSelection}
        onRevealSelection={onRevealSelection}
        value={agent.input}
        onChange={agent.setInput}
        onSend={(text, images, excerpts) => {
          scroll.scrollToBottom();
          return agent.send(text, images, excerpts, papers);
        }}
        onStop={agent.stop}
        working={streaming}
        canStop={agent.connected}
        disabled={!agent.connected}
        placeholder={t("agent.composer.placeholderExternal", { name })}
        files={files}
        papers={papers}
        skills={sharedSkills.length ? sharedSkills : skills}
        directory={directory}
      />
    </section>
  );
}
