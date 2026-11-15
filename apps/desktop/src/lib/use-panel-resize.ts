"use client";

import type { PanInfo } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_SIDEBAR_WIDTH, MIN_PANEL_WIDTH } from "@/lib/layout";
import { appStorage, storedPanelWidth } from "@/lib/storage/app-storage";

export type ResizablePanel = "sidebar" | "right";

/**
 * Widths of the two side panels, persisted across sessions. While dragging, the live width
 * is written to the `--sidebar-width` / `--right-panel-width` CSS variables once per frame
 * so the drag does not re-render the editor shell; state is committed when the drag ends.
 */
export function usePanelResize() {
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedPanelWidth("sidebarWidth", MIN_PANEL_WIDTH, MAX_SIDEBAR_WIDTH),
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    storedPanelWidth("rightPanelWidth", MIN_PANEL_WIDTH, 700),
  );
  const [resizing, setResizing] = useState<ResizablePanel | null>(null);
  const live = useRef({ sidebar: sidebarWidth, right: rightPanelWidth });
  const frame = useRef<number | null>(null);

  useEffect(() => {
    appStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    appStorage.setItem("rightPanelWidth", String(rightPanelWidth));
  }, [rightPanelWidth]);

  const startResize = useCallback(
    (panel: ResizablePanel) => {
      live.current = { sidebar: sidebarWidth, right: rightPanelWidth };
      const style = document.documentElement.style;
      style.setProperty("--sidebar-width", `${sidebarWidth}px`);
      style.setProperty("--right-panel-width", `${rightPanelWidth}px`);
      setResizing(panel);
    },
    [sidebarWidth, rightPanelWidth],
  );

  const dragResize = useCallback((panel: ResizablePanel, info: PanInfo) => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const style = document.documentElement.style;
      if (panel === "sidebar") {
        const width = Math.round(
          Math.min(Math.max(info.point.x, MIN_PANEL_WIDTH), MAX_SIDEBAR_WIDTH),
        );
        live.current.sidebar = width;
        style.setProperty("--sidebar-width", `${width}px`);
      } else {
        const width = Math.min(
          Math.max(window.innerWidth - info.point.x, MIN_PANEL_WIDTH),
          Math.floor(window.innerWidth / 2),
        );
        live.current.right = width;
        style.setProperty("--right-panel-width", `${width}px`);
      }
    });
  }, []);

  const endResize = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    setSidebarWidth(live.current.sidebar);
    setRightPanelWidth(live.current.right);
    const style = document.documentElement.style;
    style.removeProperty("--sidebar-width");
    style.removeProperty("--right-panel-width");
    setResizing(null);
  }, []);

  return { sidebarWidth, rightPanelWidth, resizing, startResize, dragResize, endResize };
}
