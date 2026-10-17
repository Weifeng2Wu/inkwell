"use client";

import { useCallback, useEffect, useState } from "react";
import { basename, normalize } from "@/lib/path";
import { appStorage } from "@/lib/storage/app-storage";

const STORAGE_KEY = "recent-projects";
const MAX_PROJECTS = 10;

export type RecentProject = {
  path: string;
  name: string;
  lastOpened: number;
};

export function useRecentProjects() {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = appStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as RecentProject[];
        setProjects(parsed.sort((a, b) => b.lastOpened - a.lastOpened));
      }
    } catch {
      // Ignore parse errors
    } finally {
      setLoaded(true);
    }
  }, []);

  const saveProjects = useCallback((newProjects: RecentProject[]) => {
    const sorted = newProjects.sort((a, b) => b.lastOpened - a.lastOpened);
    setProjects(sorted);
    appStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  }, []);

  const addProject = useCallback(
    async (path: string) => {
      // Use Tauri's normalize to ensure correct path format for the OS
      const normalizedPath = await normalize(path);
      const name = await basename(normalizedPath);
      const existing = projects.filter((p) => p.path !== normalizedPath);
      const newProject: RecentProject = {
        path: normalizedPath,
        name,
        lastOpened: Date.now(),
      };
      const updated = [newProject, ...existing].slice(0, MAX_PROJECTS);
      saveProjects(updated);
    },
    [projects, saveProjects],
  );

  const removeProject = useCallback(
    (path: string) => {
      const updated = projects.filter((p) => p.path !== path);
      saveProjects(updated);
    },
    [projects, saveProjects],
  );

  const clearAll = useCallback(() => {
    setProjects([]);
    appStorage.removeItem(STORAGE_KEY);
  }, []);

  return { projects, loaded, addProject, removeProject, clearAll };
}
