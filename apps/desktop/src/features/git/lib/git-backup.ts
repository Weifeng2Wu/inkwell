import type { GitBackupResult } from "@/types/git";

/** Error codes returned by the `git_backup` command, plus one raised before it runs. */
export const GIT_BACKUP_ERRORS = {
  notARepo: "GIT_BACKUP_NOT_A_REPO",
  inProgress: "GIT_BACKUP_IN_PROGRESS",
  detachedHead: "GIT_BACKUP_DETACHED_HEAD",
  noIdentity: "GIT_BACKUP_NO_IDENTITY",
  invalidMessage: "GIT_BACKUP_INVALID_MESSAGE",
  /** Unsaved editor buffers could not be written to disk; nothing was committed. */
  flushFailed: "GIT_BACKUP_FLUSH_FAILED",
} as const;

type Translate = (key: string, params?: Record<string, string | number>) => string;

const ERROR_KEYS: Record<string, string> = {
  [GIT_BACKUP_ERRORS.notARepo]: "git.backupErrorNotARepo",
  [GIT_BACKUP_ERRORS.inProgress]: "git.backupErrorInProgress",
  [GIT_BACKUP_ERRORS.detachedHead]: "git.backupErrorDetachedHead",
  [GIT_BACKUP_ERRORS.noIdentity]: "git.backupErrorNoIdentity",
  [GIT_BACKUP_ERRORS.flushFailed]: "git.backupErrorFlush",
};

const pad = (value: number) => String(value).padStart(2, "0");

/** Commit message of an automatic backup, in local time: `Auto backup 2026-11-14 23:05`. */
export function backupMessage(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `Auto backup ${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Normalizes a rejected `invoke` into an error code, or the raw git message. */
export function backupErrorCode(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).trim();
  return text || "git backup failed";
}

/** Readable reason for an error code; unknown codes are git's own output and pass through. */
export function backupErrorReason(code: string, t: Translate): string {
  const key = ERROR_KEYS[code];
  return key ? t(key) : code;
}

/** Complete sentence for a failed backup, for a toast or dialog. */
export function backupErrorMessage(code: string, t: Translate): string {
  return t("git.backupFailed", { error: backupErrorReason(code, t) });
}

/** Outcome of a successful `git_backup` call, for a toast. */
export function backupResultNotice(
  result: GitBackupResult,
  t: Translate,
): { message: string; type: "success" | "error" | "info" } {
  if (result.pushError) {
    return { message: t("git.backupPushFailed", { error: result.pushError }), type: "error" };
  }
  if (result.pushed) return { message: t("git.backupDonePushed"), type: "success" };
  if (result.committed) return { message: t("git.backupDone"), type: "success" };
  return { message: t("git.backupNothing"), type: "info" };
}

const LISTED_LARGE_FILES = 3;

/** Notice for files over 50 MiB left out of a backup; `null` when there are none. */
export function largeFileNotice(files: string[], t: Translate): string | null {
  if (files.length === 0) return null;
  const listed = files.slice(0, LISTED_LARGE_FILES).join(", ");
  const more = files.length - LISTED_LARGE_FILES;
  return more > 0
    ? t("git.backupLargeFilesSkippedMore", { files: listed, count: more })
    : t("git.backupLargeFilesSkipped", { files: listed });
}
