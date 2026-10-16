import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

let fontsRequest: Promise<string[]> | undefined;

export function loadSystemFonts(): Promise<string[]> {
  if (!fontsRequest) {
    fontsRequest = invoke<string[]>("list_system_fonts")
      .then((fonts) => [...new Set(fonts)].sort((first, second) => first.localeCompare(second)))
      .catch((error: unknown) => {
        fontsRequest = undefined;
        throw error;
      });
  }
  return fontsRequest;
}

export function useSystemFonts() {
  const [fonts, setFonts] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [request, setRequest] = useState(() => ({ load: loadSystemFonts }));

  useEffect(() => {
    let active = true;
    if (!isTauri()) {
      setStatus("unavailable");
      return;
    }
    setStatus("loading");
    void request.load().then(
      (loaded) => {
        if (active) {
          setFonts(loaded);
          setStatus("ready");
        }
      },
      () => {
        if (active) setStatus("error");
      },
    );
    return () => {
      active = false;
    };
  }, [request]);

  return { fonts, status, retry: () => setRequest({ load: loadSystemFonts }) };
}
