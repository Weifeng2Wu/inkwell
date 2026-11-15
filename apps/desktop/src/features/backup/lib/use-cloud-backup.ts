import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CloudBackupResult,
  type CloudConfig,
  type CloudCredentials,
  type CloudSnapshot,
  type CloudStatus,
  cloudErrorKey,
} from "./cloud-backup";

type Operation = "save" | "test" | "backup" | "list" | "restore";
type Args = { projectPath: string | null; busy: boolean; flush: () => Promise<unknown> };
const request = <Result>(value: object) =>
  invoke<Result>("cloud_backup_request", { request: value });

export function useCloudBackup(args: Args) {
  const latest = useRef(args);
  latest.current = args;
  const mounted = useRef(false);
  const gate = useRef(false);
  const activeOperation = useRef<Operation | null>(null);
  const loadedProject = useRef<string | null | undefined>(undefined);
  const deferred = useRef(false);
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<CloudSnapshot[]>([]);
  const [restoredDirectory, setRestoredDirectory] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const latestRevision = useRef(revision);
  latestRevision.current = revision;
  const available = isTauri();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!available) {
      setLoading(false);
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = async () => {
      if (disposed || revision !== latestRevision.current) return;
      if (gate.current) {
        timer = setTimeout(() => void load(), 1000);
        return;
      }
      gate.current = true;
      setLoading(true);
      try {
        const next = await request<CloudStatus>({
          type: "status",
          ...(args.projectPath ? { projectPath: args.projectPath } : {}),
        });
        if (!disposed) {
          setStatus(next);
          loadedProject.current = args.projectPath;
        }
      } catch (failure) {
        if (!disposed) {
          if (String(failure).includes("CLOUD_BUSY") && ++attempts < 5)
            timer = setTimeout(() => void load(), 1500);
          else setError(cloudErrorKey(failure));
        }
      } finally {
        gate.current = false;
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [available, args.projectPath, revision]);

  const run = useCallback(
    async <Result>(
      kind: Operation,
      value: object,
      complete: (result: Result) => void,
    ): Promise<Result | null> => {
      if (gate.current || !isTauri()) return null;
      const project = latest.current.projectPath;
      if (kind === "backup" && !project) return null;
      gate.current = true;
      setOperation(kind);
      activeOperation.current = kind;
      setError(null);
      setNotice(null);
      setRestoredDirectory(null);
      try {
        if (kind === "backup") {
          try {
            await latest.current.flush();
          } catch {
            throw new Error("CLOUD_FLUSH");
          }
          if (latest.current.projectPath !== project) return null;
        }
        const result = await request<Result>({
          type: kind,
          ...value,
          ...(kind === "backup" ? { projectPath: project } : {}),
        });
        if (mounted.current && latest.current.projectPath === project && result !== null)
          complete(result);
        return result;
      } catch (failure) {
        if (mounted.current && latest.current.projectPath === project)
          setError(cloudErrorKey(failure));
        return null;
      } finally {
        gate.current = false;
        activeOperation.current = null;
        if (mounted.current) {
          setOperation(null);
          setRevision((value) => value + 1);
        }
      }
    },
    [],
  );
  const backupNow = useCallback(
    () =>
      run<CloudBackupResult>("backup", {}, (result) => {
        setStatus((previous) => (previous ? { ...previous, lastBackup: result } : previous));
        setNotice(result.unchanged ? "cloudBackup.unchanged" : "cloudBackup.backedUp");
      }),
    [run],
  );
  const enabled = status?.config.enabled && status.hasCredentials;
  const minutes = status?.config.intervalMinutes ?? 30;
  const schedule = useCallback(() => {
    if (
      !enabled ||
      !latest.current.projectPath ||
      loadedProject.current !== latest.current.projectPath
    )
      return;
    if (gate.current && activeOperation.current === "backup") return;
    if (latest.current.busy || gate.current) {
      deferred.current = true;
      return;
    }
    deferred.current = false;
    void backupNow();
  }, [enabled, backupNow]);
  useEffect(() => {
    deferred.current = false;
    if (!enabled || !args.projectPath) return;
    const timer = setInterval(schedule, minutes * 60_000);
    return () => clearInterval(timer);
  }, [enabled, minutes, args.projectPath, schedule]);
  useEffect(() => {
    if (!args.busy && !operation && !loading && deferred.current) schedule();
  }, [args.busy, operation, loading, schedule]);
  useEffect(() => {
    if (args.projectPath !== loadedProject.current) {
      setNotice(null);
      setError(null);
      setRestoredDirectory(null);
    }
  }, [args.projectPath]);

  return {
    available,
    status,
    loading,
    operation,
    running: operation !== null || loading,
    error,
    notice,
    history,
    restoredDirectory,
    projectPath: args.projectPath,
    lastBackup: loadedProject.current === args.projectPath ? (status?.lastBackup ?? null) : null,
    backupNow,
    save: (config: CloudConfig, credentials?: CloudCredentials) =>
      run<CloudStatus>("save", { config, ...(credentials ? { credentials } : {}) }, (next) => {
        setStatus(next);
        setHistory([]);
        setNotice("cloudBackup.saved");
      }),
    testConnection: () =>
      run<{ ok: boolean }>("test", {}, () => setNotice("cloudBackup.connected")),
    refreshHistory: () => run<CloudSnapshot[]>("list", {}, setHistory),
    restore: (key: string) =>
      run<{ directory: string; fileCount: number }>("restore", { key }, (result) =>
        setRestoredDirectory(result.directory),
      ),
  };
}
export type CloudBackupController = ReturnType<typeof useCloudBackup>;
