import { isTauri } from "@tauri-apps/api/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { type AgentStatus, EXTERNAL_AGENTS } from "../lib/external-agent-catalog";
import type { AgentSelectionController } from "../lib/use-agent-selection";
import type { ExternalAgentController } from "../lib/use-external-agent";
import { useInstalledAgents } from "../lib/use-installed-agents";
import { ExternalAgentPanel } from "./external-agent-panel";
import { AgentSelectionSettings, ExternalAgentSettings } from "./external-agent-settings";

vi.mock("../lib/use-installed-agents", () => ({
  useInstalledAgents: vi.fn(() => null),
  AGENT_INSTALLATION_CHANGED: "inkwell-agent-installation-changed",
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => true), invoke: vi.fn() }));

const selection: AgentSelectionController = {
  selected: "codex",
  setSelected: vi.fn(),
  pendingSelection: null,
  confirmSelection: vi.fn(),
  cancelSelection: vi.fn(),
  launches: {},
  saveLaunch: vi.fn(),
  ready: true,
  error: null,
};

describe("external Agent settings", () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(useInstalledAgents).mockReturnValue(null);
  });
  it("offers adapter authentication without requiring another terminal login", () => {
    const agent: ExternalAgentController = {
      connected: false,
      connectionConfirmation: false,
      confirmationAgent: "codex",
      confirmConnection: vi.fn(),
      cancelConnection: vi.fn(),
      working: true,
      input: "",
      setInput: vi.fn(),
      messages: [],
      permissions: [],
      authentication: {
        methods: [{ id: "google-login", name: "Sign in with Google" }],
        choose: vi.fn(),
      },
      replaceRequired: false,
      error: null,
      activity: "",
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => {}),
      send: vi.fn(async () => true),
      permission: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      generateCommitMessage: vi.fn(async () => ""),
      generateFormatSkill: vi.fn(async () => ""),
      history: [],
      restoreHistory: vi.fn(async () => true),
      currentConversationId: null,
      newConversation: vi.fn(async () => true),
      loadHistory: vi.fn(async () => {}),
      renameConversation: vi.fn(async () => true),
      deleteConversation: vi.fn(async () => true),
    };
    const markup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(ExternalAgentPanel, {
          agent,
          selected: "antigravity",
          directory: "/project",
        }),
      ),
    );
    expect(markup).toContain("Sign in · Antigravity");
    expect(markup).toContain("Sign in with Google");
    expect(markup).not.toContain(">Disconnect<");
    expect(markup).not.toContain("Inkwell API keys are not forwarded");
    expect(markup).not.toContain("ACP is not an OS sandbox");
    expect(markup).toContain("Sign in to continue connecting.");
    expect(markup).toContain("/agent-logos/antigravity-color.svg");
    const header = markup.match(/<header[\s\S]*?<\/header>/)?.[0];
    expect(header).toContain("Antigravity");
    expect(header).not.toContain("ACP");
    expect(header).not.toContain("Connected");
  });
  it("uses the official Antigravity CLI setup guide", () => {
    expect(EXTERNAL_AGENTS.find((agent) => agent.id === "antigravity")?.installUrl).toBe(
      "https://antigravity.google/docs/getting-started?tab=cli",
    );
  });
  it("offers only the built-in backend before installed agents are detected", () => {
    vi.mocked(useInstalledAgents).mockReturnValue(null);
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(AgentSelectionSettings, { selection })),
    );
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain("Default Agent");
    expect(markup).not.toContain('value="codex"');
    expect(markup).not.toContain("External agents use ACP directly");
    expect(markup).not.toContain("Response preferences, skills and permission mode are shared");
  });
  it("offers installed agents without requiring their ACP adapters to be ready", () => {
    const statuses: AgentStatus[] = EXTERNAL_AGENTS.map((agent) => ({
      id: agent.id,
      installed: agent.id === "codex" || agent.id === "claude",
      acpReady: agent.id === "opencode",
      path: null,
      adapterPath: null,
      installable: true,
    }));
    vi.mocked(useInstalledAgents).mockReturnValue(statuses);
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(AgentSelectionSettings, { selection })),
    );
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('role="combobox"');
    expect(markup).not.toContain('value="opencode"');
  });
  it("shows the built-in backend when no external agents are installed", () => {
    vi.mocked(useInstalledAgents).mockReturnValue([]);
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(AgentSelectionSettings, { selection })),
    );
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain("Default Agent");
  });
  it("shows one compact logo/name/install row per Agent without technical setup fields", () => {
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(ExternalAgentSettings, { selection })),
    );
    expect(markup).toContain("DeepSeek Harness");
    expect(markup).toContain("ZCode");
    expect(markup).toContain("Popular Agents");
    expect(markup.match(/<li /g)).toHaveLength(EXTERNAL_AGENTS.length);
    for (const agent of EXTERNAL_AGENTS) {
      const color = ["claude", "codex", "antigravity", "qoder", "deepseek", "kimi"].includes(
        agent.id,
      );
      expect(markup).toContain(
        `/agent-logos/${agent.id === "zcode" ? "zai" : agent.id}${color ? "-color" : ""}.svg`,
      );
    }
    expect(markup).not.toContain("community ACP adapter");
    expect(markup).not.toContain("JSON array");
    expect(markup).not.toContain("ACP is not an OS sandbox");
    expect(markup).not.toContain("Installation guide");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("sm:grid-cols-2");
  });
  it("distinguishes ready, missing, incomplete and unsupported installations", () => {
    vi.mocked(useInstalledAgents).mockReturnValue(
      EXTERNAL_AGENTS.map((agent) => ({
        id: agent.id,
        installed: agent.id === "codex" || agent.id === "claude",
        acpReady: agent.id === "codex",
        path: "/private/path/should-not-appear",
        adapterPath: "/private/adapter/should-not-appear",
        installable: agent.id !== "grok",
      })),
    );
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(ExternalAgentSettings, { selection })),
    );
    expect(markup).toContain('aria-label="Installed · Codex"');
    expect(markup).toContain("Uninstall ACP");
    expect(markup).toMatch(/<span role="status" aria-label="Installed · Codex"/);
    expect(markup).toMatch(/<button[^>]*aria-label="Install · Pi"/);
    expect(markup).toContain("border-accent bg-accent text-accent-foreground");
    expect(markup).toContain("bg-success/5");
    expect(markup).toContain("bg-success/15");
    expect(markup).toContain(">Install ACP adapter</button>");
    expect(markup).toContain('aria-label="Install · Pi"');
    expect(markup).toContain('aria-label="Unavailable · Grok Build"');
    expect(markup).not.toContain("/private/");
  });
  it("disables installation outside the desktop shell", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(ExternalAgentSettings, { selection })),
    );
    expect(markup).toContain("Available in the desktop app");
    expect(markup).not.toContain('aria-busy="true"');
    expect(markup.match(/disabled=""/g)).toHaveLength(EXTERNAL_AGENTS.length + 1);
  });
});
