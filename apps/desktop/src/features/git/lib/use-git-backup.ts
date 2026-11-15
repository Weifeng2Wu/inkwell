import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitBackupResult } from "@/types/git";
import { backupErrorCode, backupMessage, GIT_BACKUP_ERRORS } from "./git-backup";

export interface UseGitBackupArgs {
  projectPath: string | null;
  isRepo: boolean;
  /** Setting: back up on a schedule. */
  enabled: boolean;
  /** Setting: minutes between scheduled backups. */
  intervalMinutes: number;
  /** Setting: push after committing. */
  push: boolean;
  /** A push, pull, agent run or compilation is under way; scheduled backups wait. */
  busy: boolean;
  /** Writes unsaved editor buffers to disk. */
  flush: () => Promise<void>;
  /** Called after every completed backup, including ones with nothing to commit. */
  onDone: (result: GitBackupResult) => void;
  /**
   * Called with an error code (see `GIT_BACKUP_ERRORS`) or git's own message.
   * Scheduled backups report a code once until it changes or a backup succeeds;
   * `backupNow` always reports.
   */
  onError: (code: string) => void;
  /**
   * Called when files over 50 MiB were left out. Scheduled backups report a
   * given set of files once; `backupNow` always reports.
   */
  onLargeFilesSkipped?: (files: string[]) => void;
}

export interface GitBackupController {
  /** Runs a backup now, even when disabled or busy. `null` when it failed or cannot run. */
  backupNow: () => Promise<GitBackupResult | null>;
  /** Time of the last completed backup in this project, as epoch milliseconds. */
  lastBackupAt: number | null;
  running: boolean;
  /** Error of the most recent backup, cleared by the next success. */
  lastError: string | null;
}

export function useGitBackup(args: UseGitBackupArgs): GitBackupController {
  const latest = useRef(args);
  latest.current = args;

  const [running, setRunning] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const inFlight = useRef<Promise<GitBackupResult | null> | null>(null);
  // Incremented on project changes, so a backup of the previous project
  // cannot report into the new one.
  const generation = useRef(0);
  const reportedError = useRef<string | null>(null);
  const reportedLargeFiles = useRef("");
  const deferred = useRef(false);

  const run = useCallback((manual: boolean): Promise<GitBackupResult | null> => {
    if (inFlight.current) return inFlight.current;
    const { projectPath, isRepo, push } = latest.current;
    if (!projectPath || !isRepo) return Promise.resolve(null);
    const started = generation.current;
    const current = () => generation.current === started;

    const task = (async (): Promise<GitBackupResult | null> => {
      try {
        try {
          await latest.current.flush();
        } catch (error) {
          console.warn("Could not save open files before the backup:", error);
          throw GIT_BACKUP_ERRORS.flushFailed;
        }
        const result = await invoke<GitBackupResult>("git_backup", {
          dir: projectPath,
          message: backupMessage(new Date()),
          push,
        });
        if (!current()) return result;
        reportedError.current = null;
        setLastError(null);
        setLastBackupAt(Date.now());
        latest.current.onDone(result);
        const skipped = [...result.skippedLargeFiles].sort().join("\n");
        if (skipped && (manual || skipped !== reportedLargeFiles.current)) {
          latest.current.onLargeFilesSkipped?.(result.skippedLargeFiles);
        }
        reportedLargeFiles.current = skipped;
        return result;
      } catch (error) {
        if (!current()) return null;
        const code = backupErrorCode(error);
        setLastError(code);
        if (manual || reportedError.current !== code) latest.current.onError(code);
        reportedError.current = code;
        return null;
      }
    })();
    inFlight.current = task;
    setRunning(true);
    void task.finally(() => {
      if (inFlight.current === task) {
        inFlight.current = null;
        setRunning(false);
      }
    });
    return task;
  }, []);

  const runScheduled = useCallback(() => {
    const { enabled, projectPath, isRepo, busy } = latest.current;
    if (!enabled || !projectPath || !isRepo) return;
    // The previous backup is still running: skip this one.
    if (inFlight.current) return;
    if (busy) {
      deferred.current = true;
      return;
    }
    deferred.current = false;
    void run(false);
  }, [run]);

  // Reset when another project opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the project path is the trigger.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = null;
    reportedError.current = null;
    reportedLargeFiles.current = "";
    deferred.current = false;
    setRunning(false);
    setLastBackupAt(null);
    setLastError(null);
  }, [args.projectPath]);

  // The timer reads the latest arguments and restarts only when the schedule
  // itself changes. It also runs while the window is hidden.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new project restarts the schedule.
  useEffect(() => {
    if (!args.enabled) {
      deferred.current = false;
      return;
    }
    const minutes = Number.isFinite(args.intervalMinutes) ? Math.max(1, args.intervalMinutes) : 10;
    const timer = setInterval(runScheduled, minutes * 60_000);
    return () => clearInterval(timer);
  }, [args.enabled, args.intervalMinutes, args.projectPath, runScheduled]);

  // A backup that came due during a push, pull, agent run or compilation.
  useEffect(() => {
    if (!args.busy && deferred.current) runScheduled();
  }, [args.busy, runScheduled]);

  const backupNow = useCallback(() => run(true), [run]);

  return { backupNow, lastBackupAt, running, lastError };
}
