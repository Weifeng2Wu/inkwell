"use client";

import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  CopyIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { RowAction } from "@/components/ui/row-action";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";
import type { GitFileChange, GitLogEntry } from "@/types/git";

const STATUS_LETTER: Record<GitFileChange["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
};

const STATUS_TINT: Record<GitFileChange["status"], string> = {
  modified: "bg-warning/15 text-warning",
  added: "bg-success/15 text-success",
  deleted: "bg-error/15 text-error",
  renamed: "bg-info/15 text-info",
  untracked: "bg-success/15 text-success",
};

/** Splits a project path into its file name and the directory shown beside it. */
export function splitChangePath(path: string): { name: string; directory: string } {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { name: path.slice(at + 1), directory: at > 0 ? path.slice(0, at) : "" };
}

type ChangeRowProps = {
  change: GitFileChange;
  staged: boolean;
  selected: boolean;
  /** Position in its list, for the staggered entrance. */
  index: number;
  onSelect: (path: string, staged: boolean) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
};

/** One changed file: status badge, name and directory, and its actions on hover. */
export function ChangeRow({
  change,
  staged,
  selected,
  index,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
}: ChangeRowProps) {
  const { t } = useI18n();
  const { name, directory } = splitChangePath(change.path);
  const status = t(`git.status.${change.status}`);
  return (
    <li
      data-active={selected}
      className="list-row motion-stagger group relative flex h-7 items-center gap-2 pl-3 pr-1.5"
      style={{ "--i": index } as CSSProperties}
    >
      <span
        title={status}
        className={`flex size-4 flex-shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold ${STATUS_TINT[change.status]}`}
      >
        <span aria-hidden="true">{STATUS_LETTER[change.status]}</span>
        <span className="sr-only">{status}</span>
      </span>
      <button
        type="button"
        data-list-row
        data-path={change.path}
        tabIndex={index === 0 ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        title={change.path}
        onClick={() => onSelect(change.path, staged)}
        className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left text-[13px] outline-none after:absolute after:inset-0 focus-visible:after:ring-1 focus-visible:after:ring-inset focus-visible:after:ring-accent"
      >
        <span
          className={`truncate ${
            change.status === "deleted" ? "text-muted line-through" : "text-foreground"
          }`}
        >
          {name}
        </span>
        {directory && (
          <span className="min-w-0 flex-shrink-[2] truncate text-xs text-muted">{directory}</span>
        )}
      </button>
      <div className="relative z-10 hidden flex-shrink-0 gap-0.5 group-hover:flex group-has-[:focus-visible]:flex">
        {staged ? (
          <RowAction label={t("git.unstageFile")} onClick={() => onUnstage(change.path)}>
            <MinusIcon className="size-4" aria-hidden="true" />
          </RowAction>
        ) : (
          <>
            <RowAction label={t("git.discardFile")} onClick={() => onDiscard(change.path)}>
              <ArrowCounterClockwiseIcon className="size-4" aria-hidden="true" />
            </RowAction>
            <RowAction label={t("git.stageFile")} onClick={() => onStage(change.path)}>
              <PlusIcon className="size-4" aria-hidden="true" />
            </RowAction>
          </>
        )}
      </div>
    </li>
  );
}

/** One commit in the history: its message, then short hash, author and age. */
export function CommitRow({ entry, age }: { entry: GitLogEntry; age: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    void navigator.clipboard.writeText(entry.hash);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className="list-row px-3 py-1.5">
      <p className="truncate text-[13px] text-foreground" title={entry.message}>
        {entry.message}
      </p>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
        <Tooltip
          label={copied ? t("git.hashCopied") : t("git.copyHash", { hash: entry.shortHash })}
        >
          <button
            type="button"
            onClick={copy}
            aria-label={t("git.copyHash", { hash: entry.shortHash })}
            className="group/hash inline-flex items-center gap-1 rounded font-mono transition-colors duration-150 hover:text-foreground"
          >
            {entry.shortHash}
            {copied ? (
              <CheckIcon className="size-3 text-success" aria-hidden="true" />
            ) : (
              <CopyIcon
                className="size-3 opacity-0 transition-opacity duration-100 group-hover/hash:opacity-100 group-focus-visible/hash:opacity-100"
                aria-hidden="true"
              />
            )}
          </button>
        </Tooltip>
        <span className="min-w-0 truncate">{entry.author}</span>
        <span className="ml-auto flex-shrink-0 tabular-nums">{age}</span>
      </div>
    </li>
  );
}
