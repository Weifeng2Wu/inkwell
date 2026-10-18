import type { AddPanelPositionOptions, DockviewApi } from "dockview-react";

export function applyDockviewPosition(
  api: DockviewApi,
  panelId: string,
  position: AddPanelPositionOptions | undefined,
  revision: number | undefined,
  previousRevision: number | undefined,
): number | undefined {
  if (revision === undefined || revision === previousRevision || !position) return previousRevision;
  if (!("referencePanel" in position)) return previousRevision;
  const reference =
    typeof position.referencePanel === "string"
      ? api.getPanel(position.referencePanel)
      : position.referencePanel;
  const panel = api.getPanel(panelId);
  if (!panel || !reference || panel === reference) return previousRevision;
  const positions = {
    left: "left",
    right: "right",
    above: "top",
    below: "bottom",
    within: "center",
  } as const;
  panel.api.moveTo({
    group: reference.group,
    position: positions[position.direction ?? "within"],
    skipSetActive: true,
  });
  return revision;
}
