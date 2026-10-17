"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { appStorage, desktopStorage, flushAppStorage, initializeAppStorage } from "./app-storage";

export function StorageThemeSync() {
  const { theme, setTheme } = useTheme();
  const loaded = useRef(false);
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const saved = appStorage.getItem("theme");
    if (saved) setTheme(saved);
    setThemeReady(true);
  }, [setTheme]);
  useEffect(() => {
    if (themeReady && theme) appStorage.setItem("theme", theme);
  }, [theme, themeReady]);
  return null;
}

async function savePending() {
  const tasks: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent("inkwell-before-close", { detail: tasks }));
  await Promise.all(tasks);
  await flushAppStorage();
}

export function StorageProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    void initializeAppStorage()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((failure: unknown) => {
        if (active) setError(String(failure));
      });
    const report = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener("inkwell-storage-error", report);
    const flush = () => {
      void flushAppStorage().catch((failure: unknown) => setError(String(failure)));
    };
    window.addEventListener("pagehide", flush);
    let unlisten: (() => void) | undefined;
    if (desktopStorage()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().onCloseRequested(async (event) => {
            event.preventDefault();
            try {
              await savePending();
              await getCurrentWindow().destroy();
            } catch (failure) {
              setError(String(failure));
            }
          }),
        )
        .then((dispose) => {
          if (active) unlisten = dispose;
          else dispose();
        })
        .catch((failure: unknown) => {
          if (active) setError(String(failure));
        });
    }
    return () => {
      active = false;
      unlisten?.();
      window.removeEventListener("inkwell-storage-error", report);
      window.removeEventListener("pagehide", flush);
    };
  }, []);
  useEffect(() => {
    if (attempt === 0) return;
    void (ready ? savePending() : initializeAppStorage())
      .then(() => {
        setReady(true);
        setError(null);
      })
      .catch((failure: unknown) => setError(String(failure)));
  }, [attempt, ready]);
  return (
    <>
      {ready && children}
      {(!ready || error) && (
        <main
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background text-foreground"
          role="status"
        >
          <p>{error ?? "Inkwell…"}</p>
          {error && (
            <button
              type="button"
              className="rounded-md border border-border px-4 py-2"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry / 重试 / 다시 시도
            </button>
          )}
        </main>
      )}
    </>
  );
}
