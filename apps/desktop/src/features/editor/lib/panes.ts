import { fileType } from "@/lib/file-types";

export type PaneId = "primary" | "split";
export type SplitSide = "left" | "right";

/** One editor group: its tabs and the state of the active tab's document. */
export type Pane = {
  tabs: string[];
  active?: string;
  /** Text of the active file; empty for image and PDF previews. */
  content: string;
  /** True until the active text file has been read. */
  loading: boolean;
  error: string | null;
};

/**
 * The editor area: a primary group and an optional second group beside it. A split group
 * always has tabs, and exists only while the primary group has tabs too.
 */
export type Panes = { primary: Pane; split: Pane | null; side: SplitSide };

const EMPTY_PANE: Pane = { tabs: [], content: "", loading: false, error: null };
export const EMPTY_PANES: Panes = { primary: EMPTY_PANE, split: null, side: "right" };

export const otherPane = (id: PaneId): PaneId => (id === "primary" ? "split" : "primary");

function withPane(panes: Panes, id: PaneId, pane: Pane | null): Panes {
  const next = { ...panes, [id]: pane ?? (id === "primary" ? EMPTY_PANE : null) };
  if (next.split && next.split.tabs.length === 0) next.split = null;
  // The primary group is never empty beside a split: the split takes its place.
  if (next.split && next.primary.tabs.length === 0)
    return { ...next, primary: next.split, split: null };
  return next;
}

function show(pane: Pane, path: string): Pane {
  return {
    tabs: pane.tabs.includes(path) ? pane.tabs : [...pane.tabs, path],
    active: path,
    content: "",
    loading: fileType(path) === "text",
    error: null,
  };
}

/** Makes `path` the active tab of a group, adding the tab if needed. */
export function activate(panes: Panes, id: PaneId, path: string, side?: SplitSide): Panes {
  // A split cannot exist on its own; the first file always opens in the primary group.
  const target = id === "split" && panes.primary.tabs.length === 0 ? "primary" : id;
  const next = withPane(panes, target, show(panes[target] ?? EMPTY_PANE, path));
  return target === "split" && side ? { ...next, side } : next;
}

/** Stores the text read for a group's active file. */
export function loaded(panes: Panes, id: PaneId, path: string, content: string): Panes {
  const pane = panes[id];
  if (!pane || pane.active !== path) return panes;
  return withPane(panes, id, { ...pane, content, loading: false, error: null });
}

export function failed(panes: Panes, id: PaneId, path: string, error: string): Panes {
  const pane = panes[id];
  if (!pane || pane.active !== path) return panes;
  return withPane(panes, id, { ...pane, content: "", loading: false, error });
}

/** Closes tabs in one group. When the active tab closes, its neighbour becomes active. */
export function closeTabs(panes: Panes, id: PaneId, paths: readonly string[]): Panes {
  const pane = panes[id];
  if (!pane || !paths.some((path) => pane.tabs.includes(path))) return panes;
  const tabs = pane.tabs.filter((path) => !paths.includes(path));
  if (pane.active && tabs.includes(pane.active)) return withPane(panes, id, { ...pane, tabs });
  const index = pane.active ? pane.tabs.indexOf(pane.active) : 0;
  const before = pane.tabs.slice(0, index).filter((path) => tabs.includes(path)).length;
  const active = tabs[Math.min(before, tabs.length - 1)];
  return withPane(panes, id, active ? { ...show(pane, active), tabs } : null);
}

/** Keeps only the tabs of a group for which `keep` is true; `path` becomes active if needed. */
export function keepTabs(
  panes: Panes,
  id: PaneId,
  path: string,
  keep: (index: number, pivot: number) => boolean,
): Panes {
  const pane = panes[id];
  const pivot = pane?.tabs.indexOf(path) ?? -1;
  if (!pane || pivot < 0) return panes;
  const tabs = pane.tabs.filter((_, index) => keep(index, pivot));
  if (tabs.length === pane.tabs.length) return panes;
  if (pane.active && tabs.includes(pane.active)) return withPane(panes, id, { ...pane, tabs });
  return withPane(panes, id, { ...show(pane, path), tabs });
}

export function reorderTab(
  panes: Panes,
  id: PaneId,
  dragged: string,
  target: string,
  position: "before" | "after",
): Panes {
  const pane = panes[id];
  if (!pane || dragged === target || !pane.tabs.includes(dragged)) return panes;
  const tabs = pane.tabs.filter((path) => path !== dragged);
  const index = tabs.indexOf(target);
  if (index < 0) return panes;
  tabs.splice(position === "before" ? index : index + 1, 0, dragged);
  return withPane(panes, id, { ...pane, tabs });
}

/** Moves a tab to the other group, creating the split on `side` when needed. */
export function moveTab(panes: Panes, path: string, to: PaneId, side?: SplitSide): Panes {
  const from = otherPane(to);
  if (!panes[from]?.tabs.includes(path)) return panes;
  // Moving the only primary tab into a new split would leave nothing to split from.
  if (to === "split" && !panes.split && panes.primary.tabs.length < 2) return panes;
  const closed = closeTabs(panes, from, [path]);
  // Closing the split's last tab removes it, and closing the primary's last promotes the split.
  const target = to === "split" && panes.split && !closed.split ? "primary" : to;
  return activate(closed, target, path, side);
}

/** Replaces the text of a file wherever it is the active, loaded document. */
export function setContent(panes: Panes, path: string, content: string): Panes {
  let next = panes;
  for (const id of ["primary", "split"] as const) {
    const pane = next[id];
    if (pane?.active === path && !pane.loading && !pane.error && pane.content !== content)
      next = { ...next, [id]: { ...pane, content } };
  }
  return next;
}

/** The loaded text documents currently shown, for features that read unsaved buffers. */
export function activeBuffers(panes: Panes): { path: string; content: string }[] {
  const buffers = new Map<string, string>();
  for (const pane of [panes.split, panes.primary])
    if (pane?.active && !pane.loading && !pane.error && fileType(pane.active) === "text")
      buffers.set(pane.active, pane.content);
  return [...buffers].map(([path, content]) => ({ path, content }));
}
