export type FileType = "text" | "image" | "pdf";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"]);

const LANGUAGES: Record<string, string> = {
  tex: "latex",
  sty: "latex",
  cls: "latex",
  bib: "bibtex",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  json: "json",
  excalidraw: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  java: "java",
  rs: "rust",
  go: "go",
  rb: "ruby",
  php: "php",
  sql: "sql",
  r: "r",
  lua: "lua",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

function extension(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export function visualDocumentKind(filename: string): "mindmap" | "poster" | undefined {
  if (/\.mindmap\.md$/i.test(filename)) return "mindmap";
  if (/\.poster\.json$/i.test(filename)) return "poster";
  return undefined;
}

export function fileDisplayName(filename: string): string {
  if (!visualDocumentKind(filename)) return filename;
  return filename.replace(/\.(?:mindmap\.md|poster\.json)$/i, "") || filename;
}

/** How the workspace opens a file: in a text editor, or as an image or PDF preview. */
export function fileType(path: string): FileType {
  const ext = extension(path);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return ext === "pdf" ? "pdf" : "text";
}

/** Monaco language id for a path; unknown extensions are plain text. */
export function fileLanguage(path: string): string {
  return LANGUAGES[extension(path)] ?? "plaintext";
}
