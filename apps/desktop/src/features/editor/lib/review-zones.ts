import type { editor } from "monaco-editor";
import { createReviewToolbar } from "./review-toolbar";

type ReviewActions = {
  acceptLabel: string;
  rejectLabel: string;
  disabled: boolean;
  onDecide: (changes: editor.ILineChange[], index: number, accept: boolean) => void;
};

export function mountReviewZones(
  diff: editor.IStandaloneDiffEditor,
  getReview: () => ReviewActions | undefined,
  onChanges: (changes: editor.ILineChange[]) => void,
) {
  const modified = diff.getModifiedEditor();
  let signature = "";
  let zones: string[] = [];
  let toolbars: { node: HTMLDivElement; widget: editor.IOverlayWidget; top: number }[] = [];
  const layout = () => {
    const info = modified.getLayoutInfo();
    for (const toolbar of toolbars) {
      toolbar.node.style.width = `${info.contentWidth}px`;
      toolbar.node.style.height = "44px";
      toolbar.node.style.visibility =
        toolbar.top >= 0 && toolbar.top + 44 <= info.height - info.horizontalScrollbarHeight
          ? "visible"
          : "hidden";
      modified.layoutOverlayWidget(toolbar.widget);
    }
  };
  const clearWidgets = () => {
    for (const toolbar of toolbars) modified.removeOverlayWidget(toolbar.widget);
    toolbars = [];
  };
  const update = () => {
    const changes = diff.getLineChanges() ?? [];
    onChanges(changes);
    const review = getReview();
    const nextSignature = JSON.stringify([changes, review?.acceptLabel, review?.rejectLabel]);
    if (signature === nextSignature) {
      for (const { node } of toolbars) {
        for (const button of node.querySelectorAll("button")) button.disabled = !!review?.disabled;
      }
      return;
    }
    signature = nextSignature;
    clearWidgets();
    modified.changeViewZones((accessor) => {
      for (const zone of zones) accessor.removeZone(zone);
      zones = [];
      if (!review) return;
      changes.forEach((change, index) => {
        const node = createReviewToolbar({
          ...review,
          index,
          onDecide: (accept) => {
            const current = getReview();
            if (current && !current.disabled) current.onDecide(changes, index, accept);
          },
        });
        const toolbar: { node: HTMLDivElement; top: number; widget: editor.IOverlayWidget } = {
          node,
          top: -1,
          widget: {
            getId: () => `agent-review-action-${index}`,
            getDomNode: () => node,
            getPosition: () => ({
              preference: { top: toolbar.top, left: modified.getLayoutInfo().contentLeft },
            }),
          } satisfies editor.IOverlayWidget,
        };
        toolbars.push(toolbar);
        modified.addOverlayWidget(toolbar.widget);
        zones.push(
          accessor.addZone({
            afterLineNumber:
              change.modifiedEndLineNumber === 0
                ? change.modifiedStartLineNumber
                : change.modifiedEndLineNumber,
            heightInPx: 44,
            domNode: document.createElement("div"),
            suppressMouseDown: false,
            onDomNodeTop: (top) => {
              if (toolbar.top === top) return;
              toolbar.top = top;
              layout();
            },
          }),
        );
      });
    });
    layout();
  };
  const subscriptions = [diff.onDidUpdateDiff(update), modified.onDidLayoutChange(layout)];
  update();
  return {
    update,
    dispose() {
      for (const subscription of subscriptions) subscription.dispose();
      clearWidgets();
    },
  };
}
