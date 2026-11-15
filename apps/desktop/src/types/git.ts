// Git domain types shared across the git panel and the Tauri daemon bridge.

export interface GitInfo {
  branch: string;
  isDirty: boolean;
  lastCommit?: {
    hash: string;
    message: string;
    date: string;
  };
  remote?: {
    name: string;
    url: string;
  };
  ahead?: number;
  behind?: number;
}

export interface GitFileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  remote?: string;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  hasCommits: boolean;
  changes: GitFileChange[];
  isRepo: boolean;
}

/** Result of the `git_backup` command. */
export interface GitBackupResult {
  committed: boolean;
  pushed: boolean;
  /** Files over 50 MiB that were left out of the commit, relative to the repository root. */
  skippedLargeFiles: string[];
  /** Set when the commit succeeded but uploading it failed. */
  pushError: string | null;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}
