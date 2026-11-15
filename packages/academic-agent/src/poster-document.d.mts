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
export type PosterBlock =
  | { id: string; type: "text"; text: string }
  | {
      id: string;
      type: "image";
      src: string;
      alt?: string;
      caption?: string;
      aspectRatio?: number;
    };
export type PosterSection = { id: string; title: string; blocks: PosterBlock[] };
export type StructuredPoster = {
  version: 2;
  title: string;
  authors?: string;
  affiliation?: string;
  subtitle?: string;
  footer?: string;
  width: number;
  height: number;
  background: string;
  color?: string;
  accent?: string;
  panel?: string;
  columns: 1 | 2 | 3;
  sections: PosterSection[];
};
export const POSTER_DEFAULTS: {
  background: string;
  ink: string;
  accent: string;
  panel: string;
  font: string;
};
export function validImageSource(value: string): boolean;
export function parsePosterDocument(content: string): PosterDocument | StructuredPoster;
export function parseFreeformPoster(content: string): PosterDocument;
export function parsePosterCanvas(content: string): PosterDocument;
export function wrapPosterText(text: string, width: number, fontSize: number): string[];
export function layoutStructuredPoster(document: StructuredPoster): {
  poster: PosterDocument;
  fontSize: number;
};
