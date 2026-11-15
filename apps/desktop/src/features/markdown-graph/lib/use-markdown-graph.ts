"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { type DocumentLink, extractDocumentLinks } from "@/lib/markdown-links";
import type { FileNode } from "@/types/files";
import {
  buildMarkdownGraph,
  graphFilePaths,
  isGraphDocumentPath,
  isMarkdownPath,
} from "./markdown-links";

export interface MarkdownGraphBuffer {
  path: string;
  content: string;
}
type Source = { content: string; links: DocumentLink[] };
const emptySources = new Map<string, Source>();

export function useMarkdownGraph({
  projectPath,
  files,
  readFile,
  change,
  buffers,
}: {
  projectPath: string | null;
  files: FileNode[];
  readFile: (path: string) => Promise<string | null>;
  change: { path: string; kind: string } | null;
  buffers: readonly MarkdownGraphBuffer[];
}) {
  const pathsKey = useMemo(() => JSON.stringify(graphFilePaths(files)), [files]);
  const paths = useMemo<string[]>(() => JSON.parse(pathsKey), [pathsKey]);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const request = useMemo(() => ({ paths, revision }), [paths, revision]);
  const cache = useRef({ project: projectPath, sources: new Map<string, Source>() });
  const [loaded, setLoaded] = useState({
    project: projectPath,
    sources: emptySources,
    errors: [] as string[],
    loading: true,
  });

  useEffect(() => {
    if (!change || change.kind === "access") return;
    if (
      isGraphDocumentPath(change.path) ||
      ["rename", "remove", "other", "unknown"].includes(change.kind)
    )
      refresh();
  }, [change, refresh]);

  useEffect(() => {
    let active = true;
    if (!projectPath) {
      cache.current = { project: null, sources: new Map() };
      setLoaded({ project: null, sources: emptySources, errors: [], loading: false });
      return;
    }
    const project = projectPath;
    const timeout = setTimeout(() => {
      const previous = cache.current.project === project ? cache.current.sources : emptySources;
      setLoaded((current) => ({
        project,
        sources: previous,
        errors: current.project === project ? current.errors : [],
        loading: true,
      }));
      const sources = new Map<string, Source>();
      const errors: string[] = [];
      let cursor = 0;
      const worker = async () => {
        while (active && cursor < request.paths.length) {
          const path = request.paths[cursor++];
          if (!path) continue;
          if (!isMarkdownPath(path)) {
            sources.set(path, { content: "", links: [] });
            continue;
          }
          try {
            const content = await readFile(path);
            if (!active) return;
            if (content === null) throw new Error("Unavailable document");
            const cached = previous.get(path);
            sources.set(
              path,
              cached?.content === content
                ? cached
                : { content, links: extractDocumentLinks(content) },
            );
          } catch {
            if (!active) return;
            errors.push(path);
            sources.set(path, { content: "", links: [] });
          }
        }
      };
      void Promise.all(Array.from({ length: Math.min(6, request.paths.length) }, worker)).then(
        () => {
          if (!active) return;
          cache.current = { project, sources };
          setLoaded({ project, sources, errors, loading: false });
        },
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [projectPath, request, readFile]);

  const live = useDeferredValue(
    useMemo(() => ({ project: projectPath, buffers }), [projectPath, buffers]),
  );
  const sources = useMemo(() => {
    const next = new Map(loaded.project === projectPath ? loaded.sources : emptySources);
    for (const path of next.keys()) if (!paths.includes(path)) next.delete(path);
    if (projectPath && loaded.project === projectPath)
      for (const path of paths)
        if (!isMarkdownPath(path)) next.set(path, { content: "", links: [] });
    if (live.project === projectPath)
      for (const buffer of live.buffers) {
        if (!paths.includes(buffer.path) || !isMarkdownPath(buffer.path)) continue;
        const existing = next.get(buffer.path);
        if (existing?.content !== buffer.content)
          next.set(buffer.path, {
            content: buffer.content,
            links: extractDocumentLinks(buffer.content),
          });
      }
    return next;
  }, [loaded, projectPath, paths, live]);
  const caseInsensitive = Boolean(projectPath && /^(?:[a-z]:|\\\\|\/\/)/i.test(projectPath));
  const graph = useMemo(
    () =>
      buildMarkdownGraph(
        new Map([...sources].map(([path, source]) => [path, source.content])),
        caseInsensitive,
        new Map([...sources].map(([path, source]) => [path, source.links])),
      ),
    [sources, caseInsensitive],
  );

  return {
    graph,
    paths,
    caseInsensitive,
    refresh,
    isLoading: Boolean(projectPath) && (loaded.project !== projectPath || loaded.loading),
    errors: loaded.project === projectPath ? loaded.errors : [],
    content: (path: string) => (isMarkdownPath(path) ? sources.get(path)?.content : undefined),
  };
}
