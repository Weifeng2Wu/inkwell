// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DEFAULT_CLOUD_CONFIG } from "../lib/cloud-backup";
import type { CloudBackupController } from "../lib/use-cloud-backup";
import { CloudBackupSettings } from "./cloud-backup-settings";

vi.mock("@/features/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

it("keeps saved keys out of the form and clears replacement secrets after saving", async () => {
  const status = {
    config: { ...DEFAULT_CLOUD_CONFIG, endpoint: "https://example.com", bucket: "test-bucket" },
    hasCredentials: true,
    lastBackup: null,
  };
  const controller: CloudBackupController = {
    available: true,
    status,
    loading: false,
    operation: null,
    running: false,
    error: null,
    notice: null,
    history: [],
    restoredDirectory: null,
    projectPath: "/project",
    lastBackup: null,
    backupNow: vi.fn(),
    save: vi.fn(async (config) => ({ ...status, config })),
    testConnection: vi.fn(),
    refreshHistory: vi.fn(),
    restore: vi.fn(),
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(CloudBackupSettings, { controller })));
    const secrets = [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    expect(secrets).toHaveLength(3);
    expect(secrets.every((input) => input.value === "")).toBe(true);
    const submit = async () =>
      act(async () => {
        container
          .querySelector("form")
          ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    await submit();
    expect(controller.save).toHaveBeenLastCalledWith(status.config, undefined);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      for (const [index, value] of ["new-access", "new-secret", "new-token"].entries()) {
        const field = secrets[index];
        if (!field) throw new Error("Missing credential field");
        setter?.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const testButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "cloudBackup.test",
    );
    expect(testButton?.disabled).toBe(true);
    await submit();
    expect(controller.save).toHaveBeenLastCalledWith(status.config, {
      accessKeyId: "new-access",
      secretAccessKey: "new-secret",
      sessionToken: "new-token",
    });
    expect(secrets.every((input) => input.value === "")).toBe(true);
    expect(container.textContent).not.toContain("new-secret");
  } finally {
    await act(async () => root.unmount());
  }
});
