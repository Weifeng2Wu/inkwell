"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { FileNode } from "@/types/files";
import { bibliographyPaths, indexBibliographies } from "./bibliography";

/** Indexes the project's `.bib` files, with open editor buffers overriding the disk. */
export function useProjectBibliography({
  projectPath,
  files,
  readFile,
  change,
  primaryPath,
  primaryContent,
  secondaryPath,
  secondaryContent,
}: {
  projectPath: string | null;
  files: FileNode[];
  readFile: (path: string) => Promise<string | null>;
  change: { path: string; kind: string } | null;
  primaryPath?: string;
  primaryContent: string;
  secondaryPath?: string;
  secondaryContent: string;
}) {
  const pathsKey = useMemo(() => JSON.stringify(bibliographyPaths(files)), [files]);
  const [revision, setRevision] = useState(0);
  const readRequest = useMemo(() => {
    const paths: string[] = JSON.parse(pathsKey);
    return { paths, revision };
  }, [pathsKey, revision]);
  const [loaded, setLoaded] = useState<{
    project: string | null;
    sources: [string, string][];
    request?: typeof readRequest;
    failed?: boolean;
  }>({
    project: null,
    sources: [],
  });
  useEffect(() => {
    if (change && change.kind !== "access" && /\.bib$/i.test(change.path))
      setRevision((current) => current + 1);
  }, [change]);
  useEffect(() => {
    let active = true;
    let failed = false;
    if (!projectPath) {
      setLoaded({ project: null, sources: [] });
      return;
    }
    void Promise.all(
      readRequest.paths.map(async (path): Promise<[string, string]> => {
        try {
          const content = await readFile(path);
          if (content === null) failed = true;
          return [path, content ?? ""];
        } catch {
          failed = true;
          return [path, ""];
        }
      }),
    ).then((sources) => {
      if (active) setLoaded({ project: projectPath, sources, request: readRequest, failed });
    });
    return () => {
      active = false;
    };
  }, [projectPath, readRequest, readFile]);
  const buffers = useDeferredValue(
    useMemo(
      () => ({
        project: projectPath,
        files: [
          { path: secondaryPath, content: secondaryContent },
          { path: primaryPath, content: primaryContent },
        ],
      }),
      [projectPath, primaryPath, primaryContent, secondaryPath, secondaryContent],
    ),
  );
  const sources = useMemo((): ReadonlyMap<string, string> => {
    if (!projectPath) return new Map();
    const sources = new Map(loaded.project === projectPath ? loaded.sources : []);
    for (const buffer of buffers.project === projectPath ? buffers.files : [])
      if (buffer.path && /\.bib$/i.test(buffer.path)) sources.set(buffer.path, buffer.content);
    return sources;
  }, [projectPath, loaded, buffers]);
  const bibliography = useMemo(() => indexBibliographies(sources), [sources]);
  const ready =
    readRequest.paths.length === 0 ||
    (loaded.project === projectPath && loaded.request === readRequest && !loaded.failed);
  return { bibliography, sources, ready };
}
