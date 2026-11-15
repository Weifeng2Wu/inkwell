import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  en,
  englishMessage,
  formatRelativeTime,
  I18nProvider,
  ko,
  type Locale,
  zh,
} from "@/features/i18n";
import { SettingsPage } from "@/features/settings";
import type { AcademicAgentController } from "../lib/use-academic-agent";
import { AcademicAgentPanel } from "./academic-agent-panel";
import { AcademicAgentSettings } from "./academic-agent-settings";
import { ConversationHistory } from "./conversation-history";
import { SkillsSettings } from "./skills-settings";

/** The copy these tests look for, read from the dictionary so wording can change freely. */
function labelsFor(locale: Locale) {
  const dictionary = { en, zh, ko }[locale];
  const { agent, common } = dictionary;
  return {
    ...agent.settings,
    key: agent.settings.apiKey,
    permissions: agent.settings.permissionMode,
    imageGenerationBaseUrl: agent.settings.imageBaseUrl,
    imageGenerationModel: agent.settings.imageModel,
    imageGenerationKey: agent.settings.imageKey,
    testImageGeneration: agent.settings.testImage,
    skills: agent.skills.title,
    skillScopeHint: agent.skills.scopeHint,
    allSkills: agent.skills.all,
    importSkills: agent.skills.import,
    uploadSkill: agent.skills.importFile,
    uploadFolder: agent.skills.importFolder,
    marketEmpty: agent.skills.empty,
    remove: agent.skills.remove,
    history: agent.history.title,
    noHistory: agent.history.empty,
    searchHistory: agent.history.search,
    backToChat: agent.history.back,
    refreshHistory: common.refresh,
    renameConversation: agent.history.rename,
    confirmDeleteConversation: agent.history.confirmDelete,
    newSession: agent.newConversation,
    dirty: agent.dirty,
    setupTitle: agent.setup.title,
    setupAction: agent.setup.action,
    examples: [
      agent.empty.summarize,
      agent.empty.citations,
      agent.empty.academic,
      agent.empty.latex,
    ],
  };
}
const labels = labelsFor("en");

