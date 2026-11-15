"use client";

import { type ReactNode, useMemo } from "react";
import { TabBar, type TabDragEndPayload, type TabDragMovePayload } from "@/components/ui/tab-bar";
import { pathSync } from "@/lib/path";
import type { Pane, PaneId } from "../lib/panes";
import type { EditorPanes } from "../lib/use-editor-panes";

type Props = {
  id: PaneId;
  pane: Pane;
  controller: EditorPanes;
  onOpen: (path: string) => void;
  onTabDragMove: (payload: TabDragMovePayload | null) => void;
  onTabDragEnd: (payload: TabDragEndPayload) => void;
  children: ReactNode;
};

/** One editor group: its tab bar above the active document. */
export function EditorPane({
  id,
  pane,
  controller,
  onOpen,
  onTabDragMove,
  onTabDragEnd,
  children,
}: Props) {
  const tabs = useMemo(
    () => pane.tabs.map((path) => ({ id: path, label: pathSync.basename(path), title: path })),
    [pane.tabs],
  );
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TabBar
        tabs={tabs}
        activeTab={pane.active ?? ""}
        onTabSelect={onOpen}
        onTabClose={(path) => controller.close(id, [path])}
        onTabReorder={(dragged, target, position) =>
          controller.reorder(id, dragged, target, position)
        }
        onTabDragMove={onTabDragMove}
        onTabDragEnd={onTabDragEnd}
        onCloseOthers={(path) => controller.closeOthers(id, path)}
        onCloseToLeft={(path) => controller.closeToLeft(id, path)}
        onCloseToRight={(path) => controller.closeToRight(id, path)}
        onCloseAll={() => controller.closeAll(id)}
      />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
