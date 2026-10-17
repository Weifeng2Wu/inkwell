"use client";

import { ArrowUpIcon, PlusIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import { matchesShortcut, useKeyboardShortcuts } from "@/features/settings";
import type { FileNode } from "@/types/files";
import type { SkillMetadata } from "../lib/academic-client";
import {
  type ChatImage,
  MAX_CHAT_IMAGES,
  mentionQuery,
  readChatImage,
  workspaceMentions,
} from "../lib/chat-input";
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
  sendLabel,
  stopLabel,
  files = [],
  skills = [],
  directory,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string, images: ChatImage[]) => Promise<unknown>;
  onStop: () => Promise<unknown>;
  working: boolean;
  disabled: boolean;
  canStop?: boolean;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  files?: FileNode[];
  skills?: SkillMetadata[];
  directory?: string;
}) {
  const { t, locale } = useI18n();
  const { bindings } = useKeyboardShortcuts();
  const addLabel = t("interface.addImages");
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
  const mention = dismissed ? null : mentionQuery(value, caret);
  const slashMatch = dismissed ? null : /(?:^|\s)\/([^\s/]*)$/.exec(value.slice(0, caret));
  const slashQuery = slashMatch
    ? {
        query: slashMatch[1] ?? "",
        start: caret - slashMatch[0].trimStart().length,
        end: caret,
      }
    : null;
  const skillQuery = slashQuery ?? (mention ? { ...mention, skillsOnly: false } : null);
  const options: { key: string; name: string; token: string; type: string; folder?: boolean }[] = [];
  if (skillQuery) {
    if (slashQuery) {
      options.push(
        ...skills.map((skill) => ({
          key: `skill:${skill.id}`,
          name: localizeSkill(skill, t).name,
          token: `@skill:${JSON.stringify(skill.id)}`,
          type: t("interface.skill"),
        })),
      );
    } else {
      options.push(
        ...workspaceMentions(files, directory, mention?.query ?? "").map((entry) => ({
            key: `${entry.folder ? "folder" : "file"}:${entry.path}`,
            name: entry.name,
            token: entry.folder ? `@${entry.path}/` : `@file:${JSON.stringify(entry.path)}`,
            type: entry.folder ? ({ zh: "文件夹", en: "Folder", ko: "폴더" }[locale]) : t("interface.file"),
            folder: entry.folder,
          })),
      );
    }
    options.splice(0, options.length, ...options.filter((item) =>
          `${item.name} ${item.key}`.toLowerCase().includes(skillQuery.query.toLowerCase()),
        ));
  }
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
    if (working || disabled || reading || sending.current || (!value.trim() && !images.length))
      return;
    sending.current = true;
    setError(null);
    try {
      const result = await onSend(value.trim() || t("interface.analyzeImages"), images);
      if (result !== false) setImages([]);
    } catch (caught) {
      setError(String(caught));
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
        throw new Error(t("interface.imageLimit"));
      const added = await Promise.all(
        selected.map((file) =>
          readChatImage(file, {
            type: t("interface.imageType"),
            size: t("interface.imageSize"),
            read: t("interface.imageRead"),
          }),
        ),
      );
      setImages((current) => [...current, ...added]);
    } catch (caught) {
      setError(String(caught));
    } finally {
      loading.current = false;
      setReading(false);
    }
  }
  return (
    <footer className="border-t border-border p-3">
      <div className="relative rounded-xl border border-border bg-surface focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/10">
        {options.length > 0 && (
          <div
            id={listId}
            ref={mentionList}
            role="listbox"
            aria-label={t("interface.mentionLabel")}
            className="absolute bottom-full mb-2 max-h-60 w-full overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg"
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
                <span className="truncate">{item.name}</span>
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
                <button
                  type="button"
                  aria-label={t("interface.removeImage", { name: image.name })}
                  disabled={working}
                  onClick={() =>
                    setImages((current) => current.filter((_, position) => position !== index))
                  }
                  className="absolute -right-1 -top-1 rounded-full border border-border bg-background p-0.5"
                >
                  <XIcon size={12} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          aria-label={placeholder}
          aria-controls={options.length ? listId : undefined}
          value={value}
          placeholder={`${placeholder}\n@ ${t("interface.mentionHint")}`}
          maxLength={100000}
          onChange={(event) => {
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
          className="block h-36 w-full resize-none overflow-y-auto rounded-xl bg-transparent px-3 pt-3 pb-14 text-sm leading-relaxed text-foreground outline-none"
        />
        <div className="pointer-events-none absolute right-2 bottom-2 left-2 flex items-center justify-between">
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
          <button
            type="button"
            className="toolbar-icon-button pointer-events-auto bg-surface text-muted hover:text-foreground"
            title={addLabel}
            aria-label={addLabel}
            disabled={working || reading || images.length >= MAX_CHAT_IMAGES}
            onClick={() => upload.current?.click()}
          >
            <PlusIcon size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={working ? stopLabel : sendLabel}
            title={working ? stopLabel : sendLabel}
            disabled={working ? !canStop : disabled || reading || (!value.trim() && !images.length)}
            onClick={() => {
              if (working) void onStop();
              else void submit();
            }}
            className="pointer-events-auto flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-35"
          >
            {working ? (
              <StopIcon size={16} weight="fill" aria-hidden="true" />
            ) : (
              <ArrowUpIcon size={18} weight="bold" aria-hidden="true" />
            )}
          </button>
          {!working && (
            <span className="pointer-events-none absolute right-10 bottom-2.5 text-[10px] text-muted-foreground">
              Shift+Enter
            </span>
          )}
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
