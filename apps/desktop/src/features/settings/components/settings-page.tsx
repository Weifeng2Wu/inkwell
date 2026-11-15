"use client";

import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  CloudArrowUpIcon,
  GearIcon,
  KeyboardIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  PuzzlePieceIcon,
  SparkleIcon,
  TerminalIcon,
  TranslateIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import {
  type AcademicAgentController,
  AcademicAgentSettings,
  type AgentSelectionController,
  AgentSelectionSettings,
  DEFAULT_ACADEMIC_CONFIG,
  type ExternalAgentController,
  ExternalAgentSettings,
  SkillsSettings,
} from "@/features/agent";
import { type CloudBackupController, CloudBackupSettings } from "@/features/backup";
import { GitHubAuthSettings, type GitSyncController, GitSyncSettings } from "@/features/git";
import { useI18n } from "@/features/i18n";
import {
  QUICK_START_STEP_IDS,
  QUICK_START_STEPS,
} from "@/features/onboarding/lib/quick-start-state";
import {
  DEFAULT_EDITOR_SETTINGS,
  type EditorSettings,
  GIT_AUTO_BACKUP_INTERVALS,
  type MinimapSettings,
} from "@/features/settings/lib/editor-settings";
import { THEMES, themeLabel } from "@/features/settings/lib/theme";
import { useEditorSettings } from "@/features/settings/lib/use-editor-settings";
import { AgentConnectionSettings } from "./agent-connection-settings";
import { AppUpdateSettings } from "./app-update-settings";
import { FontSettings } from "./font-settings";
import { KeyboardShortcutSettings } from "./keyboard-shortcut-settings";
import { LayoutParserSettings } from "./layout-parser-settings";
import { TerminalFontSettings } from "./terminal-font-settings";
import { ThemeGrid } from "./theme-grid";
import { TranslationSettings } from "./translation-settings";

export type SettingsTabId =
  | "general"
  | "editor"
  | "terminalGit"
  | "sync"
  | "agent"
  | "skills"
  | "shortcuts"
  | "updates"
  | "translation";

export interface SettingsPageProps {
  cloudBackup?: CloudBackupController;
  gitSync?: GitSyncController;
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

function CategoryHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted">{description}</p>}
    </div>
  );
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

