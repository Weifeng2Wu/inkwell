"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useI18n } from "@/features/i18n";
import type { FileNode } from "@/types/files";
import type { SkillMetadata } from "../lib/academic-client";
import { academicLabels } from "../lib/academic-labels";
import { archiveKey } from "../lib/conversation-archive";
import { type AgentSelection, EXTERNAL_AGENTS } from "../lib/external-agent-catalog";
import { externalAgentLabels } from "../lib/external-agent-labels";
import { useChatScroll } from "../lib/use-chat-scroll";
import type { ExternalAgentController } from "../lib/use-external-agent";
import { AgentLogo } from "./agent-logo";
import { ChatComposer } from "./chat-composer";
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
}: {
  agent: ExternalAgentController;
  selected: AgentSelection;
  directory?: string;
  files?: FileNode[];
  skills?: SkillMetadata[];
  enabledSkillIds?: string[];
}) {
  const { locale } = useI18n();
  const labels = externalAgentLabels(locale);
  const historyLabels = academicLabels[locale];
  const [showHistory, setShowHistory] = useState(false);
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
  const name = EXTERNAL_AGENTS.find((entry) => entry.id === selected)?.name;
  if (showHistory)
    return (
      <ConversationHistory
        storageKey={directory ? archiveKey(directory, selected) : undefined}
        onClose={() => setShowHistory(false)}
        onNew={agent.newConversation}
        agent={{
          labels: historyLabels,
          working: agent.working && agent.connected,
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
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      aria-label={name}
    >
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        {selected !== "builtin" && <AgentLogo id={selected} className="size-5" />}
        <h2 className="truncate text-sm font-medium">{name}</h2>
        <ConversationActions
          disabled={!directory || (agent.working && agent.connected)}
          newLabel={historyLabels.newSession}
          historyLabel={historyLabels.history}
          onNew={agent.newConversation}
          onHistory={() => {
            setShowHistory(true);
            void agent.loadHistory();
          }}
        />
      </header>
      <div
        ref={scroll.viewport}
        className="min-h-0 flex-1 overflow-y-auto p-3"
        aria-live="polite"
        style={{ overflowAnchor: "none", scrollBehavior: "auto" }}
      >
        <div ref={scroll.content} className="flow-root space-y-4">
          {!agent.connected && agent.working && !agent.authentication && (
            <p role="status" className="text-xs text-muted-foreground">
              {labels.connecting}
            </p>
          )}
          {!agent.connected && !agent.working && agent.error && directory && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={!directory}
              onClick={() => {
                if (agent.replaceRequired) setConfirmReconnect(true);
                else void agent.connect();
              }}
            >
              {labels.retryConnection}
            </button>
          )}
          {!directory && <p className="text-sm text-muted-foreground">{labels.noProject}</p>}
          {agent.authentication && (
            <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
              <p className="text-sm font-medium">
                {labels.authRequired} · {name}
              </p>
              <p className="text-xs text-muted-foreground">{labels.authExplanation}</p>
              {agent.authentication.methods.map((method) => (
                <div key={method.id} className="space-y-1">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => agent.authentication?.choose(method.id)}
                  >
                    {method.name}
                  </button>
                </div>
              ))}
            </div>
          )}
          {agent.messages.map((message) =>
            message.role === "assistant" &&
            !message.content &&
            !message.generatedImages?.length &&
            !agent.working ? null : (
              <article
                key={message.id}
                className={`min-w-0 rounded-lg border border-border p-3 ${message.role === "user" ? "bg-surface" : "bg-background"}`}
              >
                {message.role === "user" ? (
                  <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                ) : (
                  <>
                    {message.content ? (
                      <MarkdownText text={message.content} />
                    ) : (
                      !message.generatedImages?.length && (
                        <p className="text-sm text-muted-foreground">{labels.thinking}</p>
                      )
                    )}
                    {message.generatedImages?.map((image) => (
                      <figure key={image.path} className="mt-3 space-y-1.5">
                        <a href={convertFileSrc(image.path)} target="_blank" rel="noreferrer">
                          <Image
                            unoptimized
                            src={convertFileSrc(image.path)}
                            alt={image.relativePath}
                            width={512}
                            height={512}
                            className="max-h-80 max-w-full rounded-md border border-border object-contain"
                          />
                        </a>
                        <figcaption className="text-xs text-muted-foreground">
                          {image.relativePath}
                        </figcaption>
                      </figure>
                    ))}
                  </>
                )}
              </article>
            ),
          )}
          {agent.activity && (
            <p role="status" className="break-words text-xs text-muted-foreground">
              {labels.activity}: {agent.activity}
            </p>
          )}
          {agent.permissions.map((permission) => (
            <div
              key={permission.id}
              className="space-y-2 rounded-lg border border-border bg-surface p-3"
            >
              <p className="break-words text-sm">{permission.title}</p>
              {permission.details && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
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
                      className="btn btn-sm"
                      onClick={() => void agent.permission(permission.id, option.optionId)}
                    >
                      {labels.approve}: {option.name}
                    </button>
                  ))}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void agent.permission(permission.id, null)}
                >
                  {labels.deny}
                </button>
              </div>
            </div>
          ))}
          {agent.error && (
            <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
              {agent.error.includes("does not advertise a read-only ACP mode")
                ? {
                    zh: "此 Agent 不支持受限（只读）模式。请在 Agent 设置中选择「逐次询问」后重新连接，或使用内置 Agent。",
                    en: "This Agent does not support Restricted mode. Choose Ask every time in Agent settings and reconnect, or use the built-in Agent.",
                    ko: "이 Agent는 제한 모드를 지원하지 않습니다. Agent 설정에서 매번 확인을 선택한 후 다시 연결하거나 내장 Agent를 사용하세요.",
                  }[locale]
                : agent.error}
            </p>
          )}
        </div>
      </div>
      <Dialog.Root open={confirmReconnect} onOpenChange={setConfirmReconnect}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[9999] bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[10000] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-5 shadow-2xl focus:outline-none">
            <Dialog.Title className="text-base font-semibold">
              {labels.replaceConfirmTitle}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              {labels.replaceConfirm}
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="btn btn-sm">{labels.cancel}</Dialog.Close>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setConfirmReconnect(false);
                  void agent.connect(true);
                }}
              >
                {labels.replaceAction}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ChatComposer
        value={agent.input}
        onChange={agent.setInput}
        onSend={(text, images) => {
          scroll.scrollToBottom();
          return agent.send(text, images);
        }}
        onStop={agent.stop}
        working={agent.working && agent.connected}
        canStop={agent.connected}
        disabled={!agent.connected}
        placeholder={labels.placeholder}
        sendLabel={labels.send}
        stopLabel={labels.stop}
        files={files}
        skills={sharedSkills.length ? sharedSkills : skills}
        directory={directory}
      />
    </section>
  );
}
