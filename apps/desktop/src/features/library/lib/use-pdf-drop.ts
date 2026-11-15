"use client";

import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

/**
 * Reports PDF files dropped onto the window from the operating system. `dragging` is true
 * while such a drag hovers the window, so the shell can show a drop target.
 */
export function usePdfDrop(enabled: boolean, onDrop: (paths: string[]) => void) {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;

  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let active = true;
    let stop: (() => void) | undefined;
    const pdfs = (paths: string[]) => paths.filter((path) => /\.pdf$/i.test(path));
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent(({ payload }) => {
          if (payload.type === "enter") setDragging(pdfs(payload.paths).length > 0);
          else if (payload.type === "leave") setDragging(false);
          else if (payload.type === "drop") {
            setDragging(false);
            const dropped = pdfs(payload.paths);
            if (dropped.length) handler.current(dropped);
          }
        }),
      )
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      active = false;
      setDragging(false);
      stop?.();
    };
  }, [enabled]);

  return dragging;
}
