"use client";

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GhStatus } from "@/lib/tauri/use-tauri-daemon";

export function useGitHubAuth() {
  const [status, setStatus] = useState<GhStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [loginStarted, setLoginStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const switchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (switchingRef.current) return;
    if (!isTauri()) {
      setChecking(false);
      return;
    }
    const currentRequest = ++request.current;
    setChecking(true);
    setError(null);
    try {
      const detected = await invoke<GhStatus>("gh_check");
      if (mounted.current && currentRequest === request.current) setStatus(detected);
    } catch (caught) {
      if (mounted.current && currentRequest === request.current) {
        setStatus(null);
        setError(String(caught));
      }
    } finally {
      if (mounted.current && currentRequest === request.current) setChecking(false);
    }
  }, []);

  const switchAccount = useCallback(async (username: string) => {
    if (!isTauri() || switchingRef.current) return;
    switchingRef.current = true;
    const currentRequest = ++request.current;
    setChecking(false);
    setSwitching(username);
    setError(null);
    try {
      const detected = await invoke<GhStatus>("gh_auth_switch", { username });
      if (mounted.current && currentRequest === request.current) {
        setStatus(detected);
        setLoginStarted(false);
      }
    } catch (caught) {
      if (mounted.current && currentRequest === request.current) setError(String(caught));
    } finally {
      switchingRef.current = false;
      if (mounted.current) setSwitching(null);
    }
  }, []);

  const login = useCallback(async () => {
    if (!isTauri()) return;
    setLaunching(true);
    setError(null);
    try {
      await invoke("gh_auth_login");
      if (mounted.current) setLoginStarted(true);
    } catch (caught) {
      if (mounted.current) setError(String(caught));
    } finally {
      if (mounted.current) setLaunching(false);
    }
  }, []);

  const install = useCallback(async () => {
    if (!isTauri()) return;
    setInstalling(true);
    setError(null);
    try {
      await open("https://cli.github.com/");
    } catch (caught) {
      if (mounted.current) setError(String(caught));
    } finally {
      if (mounted.current) setInstalling(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      ++request.current;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return {
    status,
    checking,
    launching,
    installing,
    switching,
    loginStarted,
    error,
    refresh,
    login,
    install,
    switchAccount,
  };
}
