export type PdfToolbarAnchor = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };
type Box = { left: number; top: number; width: number; height: number };
type NormalizedRect = { x: number; y: number; width: number; height: number };

/**
 * Panel-relative box around a selection. Lines scrolled out of the pane (or under
 * its toolbar) are ignored unless nothing else is left to anchor to.
 */
export function pdfSelectionAnchor(
  pages: readonly { bounds: Box; rects: readonly NormalizedRect[] }[],
  panel: Box,
  minimumTop: number,
): PdfToolbarAnchor {
  const boxes = pages.flatMap(({ bounds, rects }) =>
    rects.map((rect) => {
      const left = bounds.left - panel.left + rect.x * bounds.width;
      const top = bounds.top - panel.top + rect.y * bounds.height;
      return {
        left,
        top,
        right: left + rect.width * bounds.width,
        bottom: top + rect.height * bounds.height,
      };
    }),
  );
  const visible = boxes.filter((box) => box.bottom >= minimumTop && box.top <= panel.height);
  const anchors = visible.length ? visible : boxes;
  if (!anchors.length) return { left: 0, right: 0, top: minimumTop, bottom: minimumTop };
  return {
    left: Math.min(...anchors.map((box) => box.left)),
    right: Math.max(...anchors.map((box) => box.right)),
    top: Math.min(...anchors.map((box) => box.top)),
    bottom: Math.max(...anchors.map((box) => box.bottom)),
  };
}

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
