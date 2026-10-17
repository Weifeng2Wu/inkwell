export const POSTER_DEFAULTS = {
  background: "#ffffff",
  ink: "#14253d",
  accent: "#174a7e",
  panel: "#eef3f8",
  font: "Arial",
} as const;
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
const color = (value: unknown) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
export function validImageSource(value: string) {
  return (
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ||
    (!!value &&
      !/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(value) &&
      ![...value].some((c) => c.charCodeAt(0) < 32) &&
      /\.(png|jpe?g|webp)$/i.test(value))
  );
}
export function parsePoster(content: string): PosterDocument {
  if (content.length > 20 * 1024 * 1024) throw new Error("Poster exceeds 20 MiB.");
  const p = JSON.parse(content);
  if (
    p?.version !== 1 ||
    typeof p.title !== "string" ||
    p.title.length > 1000 ||
    !finite(p.width, 100, 1400) ||
    !finite(p.height, 100, 1400) ||
    !color(p.background) ||
    !Array.isArray(p.elements) ||
    p.elements.length > 500
  )
    throw new Error("Invalid poster document.");
  const ids = new Set();
  for (const e of p.elements) {
    if (
      !e ||
      typeof e.id !== "string" ||
      !e.id ||
      ids.has(e.id) ||
      !["text", "rect", "image"].includes(e.type) ||
      !finite(e.x, 0, p.width) ||
      !finite(e.y, 0, p.height) ||
      !finite(e.width, 1, p.width) ||
      !finite(e.height, 1, p.height) ||
      e.x + e.width > p.width + 0.01 ||
      e.y + e.height > p.height + 0.01 ||
      (e.color !== undefined && !color(e.color)) ||
      (e.fill !== undefined && !color(e.fill)) ||
      (e.fontSize !== undefined && !finite(e.fontSize, 1, 120)) ||
      (e.bold !== undefined && typeof e.bold !== "boolean") ||
      (e.align !== undefined && !["left", "center", "right"].includes(e.align)) ||
      (e.text !== undefined && (typeof e.text !== "string" || e.text.length > 20000)) ||
      (e.alt !== undefined && (typeof e.alt !== "string" || e.alt.length > 1000)) ||
      (e.type === "text" && typeof e.text !== "string") ||
      (e.type === "image" && (typeof e.src !== "string" || !validImageSource(e.src)))
    )
      throw new Error("Invalid poster element.");
    ids.add(e.id);
  }
  delete p.style;
  return p as PosterDocument;
}
export const serializePoster = (poster: PosterDocument) => `${JSON.stringify(poster, null, 2)}\n`;

// Millimetres are shared by the canvas, SVG and PPTX. Text sizes are also mm.
export function wrapText(text: string, width: number, fontSize: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "",
      used = 0;
    for (const token of paragraph.match(/\S+\s*|\s+/g) ?? [""]) {
      const units = (value: string) =>
        [...value].reduce(
          (n, c) => n + ((c.codePointAt(0) ?? 0) > 255 ? 1 : /[il.,' ]/.test(c) ? 0.3 : 0.58),
          0,
        ) * fontSize;
      if (units(token) <= width) {
        if (used + units(token) > width && line) {
          lines.push(line.trimEnd());
          line = "";
          used = 0;
        }
        line += token;
        used += units(token);
      } else {
        for (const char of token) {
          const next = units(char);
          if (used + next > width && line) {
            lines.push(line.trimEnd());
            line = "";
            used = 0;
          }
          line += char;
          used += next;
        }
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
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
export function createPoster(
  size: PosterSize = "A0",
  landscape = false,
): PosterDocument {
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
  text(
    "title",
    "Your research title",
    28,
    25,
    width - 56,
    height * 0.085,
    20,
    true,
    "#ffffff",
  );
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
    text(
      `heading-${i}`,
      heading,
      x + 10,
      y + 10,
      col - 20,
      28,
      11,
      true,
      POSTER_DEFAULTS.accent,
    );
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
