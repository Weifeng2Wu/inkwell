export type { GitBackupResult } from "@/types/git";
export { ExitSyncDialog } from "./components/exit-sync-dialog";
export { type GitSyncController, GitSyncSettings } from "./components/git-sync-settings";
export { GitHubAuthSettings } from "./components/github-auth-settings";
export {
  backupErrorCode,
  backupErrorMessage,
  backupErrorReason,
  backupMessage,
  backupResultNotice,
  GIT_BACKUP_ERRORS,
  largeFileNotice,
} from "./lib/git-backup";
export {
  type ExitSyncController,
  type ExitSyncPrompt,
  type UseExitSyncArgs,
  useExitSync,
} from "./lib/use-exit-sync";
export {
  type GitBackupController,
  type UseGitBackupArgs,
  useGitBackup,
} from "./lib/use-git-backup";