function createAgent(overrides: Partial<AcademicAgentController> = {}): AcademicAgentController {
  const agent: AcademicAgentController = {
    directory: "/project",
    configReady: true,
    config: {
      provider: "test-provider",
      protocol: "",
      baseUrl: "",
      model: "test-model",
      imageGeneration: { baseUrl: "https://images.example/v1", model: "image-model" },
      webSearch: { baseUrl: "https://api.tavily.com" },
      personalPrompt: "Prefer concise Chinese responses.",
      answerLanguage: "zh",
      skillIds: [],
      permissionMode: "restricted",
    },
    setConfig: vi.fn(),
    apiKey: "",
    apiKeyLoading: false,
    imageGenerationApiKey: "",
    imageGenerationApiKeyLoading: false,
    webSearchApiKey: "",
    webSearchApiKeyLoading: false,
    webSearchApiKeySaved: true,
    setWebSearchApiKey: vi.fn(),
    setImageGenerationApiKey: vi.fn(),
    setApiKey: vi.fn(),
    conversations: [],
    historyPreview: null,
    setHistoryPreview: vi.fn(),
    loadHistory: vi.fn(),
    previewConversation: vi.fn(),
    renameConversation: vi.fn(),
    deleteConversation: vi.fn(),
    catalog: [],
    market: [],
    connectionTest: null,
    testConnection: vi.fn(),
    testingConnection: false,
    connectionTestError: null,
    testWebSearch: vi.fn(async () => true),
    changeSkill: vi.fn(),
    refreshSkills: vi.fn(),
    uploadSkill: vi.fn(),
    importGitHubSkill: vi.fn(),
    previewSkill: vi.fn(),
    generateCommitMessage: vi.fn(),
    generateFormatSkill: vi.fn(async () => ""),
    fetchModels: vi.fn(),
    settingsSaved: true,
    settingsSaveError: null,
    connected: true,
    working: false,
    session: null,
    dirty: true,
    messages: [],
    permissions: [],
    input: "",
    setInput: vi.fn(),
    error: null,
    activity: "",
    streaming: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    configure: vi.fn(),
    send: vi.fn(),
    permission: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
  return agent;
}

describe("Agent configuration location", () => {
  it("keeps image and search test buttons enabled during a model test or chat turn", () => {
    const agent = createAgent({
      working: true,
      testingConnection: true,
      imageGenerationApiKey: "image-key",
      webSearchApiKey: "search-key",
    });
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    const image = buttons.find((button) => button[2]?.includes(labels.testImageGeneration));
    const search = buttons.find((button) => button[2]?.includes(labels.testWebSearch));
    expect(image).toBeDefined();
    expect(search).toBeDefined();
    expect(image?.[1]).not.toContain("disabled");
    expect(search?.[1]).not.toContain("disabled");
  });
  it("offers a search connection test and masks its saved key", () => {
    const agent = createAgent({ webSearchApiKey: "tvly-sensitive-search-key" });
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    expect(markup).toContain(labels.testWebSearch);
    expect(markup).toContain(labels.webSearchTestHint);
    expect(markup).not.toContain("tvly-sensitive-search-key");
    expect(markup).toContain('data-settings-section="search"');
  });
  it("keeps response and permission preferences separate from skills for external agents", () => {
    const agent = createAgent();
    const markup = renderToStaticMarkup(
      createElement(AcademicAgentSettings, { agent, external: true }),
    );
    expect(markup).toContain(labels.personalPrompt);
    expect(markup).toContain(labels.answerLanguage);
    expect(markup).toContain(labels.permissions);
    expect(markup).toContain("Ask every time (default)");
    expect(markup).toContain(labels.sharedHeading);
    expect(markup).not.toContain("Shared Agent settings");
    expect(markup).not.toContain(labels.skills);
    expect(markup).not.toContain(labels.testConnection);
    expect(markup).not.toContain(labels.imageGeneration);
    expect(markup).not.toMatch(/<input[^>]*type="password"/);
  });

  it("moves the selected skills and marketplace into independent Skills settings", () => {
    const agent = createAgent();
    agent.catalog = [
      {
        id: "paper-review",
        name: "Paper review",
        description: "Review a manuscript",
        version: "1.0.0",
        source: "project",
      },
    ];
    agent.market = agent.catalog.map((skill) => ({ ...skill, installed: true, managed: true }));
    agent.config.skillIds = ["paper-review"];
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SkillsSettings, { agent })),
    );
    expect(markup).toContain(labels.skills);
    expect(markup).toContain(en.formatSkill.title);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Paper review");
    expect(markup.match(/<article /g)).toHaveLength(1);
    expect(markup).not.toContain("<fieldset");
    expect(markup).toContain(labels.skillScopeHint);
    expect(markup).toContain('value="installed"');
    expect(markup).toContain(labels.allSkills);
    expect(markup).toContain(labels.importSkills);
    expect(markup).not.toContain(labels.uploadSkill);
    expect(markup).not.toContain(labels.uploadFolder);
    expect(markup).not.toContain(labels.marketEmpty);
    expect(markup).not.toContain("File access still follows your permission mode.");
    expect(markup).not.toContain(labels.personalPrompt);
    expect(markup).not.toContain(labels.permissions);
  });

  it("renders compact skill cards with GitHub links and stars but no preview or version", () => {
    const agent = createAgent({
      market: [
        {
          id: "writing",
          name: "Research writing",
          description: "Write with evidence.",
          version: "hidden-version",
          source: "https://github.com/example/writing",
          stars: 7523,
          installed: true,
          managed: true,
        },
      ],
    });
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SkillsSettings, { agent })),
    );
    expect(markup).toContain("lg:grid-cols-3");
    expect(markup).toContain('href="https://github.com/example/writing"');
    expect(markup).toContain("7.5k");
    expect(markup).not.toContain("hidden-version");
    expect(markup).not.toContain("<details");
  });

  it("routes the Skills category to its own settings panel", () => {
    const agent = createAgent();
    const renderSettings = (initialTab: "agent" | "skills") =>
      renderToStaticMarkup(
        createElement(
          I18nProvider,
          null,
          createElement(SettingsPage, {
            academicAgent: agent,
            initialTab,
            agentSelection: {
              selected: "builtin",
              setSelected: vi.fn(),
              pendingSelection: null,
              confirmSelection: vi.fn(),
              cancelSelection: vi.fn(),
              launches: {},
              saveLaunch: vi.fn(),
              ready: true,
              error: null,
            },
          }),
        ),
      );
    const skillsMarkup = renderSettings("skills");
    expect(skillsMarkup).toContain('aria-label="Skills"');
    expect(skillsMarkup).toContain(labels.skills);
    expect(skillsMarkup).not.toContain(labels.personalPromptPlaceholder);
    const agentMarkup = renderSettings("agent");
    expect(agentMarkup).toContain(labels.personalPromptPlaceholder);
    expect(agentMarkup).not.toContain('aria-label="Skills"');
  });

  it("offers a single skill import entry without requiring a project or runtime connection", () => {
    const agent = createAgent({ directory: undefined, connected: false });
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SkillsSettings, { agent })),
    );
    expect(markup).toContain(labels.importSkills);
    expect(markup.match(/<button /g)).toHaveLength(2);
    expect(markup).toContain(`aria-label="${en.formatSkill.title}"`);
    expect(markup).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("keeps installed skills removable without a workspace", () => {
    const agent = createAgent({
      directory: undefined,
      market: [
        {
          id: "writing",
          name: "Writing",
          description: "Write papers",
          version: "1",
          source: "Local upload",
          installed: true,
          managed: true,
        },
      ],
    });
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SkillsSettings, { agent })),
    );
    expect(markup).not.toMatch(/<button[^>]*disabled=""/);
    expect(markup).toContain(labels.remove);
  });
  it("masks a stored API key without rendering the full value or replacement/delete buttons", () => {
    const agent = createAgent({ apiKey: "sk-fixture-private-key-1234" });
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    expect(markup).toContain('value="sk-f***1234"');
    expect(markup).not.toContain(agent.apiKey);
    expect(markup).not.toMatch(/<button[^>]*>(?:Replace|Delete)(?: API key)?<\/button>/);
  });

  it("disables model requests but allows key replacement while loading", () => {
    const agent = createAgent({ apiKeyLoading: true });
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    expect(markup).toContain(labels.keyLoading);
    expect(markup).toMatch(/<input[^>]*autoComplete="off"[^>]*aria-busy="true"/);
    expect(markup).not.toMatch(/<input[^>]*autoComplete="off"[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*disabled="">Test connection<\/button>/);
  });
  it.each([
    "restricted",
    "ask",
    "auto",
  ] as const)("shows %s permission mode above response language", (permissionMode) => {
    const agent = createAgent();
    agent.config.permissionMode = permissionMode;
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    expect(markup).toContain(`<option value="${permissionMode}" selected="">`);
    expect(markup.indexOf(labels.permissions)).toBeLessThan(markup.indexOf(labels.answerLanguage));
    for (const label of [labels.permissionRestricted, labels.permissionAsk, labels.permissionAuto])
      expect(markup).toContain(label);
  });
  it("shows current settings without a manual save action", () => {
    const agent = createAgent();
    agent.config = { ...agent.config, model: "updated-model" };
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    expect(markup).toContain('value="updated-model"');
    expect(markup).not.toMatch(/<button[^>]*>Save<\/button>/);
    expect(markup).toContain(labels.testConnection);
    expect(agent.setConfig).not.toHaveBeenCalled();
  });
  it("renders the selected response language with Chinese, English, and Korean choices", () => {
    for (const answerLanguage of ["zh", "en", "ko"] as const) {
      const agent = createAgent();
      agent.config.answerLanguage = answerLanguage;
      const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
      expect(markup).toContain(labels.answerLanguage);
      expect(markup).toContain(`<option value="${answerLanguage}" selected="">`);
      for (const text of ["中文", "English", "한국어"]) expect(markup).toContain(text);
    }
  });
  it("provides an empty history view without a settings shortcut", () => {
    const agent = createAgent();
    const markup = renderToStaticMarkup(
      createElement(ConversationHistory, { agent, onClose: vi.fn() }),
    );
    expect(markup).toContain(labels.noHistory);
    expect(markup).toContain(labels.searchHistory);
    expect(markup).toContain(labels.backToChat);
  });

  it("renders compact conversations with title navigation, icon actions and date only", () => {
    const agent = createAgent({
      conversations: [
        {
          key: "saved-session",
          sessionId: "session",
          title: "Draft discussion",
          created: "2026-10-16T00:00:00Z",
          modified: "2026-10-16T01:00:00Z",
          messageCount: 2,
        },
      ],
    });
    const markup = renderToStaticMarkup(
      createElement(ConversationHistory, { agent, onClose: vi.fn() }),
    );
    for (const label of ["Draft discussion", labels.renameConversation])
      expect(markup).toContain(label);
    expect(markup).not.toContain(labels.confirmDeleteConversation);
    for (const action of ["open", "renameItem", "deleteItem"])
      expect(markup).toContain(
        `aria-label="${englishMessage(`agent.history.${action}`, { title: "Draft discussion" })}"`,
      );
    expect(markup).not.toContain(">Continue</button>");
    expect(markup).not.toContain(">Rename</button>");
    expect(markup).not.toContain("2 messages");
    expect(markup).toContain(`>${formatRelativeTime("2026-10-16T01:00:00Z", "en")}</time>`);
    expect(markup).not.toMatch(/<time[^>]*>[^<]*\d:\d/);
  });
  it("uses the shared icon toolbar for history navigation and creation", () => {
    const agent = createAgent();
    const markup = renderToStaticMarkup(
      createElement(ConversationHistory, {
        agent,
        onClose: vi.fn(),
        onNew: vi.fn(async () => true),
        storageKey: "test-history",
      }),
    );
    for (const label of [labels.backToChat, labels.refreshHistory, labels.newSession]) {
      expect(markup).toContain(`aria-label="${label}"`);
      expect(markup).not.toContain(`title="${label}"`);
      expect(markup).not.toContain(`>${label}</button>`);
    }
    expect(markup).toContain("h-14 shrink-0");
    expect(markup).toContain(`>${labels.history}</h2>`);
    expect(markup).toContain(">Recent</button>");
    expect(markup).toContain(">Archived</button>");
  });
  it("offers API protocols, an endpoint, and connectivity testing without the skills market", () => {
    const agent = createAgent();
    agent.config.protocol = "openai";
    agent.config.baseUrl = "https://api.example.com/v1";
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    for (const text of ["OpenAI", "Anthropic", "Gemini", labels.baseUrl, labels.testConnection])
      expect(markup).toContain(text);
    expect(markup).toContain('value="https://api.example.com/v1"');
    expect(markup).not.toContain(labels.uploadSkill);
    expect(markup).not.toContain(labels.uploadFolder);
    expect(markup).toContain(labels.openaiCompatible);
    expect(markup).toContain(labels.anthropicCompatible);
    expect(markup).toContain(labels.geminiCompatible);
    expect(markup.indexOf('-model"')).toBeLessThan(markup.indexOf('-key"'));
  });
  it("keeps connectivity testing below the model field without a discovery button", () => {
    const agent = createAgent({ connectionTest: { configuration: "test", milliseconds: 42 } });
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    expect(markup).toMatch(
      new RegExp(
        `<div class="flex flex-wrap items-center gap-2"><button[^>]*>${labels.testConnection}</button></div><p[^>]*>${englishMessage("agent.settings.testSuccess", { ms: 42 })}</p>`,
      ),
    );
  });

  it("offers only supported protocols when loading a legacy configuration", () => {
    const agent = createAgent();
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    expect(markup).toMatch(/<option value="" disabled="" hidden="" selected="">/);
    expect(markup.match(/<option value="(?:openai|anthropic|gemini)"/g)).toHaveLength(3);
    expect(agent.config.protocol).toBe("");
    expect(agent.setConfig).not.toHaveBeenCalled();
  });

  it("renders model and preference fields in Agent settings", () => {
    const markup = renderToStaticMarkup(
      createElement(AcademicAgentSettings, { agent: createAgent() }),
    );
    for (const label of [
      labels.provider,
      labels.model,
      labels.key,
      labels.imageGeneration,
      labels.imageGenerationBaseUrl,
      labels.imageGenerationModel,
      labels.imageGenerationKey,
      labels.testImageGeneration,
      labels.permissions,
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('value="test-provider"');
    expect(markup).toContain('value="test-model"');
    expect(markup).toContain(labels.personalPrompt);
    expect(markup).toContain("Prefer concise Chinese responses.");
    expect(markup).not.toContain("Optional OpenAI-compatible Images API settings");
  });

  it("uses shared styling for agent inputs, selects, and the multiline prompt", () => {
    const markup = renderToStaticMarkup(
      createElement(AcademicAgentSettings, { agent: createAgent() }),
    );
    expect(markup.match(/<select[^>]*class="settings-control settings-select"/g)).toHaveLength(3);
    expect(markup).toMatch(/<input[^>]*type="text"[^>]*class="settings-control mt-1 w-full"/);
    expect(markup).toMatch(
      /<textarea[^>]*class="settings-control mt-1 w-full h-32 min-h-32 max-h-32 resize-none"/,
    );
  });

  it("omits manual runtime connection controls from settings", () => {
    for (const connected of [false, true]) {
      const agent = createAgent({ connected });
      const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
      expect(markup).toContain(`>${labels.testConnection}</button>`);
    }
  });

  it("keeps configuration fields out of the conversation panel", () => {
    const markup = renderToStaticMarkup(
      createElement(AcademicAgentPanel, { agent: createAgent() }),
    );
    expect(markup).toContain(labels.history);
    expect(markup).toContain(labels.newSession);
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain('value="test-provider"');
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).not.toContain("Prefer concise Chinese responses.");
  });

  it("allows starting while disconnected, without connection or compatible-resume buttons", () => {
    const agent = createAgent({ connected: false });
    const markup = renderToStaticMarkup(createElement(AcademicAgentPanel, { agent }));
    expect(markup).toMatch(new RegExp(`<button[^>]*aria-label="${labels.newSession}"[^>]*><svg`));
    expect(markup).not.toMatch(
      new RegExp(`<button[^>]*disabled[^>]*aria-label="${labels.newSession}"`),
    );
    expect(markup).not.toContain(`>${labels.newSession}</button>`);
  });

  it.each(["en", "zh", "ko"] as const)("guides unconfigured users to settings in %s", (locale) => {
    const agent = createAgent();
    agent.config = { ...agent.config, model: " " };
    const localized = labelsFor(locale);
    const markup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { locale },
        createElement(AcademicAgentPanel, { agent, onOpenSettings: vi.fn() }),
      ),
    );
    expect(markup).toContain(localized.setupTitle);
    expect(markup).toContain(`>${localized.setupAction}</button>`);
    for (const example of localized.examples) expect(markup).not.toContain(example);
    expect(markup).not.toContain('type="password"');
    expect(markup).toMatch(/<button[^>]*aria-label="[^"]+"[^>]*disabled=""/);
  });

  it.each([
    "en",
    "zh",
    "ko",
  ] as const)("shows localized example prompts for a configured local model in %s", (locale) => {
    const agent = createAgent({ apiKey: "" });
    const localized = labelsFor(locale);
    const markup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { locale },
        createElement(AcademicAgentPanel, { agent, onOpenSettings: vi.fn() }),
      ),
    );
    expect(markup).not.toContain(localized.setupTitle);
    expect(localized.examples).toHaveLength(4);
    const text = markup.replace(/<[^>]+>/g, "");
    for (const example of localized.examples) expect(text).toContain(example);
  });

  it("preserves conversation messages when model settings are cleared", () => {
    const agent = createAgent({
      messages: [{ id: "message", role: "user", content: "Keep my conversation visible" }],
    });
    agent.config = { ...agent.config, model: "" };
    const markup = renderToStaticMarkup(
      createElement(AcademicAgentPanel, { agent, onOpenSettings: vi.fn() }),
    );
    expect(markup).not.toContain(labels.setupTitle);
    expect(markup).toContain("Keep my conversation visible");
  });

  it("waits for saved configuration before showing the setup prompt", () => {
    const agent = createAgent({ configReady: false });
    agent.config = { ...agent.config, model: "" };
    const markup = renderToStaticMarkup(
      createElement(AcademicAgentPanel, { agent, onOpenSettings: vi.fn() }),
    );
    expect(markup).not.toContain(labels.setupTitle);
  });

  it("keeps settings editable while busy but prevents concurrent runtime requests", () => {
    const markup = renderToStaticMarkup(
      createElement(AcademicAgentSettings, { agent: createAgent({ working: true }) }),
    );
    expect(markup).not.toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup).not.toMatch(/<select[^>]*disabled=""/);
    expect(markup).not.toMatch(/<input[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*disabled=""/);
  });

  it("allows editing before opening a project but disables runtime requests", () => {
    const agent = createAgent({ directory: undefined });
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    expect(markup).not.toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*disabled=""/);
  });

  it("allows an empty personal preference prompt", () => {
    const agent = createAgent();
    agent.config.personalPrompt = "";
    const markup = renderToStaticMarkup(createElement(AcademicAgentSettings, { agent }));
    expect(markup).toMatch(/<textarea[^>]*h-32[^>]*><\/textarea>/);
    expect(markup).toContain("resize-none");
    expect(markup).not.toMatch(/<textarea[^>]*required/);
  });

  it("blocks sending until changed configuration is applied", () => {
    const agent = createAgent({
      session: { sessionId: "session", messages: [], tools: [] },
      input: "Hello",
    });
    const markup = renderToStaticMarkup(createElement(AcademicAgentPanel, { agent }));
    expect(markup).toContain(labels.dirty);
    expect(markup).toMatch(/<button[^>]*aria-label="Send"[^>]*disabled=""/);
  });
});
