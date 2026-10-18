"use client";

import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  GearIcon,
  KeyboardIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  SparkleIcon,
  TerminalIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  type AcademicAgentController,
  AcademicAgentSettings,
  type AgentSelectionController,
  AgentSelectionSettings,
  academicLabels,
  DEFAULT_ACADEMIC_CONFIG,
  type ExternalAgentController,
  ExternalAgentSettings,
  SkillsSettings,
} from "@/features/agent";
import { GitHubAuthSettings } from "@/features/git";
import { type Locale, useI18n } from "@/features/i18n";
import { quickStartLabels } from "@/features/onboarding/lib/labels";
import { QUICK_START_STEPS } from "@/features/onboarding/lib/quick-start-state";
import {
  DEFAULT_EDITOR_SETTINGS,
  type EditorSettings,
  type MinimapSettings,
} from "@/features/settings/lib/editor-settings";
import { THEMES } from "@/features/settings/lib/theme";
import { useEditorSettings } from "@/features/settings/lib/use-editor-settings";
import { AgentConnectionSettings } from "./agent-connection-settings";
import { FontSettings } from "./font-settings";
import { KeyboardShortcutSettings } from "./keyboard-shortcut-settings";
import { LayoutParserSettings } from "./layout-parser-settings";
import { TerminalFontSettings } from "./terminal-font-settings";
import { ThemeGrid } from "./theme-grid";

export type SettingsTabId = "general" | "editor" | "terminalGit" | "agent" | "skills" | "shortcuts";

export interface SettingsPageProps {
  quickStart?: {
    step: number;
    saveError: boolean;
    onNext: () => void;
    onBack: () => void;
    onClose: () => void;
  };
  onOpenTerminal?: () => void;
  onOpenQuickStart?: () => void;
  onClose?: () => void;
  editorSettings?: EditorSettings;
  onUpdateEditorSettings?: (updates: Partial<EditorSettings>) => void;
  initialTab?: SettingsTabId;
  academicAgent?: AcademicAgentController;
  agentSelection?: AgentSelectionController;
  externalAgent?: ExternalAgentController;
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg bg-background p-5 mb-5 shadow-sm">
      <div className="mb-4 pb-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-2 gap-3 border-b border-border/40 last:border-b-0 last:pb-0">
      <div className="min-w-0 pr-4">
        <span className="text-sm font-medium text-foreground-secondary block">{label}</span>
        {description && <p className="text-xs text-muted mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="max-w-full shrink-0 self-start sm:self-auto">{children}</div>
    </div>
  );
}

function SettingSelect({
  label,
  description,
  value,
  onChange,
  options,
}: {
  label: string;
  description?: string;
  value: string | number;
  onChange: (value: string) => void;
  options: { value: string | number; label: string }[];
}) {
  return (
    <SettingRow label={label} description={description}>
      <Select value={String(value)} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="settings-control settings-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="settings-select-content">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  ariaLabel,
}: {
  value: number;
  onChange: (val: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  ariaLabel: string;
}) {
  const roundVal = (v: number) => Math.round(v * 10) / 10;

  return (
    <div className="settings-number-stepper">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, roundVal(value - step)))}
        className="size-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-r border-border"
        aria-label={`Decrease ${ariaLabel}`}
      >
        <MinusIcon className="size-3" />
      </button>
      <input
        type="number"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          if (!Number.isNaN(parsed)) {
            onChange(Math.min(max, Math.max(min, parsed)));
          }
        }}
        className="w-12 h-8 text-xs tabular-nums text-center border-0 focus:outline-none focus:ring-0 bg-transparent text-foreground"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, roundVal(value + step)))}
        className="size-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-l border-border"
        aria-label={`Increase ${ariaLabel}`}
      >
        <PlusIcon className="size-3" />
      </button>
      {unit && (
        <span className="text-[11px] text-muted-foreground px-2 border-l border-border bg-surface-secondary h-8 flex items-center">
          {unit}
        </span>
      )}
    </div>
  );
}

