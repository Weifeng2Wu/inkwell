"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { ReviewChange } from "./review-changes";

export type ReviewBuffer = { path: string; content: string };

export function useAgentReview({
  directory,
  buffers,
  onApplied,
}: {
  directory?: string;
  buffers: () => ReviewBuffer[];
  onApplied: (path: string, content: string | null) => void;
}) {
  const [changes, setChanges] = useState<ReviewChange[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = useRef(directory);
  scope.current = directory;
  const pending = useRef(false);
  const deciding = useRef(false);
  const latest = useRef({ buffers, onApplied });
  latest.current = { buffers, onApplied };

  useEffect(() => {
    setChanges([]);
    setOpen(false);
    setError(null);
    pending.current = false;
    if (!directory) return;
    void invoke<ReviewChange[]>("agent_review_changes")
      .then((result) => {
        if (scope.current === directory) {
          setChanges(result);
          setOpen(result.length > 0);
        }
      })
      .catch((caught: unknown) => {
        if (scope.current === directory) setError(String(caught));
      });
  }, [directory]);

  async function beforeTurn() {
    if (!directory || scope.current !== directory || pending.current)
      throw new Error("Agent review is busy or the project changed.");
    pending.current = true;
    try {
      await invoke("agent_review_prepare", { buffers: latest.current.buffers() });
      if (scope.current !== directory) throw new Error("Project changed.");
    } catch (caught) {
      pending.current = false;
      throw caught;
    }
  }

  async function afterTurn() {
    if (scope.current !== directory) return;
    try {
      const result = await invoke<ReviewChange[]>("agent_review_changes");
      if (scope.current === directory) {
        setChanges(result);
        setOpen(result.length > 0);
      }
    } finally {
      pending.current = false;
    }
  }

  async function resolve(
    change: ReviewChange,
    accept: boolean,
    content = change.after,
    remaining?: string,
  ) {
    if (scope.current !== directory) throw new Error("Project changed.");
    const buffer = latest.current.buffers().find((entry) => entry.path === change.path);
    if (accept && buffer && buffer.content !== change.before)
      throw new Error(
        "The editor content changed. Original content was preserved; reject and regenerate this suggestion.",
      );
    await invoke("agent_review_resolve", {
      path: change.path,
      expected: change.before,
      proposed: change.after,
      content,
      accept,
      ...(remaining === undefined ? {} : { remaining }),
    });
    if (scope.current !== directory) return;
    if (accept) latest.current.onApplied(change.path, content);
    setChanges((current) =>
      remaining === undefined
        ? current.filter((entry) => entry.path !== change.path)
        : current.map((entry) =>
            entry.path === change.path
              ? { ...entry, before: accept ? content : change.before, after: remaining }
              : entry,
          ),
    );
  }

  async function decide(
    change: ReviewChange,
    accept: boolean,
    content = change.after,
    remaining?: string,
  ) {
    if (pending.current || deciding.current) return;
    deciding.current = true;
    setBusy(true);
    setError(null);
    try {
      await resolve(change, accept, content, remaining);
    } catch (caught) {
      setError(String(caught));
    } finally {
      deciding.current = false;
      setBusy(false);
    }
  }

  async function decideAll(accept: boolean) {
    if (pending.current || deciding.current) return;
    deciding.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const change of changes) await resolve(change, accept);
    } catch (caught) {
      setError(String(caught));
    } finally {
      deciding.current = false;
      setBusy(false);
    }
  }

  return { changes, open, setOpen, error, busy, beforeTurn, afterTurn, decide, decideAll };
}
