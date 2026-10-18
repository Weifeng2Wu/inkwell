import { useEffect, useRef, useState } from "react";
import type { AcademicConfig, ModelDiscoveryResult } from "./academic-client";
import { formatModelDiscoveryError } from "./model-discovery";

type Snapshot = {
  endpoint: string;
  result?: ModelDiscoveryResult;
  loading: boolean;
  error: string | null;
};

export function useAutomaticModels(options: {
  enabled: boolean;
  directory?: string;
  config: AcademicConfig;
  apiKey: string;
  apiKeyLoading: boolean;
  working: boolean;
  errorLabel: string;
  fetchModels: (config: AcademicConfig, apiKey: string) => Promise<ModelDiscoveryResult>;
  onDiscovered: (result: ModelDiscoveryResult) => void;
}) {
  const { config, apiKey, directory, enabled, apiKeyLoading, working } = options;
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  const endpoint = JSON.stringify([directory, config.protocol, baseUrl, apiKey]);
  let validEndpoint = false;
  let local = false;
  try {
    const url = new URL(baseUrl);
    local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    validEndpoint =
      (url.protocol === "https:" || (local && url.protocol === "http:")) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {}
  const ready = !!(
    enabled &&
    directory &&
    config.protocol &&
    validEndpoint &&
    !apiKeyLoading &&
    (apiKey.trim() || local)
  );
  const latest = useRef({ ...options, endpoint, ready });
  latest.current = { ...options, endpoint, ready };
  const attempted = useRef<string | null>(null);
  const scope = useRef({ endpoint, ready, version: 0 });
  if (scope.current.endpoint !== endpoint || scope.current.ready !== ready) {
    scope.current = { endpoint, ready, version: scope.current.version + 1 };
    attempted.current = null;
  }
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(
    () => () => {
      scope.current.version += 1;
      attempted.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!ready) {
      attempted.current = null;
      return;
    }
    if (working || attempted.current === endpoint) return;
    const version = scope.current.version;
    const timer = setTimeout(() => {
      attempted.current = endpoint;
      const request = latest.current;
      setSnapshot({ endpoint, loading: true, error: null });
      void request.fetchModels(request.config, request.apiKey).then(
        (result) => {
          if (scope.current.version !== version || !latest.current.ready) return;
          setSnapshot({ endpoint, result, loading: false, error: null });
          latest.current.onDiscovered(result);
        },
        (error: unknown) => {
          if (scope.current.version !== version || !latest.current.ready) return;
          setSnapshot({
            endpoint,
            loading: false,
            error: formatModelDiscoveryError(error, latest.current.errorLabel, request.apiKey),
          });
        },
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [endpoint, ready, working]);
  const current = snapshot?.endpoint === endpoint ? snapshot : null;
  return {
    models: current?.result?.models ?? null,
    capabilities: current?.result?.capabilities,
    loading: ready && (!current || current.loading),
    error: current?.error ?? null,
  };
}
