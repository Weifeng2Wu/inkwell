import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

export const isDrawingFile = (path: string) => /\.excalidraw$/i.test(path);
export const MAX_DRAWING_BYTES = 20 * 1024 * 1024;

export function parseDrawing(content: string): ExcalidrawInitialDataState {
  if (!content.trim()) return { elements: [], scrollToContent: true };
  if (new TextEncoder().encode(content).length > MAX_DRAWING_BYTES)
    throw new Error("drawing.tooLarge");
  const scene = JSON.parse(content);
  if (
    scene?.type !== "excalidraw" ||
    ![1, 2].includes(scene.version) ||
    !Array.isArray(scene.elements) ||
    scene.elements.length > 10000 ||
    (scene.appState !== undefined &&
      (!scene.appState || typeof scene.appState !== "object" || Array.isArray(scene.appState))) ||
    (scene.files !== undefined &&
      (!scene.files || typeof scene.files !== "object" || Array.isArray(scene.files)))
  )
    throw new Error("drawing.invalid");
  const ids = new Set<string>();
  for (const element of scene.elements) {
    if (
      !element ||
      typeof element.id !== "string" ||
      !element.id ||
      ids.has(element.id) ||
      ![
        "rectangle",
        "diamond",
        "ellipse",
        "text",
        "image",
        "line",
        "arrow",
        "freedraw",
        "frame",
        "magicframe",
        "embeddable",
        "iframe",
      ].includes(element.type) ||
      ![element.x, element.y, element.width, element.height].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    )
      throw new Error("drawing.invalid");
    ids.add(element.id);
  }
  for (const file of Object.values(scene.files ?? {})) {
    if (
      !file ||
      typeof file !== "object" ||
      !("dataURL" in file) ||
      typeof file.dataURL !== "string" ||
      !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/.test(file.dataURL)
    )
      throw new Error("drawing.invalid");
  }
  return {
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files,
    scrollToContent: true,
  };
}
