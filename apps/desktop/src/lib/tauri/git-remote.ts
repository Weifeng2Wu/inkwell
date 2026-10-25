import { invoke } from "@tauri-apps/api/core";

const pendingFetches = new Map<string, Promise<void>>();

// Focus events, the timer and manual refresh can arrive together. Share the fetch
// so Git's remote ref locks do not turn a normal refresh into a spurious error.
export function fetchGitRemote(dir: string): Promise<void> {
  const pending = pendingFetches.get(dir);
  if (pending) return pending;
  const request = invoke<void>("git_fetch", { dir }).finally(() => {
    pendingFetches.delete(dir);
  });
  pendingFetches.set(dir, request);
  return request;
}
