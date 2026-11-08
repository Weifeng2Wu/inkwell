export type PdfToolbarAnchor = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };

/** Panel-relative placement shared by the compact toolbar and its color palette. */
export function pdfToolbarPosition(
  anchor: PdfToolbarAnchor,
  panel: Size,
  toolbar: Size,
  minimumTop: number,
  preferBelow = false,
) {
  const padding = 8;
  const maximumLeft = Math.max(padding, panel.width - toolbar.width - padding);
  const maximumTop = Math.max(minimumTop, panel.height - toolbar.height - padding);
  const above = anchor.top - toolbar.height - padding;
  const below = anchor.bottom + padding;
  let top: number;
  if (preferBelow && below <= maximumTop) top = below;
  else if (above >= minimumTop) top = above;
  else if (below <= maximumTop) top = below;
  else top = above;
  return {
    left: Math.max(
      padding,
      Math.min((anchor.left + anchor.right - toolbar.width) / 2, maximumLeft),
    ),
    top: Math.max(minimumTop, Math.min(top, maximumTop)),
  };
}
