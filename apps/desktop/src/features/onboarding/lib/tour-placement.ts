export interface TourRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function placeTourCard(
  target: TourRect | null,
  viewportWidth: number,
  viewportHeight: number,
  cardHeight: number,
) {
  const gap = 16;
  const width = Math.min(400, Math.max(0, viewportWidth - gap * 2));
  const height = Math.min(cardHeight, viewportHeight - gap * 2);
  const left = target
    ? Math.min(Math.max(gap, target.left + target.width - width), viewportWidth - gap - width)
    : (viewportWidth - width) / 2;
  let top = target ? target.top + target.height + gap : (viewportHeight - height) / 2;
  if (target && top + height > viewportHeight - gap) top = target.top - height - gap;
  return { left, top: Math.max(gap, Math.min(top, viewportHeight - height - gap)), width };
}
