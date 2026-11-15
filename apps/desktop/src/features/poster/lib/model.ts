import {
  POSTER_DEFAULTS,
  parsePosterCanvas,
  wrapPosterText,
} from "@inkwell/academic-agent/poster-document";

export { POSTER_DEFAULTS, validImageSource } from "@inkwell/academic-agent/poster-document";
export const POSTER_SIZES = {
  A0: [841, 1189],
  A1: [594, 841],
  "36×48 in": [914.4, 1219.2],
} as const;
export type PosterSize = keyof typeof POSTER_SIZES;
export type PosterElement = {
  id: string;
  type: "text" | "rect" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  src?: string;
  alt?: string;
};
export type PosterDocument = {
  version: 1;
  title: string;
  width: number;
  height: number;
  background: string;
  elements: PosterElement[];
};

export const isPosterFile = (path: string) => /\.poster\.json$/i.test(path);
export const parsePoster = parsePosterCanvas;
export const serializePoster = (poster: PosterDocument) => `${JSON.stringify(poster, null, 2)}\n`;

export const wrapText = wrapPosterText;
export function textOverflows(e: PosterElement) {
  return (
    e.type === "text" &&
    wrapText(e.text ?? "", e.width, e.fontSize ?? 8).length * (e.fontSize ?? 8) * 1.25 > e.height
  );
}
export function resizePoster(p: PosterDocument, width: number, height: number): PosterDocument {
  const sx = width / p.width,
    sy = height / p.height;
  return {
    ...p,
    width,
    height,
    elements: p.elements.map((e) => ({
      ...e,
      x: e.x * sx,
      y: e.y * sy,
      width: e.width * sx,
      height: e.height * sy,
      ...(e.fontSize
        ? { fontSize: Math.max(1, Math.min(120, e.fontSize * Math.min(sx, sy))) }
        : {}),
    })),
  };
}
export function createPoster(size: PosterSize = "A0", landscape = false): PosterDocument {
  const [short, long] = POSTER_SIZES[size];
  const width = landscape ? long : short,
    height = landscape ? short : long;
  const elements: PosterElement[] = [];
  const text = (
    id: string,
    value: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fontSize: number,
    bold = false,
    ink: string = POSTER_DEFAULTS.ink,
  ) =>
    elements.push({
      id,
      type: "text",
      text: value,
      x,
      y,
      width: w,
      height: h,
      fontSize,
      bold,
      color: ink,
    });
  elements.push({
    id: "header",
    type: "rect",
    x: 0,
    y: 0,
    width,
    height: height * 0.18,
    fill: POSTER_DEFAULTS.accent,
  });
  text("title", "Your research title", 28, 25, width - 56, height * 0.085, 20, true, "#ffffff");
  text(
    "authors",
    "Authors · Institution · Contact",
    28,
    height * 0.13,
    width - 56,
    25,
    8,
    false,
    "#ffffff",
  );
  const columns = 3;
  const gap = 18,
    margin = 28,
    available = width - margin * 2 - gap * (columns - 1),
    columnWidths = [available * 0.29, available * 0.42, available * 0.29];
  const headings = [
    "Research question",
    "Methods",
    "Key results",
    "Discussion",
    "Conclusions",
    "References & acknowledgements",
  ];
  const top = height * 0.22,
    row = (height - top - 30) / Math.ceil(headings.length / columns);
  headings.forEach((heading, i) => {
    const column = i % columns;
    const x = margin + columnWidths.slice(0, column).reduce((sum, value) => sum + value + gap, 0),
      col = columnWidths[column] ?? columnWidths[0] ?? 1,
      y = top + Math.floor(i / columns) * row;
    elements.push({
      id: `panel-${i}`,
      type: "rect",
      x,
      y,
      width: col,
      height: row - gap,
      fill: POSTER_DEFAULTS.panel,
    });
    text(`heading-${i}`, heading, x + 10, y + 10, col - 20, 28, 11, true, POSTER_DEFAULTS.accent);
    text(
      `body-${i}`,
      "Add evidence from your paper here. Double-click to edit; drag to move.",
      x + 10,
      y + 47,
      col - 20,
      row - gap - 57,
      8,
    );
  });
  return {
    version: 1,
    title: "Research poster",
    width,
    height,
    background: POSTER_DEFAULTS.background,
    elements,
  };
}
