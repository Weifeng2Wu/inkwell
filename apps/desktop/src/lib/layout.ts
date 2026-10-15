/** Shell layout constants shared by the editor shell and its panels. */

export const PANEL_SPRING = {
  type: "spring",
  stiffness: 400,
  damping: 35,
  mass: 0.8,
} as const;

export const INSTANT_TRANSITION = { duration: 0 } as const;

export const MIN_PANEL_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;
