import { useEffect, useRef, useState } from "react";
import type { AcademicConfig } from "./academic-client";
import { apiKeyScope, readAgentApiKey, writeAgentApiKey } from "./agent-api-key-store";

type KeyState = {
  scope: string;
  value: string;
  loading: boolean;
  saved: boolean;
  error: "load" | "save" | null;
};

export function useAgentApiKey(config: AcademicConfig) {
  const scope = apiKeyScope(config);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const revision = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<KeyState>({
    scope,
    value: "",
    loading: true,
    saved: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const version = ++revision.current;
    setState({ scope, value: "", loading: true, saved: false, error: null });
    void writes.current
      .then(() => readAgentApiKey(scope))
      .then((value) => {
        if (!cancelled && revision.current === version)
          setState({ scope, value: value ?? "", loading: false, saved: true, error: null });
      })
      .catch(() => {
        if (!cancelled && revision.current === version)
          setState({ scope, value: "", loading: false, saved: false, error: "load" });
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  function setApiKey(value: string) {
    const trimmed = value.trim();
    if (!trimmed || currentScope.current !== scope) return;
    const version = ++revision.current;
    setState({ scope, value: trimmed, loading: false, saved: false, error: null });
    const saving = writes.current.then(() => writeAgentApiKey(scope, trimmed));
    writes.current = saving.catch(() => {});
    void saving
      .then(() => {
        if (currentScope.current === scope && revision.current === version)
          setState({ scope, value: trimmed, loading: false, saved: true, error: null });
      })
      .catch(() => {
        if (currentScope.current === scope && revision.current === version)
          setState({ scope, value: trimmed, loading: false, saved: false, error: "save" });
      });
  }

  return {
    apiKey: state.scope === scope ? state.value : "",
    apiKeyLoading: state.scope !== scope || state.loading,
    apiKeySaved: state.scope === scope && state.saved,
    apiKeyError: state.scope === scope ? state.error : null,
    setApiKey,
  };
}
