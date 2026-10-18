import type { DockviewApi } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import { applyDockviewPosition } from "./dockview-position";

function setup() {
  const moveTo = vi.fn();
  const primary = { group: { id: "source-group" } };
  const pdf = { api: { moveTo } };
  const panels = new Map<string, unknown>([
    ["editor-primary", primary],
    ["editor-split-right", pdf],
  ]);
  const api = { getPanel: (id: string) => panels.get(id) } as unknown as DockviewApi;
  return { api, primary, moveTo, panels };
}

const position = { referencePanel: "editor-primary", direction: "right" as const };

describe("Dockview position requests", () => {
  it("moves an already open PDF to the right of the source on a new SyncTeX jump", () => {
    const { api, primary, moveTo } = setup();
    expect(applyDockviewPosition(api, "editor-split-right", position, 2, 1)).toBe(2);
    expect(moveTo).toHaveBeenCalledExactlyOnceWith({
      group: primary.group,
      position: "right",
      skipSetActive: true,
    });
  });

  it("preserves manual layout changes during ordinary rerenders", () => {
    const { api, moveTo } = setup();
    expect(applyDockviewPosition(api, "editor-split-right", position, 2, 2)).toBe(2);
    expect(applyDockviewPosition(api, "editor-split-right", position, undefined, 2)).toBe(2);
    expect(moveTo).not.toHaveBeenCalled();
  });

  it("waits for both panels before marking a layout request as applied", () => {
    const { api, panels, moveTo } = setup();
    panels.delete("editor-primary");
    expect(applyDockviewPosition(api, "editor-split-right", position, 2, 1)).toBe(1);
    expect(moveTo).not.toHaveBeenCalled();
  });

  it("applies repeated jumps even if the requested side has not changed", () => {
    const { api, moveTo } = setup();
    const applied = applyDockviewPosition(api, "editor-split-right", position, 2, 1);
    expect(applyDockviewPosition(api, "editor-split-right", position, 3, applied)).toBe(3);
    expect(moveTo).toHaveBeenCalledTimes(2);
  });
});
