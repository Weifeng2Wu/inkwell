"use client";

import dynamic from "next/dynamic";

export const MarkdownGraphModal = dynamic(
  () => import("./components/markdown-graph-modal").then((module) => module.MarkdownGraphModal),
  { ssr: false },
);
export { markdownGraphNode, resolveDocumentLink } from "./lib/markdown-links";
export { useMarkdownGraph } from "./lib/use-markdown-graph";
