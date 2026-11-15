"use client";

import {
  ArrowUpIcon,
  FilePdfIcon,
  FileTextIcon,
  PlusIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { errorMessage, useI18n } from "@/features/i18n";
import { matchesShortcut, shortcutLabel, useKeyboardShortcuts } from "@/features/settings";
import { isPdfExcerpt, type SelectionAttachment } from "@/types/editor-selection";
import type { FileNode } from "@/types/files";
import type { Paper } from "@/types/papers";
import type { SkillMetadata } from "../lib/academic-client";
import {
  type ChatImage,
  MAX_CHAT_IMAGES,
  mentionQuery,
  readChatImage,
  workspaceMentions,
} from "../lib/chat-input";
import { paperSuggestions, paperToken } from "../lib/paper-context";
import { localizeSkill } from "../lib/skill-presentation";

export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  working,
  disabled,
  canStop = working,
  placeholder,
  files = [],
  skills = [],
  papers = [],
  directory,
  selections = [],
  onRemoveSelection,
  onRevealSelection,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (
    text: string,
    images: ChatImage[],
    selections: SelectionAttachment[],
  ) => Promise<unknown>;
  onStop: () => Promise<unknown>;
  working: boolean;
  disabled: boolean;
  canStop?: boolean;
  placeholder: string;
  files?: FileNode[];
  skills?: SkillMetadata[];
  /** Library papers offered by the `@` picker and inserted as `@paper:"key"`. */
  papers?: readonly Paper[];
  directory?: string;
  selections?: SelectionAttachment[];
  onRemoveSelection?: (id: string) => void;
  onRevealSelection?: (selection: SelectionAttachment) => void;
}) {
  const { t } = useI18n();
  const { bindings } = useKeyboardShortcuts();
  const addLabel = t("agent.composer.addImages");
  const sendKeys = shortcutLabel(bindings.send);
  const [images, setImages] = useState<ChatImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const loading = useRef(false);
  const sending = useRef(false);
  const [reading, setReading] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const mentionList = useRef<HTMLDivElement>(null);
  const listId = useId();
  // A prompt filled in from outside (an example, a restored draft) puts the caret at its end,
  // so a trailing "@" opens the picker straight away.
  const typed = useRef(value);
  useEffect(() => {
    if (value === typed.current) return;
    typed.current = value;
    setCaret(value.length);
    setActive(0);
    setDismissed(false);
  }, [value]);
  const mention = dismissed ? null : mentionQuery(value, caret);
  const latestSelection = selections.at(-1)?.id;
  useEffect(() => {
    if (latestSelection) textarea.current?.focus();
  }, [latestSelection]);
  const slashMatch = dismissed ? null : /(?:^|\s)\/([^\s/]*)$/.exec(value.slice(0, caret));
  const slashQuery = slashMatch
    ? {
        query: slashMatch[1] ?? "",
        start: caret - slashMatch[0].trimStart().length,
        end: caret,
      }
    : null;
  const skillQuery = slashQuery ?? (mention ? { ...mention, skillsOnly: false } : null);
  const options: {
    key: string;
    name: string;
    token: string;
    type: string;
    folder?: boolean;
    detail?: string;
    citationKey?: string;
  }[] = [];
  if (skillQuery) {
    if (slashQuery) {
      options.push(
        ...skills.map((skill) => ({
          key: `skill:${skill.id}`,
          name: localizeSkill(skill, t).name,
          token: `@skill:${JSON.stringify(skill.id)}`,
          type: t("agent.composer.skill"),
        })),
      );
    } else {
      options.push(
        ...workspaceMentions(files, directory, mention?.query ?? "").map((entry) => ({
          key: `${entry.folder ? "folder" : "file"}:${entry.path}`,
          name: entry.name,
          token: entry.folder ? `@${entry.path}/` : `@file:${JSON.stringify(entry.path)}`,
          type: t(entry.folder ? "agent.composer.folder" : "agent.composer.file"),
          folder: entry.folder,
        })),
      );
    }
    options.splice(
      0,
      options.length,
      ...options.filter((item) =>
        `${item.name} ${item.key}`.toLowerCase().includes(skillQuery.query.toLowerCase()),
      ),
    );
    if (mention && !slashQuery) {
      // "@paper:" narrows the picker to the library; papers follow files otherwise.
      const papersOnly = /^paper:/i.test(mention.query);
      if (papersOnly) options.length = 0;
      options.push(
        ...paperSuggestions(papers, papersOnly ? mention.query.slice(6) : mention.query).map(
          (paper) => {
            const first = paper.authors[0];
            const author =
              first && paper.authors.length > 1
                ? t("agent.composer.paperEtAl", { name: first })
                : first;
            return {
              key: `paper:${paper.key}`,
              name: paper.title || paper.key,
              token: paperToken(paper.key),
              type: t("agent.composer.paper"),
              detail: [author, paper.year].filter(Boolean).join(" · "),
              citationKey: paper.key,
            };
          },
        ),
      );
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls again when the highlighted option changes.
  useEffect(() => {
    mentionList.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, options.length]);
  function choose(index: number) {
    const item = options[index];
    if (!item || !skillQuery) return;
    const suffix = item.folder ? "" : " ";
    const next = `${value.slice(0, skillQuery.start)}${item.token}${suffix}${value.slice(skillQuery.end)}`;
    typed.current = next;
    onChange(next);
    const position = skillQuery.start + item.token.length + suffix.length;
    setCaret(position);
    setActive(0);
    setDismissed(!item.folder);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  }
  async function submit() {
    if (
      working ||
      disabled ||
      reading ||
      sending.current ||
      (!value.trim() && !images.length && !selections.length)
    )
      return;
    sending.current = true;
    setError(null);
    try {
      const result = await onSend(
        value.trim() ||
          t(selections.length ? "agent.composer.analyzeSelection" : "agent.composer.analyzeImages"),
        images,
        selections,
      );
      if (result !== false) {
        setImages([]);
        for (const selection of selections) onRemoveSelection?.(selection.id);
      }
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      sending.current = false;
    }
  }
  async function attach(selected: File[]) {
    if (loading.current || working) return;
    loading.current = true;
    setReading(true);
    setError(null);
    try {
      if (images.length + selected.length > MAX_CHAT_IMAGES)
        throw new Error(t("agent.composer.imageLimit"));
      const added = await Promise.all(
        selected.map((file) =>
          readChatImage(file, {
            type: t("agent.composer.imageType"),
            size: t("agent.composer.imageSize"),
            read: t("agent.composer.imageRead"),
          }),
        ),
      );
      setImages((current) => [...current, ...added]);
    } catch (caught) {
      setError(errorMessage(caught, t));
    } finally {
      loading.current = false;
      setReading(false);
    }
  }
  return (
    <footer className="border-t border-border p-3">
      <div className="relative rounded-xl border border-border bg-surface focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/10">
        {selections.length > 0 && (
          <section
            className="max-h-48 space-y-1.5 overflow-y-auto px-3 pt-3"
            aria-label={t("agent.composer.selections")}
          >
            {selections.map((selection) => {
              const name = selection.path.split(/[\\/]/).at(-1) || selection.path;
              const pdf = isPdfExcerpt(selection);
              const SourceIcon = pdf ? FilePdfIcon : FileTextIcon;
              let lines: string;
              if (isPdfExcerpt(selection)) {
                lines = t("agent.composer.selectionPage", { page: selection.page });
              } else {
                const endLine =
                  selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
                    ? selection.endLineNumber - 1
                    : selection.endLineNumber;
                lines =
                  selection.startLineNumber === endLine
                    ? t("agent.composer.selectionLine", { line: selection.startLineNumber })
                    : t("agent.composer.selectionLines", {
                        start: selection.startLineNumber,
                        end: endLine,
                      });
              }
              return (
                <div
                  key={selection.id}
                  className="relative rounded-md border border-border bg-background text-xs"
                >
                  <button
                    type="button"
                    onClick={() => onRevealSelection?.(selection)}
                    aria-label={t("agent.composer.revealSelection", { name, lines })}
                    className="flex w-full items-center gap-2 rounded-md py-2 pl-2.5 pr-8 text-left hover:bg-surface"
                    title={selection.path}
                  >
                    <SourceIcon size={14} className="shrink-0 text-muted" aria-hidden="true" />
                    <span className="min-w-0 truncate font-medium text-foreground">{name}</span>
                    <span className="shrink-0 text-muted">· {lines}</span>
                  </button>
                  <Tooltip
                    label={t("common.remove")}
                    className="absolute right-1.5 top-1.5 inline-flex"
                  >
                    <button
                      type="button"
                      disabled={working}
                      aria-label={t("agent.composer.removeSelection", { name: selection.path })}
                      onClick={() => onRemoveSelection?.(selection.id)}
                      className="rounded p-1 text-muted transition-colors hover:text-foreground"
                    >
                      <XIcon size={12} aria-hidden="true" />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </section>
        )}
        {options.length > 0 && (
          <div
            id={listId}
            ref={mentionList}
            role="listbox"
            aria-label={t("agent.composer.mentions")}
            className="motion-pop absolute bottom-full mb-2 max-h-60 w-full overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg"
          >
            {options.map((item, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                key={item.key}
                onClick={() => choose(index)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs ${index === active ? "bg-accent/10 text-accent" : "hover:bg-surface"}`}
              >
                <span className="shrink-0 text-muted">{item.type}</span>
                <span className="min-w-0 truncate">{item.name}</span>
                {item.detail && (
                  <span className="max-w-[40%] shrink-0 truncate text-muted">{item.detail}</span>
                )}
                {item.citationKey && (
                  <span className="ml-auto max-w-[30%] shrink-0 truncate text-muted">
                    {item.citationKey}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {images.map((image, index) => (
              <div key={image.id ?? image.name} className="relative">
                <Image
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.name}
                  width={56}
                  height={56}
                  unoptimized
                  className="size-14 rounded-md object-cover"
                />
                <Tooltip
                  label={t("common.remove")}
                  className="absolute -right-1 -top-1 inline-flex"
                >
                  <button
                    type="button"
                    aria-label={t("agent.composer.removeImage", { name: image.name })}
                    disabled={working}
                    onClick={() =>
                      setImages((current) => current.filter((_, position) => position !== index))
                    }
                    className="rounded-full border border-border bg-background p-0.5"
                  >
                    <XIcon size={12} aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          aria-label={placeholder}
          aria-controls={options.length ? listId : undefined}
          value={value}
          placeholder={`${placeholder}\n${t("agent.composer.mentionHint")}`}
          maxLength={100000}
          onChange={(event) => {
            typed.current = event.target.value;
            onChange(event.target.value);
            setCaret(event.target.selectionStart);
            setActive(0);
            setDismissed(false);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (pasted.length) {
              event.preventDefault();
              void attach(pasted);
            }
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              options.length &&
              ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)
            ) {
              event.preventDefault();
              if (event.key === "Escape") setDismissed(true);
              else if (event.key === "ArrowDown") setActive((active + 1) % options.length);
              else if (event.key === "ArrowUp")
                setActive((active - 1 + options.length) % options.length);
              else choose(active);
            } else if (matchesShortcut(event.nativeEvent, bindings.send)) {
              event.preventDefault();
              void submit();
            }
          }}
          className="block h-24 w-full resize-none overflow-y-auto rounded-t-xl bg-transparent px-3 pt-3 pb-1 text-sm leading-relaxed text-foreground outline-none"
        />
        <div className="relative mx-2 my-2 flex items-center justify-between">
          <input
            ref={upload}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            aria-label={addLabel}
            onChange={(event) => {
              void attach(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <Tooltip label={addLabel} side="top">
            <button
              type="button"
              className="toolbar-icon-button bg-surface text-muted hover:text-foreground"
              aria-label={addLabel}
              disabled={working || reading || images.length >= MAX_CHAT_IMAGES}
              onClick={() => upload.current?.click()}
            >
              <PlusIcon size={18} aria-hidden="true" />
            </button>
          </Tooltip>
          <div className="flex items-center gap-2">
            {!working && sendKeys && (
              <span aria-hidden="true" className="text-[11px] text-muted-foreground">
                {sendKeys}
              </span>
            )}
            <Tooltip
              label={t(working ? "agent.composer.stop" : "agent.composer.send")}
              keys={working ? undefined : sendKeys}
              side="top"
            >
              <button
                type="button"
                aria-label={t(working ? "agent.composer.stop" : "agent.composer.send")}
                disabled={
                  working
                    ? !canStop
                    : disabled || reading || (!value.trim() && !images.length && !selections.length)
                }
                onClick={() => {
                  if (working) void onStop();
                  else void submit();
                }}
                className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-35"
              >
                {working ? (
                  <StopIcon size={16} weight="fill" aria-hidden="true" />
                ) : (
                  <ArrowUpIcon size={18} weight="bold" aria-hidden="true" />
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-error">
          {error}
        </p>
      )}
    </footer>
  );
}
