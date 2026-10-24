import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { useGitHubAuth } from "../lib/use-github-auth";
import { GitHubAuthSettings } from "./github-auth-settings";

vi.mock("../lib/use-github-auth", () => ({ useGitHubAuth: vi.fn() }));

function render() {
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(GitHubAuthSettings)));
}

beforeEach(() => {
  vi.mocked(useGitHubAuth).mockReturnValue({
    status: null,
    checking: false,
    launching: false,
    installing: false,
    switching: null,
    loginStarted: false,
    error: null,
    refresh: vi.fn(async () => {}),
    login: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    switchAccount: vi.fn(async () => {}),
  });
});

describe("GitHub authentication settings", () => {
  it("lists saved accounts with actions and no explanatory text", () => {
    vi.mocked(useGitHubAuth).mockReturnValue({
      ...useGitHubAuth(),
      status: {
        installed: true,
        authenticated: true,
        username: "researcher",
        accounts: [
          { username: "researcher", active: true, authenticated: true },
          { username: "work-account", active: false, authenticated: true },
          { username: "expired", active: false, authenticated: false },
        ],
      },
    });
    const markup = render();
    expect(markup).toContain("Add account");
    expect(markup).toContain('aria-label="Switch account @work-account"');
    expect(markup).not.toContain('aria-label="Switch account @researcher"');
    expect(markup).toMatch(/aria-label="Switch account @expired"[^>]*disabled=""/);
    expect(markup).not.toContain("commit history");
    expect(markup).not.toContain("SSH uses its own keys");
  });

  it("disables all authentication actions while switching", () => {
    vi.mocked(useGitHubAuth).mockReturnValue({
      ...useGitHubAuth(),
      switching: "work-account",
      status: {
        installed: true,
        authenticated: true,
        username: "researcher",
        accounts: [{ username: "work-account", active: false, authenticated: true }],
      },
    });
    const markup = render();
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
    expect(markup).toContain("Switching");
  });

  it("shows the active account and offers adding an account", () => {
    vi.mocked(useGitHubAuth).mockReturnValue({
      ...useGitHubAuth(),
      status: { installed: true, authenticated: true, username: "researcher" },
    });
    const markup = render();
    expect(markup).toContain("@researcher");
    expect(markup).toContain("Signed in");
    expect(markup).toContain("Add account");
    expect(markup).not.toContain("disabled");
  });

  it("offers login when GitHub CLI has no valid authentication", () => {
    vi.mocked(useGitHubAuth).mockReturnValue({
      ...useGitHubAuth(),
      status: { installed: true, authenticated: false, username: "stale-account" },
    });
    const markup = render();
    expect(markup).toContain("Not signed in or credentials have expired");
    expect(markup).toContain("Sign in to GitHub");
    expect(markup).not.toContain("@stale-account");
    expect(markup).not.toContain("disabled");
  });

  it("replaces authentication controls with an Agent-style install button when the CLI is missing", () => {
    vi.mocked(useGitHubAuth).mockReturnValue({
      ...useGitHubAuth(),
      status: { installed: false, authenticated: false, username: "" },
    });
    const markup = render();
    expect(markup).toContain("GitHub CLI is not installed");
    expect(markup).toContain('aria-label="Install GitHub CLI"');
    expect(markup).toContain("bg-accent");
    expect(markup).toContain("min-w-28");
    expect(markup).not.toContain("Refresh status");
    expect(markup).not.toContain("Sign in to GitHub");
    expect(markup).not.toContain("Local version control");
    expect(markup).not.toContain('disabled=""');
  });

  it("shows only detection status without login instructions after launching", () => {
    vi.mocked(useGitHubAuth).mockReturnValue({
      ...useGitHubAuth(),
      checking: true,
      loginStarted: true,
    });
    const markup = render();
    expect(markup).toContain("Checking authentication");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("Complete sign-in in the terminal and browser");
  });

  it("reports detection errors without claiming the CLI is missing", () => {
    vi.mocked(useGitHubAuth).mockReturnValue({ ...useGitHubAuth(), error: "IPC failed" });
    const markup = render();
    expect(markup).toContain("Authentication status unavailable");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("IPC failed");
    expect(markup).not.toContain("GitHub CLI is not installed");
    expect(markup).not.toContain("<button");
  });

  it("disables the installation button while opening the installer", () => {
    vi.mocked(useGitHubAuth).mockReturnValue({
      ...useGitHubAuth(),
      status: { installed: false, authenticated: false, username: "" },
      installing: true,
    });
    const markup = render();
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("animate-spin");
  });
});