export function SettingsPage({
  quickStart,
  onOpenTerminal,
  onOpenQuickStart,
  onClose,
  editorSettings: externalEditorSettings,
  onUpdateEditorSettings: externalUpdateEditorSettings,
  initialTab = "general",
  academicAgent,
  agentSelection,
  externalAgent,
}: SettingsPageProps) {
  const { t, locale, setLocale, locales } = useI18n();
  const { theme, setTheme } = useTheme();

  // Fallback to hooks if external props not provided
  const internalEditorSettings = useEditorSettings(!externalEditorSettings);

  const editorSettings = externalEditorSettings ?? internalEditorSettings.settings;
  const onUpdateEditorSettings =
    externalUpdateEditorSettings ?? internalEditorSettings.updateSettings;

  const [activeTab, setActiveTab] = useState<SettingsTabId>(
    initialTab === "editor" ? "general" : initialTab,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const guidedTab: SettingsTabId | undefined = quickStart
    ? ({ 4: "agent", 5: "general", 6: "agent", 7: "skills", 8: "terminalGit" } as const)[
        quickStart.step as 4 | 5 | 6 | 7 | 8
      ]
    : undefined;
  const currentTab = guidedTab ?? activeTab;
  const guideLabels = quickStartLabels[locale];
  useEffect(() => {
    if (!guidedTab) return;
    setActiveTab(guidedTab);
    setSearchQuery("");
    const frame = requestAnimationFrame(() => {
      const container = document.querySelector<HTMLElement>('[data-settings-section="content"]');
      if (!container) return;
      const section = document.querySelector<HTMLElement>(
        `[data-settings-section="${quickStart?.step === 5 ? "layout" : quickStart?.step === 6 ? "search" : quickStart?.step === 8 ? "github" : "content"}"]`,
      );
      container.scrollTop =
        section && section !== container
          ? section.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            container.scrollTop -
            16
          : 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [guidedTab, quickStart?.step]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !(
          e.target instanceof Element &&
          e.target.closest('[data-shortcut-recorder], [role="dialog"]')
        )
      ) {
        if (quickStart) quickStart.onClose();
        else onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, quickStart]);

  const handleResetCurrent = useCallback(() => {
    if (currentTab === "agent") {
      academicAgent?.setConfig(DEFAULT_ACADEMIC_CONFIG);
    } else {
      onUpdateEditorSettings(DEFAULT_EDITOR_SETTINGS);
    }
  }, [currentTab, academicAgent, onUpdateEditorSettings]);

  const navItems = useMemo(
    () => [
      {
        id: "general" as const,
        icon: GearIcon,
        label: t("settings.categories.general"),
        desc: t("settings.categories.generalDesc"),
      },
      {
        id: "terminalGit" as const,
        icon: TerminalIcon,
        label: t("settings.categories.terminalGit"),
        desc: t("settings.categories.terminalGitDesc"),
      },
      {
        id: "shortcuts" as const,
        icon: KeyboardIcon,
        label: t("shortcuts.title"),
        desc: t("shortcuts.description"),
      },
      ...(academicAgent
        ? [
            {
              id: "agent" as const,
              icon: SparkleIcon,
              label: academicLabels[locale].settings,
              desc: academicLabels[locale].settingsDescription,
            },
            {
              id: "skills" as const,
              icon: SparkleIcon,
              label: t("settings.categories.skills"),
              desc: t("settings.categories.skillsDesc"),
            },
          ]
        : []),
    ],
    [t, locale, academicAgent],
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const matchesSearch = useCallback(
    (text: string) => {
      if (!normalizedSearch) return true;
      return text.toLowerCase().includes(normalizedSearch);
    },
    [normalizedSearch],
  );

  return (
    <div
      data-settings-page
      className="fixed inset-0 z-50 bg-background text-foreground flex flex-col h-screen w-screen overflow-hidden select-none"
    >
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-border bg-background px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={quickStart ? quickStart.onClose : onClose}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:text-foreground hover:bg-accent-hover border border-border hover:border-border-dark rounded-md transition-colors"
            title={`${t("settings.backToEditor")} (Esc)`}
          >
            <ArrowLeftIcon className="size-3.5" />
            <span>{t("settings.backToEditor")}</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-muted bg-surface-secondary border border-border rounded">
              Esc
            </kbd>
          </button>

          <span
            role="status"
            title={academicAgent?.settingsSaveError ?? undefined}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted font-medium bg-surface-secondary px-2.5 py-1 rounded-full border border-border"
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${
                academicAgent?.settingsSaveError
                  ? "bg-error"
                  : academicAgent && !academicAgent.settingsSaved
                    ? "bg-border"
                    : "bg-success"
              }`}
            />
            {academicAgent?.settingsSaveError
              ? academicAgent.labels.settingsSaveFailed
              : academicAgent && !academicAgent.settingsSaved
                ? academicAgent.labels.settingsSaving
                : t("settings.autoSaved")}
          </span>
        </div>

        {/* Search Input */}
        <div className="relative w-64 md:w-80">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            disabled={Boolean(quickStart)}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("settings.searchPlaceholder")}
            className="settings-control settings-search-control w-full"
            aria-label={t("settings.searchPlaceholder")}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground p-0.5"
              aria-label={t("common.clear")}
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          {!quickStart && onOpenQuickStart && (
            <button type="button" onClick={onOpenQuickStart} className="btn btn-sm">
              {{ zh: "快速引导", en: "Quick start", ko: "빠른 시작" }[locale]}
            </button>
          )}
          {currentTab !== "shortcuts" && (
            <button
              type="button"
              onClick={handleResetCurrent}
              disabled={Boolean(quickStart) || (currentTab === "agent" && academicAgent?.working)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-foreground hover:bg-accent-hover border border-border rounded-md transition-colors"
              title={t("settings.resetCurrentTab")}
            >
              <ArrowCounterClockwiseIcon className="size-3.5" />
              <span className="hidden sm:inline">{t("settings.resetDefaults")}</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={quickStart ? quickStart.onClose : onClose}
              className="px-4 py-1.5 text-xs font-medium bg-accent text-accent-foreground hover:bg-accent/90 rounded-md transition-colors"
            >
              {t("settings.done")}
            </button>
          )}
        </div>
      </header>

      {quickStart && (
        <section
          data-quick-start
          data-tour-step={
            quickStart.step === 4
              ? "ai"
              : quickStart.step === 5
                ? "layout"
                : quickStart.step === 6
                  ? "search"
                  : quickStart.step === 7
                    ? "skills"
                    : "github"
          }
          aria-labelledby="settings-guide-heading"
          className="shrink-0 border-b border-accent/25 bg-accent/5 px-6 py-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-accent">
                {guideLabels.quickStart} · {quickStart.step + 1} / {QUICK_START_STEPS}
              </p>
              <h2 id="settings-guide-heading" className="mt-1 text-sm font-semibold">
                {guideLabels.steps[quickStart.step]}
              </h2>
              <p className="mt-1 text-xs leading-6 text-muted">
                {guideLabels.descriptions[quickStart.step]}
              </p>
              {quickStart.saveError && (
                <p role="alert" className="text-xs text-error">
                  {guideLabels.storageError}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="btn btn-sm" onClick={quickStart.onBack}>
                {guideLabels.back}
              </button>
              {quickStart.step < QUICK_START_STEPS - 1 && (
                <button type="button" className="text-xs text-muted" onClick={quickStart.onNext}>
                  {guideLabels.later}
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={quickStart.onNext}>
                {quickStart.step === QUICK_START_STEPS - 1 ? guideLabels.finish : guideLabels.next}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Main Two-Column Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar Category Navigation */}
        <aside className="w-64 border-r border-border bg-surface-secondary/20 p-4 flex flex-col justify-between shrink-0 overflow-y-auto">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = !searchQuery && currentTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={Boolean(quickStart)}
                  onClick={() => {
                    setActiveTab(item.id);
                    setSearchQuery("");
                  }}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors border ${
                    isActive
                      ? "bg-accent/10 border-accent/30 text-foreground shadow-sm"
                      : "border-transparent text-foreground-secondary hover:bg-accent-hover hover:border-border"
                  }`}
                >
                  <Icon
                    className={`size-4 mt-0.5 shrink-0 ${
                      isActive ? "text-accent" : "text-muted-foreground"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-xs font-semibold ${
                        isActive ? "text-foreground" : "text-foreground-secondary"
                      }`}
                    >
                      {item.label}
                    </div>
                    <div className="text-[11px] text-muted line-clamp-1 mt-0.5">{item.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Main Settings Panel */}
        <main
          data-settings-section="content"
          className="flex-1 h-full overflow-y-auto p-6 md:p-8 lg:p-10"
        >
          <div className="max-w-3xl mx-auto pb-12">
            {/* SEARCH RESULTS VIEW */}
            {searchQuery ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    {t("settings.searchResultsTitle")}
                  </h2>
                  <p className="text-xs text-muted mt-1">
                    {t("settings.searchPlaceholder")}: &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>

                {/* Show all sections that match query */}
                <KeyboardShortcutSettings query={searchQuery} />
                {/* General items */}
                {matchesSearch(t("layoutParser.title")) && <LayoutParserSettings />}
                {(matchesSearch(t("settings.general.language")) ||
                  matchesSearch(t("settings.general.theme"))) && (
                  <SectionCard title={t("settings.categories.general")}>
                    {matchesSearch(t("settings.general.language")) && (
                      <SettingSelect
                        label={t("settings.general.language")}
                        description={t("settings.general.languageDesc")}
                        value={locale}
                        onChange={(val) => setLocale(val as Locale)}
                        options={locales.map((loc) => ({
                          value: loc.id,
                          label: `${loc.label} (${loc.nativeName})`,
                        }))}
                      />
                    )}
                    {matchesSearch(t("settings.general.theme")) && (
                      <SettingRow
                        label={t("settings.general.theme")}
                        description={t("settings.general.themeDesc")}
                      >
                        <Select value={theme || "light"} onValueChange={setTheme}>
                          <SelectTrigger
                            className="settings-control settings-select"
                            aria-label={t("settings.general.theme")}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="settings-select-content">
                            {THEMES.map((th) => (
                              <SelectItem key={th.id} value={th.id} className="text-xs">
                                {th.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </SettingRow>
                    )}
                  </SectionCard>
                )}

                {/* Editor items */}
                {(matchesSearch(t("settings.keybindings.vimMode")) ||
                  matchesSearch(t("settings.display.fontFamily")) ||
                  matchesSearch(t("settings.fonts.uiFontFamily")) ||
                  matchesSearch(t("settings.fonts.textFontFamily")) ||
                  matchesSearch(t("settings.fonts.codeFontFamily")) ||
                  matchesSearch(t("settings.display.fontSize")) ||
                  matchesSearch(t("settings.display.wordWrap")) ||
                  matchesSearch(t("settings.minimap.enableMinimap"))) && (
                  <SectionCard title={t("settings.categories.editor")}>
                    {(matchesSearch(t("settings.display.fontFamily")) ||
                      matchesSearch(t("settings.fonts.uiFontFamily")) ||
                      matchesSearch(t("settings.fonts.textFontFamily")) ||
                      matchesSearch(t("settings.fonts.codeFontFamily"))) && (
                      <FontSettings settings={editorSettings} onChange={onUpdateEditorSettings} />
                    )}
                    {matchesSearch(t("settings.keybindings.vimMode")) && (
                      <SettingRow
                        label={t("settings.keybindings.vimMode")}
                        description={t("settings.keybindings.vimModeDesc")}
                      >
                        <Switch
                          checked={editorSettings.vimMode}
                          onCheckedChange={(v) => onUpdateEditorSettings({ vimMode: v })}
                        />
                      </SettingRow>
                    )}
                    {matchesSearch(t("settings.display.fontSize")) && (
                      <SettingRow
                        label={t("settings.display.fontSize")}
                        description={t("settings.display.fontSizeDesc")}
                      >
                        <NumberStepper
                          value={editorSettings.fontSize}
                          onChange={(v) => onUpdateEditorSettings({ fontSize: v })}
                          min={8}
                          max={32}
                          unit="px"
                          ariaLabel={t("settings.display.fontSize")}
                        />
                      </SettingRow>
                    )}
                    {matchesSearch(t("settings.display.wordWrap")) && (
                      <SettingSelect
                        label={t("settings.display.wordWrap")}
                        value={editorSettings.wordWrap}
                        onChange={(v) =>
                          onUpdateEditorSettings({
                            wordWrap: v as EditorSettings["wordWrap"],
                          })
                        }
                        options={[
                          { value: "off", label: t("settings.options.off") },
                          { value: "on", label: t("settings.options.on") },
                          { value: "wordWrapColumn", label: t("settings.options.wordWrapColumn") },
                          { value: "bounded", label: t("settings.options.bounded") },
                        ]}
                      />
                    )}
                    {matchesSearch(t("settings.minimap.enableMinimap")) && (
                      <SettingRow
                        label={t("settings.minimap.enableMinimap")}
                        description={t("settings.minimap.enableMinimapDesc")}
                      >
                        <Switch
                          checked={editorSettings.minimap.enabled}
                          onCheckedChange={(v) =>
                            onUpdateEditorSettings({
                              minimap: { ...editorSettings.minimap, enabled: v },
                            })
                          }
                        />
                      </SettingRow>
                    )}
                  </SectionCard>
                )}

                {/* Git & Terminal items */}
                {matchesSearch(
                  `GitHub ${t("settings.gitSection.login")} ${t("settings.gitSection.installCli")}`,
                ) && (
                  <SectionCard title="GitHub">
                    <GitHubAuthSettings />
                  </SectionCard>
                )}
                {(matchesSearch(t("settings.gitSection.autoFetch")) ||
                  matchesSearch(t("settings.terminalSection.fontFamily")) ||
                  matchesSearch(t("settings.terminalSection.shellMode"))) && (
                  <SectionCard title={t("settings.categories.terminalGit")}>
                    {matchesSearch(t("settings.gitSection.autoFetch")) && (
                      <SettingRow
                        label={t("settings.gitSection.autoFetch")}
                        description={t("settings.gitSection.autoFetchDesc")}
                      >
                        <Switch
                          checked={editorSettings.gitAutoFetchEnabled}
                          onCheckedChange={(v) =>
                            onUpdateEditorSettings({ gitAutoFetchEnabled: v })
                          }
                        />
                      </SettingRow>
                    )}
                    {matchesSearch(t("settings.terminalSection.fontFamily")) && (
                      <TerminalFontSettings
                        value={editorSettings.terminalFontFamily}
                        onChange={(font) => onUpdateEditorSettings({ terminalFontFamily: font })}
                      />
                    )}
                    {matchesSearch(t("settings.terminalSection.shellMode")) && (
                      <SettingSelect
                        label={t("settings.terminalSection.shellMode")}
                        value={editorSettings.terminalShellMode}
                        onChange={(v) =>
                          onUpdateEditorSettings({
                            terminalShellMode: v as EditorSettings["terminalShellMode"],
                          })
                        }
                        options={[
                          { value: "auto", label: t("settings.options.auto") },
                          { value: "custom", label: t("settings.options.custom") },
                        ]}
                      />
                    )}
                  </SectionCard>
                )}

                {academicAgent &&
                  matchesSearch(
                    [
                      academicLabels[locale].settings,
                      academicLabels[locale].settingsDescription,
                      academicLabels[locale].personalPrompt,
                      "agent provider model API key permissions",
                    ].join(" "),
                  ) && (
                    <AcademicAgentSettings
                      agent={academicAgent}
                      external={
                        agentSelection?.selected !== undefined &&
                        agentSelection.selected !== "builtin"
                      }
                    />
                  )}
                {academicAgent &&
                  matchesSearch(
                    [
                      t("settings.categories.skills"),
                      t("settings.categories.skillsDesc"),
                      academicLabels[locale].skills,
                      academicLabels[locale].market,
                      "skills",
                    ].join(" "),
                  ) && (
                    <SkillsSettings
                      agent={academicAgent}
                      selection={agentSelection}
                      externalAgent={externalAgent}
                    />
                  )}
                {agentSelection && matchesSearch("agent ACP") && (
                  <>
                    <AgentSelectionSettings selection={agentSelection} />
                    <ExternalAgentSettings selection={agentSelection} />
                  </>
                )}
              </div>
            ) : (
              /* TAB VIEW */
              <div className="space-y-6">
                {currentTab === "shortcuts" && <KeyboardShortcutSettings />}
                {currentTab === "skills" && academicAgent && (
                  <SkillsSettings
                    agent={academicAgent}
                    selection={agentSelection}
                    externalAgent={externalAgent}
                  />
                )}
                {currentTab === "agent" && (
                  <AgentConnectionSettings agent={academicAgent} selection={agentSelection} />
                )}
                {/* ===== 1. GENERAL TAB ===== */}
                {currentTab === "general" && (
                  <>
                    {agentSelection && <AgentSelectionSettings selection={agentSelection} />}
                    <div className="mb-6">
                      <h2 className="text-xl font-bold tracking-tight text-foreground">
                        {t("settings.categories.general")}
                      </h2>
                      <p className="text-xs text-muted mt-1">
                        {t("settings.categories.generalDesc")}
                      </p>
                    </div>

                    <SectionCard
                      title={t("settings.general.language")}
                      description={t("settings.general.languageDesc")}
                    >
                      <SettingSelect
                        label={t("settings.general.language")}
                        description={t("settings.general.languageDesc")}
                        value={locale}
                        onChange={(val) => setLocale(val as Locale)}
                        options={locales.map((loc) => ({
                          value: loc.id,
                          label: `${loc.label} (${loc.nativeName})`,
                        }))}
                      />
                    </SectionCard>

                    <SectionCard
                      title={t("settings.general.appearance")}
                      description={t("settings.general.themeDesc")}
                    >
                      <ThemeGrid
                        theme={theme}
                        onSelect={setTheme}
                        label={t("settings.general.theme")}
                      />
                    </SectionCard>

                    {/* Keybindings */}
                    <div data-settings-section="layout">
                      <LayoutParserSettings />
                    </div>
                    <SectionCard title={t("settings.keybindings.title")}>
                      <SettingRow
                        label={t("settings.keybindings.vimMode")}
                        description={t("settings.keybindings.vimModeDesc")}
                      >
                        <div className="flex items-center gap-3">
                          {editorSettings.vimMode && (
                            <span className="text-[10px] px-2 py-0.5 bg-accent text-accent-foreground font-bold tracking-wider rounded">
                              {t("settings.keybindings.normal")}
                            </span>
                          )}
                          <Switch
                            checked={editorSettings.vimMode}
                            onCheckedChange={(v) => onUpdateEditorSettings({ vimMode: v })}
                          />
                        </div>
                      </SettingRow>
                    </SectionCard>

                    {/* Typography & Display */}
                    <SectionCard title={t("settings.display.title")}>
                      <FontSettings settings={editorSettings} onChange={onUpdateEditorSettings} />

                      <SettingRow
                        label={t("settings.display.fontSize")}
                        description={t("settings.display.fontSizeDesc")}
                      >
                        <NumberStepper
                          value={editorSettings.fontSize}
                          onChange={(v) => onUpdateEditorSettings({ fontSize: v })}
                          min={8}
                          max={32}
                          unit="px"
                          ariaLabel={t("settings.display.fontSize")}
                        />
                      </SettingRow>

                      <SettingRow
                        label={t("settings.display.lineHeight")}
                        description={t("settings.display.lineHeightDesc")}
                      >
                        <NumberStepper
                          value={editorSettings.lineHeight}
                          onChange={(v) => onUpdateEditorSettings({ lineHeight: v })}
                          min={1.0}
                          max={3.0}
                          step={0.1}
                          ariaLabel={t("settings.display.lineHeight")}
                        />
                      </SettingRow>

                      <SettingSelect
                        label={t("settings.display.lineNumbers")}
                        value={editorSettings.lineNumbers}
                        onChange={(v) =>
                          onUpdateEditorSettings({
                            lineNumbers: v as EditorSettings["lineNumbers"],
                          })
                        }
                        options={[
                          { value: "on", label: t("settings.options.on") },
                          { value: "off", label: t("settings.options.off") },
                          { value: "relative", label: t("settings.options.relative") },
                          { value: "interval", label: t("settings.options.interval") },
                        ]}
                      />

                      <SettingSelect
                        label={t("settings.display.renderWhitespace")}
                        value={editorSettings.renderWhitespace}
                        onChange={(v) =>
                          onUpdateEditorSettings({
                            renderWhitespace: v as EditorSettings["renderWhitespace"],
                          })
                        }
                        options={[
                          { value: "none", label: t("common.none") },
                          { value: "boundary", label: t("settings.options.boundary") },
                          { value: "selection", label: t("settings.options.selection") },
                          { value: "trailing", label: t("settings.options.trailing") },
                          { value: "all", label: t("settings.options.all") },
                        ]}
                      />

                      <SettingRow
                        label={t("settings.display.smoothScrolling")}
                        description={t("settings.display.smoothScrollingDesc")}
                      >
                        <Switch
                          checked={editorSettings.smoothScrolling}
                          onCheckedChange={(v) => onUpdateEditorSettings({ smoothScrolling: v })}
                        />
                      </SettingRow>
                    </SectionCard>

                    {/* Minimap */}
                    <SectionCard title={t("settings.minimap.title")}>
                      <SettingRow
                        label={t("settings.minimap.enableMinimap")}
                        description={t("settings.minimap.enableMinimapDesc")}
                      >
                        <Switch
                          checked={editorSettings.minimap.enabled}
                          onCheckedChange={(v) =>
                            onUpdateEditorSettings({
                              minimap: { ...editorSettings.minimap, enabled: v },
                            })
                          }
                        />
                      </SettingRow>

                      {editorSettings.minimap.enabled && (
                        <div className="pl-4 border-l-2 border-border space-y-3 pt-2">
                          <SettingSelect
                            label={t("settings.minimap.side")}
                            value={editorSettings.minimap.side}
                            onChange={(v) =>
                              onUpdateEditorSettings({
                                minimap: {
                                  ...editorSettings.minimap,
                                  side: v as MinimapSettings["side"],
                                },
                              })
                            }
                            options={[
                              { value: "right", label: t("settings.options.right") },
                              { value: "left", label: t("settings.options.left") },
                            ]}
                          />

                          <SettingSelect
                            label={t("settings.minimap.showSlider")}
                            value={editorSettings.minimap.showSlider}
                            onChange={(v) =>
                              onUpdateEditorSettings({
                                minimap: {
                                  ...editorSettings.minimap,
                                  showSlider: v as MinimapSettings["showSlider"],
                                },
                              })
                            }
                            options={[
                              { value: "mouseover", label: t("settings.options.mouseover") },
                              { value: "always", label: t("settings.options.always") },
                            ]}
                          />

                          <SettingRow
                            label={t("settings.minimap.renderCharacters")}
                            description={t("settings.minimap.renderCharactersDesc")}
                          >
                            <Switch
                              checked={editorSettings.minimap.renderCharacters}
                              onCheckedChange={(v) =>
                                onUpdateEditorSettings({
                                  minimap: {
                                    ...editorSettings.minimap,
                                    renderCharacters: v,
                                  },
                                })
                              }
                            />
                          </SettingRow>

                          <SettingRow label={t("settings.minimap.scale")}>
                            <NumberStepper
                              value={editorSettings.minimap.scale}
                              onChange={(v) =>
                                onUpdateEditorSettings({
                                  minimap: { ...editorSettings.minimap, scale: v },
                                })
                              }
                              min={1}
                              max={3}
                              unit="x"
                              ariaLabel={t("settings.minimap.scale")}
                            />
                          </SettingRow>
                        </div>
                      )}
                    </SectionCard>

                    {/* Editing & Formatting */}
                    <SectionCard title={t("settings.editing.title")}>
                      <SettingRow
                        label={t("settings.editing.tabSize")}
                        description={t("settings.editing.tabSizeDesc")}
                      >
                        <NumberStepper
                          value={editorSettings.tabSize}
                          onChange={(v) => onUpdateEditorSettings({ tabSize: v })}
                          min={1}
                          max={8}
                          unit="spaces"
                          ariaLabel={t("settings.editing.tabSize")}
                        />
                      </SettingRow>

                      <SettingRow
                        label={t("settings.editing.insertSpaces")}
                        description={t("settings.editing.insertSpacesDesc")}
                      >
                        <Switch
                          checked={editorSettings.insertSpaces}
                          onCheckedChange={(v) => onUpdateEditorSettings({ insertSpaces: v })}
                        />
                      </SettingRow>

                      <SettingSelect
                        label={t("settings.display.wordWrap")}
                        value={editorSettings.wordWrap}
                        onChange={(v) =>
                          onUpdateEditorSettings({
                            wordWrap: v as EditorSettings["wordWrap"],
                          })
                        }
                        options={[
                          { value: "off", label: t("settings.options.off") },
                          { value: "on", label: t("settings.options.on") },
                          { value: "wordWrapColumn", label: t("settings.options.wordWrapColumn") },
                          { value: "bounded", label: t("settings.options.bounded") },
                        ]}
                      />

                      <SettingSelect
                        label={t("settings.editing.autoClosingBrackets")}
                        value={editorSettings.autoClosingBrackets}
                        onChange={(v) =>
                          onUpdateEditorSettings({
                            autoClosingBrackets: v as EditorSettings["autoClosingBrackets"],
                          })
                        }
                        options={[
                          { value: "always", label: t("settings.options.always") },
                          {
                            value: "languageDefined",
                            label: t("settings.options.languageDefined"),
                          },
                          {
                            value: "beforeWhitespace",
                            label: t("settings.options.beforeWhitespace"),
                          },
                          { value: "never", label: t("settings.options.never") },
                        ]}
                      />

                      <SettingSelect
                        label={t("settings.display.cursorStyle")}
                        value={editorSettings.cursorStyle}
                        onChange={(v) =>
                          onUpdateEditorSettings({
                            cursorStyle: v as EditorSettings["cursorStyle"],
                          })
                        }
                        options={[
                          { value: "line", label: t("settings.options.line") },
                          { value: "block", label: t("settings.options.block") },
                          { value: "underline", label: t("settings.options.underline") },
                          { value: "line-thin", label: t("settings.options.lineThin") },
                        ]}
                      />

                      <SettingRow
                        label={t("settings.formatting.formatOnSave")}
                        description={t("settings.formatting.formatOnSaveDesc")}
                      >
                        <Switch
                          checked={editorSettings.formatOnSave}
                          onCheckedChange={(v) => onUpdateEditorSettings({ formatOnSave: v })}
                        />
                      </SettingRow>
                    </SectionCard>
                  </>
                )}

                {/* ===== 3. TERMINAL & GIT TAB ===== */}
                {currentTab === "terminalGit" && (
                  <>
                    <div className="mb-6">
                      <h2 className="text-xl font-bold tracking-tight text-foreground">
                        {t("settings.categories.terminalGit")}
                      </h2>
                      <p className="text-xs text-muted mt-1">
                        {t("settings.categories.terminalGitDesc")}
                      </p>
                    </div>

                    <SectionCard title={t("settings.terminalSection.title")}>
                      <TerminalFontSettings
                        value={editorSettings.terminalFontFamily}
                        onChange={(font) => onUpdateEditorSettings({ terminalFontFamily: font })}
                      />

                      <SettingRow label={t("settings.terminalSection.fontSize")}>
                        <NumberStepper
                          value={editorSettings.terminalFontSize}
                          onChange={(v) => onUpdateEditorSettings({ terminalFontSize: v })}
                          min={8}
                          max={32}
                          unit="px"
                          ariaLabel={t("settings.terminalSection.fontSize")}
                        />
                      </SettingRow>

                      <SettingRow label={t("settings.terminalSection.lineHeight")}>
                        <NumberStepper
                          value={editorSettings.terminalLineHeight}
                          onChange={(v) => onUpdateEditorSettings({ terminalLineHeight: v })}
                          min={1.0}
                          max={3.0}
                          step={0.1}
                          ariaLabel={t("settings.terminalSection.lineHeight")}
                        />
                      </SettingRow>

                      <SettingSelect
                        label={t("settings.terminalSection.shellMode")}
                        value={editorSettings.terminalShellMode}
                        onChange={(v) =>
                          onUpdateEditorSettings({
                            terminalShellMode: v as EditorSettings["terminalShellMode"],
                          })
                        }
                        options={[
                          { value: "auto", label: t("settings.options.auto") },
                          { value: "custom", label: t("settings.options.custom") },
                        ]}
                      />

                      {editorSettings.terminalShellMode === "custom" && (
                        <SettingRow
                          label={t("settings.terminalSection.shellPath")}
                          description={t("settings.terminalSection.shellPathDesc")}
                        >
                          <input
                            type="text"
                            value={editorSettings.terminalShellPath}
                            onChange={(e) =>
                              onUpdateEditorSettings({ terminalShellPath: e.target.value })
                            }
                            placeholder={t("settings.terminalSection.shellPathPlaceholder")}
                            className="settings-control w-64 font-mono"
                            aria-label={t("settings.terminalSection.shellPath")}
                          />
                        </SettingRow>
                      )}
                    </SectionCard>

                    <SectionCard title={t("settings.gitSection.title")}>
                      <div data-settings-section="github">
                        <GitHubAuthSettings />
                      </div>
                      <SettingRow
                        label={t("settings.gitSection.autoFetch")}
                        description={t("settings.gitSection.autoFetchDesc")}
                      >
                        <Switch
                          checked={editorSettings.gitAutoFetchEnabled}
                          onCheckedChange={(v) =>
                            onUpdateEditorSettings({ gitAutoFetchEnabled: v })
                          }
                        />
                      </SettingRow>

                      {editorSettings.gitAutoFetchEnabled && (
                        <SettingSelect
                          label={t("settings.gitSection.interval")}
                          value={editorSettings.gitAutoFetchIntervalSeconds}
                          onChange={(v) =>
                            onUpdateEditorSettings({
                              gitAutoFetchIntervalSeconds: parseInt(v, 10) || 120,
                            })
                          }
                          options={[
                            { value: 30, label: t("git.secondsUnit", { count: 30 }) },
                            { value: 60, label: t("git.minutesUnit", { count: 1, s: "" }) },
                            { value: 120, label: t("git.minutesUnit", { count: 2, s: "s" }) },
                            { value: 300, label: t("git.minutesUnit", { count: 5, s: "s" }) },
                            { value: 600, label: t("git.minutesUnit", { count: 10, s: "s" }) },
                          ]}
                        />
                      )}
                    </SectionCard>
                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
