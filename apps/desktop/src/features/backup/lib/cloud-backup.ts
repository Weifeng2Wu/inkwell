export const CLOUD_INTERVALS = [5, 15, 30, 60, 120] as const;
export interface CloudConfig {
  provider: "r2" | "s3";
  endpoint: string;
  bucket: string;
  prefix: string;
  region: string;
  enabled: boolean;
  intervalMinutes: number;
}
export interface CloudCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}
export interface CloudSnapshot {
  key: string;
  createdAt: string;
  project: string;
}
export interface CloudBackupResult extends CloudSnapshot {
  fileCount: number;
  totalBytes: number;
  uploadedFiles: number;
  unchanged: boolean;
  skipped: string[];
  skippedCount: number;
}
export interface CloudStatus {
  config: CloudConfig;
  hasCredentials: boolean;
  lastBackup: CloudBackupResult | null;
}
export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
  provider: "r2",
  endpoint: "",
  bucket: "",
  prefix: "inkwell",
  region: "auto",
  enabled: false,
  intervalMinutes: 30,
};

export function cloudErrorKey(error: unknown) {
  const code = String(error).replace(/^Error:\s*/, "");
  if (code === "CLOUD_HTTP:401" || code === "CLOUD_HTTP:403")
    return "cloudBackup.errors.credentials";
  if (code.startsWith("CLOUD_HTTP:")) return "cloudBackup.errors.remote";
  const keys: Record<string, string> = {
    CLOUD_CONFIG: "cloudBackup.errors.config",
    CLOUD_CREDENTIALS: "cloudBackup.errors.credentials",
    CLOUD_NETWORK: "cloudBackup.errors.network",
    CLOUD_TIMEOUT: "cloudBackup.errors.network",
    CLOUD_BUSY: "cloudBackup.errors.busy",
    CLOUD_PROJECT: "cloudBackup.errors.project",
    CLOUD_PATH: "cloudBackup.errors.path",
    CLOUD_SIZE_LIMIT: "cloudBackup.errors.size",
    CLOUD_CHANGED: "cloudBackup.errors.changed",
    CLOUD_INTEGRITY: "cloudBackup.errors.integrity",
    CLOUD_MANIFEST: "cloudBackup.errors.integrity",
    CLOUD_RESPONSE: "cloudBackup.errors.remote",
    CLOUD_RUNTIME: "cloudBackup.errors.runtime",
    CLOUD_FLUSH: "cloudBackup.errors.flush",
  };
  return keys[code] ?? "cloudBackup.errors.local";
}
