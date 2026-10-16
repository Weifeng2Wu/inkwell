export function createReviewToolbar({
  acceptLabel,
  rejectLabel,
  disabled,
  index,
  onDecide,
}: {
  acceptLabel: string;
  rejectLabel: string;
  disabled: boolean;
  index: number;
  onDecide: (accept: boolean) => void;
}) {
  const node = document.createElement("div");
  node.className = "agent-review-toolbar";
  node.setAttribute("role", "group");
  for (const event of ["pointerdown", "mousedown", "dblclick", "keydown"]) {
    node.addEventListener(event, (event) => event.stopPropagation());
  }
  for (const accept of [true, false]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-sm agent-review-action ${accept ? "btn-primary" : "btn-secondary"}`;
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = accept ? "✓" : "×";
    const label = document.createElement("span");
    label.textContent = accept ? acceptLabel : rejectLabel;
    button.append(icon, label);
    button.disabled = disabled;
    button.setAttribute("aria-label", `${label.textContent} ${index + 1}`);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!button.disabled) onDecide(accept);
    });
    node.append(button);
  }
  return node;
}