/** Automatic backup rows, shared by the Terminal & Git category and the search results. */
function GitBackupSettingRows({
  settings,
  onUpdate,
}: {
  settings: EditorSettings;
  onUpdate: (updates: Partial<EditorSettings>) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <SettingRow label={t("settings.gitSection.autoBackup")}>
        <Switch
          aria-label={t("settings.gitSection.autoBackup")}
          data-git-auto-backup
          checked={settings.gitAutoBackupEnabled}
          onCheckedChange={(v) => onUpdate({ gitAutoBackupEnabled: v })}
        />
      </SettingRow>
      {settings.gitAutoBackupEnabled && (
        <>
          <SettingSelect
            label={t("settings.gitSection.autoBackupInterval")}
            value={settings.gitAutoBackupIntervalMinutes}
            onChange={(v) =>
              onUpdate({
                gitAutoBackupIntervalMinutes:
                  GIT_AUTO_BACKUP_INTERVALS.find((minutes) => String(minutes) === v) ??
                  DEFAULT_EDITOR_SETTINGS.gitAutoBackupIntervalMinutes,
              })
            }
            options={GIT_AUTO_BACKUP_INTERVALS.map((minutes) => ({
              value: minutes,
              label: t("settings.units.minutes", { count: minutes }),
            }))}
          />
          <SettingRow label={t("settings.gitSection.autoBackupPush")}>
            <Switch
              aria-label={t("settings.gitSection.autoBackupPush")}
              data-git-auto-backup-push
              checked={settings.gitAutoBackupPush}
              onCheckedChange={(v) => onUpdate({ gitAutoBackupPush: v })}
            />
          </SettingRow>
        </>
      )}
    </>
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
  const { t } = useI18n();
  const roundVal = (v: number) => Math.round(v * 10) / 10;

  return (
    <div className="settings-number-stepper">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, roundVal(value - step)))}
        className="size-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-r border-border"
        aria-label={t("settings.decrease", { setting: ariaLabel })}
      >
        <MinusIcon className="size-3" aria-hidden="true" />
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
        aria-label={t("settings.increase", { setting: ariaLabel })}
      >
        <PlusIcon className="size-3" aria-hidden="true" />
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
  gitSync,
  cloudBackup,
  quickStart,
  onOpenTerminal: _onOpenTerminal,
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
  const [confirmRestore, setConfirmRestore] = useState(false);
  const guidedTab: SettingsTabId | undefined = quickStart
    ? ({ 4: "agent", 5: "general", 6: "agent", 7: "skills", 8: "terminalGit" } as const)[
        quickStart.step as 4 | 5 | 6 | 7 | 8
      ]
    : undefined;
  const currentTab = guidedTab ?? activeTab;
  const guideStep = quickStart ? QUICK_START_STEP_IDS[quickStart.step] : undefined;
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
          e.target.closest('[data-shortcut-recorder], [role="dialog"], [role="alertdialog"]')
        )
      ) {
        if (quickStart) quickStart.onClose();
        else onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, quickStart]);

  const restoresAgent = currentTab === "agent";
  const handleRestoreDefaults = useCallback(() => {
    if (restoresAgent) academicAgent?.setConfig(DEFAULT_ACADEMIC_CONFIG);
    else onUpdateEditorSettings(DEFAULT_EDITOR_SETTINGS);
  }, [restoresAgent, academicAgent, onUpdateEditorSettings]);

  const navItems = useMemo(
    () => [
      {
        id: "general" as const,
        icon: GearIcon,
        label: t("settings.categories.general"),
        desc: t("settings.categories.generalDesc"),
      },
      {
        id: "translation" as const,
        icon: TranslateIcon,
        label: t("settings.categories.translation"),
        desc: t("settings.categories.translationDesc"),
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
      {
        id: "sync" as const,
        icon: CloudArrowUpIcon,
        label: t("cloudBackup.category"),
        desc: t("cloudBackup.description"),
      },
      ...(academicAgent
        ? [
            {
              id: "agent" as const,
              icon: SparkleIcon,
              label: t("settings.categories.agent"),
              desc: t("settings.categories.agentDesc"),
            },
            {
              id: "skills" as const,
              icon: PuzzlePieceIcon,
              label: t("settings.categories.skills"),
              desc: t("settings.categories.skillsDesc"),
            },
          ]
        : []),
      {
        id: "updates" as const,
        icon: ArrowCounterClockwiseIcon,
        label: t("settings.categories.updates"),
        desc: t("settings.categories.updatesDesc"),
      },
    ],
    [t, academicAgent],
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchesSearch = useCallback(
    (...texts: string[]) =>
      !normalizedSearch || texts.some((text) => text.toLowerCase().includes(normalizedSearch)),
    [normalizedSearch],
  );
  const saveState = academicAgent?.settingsSaveError
    ? "failed"
    : academicAgent && !academicAgent.settingsSaved
      ? "saving"
      : "saved";

  // Rows shown both in their category and in search results.
  const languageRow = (
    <SettingSelect
      label={t("settings.general.interfaceLanguage")}
      description={t("settings.general.interfaceLanguageDesc")}
      value={locale}
      onChange={(value) => {
        const next = locales.find((entry) => entry.id === value);
        if (next) setLocale(next.id);
      }}
      options={locales.map((entry) => ({ value: entry.id, label: entry.nativeName }))}
    />
  );
  const fontRows = <FontSettings settings={editorSettings} onChange={onUpdateEditorSettings} />;
  const fontSizeRow = (
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
  );
  const wordWrapRow = (
    <SettingSelect
      label={t("settings.display.wordWrap")}
      value={editorSettings.wordWrap}
      onChange={(v) => onUpdateEditorSettings({ wordWrap: v as EditorSettings["wordWrap"] })}
      options={[
        { value: "off", label: t("settings.options.off") },
        { value: "on", label: t("settings.options.wrapWindow") },
        {
          value: "wordWrapColumn",
          label: t("settings.options.wrapColumn", { column: editorSettings.wordWrapColumn }),
        },
        {
          value: "bounded",
          label: t("settings.options.wrapBounded", { column: editorSettings.wordWrapColumn }),
        },
      ]}
    />
  );
  const vimModeRow = (
    <SettingRow
      label={t("settings.editing.vimMode")}
      description={t("settings.editing.vimModeDesc")}
    >
      <Switch
        aria-label={t("settings.editing.vimMode")}
        checked={editorSettings.vimMode}
        onCheckedChange={(v) => onUpdateEditorSettings({ vimMode: v })}
      />
    </SettingRow>
  );
  const minimapRow = (
    <SettingRow label={t("settings.minimap.enable")} description={t("settings.minimap.enableDesc")}>
      <Switch
        aria-label={t("settings.minimap.enable")}
        checked={editorSettings.minimap.enabled}
        onCheckedChange={(v) =>
          onUpdateEditorSettings({ minimap: { ...editorSettings.minimap, enabled: v } })
        }
      />
    </SettingRow>
  );
  const autoFetchRow = (
    <SettingRow
      label={t("settings.gitSection.autoFetch")}
      description={t("settings.gitSection.autoFetchDesc")}
    >
      <Switch
        aria-label={t("settings.gitSection.autoFetch")}
        checked={editorSettings.gitAutoFetchEnabled}
        onCheckedChange={(v) => onUpdateEditorSettings({ gitAutoFetchEnabled: v })}
      />
    </SettingRow>
  );
  const backupRows = (
    <GitBackupSettingRows settings={editorSettings} onUpdate={onUpdateEditorSettings} />
  );
  const terminalFontRow = (
    <TerminalFontSettings
      value={editorSettings.terminalFontFamily}
      onChange={(font) => onUpdateEditorSettings({ terminalFontFamily: font })}
    />
  );
  const shellModeRow = (
    <SettingSelect
      label={t("settings.terminalSection.shellMode")}
      value={editorSettings.terminalShellMode}
      onChange={(v) =>
        onUpdateEditorSettings({ terminalShellMode: v as EditorSettings["terminalShellMode"] })
      }
      options={[
        { value: "auto", label: t("settings.options.shellAuto") },
        { value: "custom", label: t("settings.options.shellCustom") },
      ]}
    />
  );
  const agentSettings = academicAgent && (
    <AcademicAgentSettings
      agent={academicAgent}
      external={agentSelection?.selected !== undefined && agentSelection.selected !== "builtin"}
    />
  );
  const skillsSettings = academicAgent && (
    <SkillsSettings
      agent={academicAgent}
      selection={agentSelection}
      externalAgent={externalAgent}
    />
  );

  const fontLabels = [
    t("settings.fonts.uiFontFamily"),
    t("settings.fonts.textFontFamily"),
    t("settings.fonts.codeFontFamily"),
  ];
  const backupLabels = [
    t("settings.gitSection.autoBackup"),
    t("settings.gitSection.autoBackupDesc"),
    t("settings.gitSection.autoBackupPush"),
  ];

  return (
    <div
      data-settings-page
      className="fixed inset-0 z-50 flex h-screen w-screen select-none flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Top Navigation Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6">
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            onClick={quickStart ? quickStart.onClose : onClose}
            className="flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground-secondary transition-colors hover:border-border-dark hover:bg-accent-hover hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            <span>{t("settings.back")}</span>
            <kbd className="kbd-quiet hidden sm:inline-flex">Esc</kbd>
          </button>

          <span
            role="status"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-[11px] font-medium text-muted"
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${
                saveState === "failed"
                  ? "bg-error"
                  : saveState === "saving"
                    ? "bg-border"
                    : "bg-success"
              }`}
            />
            {t(`settings.${saveState === "failed" ? "saveFailed" : saveState}`)}
          </span>
          {academicAgent?.settingsSaveError && (
            <span
              role="alert"
              className="hidden min-w-0 max-w-64 truncate text-xs text-error md:inline"
              title={academicAgent.settingsSaveError}
            >
              {academicAgent.settingsSaveError}
            </span>
          )}
        </div>

        {/* Search Input */}
        <div className="relative w-64 shrink md:w-80">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            disabled={Boolean(quickStart)}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("settings.search")}
            className="settings-control settings-search-control w-full"
            aria-label={t("settings.search")}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted transition-colors hover:text-foreground"
              aria-label={t("common.clear")}
            >
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {!quickStart && onOpenQuickStart && (
            <button type="button" onClick={onOpenQuickStart} className="btn btn-sm">
              {t("onboarding.name")}
            </button>
          )}
          {currentTab !== "shortcuts" &&
            currentTab !== "sync" &&
            currentTab !== "updates" &&
            currentTab !== "translation" && (
              <Tooltip label={t("settings.restoreDefaults")}>
                <button
                  type="button"
                  onClick={() => setConfirmRestore(true)}
                  disabled={Boolean(quickStart) || (restoresAgent && academicAgent?.working)}
                  aria-label={t("settings.restoreDefaults")}
                  className="btn btn-sm"
                >
                  <ArrowCounterClockwiseIcon className="size-3.5" aria-hidden="true" />
                  <span className="hidden lg:inline">{t("settings.restoreDefaults")}</span>
                </button>
              </Tooltip>
            )}
          {onClose && (
            <button
              type="button"
              onClick={quickStart ? quickStart.onClose : onClose}
              className="btn btn-primary btn-sm"
            >
              {t("common.done")}
            </button>
          )}
        </div>
      </header>

      {quickStart && guideStep && (
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
          className="motion-fade shrink-0 border-b border-accent/25 bg-accent/5 px-6 py-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-accent">
                {t("onboarding.progress", {
                  current: quickStart.step + 1,
                  total: QUICK_START_STEPS,
                })}
              </p>
              <h2 id="settings-guide-heading" className="mt-1 text-sm font-semibold">
                {t(`onboarding.steps.${guideStep}.title`)}
              </h2>
              <p className="mt-1 max-w-3xl text-xs leading-6 text-muted">
                {t(`onboarding.steps.${guideStep}.body`)}
              </p>
              {quickStart.saveError && (
                <p role="alert" className="mt-1 text-xs text-error">
                  {t("onboarding.storageError")}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {quickStart.step < QUICK_START_STEPS - 1 && (
                <button
                  type="button"
                  className="px-2 text-xs text-muted transition-colors hover:text-foreground"
                  onClick={quickStart.onNext}
                >
                  {t("onboarding.skip")}
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={quickStart.onBack}>
                {t("onboarding.back")}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={quickStart.onNext}>
                {t(
                  quickStart.step === QUICK_START_STEPS - 1
                    ? "onboarding.finish"
                    : "onboarding.next",
                )}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Main Two-Column Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar Category Navigation */}
        <nav
          aria-label={t("workbench.settings")}
          className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface-secondary/20 p-3"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = !searchQuery && currentTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={Boolean(quickStart)}
                aria-current={isActive ? "page" : undefined}
                data-active={isActive}
                onClick={() => {
                  setActiveTab(item.id);
                  setSearchQuery("");
                }}
                className={`list-row flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left ${
                  isActive ? "text-foreground" : "text-foreground-secondary"
                }`}
              >
                <Icon
                  aria-hidden="true"
                  className={`mt-0.5 size-4 shrink-0 ${isActive ? "text-accent" : "text-muted-foreground"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{item.label}</span>
                  <span
                    className={`mt-0.5 block text-xs leading-4 text-muted ${item.id === "sync" ? "truncate" : ""}`}
                    title={item.id === "sync" ? item.desc : undefined}
                  >
                    {item.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Right Main Settings Panel */}
        <main
          data-settings-section="content"
          className="h-full flex-1 overflow-y-auto p-6 md:p-8 lg:p-10"
        >
          <div className="mx-auto max-w-3xl pb-12">
            {searchQuery ? (
              <div>
                <div className="mb-6">
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">
                    {t("settings.searchResults")}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {t("settings.searchResultsFor", { query: searchQuery.trim() })}
                  </p>
                </div>

                {/* Every child is conditional, so no match leaves this empty and reveals the hint below. */}
                <div data-settings-results className="peer space-y-6 empty:hidden">
                  <KeyboardShortcutSettings query={searchQuery} />
                  {matchesSearch(
                    t("settings.updates.title"),
                    t("settings.updates.automatic"),
                    t("settings.keywords.updates"),
                  ) && <AppUpdateSettings />}
                  {matchesSearch(t("layoutParser.title"), t("settings.keywords.layoutParser")) && (
                    <LayoutParserSettings />
                  )}
                  {matchesSearch(
                    t("settings.categories.translation"),
                    t("settings.keywords.translation"),
                  ) && <TranslationSettings />}
                  {matchesSearch(
                    t("settings.general.language"),
                    t("settings.general.interfaceLanguage"),
                    t("settings.general.theme"),
                  ) && (
                    <SectionCard title={t("settings.categories.general")}>
                      {matchesSearch(
                        t("settings.general.language"),
                        t("settings.general.interfaceLanguage"),
                      ) && languageRow}
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
                              {THEMES.map((option) => (
                                <SelectItem key={option.id} value={option.id} className="text-xs">
                                  {themeLabel(option, t)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </SettingRow>
                      )}
                    </SectionCard>
                  )}

                  {matchesSearch(
                    ...fontLabels,
                    t("settings.editing.vimMode"),
                    t("settings.display.fontSize"),
                    t("settings.display.wordWrap"),
                    t("settings.minimap.enable"),
                  ) && (
                    <SectionCard title={t("settings.categories.editor")}>
                      {matchesSearch(...fontLabels) && fontRows}
                      {matchesSearch(t("settings.editing.vimMode")) && vimModeRow}
                      {matchesSearch(t("settings.display.fontSize")) && fontSizeRow}
                      {matchesSearch(t("settings.display.wordWrap")) && wordWrapRow}
                      {matchesSearch(t("settings.minimap.enable")) && minimapRow}
                    </SectionCard>
                  )}

                  {cloudBackup &&
                    matchesSearch(
                      t("cloudBackup.category"),
                      t("cloudBackup.description"),
                      "R2",
                      "S3",
                    ) && (
                      <SectionCard title={t("cloudBackup.title")}>
                        <CloudBackupSettings controller={cloudBackup} />
                      </SectionCard>
                    )}
                  {matchesSearch(
                    t("settings.gitSection.syncProject"),
                    t("settings.gitSection.fetchNow"),
                    t("settings.gitSection.pullNow"),
                    t("settings.gitSection.backupNow"),
                  ) && (
                    <SectionCard title={t("settings.gitSection.syncProject")}>
                      <GitSyncSettings controller={gitSync} />
                    </SectionCard>
                  )}
                  {matchesSearch(
                    "GitHub",
                    t("settings.gitSection.login"),
                    t("settings.gitSection.installCli"),
                  ) && (
                    <SectionCard title="GitHub">
                      <GitHubAuthSettings />
                    </SectionCard>
                  )}
                  {matchesSearch(
                    ...backupLabels,
                    t("settings.gitSection.autoFetch"),
                    t("settings.terminalSection.title"),
                    t("settings.terminalSection.fontFamily"),
                    t("settings.terminalSection.shellMode"),
                  ) && (
                    <SectionCard title={t("settings.categories.terminalGit")}>
                      {matchesSearch(t("settings.gitSection.autoFetch")) && autoFetchRow}
                      {matchesSearch(...backupLabels) && backupRows}
                      {matchesSearch(
                        t("settings.terminalSection.title"),
                        t("settings.terminalSection.fontFamily"),
                      ) && terminalFontRow}
                      {matchesSearch(
                        t("settings.terminalSection.title"),
                        t("settings.terminalSection.shellMode"),
                      ) && shellModeRow}
                    </SectionCard>
                  )}

                  {matchesSearch(
                    t("settings.categories.agent"),
                    t("settings.categories.agentDesc"),
                    t("agent.settings.personalPrompt"),
                    t("settings.keywords.agent"),
                  ) && agentSettings}
                  {matchesSearch(
                    t("settings.categories.skills"),
                    t("settings.categories.skillsDesc"),
                    t("agent.skills.title"),
                    t("settings.keywords.skills"),
                  ) && skillsSettings}
                  {agentSelection &&
                    matchesSearch(
                      t("agent.external.heading"),
                      t("agent.external.defaultAgent"),
                      t("settings.keywords.externalAgents"),
                    ) && (
                      <>
                        <AgentSelectionSettings selection={agentSelection} />
                        <ExternalAgentSettings selection={agentSelection} />
                      </>
                    )}
                </div>
                <p
                  data-settings-no-results
                  className="hidden rounded-lg border border-border bg-surface px-4 py-6 text-center text-[13px] leading-6 text-muted peer-empty:block"
                >
                  {t("settings.searchEmpty", { query: searchQuery.trim() })}
                </p>
              </div>
            ) : (
              <div className="motion-fade space-y-6" key={currentTab}>
                {currentTab === "shortcuts" && <KeyboardShortcutSettings />}
                {currentTab === "skills" && skillsSettings}
                {currentTab === "agent" && (
                  <AgentConnectionSettings agent={academicAgent} selection={agentSelection} />
                )}
                {currentTab === "updates" && <AppUpdateSettings />}
                {currentTab === "translation" && <TranslationSettings />}
                {currentTab === "general" && (
                  <>
                    <CategoryHeading
                      title={t("settings.categories.general")}
                      description={t("settings.categories.generalDesc")}
                    />
                    {agentSelection && <AgentSelectionSettings selection={agentSelection} />}

                    <SectionCard title={t("settings.general.language")}>{languageRow}</SectionCard>

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

                    <div data-settings-section="layout">
                      <LayoutParserSettings />
                    </div>

                    <SectionCard title={t("settings.display.title")}>
                      {fontRows}
                      {fontSizeRow}

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
                          { value: "relative", label: t("settings.options.lineNumbersRelative") },
                          { value: "interval", label: t("settings.options.lineNumbersInterval") },
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
                          { value: "none", label: t("settings.options.never") },
                          { value: "boundary", label: t("settings.options.whitespaceBoundary") },
                          { value: "selection", label: t("settings.options.whitespaceSelection") },
                          { value: "trailing", label: t("settings.options.whitespaceTrailing") },
                          { value: "all", label: t("settings.options.whitespaceAll") },
                        ]}
                      />

                      <SettingRow
                        label={t("settings.display.smoothScrolling")}
                        description={t("settings.display.smoothScrollingDesc")}
                      >
                        <Switch
                          aria-label={t("settings.display.smoothScrolling")}
                          checked={editorSettings.smoothScrolling}
                          onCheckedChange={(v) => onUpdateEditorSettings({ smoothScrolling: v })}
                        />
                      </SettingRow>

                      <SettingSelect
                        label={t("settings.display.cursorStyle")}
                        value={editorSettings.cursorStyle}
                        onChange={(v) =>
                          onUpdateEditorSettings({
                            cursorStyle: v as EditorSettings["cursorStyle"],
                          })
                        }
                        options={[
                          { value: "line", label: t("settings.options.cursorLine") },
                          { value: "block", label: t("settings.options.cursorBlock") },
                          { value: "underline", label: t("settings.options.cursorUnderline") },
                          { value: "line-thin", label: t("settings.options.cursorThinLine") },
                        ]}
                      />
                    </SectionCard>

                    <SectionCard title={t("settings.minimap.title")}>
                      {minimapRow}

                      {editorSettings.minimap.enabled && (
                        <div className="space-y-3 border-l border-border pl-4 pt-2">
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
                              { value: "mouseover", label: t("settings.options.onHover") },
                              { value: "always", label: t("settings.options.always") },
                            ]}
                          />

                          <SettingRow
                            label={t("settings.minimap.renderCharacters")}
                            description={t("settings.minimap.renderCharactersDesc")}
                          >
                            <Switch
                              aria-label={t("settings.minimap.renderCharacters")}
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
                              unit="×"
                              ariaLabel={t("settings.minimap.scale")}
                            />
                          </SettingRow>
                        </div>
                      )}
                    </SectionCard>

                    <SectionCard title={t("settings.editing.title")}>
                      {vimModeRow}

                      <SettingRow
                        label={t("settings.editing.tabSize")}
                        description={t("settings.editing.tabSizeDesc")}
                      >
                        <NumberStepper
                          value={editorSettings.tabSize}
                          onChange={(v) => onUpdateEditorSettings({ tabSize: v })}
                          min={1}
                          max={8}
                          ariaLabel={t("settings.editing.tabSize")}
                        />
                      </SettingRow>

                      <SettingRow
                        label={t("settings.editing.insertSpaces")}
                        description={t("settings.editing.insertSpacesDesc")}
                      >
                        <Switch
                          aria-label={t("settings.editing.insertSpaces")}
                          checked={editorSettings.insertSpaces}
                          onCheckedChange={(v) => onUpdateEditorSettings({ insertSpaces: v })}
                        />
                      </SettingRow>

                      {wordWrapRow}

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
                            label: t("settings.options.languageDefault"),
                          },
                          {
                            value: "beforeWhitespace",
                            label: t("settings.options.beforeWhitespace"),
                          },
                          { value: "never", label: t("settings.options.never") },
                        ]}
                      />

                      <SettingRow
                        label={t("settings.editing.formatOnSave")}
                        description={t("settings.editing.formatOnSaveDesc")}
                      >
                        <Switch
                          aria-label={t("settings.editing.formatOnSave")}
                          checked={editorSettings.formatOnSave}
                          onCheckedChange={(v) => onUpdateEditorSettings({ formatOnSave: v })}
                        />
                      </SettingRow>
                    </SectionCard>
                  </>
                )}

                {currentTab === "sync" && (
                  <>
                    <CategoryHeading title={t("cloudBackup.category")} />
                    <SectionCard title={t("settings.gitSection.title")}>
                      <GitHubAuthSettings />
                      <GitSyncSettings controller={gitSync} />
                      {backupRows}
                    </SectionCard>
                    <SectionCard title={t("cloudBackup.title")}>
                      {cloudBackup ? (
                        <CloudBackupSettings controller={cloudBackup} />
                      ) : (
                        <p className="text-xs text-muted">{t("cloudBackup.desktopOnly")}</p>
                      )}
                    </SectionCard>
                  </>
                )}
                {currentTab === "terminalGit" && (
                  <>
                    <CategoryHeading
                      title={t("settings.categories.terminalGit")}
                      description={t("settings.categories.terminalGitDesc")}
                    />

                    <SectionCard title={t("settings.terminalSection.title")}>
                      {terminalFontRow}

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

                      {shellModeRow}

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
                      <GitSyncSettings controller={gitSync} />
                      {autoFetchRow}

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
                            { value: 30, label: t("settings.units.seconds", { count: 30 }) },
                            ...[1, 2, 5, 10].map((minutes) => ({
                              value: minutes * 60,
                              label: t("settings.units.minutes", { count: minutes }),
                            })),
                          ]}
                        />
                      )}
                      {backupRows}
                    </SectionCard>
                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
      {confirmRestore && (
        <ConfirmDialog
          title={t(restoresAgent ? "settings.restoreAgentTitle" : "settings.restoreEditorTitle")}
          message={t(
            restoresAgent ? "settings.restoreAgentMessage" : "settings.restoreEditorMessage",
          )}
          confirmLabel={t("settings.restoreDefaults")}
          onConfirm={() => {
            setConfirmRestore(false);
            handleRestoreDefaults();
          }}
          onCancel={() => setConfirmRestore(false)}
        />
      )}
    </div>
  );
}
