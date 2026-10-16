export function pdfNavigationPoint({
  clientX,
  clientY,
  rect,
  scale,
  pointerStartedOnPage,
  keyboard,
}: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  scale: number;
  pointerStartedOnPage: boolean;
  keyboard: boolean;
}) {
  if ((!pointerStartedOnPage && !keyboard) || scale <= 0) return null;
  const x = keyboard ? rect.width / 2 : clientX - rect.left;
  const y = keyboard ? rect.height / 2 : clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  return { x: x / scale, y: y / scale };
}
