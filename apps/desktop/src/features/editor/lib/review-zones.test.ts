import type { editor } from "monaco-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountReviewZones } from "./review-zones";

vi.mock("./review-toolbar", () => ({
  createReviewToolbar: () => ({ style: {}, querySelectorAll: () => [] }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("review action interaction layer", () => {
  it("keeps controls outside hidden view zones and tracks scrolling without remounting", () => {
    vi.stubGlobal("document", { createElement: () => ({}) });
    const zones: editor.IViewZone[] = [];
    const widgets: editor.IOverlayWidget[] = [];
    const info = { contentWidth: 600, contentLeft: 50, height: 500, horizontalScrollbarHeight: 10 };
    const dispose = vi.fn();
    const modified = {
      getLayoutInfo: () => info,
      changeViewZones: (callback: (accessor: unknown) => void) =>
        callback({
          addZone: (zone: editor.IViewZone) => {
            zones.push(zone);
            return "zone";
          },
          removeZone: vi.fn(),
        }),
      addOverlayWidget: (widget: editor.IOverlayWidget) => widgets.push(widget),
      removeOverlayWidget: vi.fn(),
      layoutOverlayWidget: vi.fn(),
      onDidLayoutChange: () => ({ dispose }),
    };
    const changes = [
      {
        originalStartLineNumber: 1,
        originalEndLineNumber: 1,
        modifiedStartLineNumber: 1,
        modifiedEndLineNumber: 1,
      },
    ];
    const diff = {
      getModifiedEditor: () => modified,
      getLineChanges: () => changes,
      onDidUpdateDiff: () => ({ dispose }),
    };
    const controls = mountReviewZones(
      diff as unknown as editor.IStandaloneDiffEditor,
      () => ({
        acceptLabel: "接受",
        rejectLabel: "拒绝",
        disabled: false,
        onDecide: vi.fn(),
      }),
      vi.fn(),
    );
    const zone = zones[0];
    const widget = widgets[0];
    expect(zone).toBeDefined();
    expect(widget).toBeDefined();
    expect(zone?.domNode).not.toBe(widget?.getDomNode());
    expect(zone?.suppressMouseDown).toBe(false);
    zone?.onDomNodeTop?.(120);
    expect(widget?.getPosition()).toEqual({ preference: { top: 120, left: 50 } });
    expect(widget?.getDomNode().style.visibility).toBe("visible");
    zone?.onDomNodeTop?.(-50);
    expect(widget?.getDomNode().style.visibility).toBe("hidden");
    controls.update();
    expect(widgets).toHaveLength(1);
    controls.dispose();
    expect(modified.removeOverlayWidget).toHaveBeenCalledWith(widget);
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
