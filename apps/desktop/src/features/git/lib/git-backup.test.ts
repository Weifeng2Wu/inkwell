import { describe, expect, it } from "vitest";
import { en } from "@/features/i18n";
import {
  backupErrorCode,
  backupErrorMessage,
  backupErrorReason,
  backupMessage,
  backupResultNotice,
  GIT_BACKUP_ERRORS,
  largeFileNotice,
} from "./git-backup";

const t = (key: string, params?: Record<string, string | number>) =>
  `${key}${params ? JSON.stringify(params) : ""}`;

describe("backup commit message", () => {
  it("uses zero-padded local time", () => {
    expect(backupMessage(new Date(2026, 10, 14, 23, 5, 59))).toBe("Auto backup 2026-11-14 23:05");
    expect(backupMessage(new Date(2027, 0, 2, 3, 4))).toBe("Auto backup 2027-01-02 03:04");
  });

  it("satisfies the command's message rules", () => {
    const message = backupMessage(new Date());
    expect(message.length).toBeLessThanOrEqual(200);
    expect(message).toMatch(/^Auto backup \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("backup errors", () => {
  it("normalizes rejected values to a code", () => {
    expect(backupErrorCode("GIT_BACKUP_IN_PROGRESS")).toBe("GIT_BACKUP_IN_PROGRESS");
    expect(backupErrorCode(new Error(" fatal: bad object \n"))).toBe("fatal: bad object");
    expect(backupErrorCode("  ")).toBe("git backup failed");
  });

  it("has a translated reason for every code the user can reach", () => {
    for (const code of [
      GIT_BACKUP_ERRORS.notARepo,
      GIT_BACKUP_ERRORS.inProgress,
      GIT_BACKUP_ERRORS.detachedHead,
      GIT_BACKUP_ERRORS.noIdentity,
      GIT_BACKUP_ERRORS.flushFailed,
    ]) {
      const key = backupErrorReason(code, (name) => name);
      expect(key).toMatch(/^git\.backupError/);
      expect(en.git).toHaveProperty(key.slice("git.".length));
    }
  });

  it("passes git's own message through", () => {
    expect(backupErrorReason("fatal: index.lock exists", t)).toBe("fatal: index.lock exists");
    expect(backupErrorMessage("fatal: index.lock exists", t)).toBe(
      'git.backupFailed{"error":"fatal: index.lock exists"}',
    );
  });
});

describe("backup notices", () => {
  const base = { committed: false, pushed: false, skippedLargeFiles: [], pushError: null };

  it("describes each outcome", () => {
    expect(backupResultNotice(base, t)).toEqual({ message: "git.backupNothing", type: "info" });
    expect(backupResultNotice({ ...base, committed: true }, t)).toEqual({
      message: "git.backupDone",
      type: "success",
    });
    expect(backupResultNotice({ ...base, committed: true, pushed: true }, t)).toEqual({
      message: "git.backupDonePushed",
      type: "success",
    });
    expect(backupResultNotice({ ...base, committed: true, pushError: "denied" }, t)).toEqual({
      message: 'git.backupPushFailed{"error":"denied"}',
      type: "error",
    });
  });

  it("lists skipped large files, shortening long lists", () => {
    expect(largeFileNotice([], t)).toBeNull();
    expect(largeFileNotice(["papers/a.pdf", "b.bin"], t)).toBe(
      'git.backupLargeFilesSkipped{"files":"papers/a.pdf, b.bin"}',
    );
    expect(largeFileNotice(["1", "2", "3", "4", "5"], t)).toBe(
      'git.backupLargeFilesSkippedMore{"files":"1, 2, 3","count":2}',
    );
  });
});
