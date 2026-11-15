import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitBackupResult, GitStatus } from "@/types/git";
import { backupErrorCode, backupMessage, GIT_BACKUP_ERRORS } from "./git-backup";

export interface UseExitSyncArgs {
  projectPath: string | null;
  gitPush: () => Promise<{ success: boolean; error?: string }>;
  /** Automatic backup settings. */
  backup: { enabled: boolean; push: boolean };
  /** Writes unsaved editor buffers to disk. */
  flush: () => Promise<void>;
}

export type ExitSyncPrompt =
  /** Automatic backup is off and commits are waiting to upload. */
  | { kind: "push"; ahead: number; busy: boolean; error?: string }
  /** The closing backup is taking a while. */
  | { kind: "backup-running" }
  /** The closing backup failed; `code` is a `GIT_BACKUP_ERRORS` code or git's message. */
  | { kind: "backup-failed"; code: string }
  /** The closing backup was committed, but uploading it failed. */
  | { kind: "backup-push-failed"; error: string };

export interface ExitSyncController {
  /** The dialog to show, or `null`. */
  prompt: ExitSyncPrompt | null;
  /** Primary action: upload pending commits, or retry the backup. */
  confirm: () => Promise<void>;
  /** Close without uploading, or without a completed backup. */
  closeAnyway: () => void;
}

/** Delay before the "backing up" dialog appears, so quick backups stay invisible. */
const RUNNING_NOTICE_DELAY_MS = 600;

/**
 * Backs up or offers to upload the project before the application closes.
 *
 * `inkwell-before-close` listeners add promises to the event's `detail`; the
 * window closes once they settle. Closing cannot be cancelled, so the dialog
 * only offers to retry or to close anyway.
 */
export function useExitSync(args: UseExitSyncArgs): ExitSyncController {
  const latest = useRef(args);
  latest.current = args;

  const [prompt, setPrompt] = useState<ExitSyncPrompt | null>(null);
  // One close sequence at a time; `finish` lets the window close.
  const session = useRef<{ done: Promise<void>; finish: () => void; path: string } | null>(null);
  const attempt = useRef(0);

  const finish = useCallback(() => {
    attempt.current += 1;
    const current = session.current;
    session.current = null;
    setPrompt(null);
    current?.finish();
  }, []);

  /** Asks whether to upload pending commits; closes directly when there are none. */
  const offerUpload = useCallback(
    async (path: string, token: number) => {
      try {
        await invoke("git_fetch", { dir: path });
      } catch (error) {
        console.warn("Could not fetch remote before closing:", error);
      }
      let status: GitStatus | null = null;
      try {
        status = await invoke<GitStatus>("git_status", { dir: path });
      } catch (error) {
        console.warn("Could not check pending commits before closing:", error);
      }
      if (attempt.current !== token) return;
      if (!status?.isRepo || !status.hasUpstream || status.ahead <= 0) {
        finish();
        return;
      }
      setPrompt({ kind: "push", ahead: status.ahead, busy: false });
    },
    [finish],
  );

  const backUp = useCallback(
    async (path: string, settle?: Promise<unknown>) => {
      attempt.current += 1;
      const token = attempt.current;
      const notice = setTimeout(() => {
        if (attempt.current === token) setPrompt({ kind: "backup-running" });
      }, RUNNING_NOTICE_DELAY_MS);
      let result: GitBackupResult | null = null;
      let failure: string | null = null;
      try {
        // Other listeners (PDF notes, agent sessions) save their files first.
        await settle;
        let flushed = true;
        try {
          await latest.current.flush();
        } catch (error) {
          console.warn("Could not save open files before the closing backup:", error);
          flushed = false;
        }
        if (flushed) {
          result = await invoke<GitBackupResult>("git_backup", {
            dir: path,
            message: backupMessage(new Date()),
            push: latest.current.backup.push,
          });
        } else {
          failure = GIT_BACKUP_ERRORS.flushFailed;
        }
      } catch (error) {
        failure = backupErrorCode(error);
      } finally {
        clearTimeout(notice);
      }
      if (attempt.current !== token) return;
      // Not a repository: there is nothing to back up or to upload.
      if (failure === GIT_BACKUP_ERRORS.notARepo) {
        finish();
      } else if (failure !== null) {
        setPrompt({ kind: "backup-failed", code: failure });
      } else if (result?.pushError) {
        setPrompt({ kind: "backup-push-failed", error: result.pushError });
      } else if (latest.current.backup.push) {
        finish();
      } else {
        // Backups stay local by choice; still mention commits waiting to upload.
        setPrompt(null);
        await offerUpload(path, token);
      }
    },
    [finish, offerUpload],
  );

  useEffect(() => {
    const beforeClose = (event: Event) => {
      const tasks = (event as CustomEvent<Promise<unknown>[]>).detail;
      if (!Array.isArray(tasks)) return;
      // A second close request joins the sequence that is already running.
      if (session.current) {
        tasks.push(session.current.done);
        return;
      }
      const path = latest.current.projectPath;
      if (!path) return;
      let release: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        release = resolve;
      });
      session.current = { done, finish: release, path };
      tasks.push(done);
      if (latest.current.backup.enabled) {
        // Wait for the tasks of every other listener, including those that
        // register after this one, before committing.
        const others = Promise.resolve().then(() =>
          Promise.allSettled(tasks.filter((task) => task !== done)),
        );
        void backUp(path, others);
      } else {
        attempt.current += 1;
        void offerUpload(path, attempt.current);
      }
    };
    window.addEventListener("inkwell-before-close", beforeClose);
    return () => {
      window.removeEventListener("inkwell-before-close", beforeClose);
      // Never leave a close request waiting on an unmounted dialog.
      attempt.current += 1;
      session.current?.finish();
      session.current = null;
    };
  }, [backUp, offerUpload]);

  const confirm = useCallback(async () => {
    const current = session.current;
    if (!current || !prompt) return;
    if (prompt.kind === "backup-running") return;
    if (prompt.kind === "backup-failed") {
      setPrompt({ kind: "backup-running" });
      await backUp(current.path);
      return;
    }
    if (prompt.kind === "push" && prompt.busy) return;
    const token = attempt.current;
    const ahead = prompt.kind === "push" ? prompt.ahead : 0;
    const retryBackupPush = prompt.kind === "backup-push-failed";
    setPrompt(retryBackupPush ? { kind: "backup-running" } : { kind: "push", ahead, busy: true });
    let outcome: { success: boolean; error?: string };
    try {
      outcome = await latest.current.gitPush();
    } catch (error) {
      outcome = { success: false, error: String(error) };
    }
    if (attempt.current !== token) return;
    if (outcome.success) {
      finish();
    } else if (retryBackupPush) {
      setPrompt({ kind: "backup-push-failed", error: outcome.error ?? "" });
    } else {
      setPrompt({ kind: "push", ahead, busy: false, error: outcome.error ?? "" });
    }
  }, [backUp, finish, prompt]);

  return { prompt, confirm, closeAnyway: finish };
}
