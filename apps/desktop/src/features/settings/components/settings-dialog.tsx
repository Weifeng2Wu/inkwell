"use client";

import { ArrowCounterClockwiseIcon, MinusIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useTheme } from "next-themes";
import { useCallback, useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type Locale, useI18n } from "@/features/i18n";
import {
  DEFAULT_EDITOR_SETTINGS,
  type EditorSettings,
  type MinimapSettings,
} from "@/features/settings/lib/editor-settings";
import { FontSettings } from "./font-settings";
import { TerminalFontSettings } from "./terminal-font-settings";
import { ThemeGrid } from "./theme-grid";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  editorSettings: EditorSettings;
  onUpdateEditorSettings: (updates: Partial<EditorSettings>) => void;
  initialTab?: "general" | "editor";
}

// Section header component for visual grouping - editorial style
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-6 pb-2 border-t border-border mt-4 first:mt-0 first:border-t-0 first:pt-2">
      <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
        {children}
      </h3>
    </div>
  );
}

function CheckboxItem({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  const checkboxId = useId();

  return (
    <label htmlFor={checkboxId} className="flex items-start gap-3 cursor-pointer group py-2">
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div className="flex-1">
        <span className="text-sm font-medium text-foreground-secondary group-hover:text-foreground transition-colors">
          {label}
        </span>
        <p className="text-xs text-muted mt-0.5">{description}</p>
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  description,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: { value: string | number; label: string }[];
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 gap-8">
      <div className="shrink-0">
        <span className="text-sm font-medium text-foreground-secondary block">{label}</span>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <Select value={String(value)} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="settings-control settings-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="settings-select-content">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={String(opt.value)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <div className="py-2">
      <span className="text-sm font-medium block mb-2 text-foreground-secondary">
        {t("settings.general.theme")}
      </span>
      <ThemeGrid theme={theme} onSelect={setTheme} label={t("settings.general.theme")} />
      <p className="text-xs text-muted mt-1.5">{t("settings.general.themeDesc")}</p>
    </div>
  );
}

export function SettingsDialog({
  open,
  onClose,
  editorSettings,
  onUpdateEditorSettings,
  initialTab = "general",
}: SettingsDialogProps) {
  const { t, locale, setLocale, locales } = useI18n();
  const [activeTab, setActiveTab] = useState<string>(
    initialTab === "editor" ? "general" : initialTab,
  );

  const handleResetEditorSettings = useCallback(() => {
    onUpdateEditorSettings(DEFAULT_EDITOR_SETTINGS);
  }, [onUpdateEditorSettings]);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/45 z-[9999]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] bg-background border border-border rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <Dialog.Title className="text-lg font-bold tracking-tight">
                {t("settings.title")}
              </Dialog.Title>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {t("settings.autoSaved")}
              </span>
            </div>
            <Dialog.Close className="toolbar-icon-button" aria-label={t("common.close")}>
              <XIcon className="size-4" />
            </Dialog.Close>
          </div>

          <Tabs.Root
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* Tabs */}
            <Tabs.List className="flex border-b border-border shrink-0">
              <Tabs.Trigger
                value="general"
                className="flex-1 px-4 py-3 text-sm font-medium transition-colors relative text-muted-foreground hover:text-foreground data-[state=active]:text-foreground"
              >
                {t("settings.tabs.general")}
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent transition-opacity opacity-0 data-[state=active]:opacity-100" />
              </Tabs.Trigger>
            </Tabs.List>

            {/* ===== GENERAL TAB ===== */}
            <Tabs.Content value="general" className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
              <SectionHeader>{t("settings.general.language")}</SectionHeader>
              <SelectField
                label={t("settings.general.language")}
                description={t("settings.general.languageDesc")}
                value={locale}
                onChange={(val) => setLocale(val as Locale)}
                options={locales.map((loc) => ({
                  value: loc.id,
                  label: `${loc.label} (${loc.nativeName})`,
                }))}
              />

              <SectionHeader>{t("settings.general.appearance")}</SectionHeader>
              <ThemePicker />

              <SectionHeader>{t("settings.gitSection.title")}</SectionHeader>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 border flex items-center justify-center transition-colors ${
                      editorSettings.gitAutoFetchEnabled
                        ? "bg-accent border-accent"
                        : "bg-accent-hover border-border"
                    }`}
                  >
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      className={
                        editorSettings.gitAutoFetchEnabled
                          ? "text-accent-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      <path
                        d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 2.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM4.5 8a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm7 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z"
                        fill="currentColor"
                        fillRule="evenodd"
                      />
                      <path
                        d="M8 5.75v2.5M6 9l-1-.5M10 9l1-.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground-secondary">
                        {t("settings.gitSection.autoFetch")}
                      </span>
                      {editorSettings.gitAutoFetchEnabled && (
                        <span className="text-[10px] px-1.5 py-0.5 border border-success/30 text-success font-medium uppercase tracking-wider bg-success/10">
                          {t("common.active")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-0.5">
                      {t("settings.gitSection.autoFetchDesc")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={editorSettings.gitAutoFetchEnabled}
                  onCheckedChange={(v) => onUpdateEditorSettings({ gitAutoFetchEnabled: v })}
                />
              </div>

              {editorSettings.gitAutoFetchEnabled && (
                <div className="pl-4 border-l-2 border-border ml-1">
                  <SelectField
                    label={t("settings.gitSection.interval")}
                    value={editorSettings.gitAutoFetchIntervalSeconds}
                    onChange={(v) =>
                      onUpdateEditorSettings({
                        gitAutoFetchIntervalSeconds: Math.min(
                          3600,
                          Math.max(15, parseInt(v, 10) || 120),
                        ),
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
                </div>
              )}
              <SectionHeader>{t("settings.keybindings.title")}</SectionHeader>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 border flex items-center justify-center tabular-nums text-xs font-bold tracking-tight transition-colors ${
                      editorSettings.vimMode
                        ? "bg-accent border-accent text-accent-foreground"
                        : "bg-accent-hover border-border text-muted-foreground"
                    }`}
                  >
                    Vi
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground-secondary">
                        {t("settings.keybindings.vimMode")}
                      </span>
                      {editorSettings.vimMode && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-accent text-accent-foreground tabular-nums font-bold tracking-wider">
                          {t("settings.keybindings.normal")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-0.5">
                      {t("settings.keybindings.vimModeDesc")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={editorSettings.vimMode}
                  onCheckedChange={(v) => onUpdateEditorSettings({ vimMode: v })}
                />
              </div>

              <SectionHeader>{t("settings.display.title")}</SectionHeader>

              <FontSettings settings={editorSettings} onChange={onUpdateEditorSettings} />

              <div className="flex items-center justify-between py-2">
                <label
                  htmlFor="editor-font-size"
                  className="text-sm font-medium text-foreground-secondary"
                >
                  {t("settings.display.fontSize")}
                </label>
                <div className="settings-number-stepper">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        fontSize: Math.max(8, editorSettings.fontSize - 1),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-r border-border"
                    aria-label={t("interface.decrease", {
                      setting: t("settings.display.fontSize"),
                    })}
                  >
                    <MinusIcon className="size-3" />
                  </button>
                  <input
                    id="editor-font-size"
                    type="number"
                    min="8"
                    max="32"
                    value={editorSettings.fontSize}
                    onChange={(e) =>
                      onUpdateEditorSettings({
                        fontSize: Math.min(32, Math.max(8, parseInt(e.target.value, 10) || 14)),
                      })
                    }
                    className="w-12 h-8 text-sm text-center border-0 focus:outline-none focus:ring-0 tabular-nums bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        fontSize: Math.min(32, editorSettings.fontSize + 1),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-l border-border"
                    aria-label={t("interface.increase", {
                      setting: t("settings.display.fontSize"),
                    })}
                  >
                    <PlusIcon className="size-3" />
                  </button>
                  <span className="text-xs text-muted-foreground px-2 border-l border-border">
                    px
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between py-2">
                <label
                  htmlFor="editor-line-height"
                  className="text-sm font-medium text-foreground-secondary"
                >
                  {t("settings.display.lineHeight")}
                </label>
                <div className="settings-number-stepper">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        lineHeight: Math.max(
                          1.0,
                          Math.round((editorSettings.lineHeight - 0.1) * 10) / 10,
                        ),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-r border-border"
                    aria-label={t("interface.decrease", {
                      setting: t("settings.display.lineHeight"),
                    })}
                  >
                    <MinusIcon className="size-3" />
                  </button>
                  <input
                    id="editor-line-height"
                    type="number"
                    min="1.0"
                    max="3.0"
                    step="0.1"
                    value={editorSettings.lineHeight.toFixed(1)}
                    onChange={(e) =>
                      onUpdateEditorSettings({
                        lineHeight: Math.min(3.0, Math.max(1.0, parseFloat(e.target.value) || 1.6)),
                      })
                    }
                    className="w-12 h-8 text-sm text-center border-0 focus:outline-none focus:ring-0 tabular-nums bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        lineHeight: Math.min(
                          3.0,
                          Math.round((editorSettings.lineHeight + 0.1) * 10) / 10,
                        ),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-l border-border"
                    aria-label={t("interface.increase", {
                      setting: t("settings.display.lineHeight"),
                    })}
                  >
                    <PlusIcon className="size-3" />
                  </button>
                </div>
              </div>

              <SelectField
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

              <SelectField
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

              <div className="space-y-3 pt-1">
                <CheckboxItem
                  checked={editorSettings.smoothScrolling}
                  onChange={(v) => onUpdateEditorSettings({ smoothScrolling: v })}
                  label={t("settings.display.smoothScrolling")}
                  description={t("settings.display.smoothScrollingDesc")}
                />
              </div>

              <SectionHeader>{t("settings.minimap.title")}</SectionHeader>

              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground-secondary">
                      {t("settings.minimap.enableMinimap")}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {t("settings.minimap.enableMinimapDesc")}
                  </p>
                </div>
                <Switch
                  checked={editorSettings.minimap.enabled}
                  onCheckedChange={(v) =>
                    onUpdateEditorSettings({
                      minimap: { ...editorSettings.minimap, enabled: v },
                    })
                  }
                />
              </div>

              {editorSettings.minimap.enabled && (
                <div className="pl-4 border-l-2 border-border ml-1 space-y-1">
                  <SelectField
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

                  <SelectField
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

                  <div className="pt-2">
                    <CheckboxItem
                      checked={editorSettings.minimap.renderCharacters}
                      onChange={(v) =>
                        onUpdateEditorSettings({
                          minimap: {
                            ...editorSettings.minimap,
                            renderCharacters: v,
                          },
                        })
                      }
                      label={t("settings.minimap.renderCharacters")}
                      description={t("settings.minimap.renderCharactersDesc")}
                    />
                  </div>

                  <SelectField
                    label={t("settings.minimap.size")}
                    value={editorSettings.minimap.size}
                    onChange={(v) =>
                      onUpdateEditorSettings({
                        minimap: {
                          ...editorSettings.minimap,
                          size: v as MinimapSettings["size"],
                        },
                      })
                    }
                    options={[
                      { value: "proportional", label: t("settings.options.proportional") },
                      { value: "fill", label: t("settings.options.fill") },
                      { value: "fit", label: t("settings.options.fit") },
                    ]}
                  />

                  <div className="flex items-center justify-between py-2">
                    <label
                      htmlFor="editor-minimap-scale"
                      className="text-sm font-medium text-foreground-secondary"
                    >
                      {t("settings.minimap.scale")}
                    </label>
                    <div className="settings-number-stepper">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateEditorSettings({
                            minimap: {
                              ...editorSettings.minimap,
                              scale: Math.max(1, editorSettings.minimap.scale - 1),
                            },
                          })
                        }
                        className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-r border-border"
                        aria-label={t("interface.decrease", {
                          setting: t("settings.minimap.scale"),
                        })}
                      >
                        <MinusIcon className="size-3" />
                      </button>
                      <span className="w-10 text-center tabular-nums text-sm">
                        {editorSettings.minimap.scale}x
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateEditorSettings({
                            minimap: {
                              ...editorSettings.minimap,
                              scale: Math.min(3, editorSettings.minimap.scale + 1),
                            },
                          })
                        }
                        className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-l border-border"
                        aria-label={t("interface.increase", {
                          setting: t("settings.minimap.scale"),
                        })}
                      >
                        <PlusIcon className="size-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <SectionHeader>{t("settings.editing.title")}</SectionHeader>

              <div className="flex items-center justify-between py-2">
                <label
                  htmlFor="editor-tab-size"
                  className="text-sm font-medium text-foreground-secondary"
                >
                  {t("settings.editing.tabSize")}
                </label>
                <div className="settings-number-stepper">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        tabSize: Math.max(1, editorSettings.tabSize - 1),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-r border-border"
                    aria-label={t("interface.decrease", { setting: t("settings.editing.tabSize") })}
                  >
                    <MinusIcon className="size-3" />
                  </button>
                  <span className="w-10 text-center tabular-nums text-sm">
                    {editorSettings.tabSize}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        tabSize: Math.min(8, editorSettings.tabSize + 1),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-l border-border"
                    aria-label={t("interface.increase", { setting: t("settings.editing.tabSize") })}
                  >
                    <PlusIcon className="size-3" />
                  </button>
                  <span className="text-xs text-muted-foreground px-2 border-l border-border">
                    spaces
                  </span>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <CheckboxItem
                  checked={editorSettings.insertSpaces}
                  onChange={(v) => onUpdateEditorSettings({ insertSpaces: v })}
                  label={t("settings.editing.insertSpaces")}
                  description={t("settings.editing.insertSpacesDesc")}
                />
              </div>

              <SelectField
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

              {editorSettings.wordWrap === "wordWrapColumn" && (
                <div className="pl-4 border-l-2 border-border ml-1">
                  <div className="flex items-center justify-between py-2">
                    <label
                      htmlFor="editor-wrap-column"
                      className="text-sm font-medium text-foreground-secondary"
                    >
                      {t("settings.display.wordWrapColumn")}
                    </label>
                    <div className="settings-number-stepper">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateEditorSettings({
                            wordWrapColumn: Math.max(20, editorSettings.wordWrapColumn - 10),
                          })
                        }
                        className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-r border-border"
                        aria-label={t("interface.decrease", {
                          setting: t("settings.display.wordWrapColumn"),
                        })}
                      >
                        <MinusIcon className="size-3" />
                      </button>
                      <input
                        id="editor-wrap-column"
                        type="number"
                        min="20"
                        max="200"
                        value={editorSettings.wordWrapColumn}
                        onChange={(e) =>
                          onUpdateEditorSettings({
                            wordWrapColumn: Math.min(
                              200,
                              Math.max(20, parseInt(e.target.value, 10) || 80),
                            ),
                          })
                        }
                        className="w-14 h-8 text-sm text-center border-0 focus:outline-none focus:ring-0 tabular-nums bg-transparent"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateEditorSettings({
                            wordWrapColumn: Math.min(200, editorSettings.wordWrapColumn + 10),
                          })
                        }
                        className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-l border-border"
                        aria-label={t("interface.increase", {
                          setting: t("settings.display.wordWrapColumn"),
                        })}
                      >
                        <PlusIcon className="size-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <SelectField
                label={t("settings.editing.autoClosingBrackets")}
                value={editorSettings.autoClosingBrackets}
                onChange={(v) =>
                  onUpdateEditorSettings({
                    autoClosingBrackets: v as EditorSettings["autoClosingBrackets"],
                  })
                }
                options={[
                  { value: "always", label: t("settings.options.always") },
                  { value: "languageDefined", label: t("settings.options.languageDefined") },
                  { value: "beforeWhitespace", label: t("settings.options.beforeWhitespace") },
                  { value: "never", label: t("settings.options.never") },
                ]}
              />

              <SelectField
                label={t("settings.editing.autoClosingQuotes")}
                value={editorSettings.autoClosingQuotes}
                onChange={(v) =>
                  onUpdateEditorSettings({
                    autoClosingQuotes: v as EditorSettings["autoClosingQuotes"],
                  })
                }
                options={[
                  { value: "always", label: t("settings.options.always") },
                  { value: "languageDefined", label: t("settings.options.languageDefined") },
                  { value: "beforeWhitespace", label: t("settings.options.beforeWhitespace") },
                  { value: "never", label: t("settings.options.never") },
                ]}
              />

              <SelectField
                label={t("settings.display.cursorBlinking")}
                value={editorSettings.cursorBlinking}
                onChange={(v) =>
                  onUpdateEditorSettings({
                    cursorBlinking: v as EditorSettings["cursorBlinking"],
                  })
                }
                options={[
                  { value: "blink", label: t("settings.options.blink") },
                  { value: "smooth", label: t("settings.options.smooth") },
                  { value: "phase", label: t("settings.options.phase") },
                  { value: "expand", label: t("settings.options.expand") },
                  { value: "solid", label: t("settings.options.solid") },
                ]}
              />

              <SelectField
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
                  { value: "block-outline", label: t("settings.options.blockOutline") },
                  { value: "underline-thin", label: t("settings.options.underlineThin") },
                ]}
              />

              <SectionHeader>{t("settings.formatting.title")}</SectionHeader>

              <div className="space-y-3 pt-1">
                <CheckboxItem
                  checked={editorSettings.formatOnSave}
                  onChange={(v) => onUpdateEditorSettings({ formatOnSave: v })}
                  label={t("settings.formatting.formatOnSave")}
                  description={t("settings.formatting.formatOnSaveDesc")}
                />

                <CheckboxItem
                  checked={editorSettings.formatOnPaste}
                  onChange={(v) => onUpdateEditorSettings({ formatOnPaste: v })}
                  label={t("settings.formatting.formatOnPaste")}
                  description={t("settings.formatting.formatOnPasteDesc")}
                />
              </div>

              <SectionHeader>{t("settings.terminalSection.title")}</SectionHeader>

              <TerminalFontSettings
                value={editorSettings.terminalFontFamily}
                onChange={(font) => onUpdateEditorSettings({ terminalFontFamily: font })}
              />

              <div className="flex items-center justify-between py-2">
                <label
                  htmlFor="editor-terminal-font-size"
                  className="text-sm font-medium text-foreground-secondary"
                >
                  {t("settings.terminalSection.fontSize")}
                </label>
                <div className="settings-number-stepper">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        terminalFontSize: Math.max(8, editorSettings.terminalFontSize - 1),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-r border-border"
                    aria-label={t("interface.decrease", {
                      setting: t("settings.terminalSection.fontSize"),
                    })}
                  >
                    <MinusIcon className="size-3" />
                  </button>
                  <input
                    id="editor-terminal-font-size"
                    type="number"
                    min="8"
                    max="32"
                    value={editorSettings.terminalFontSize}
                    onChange={(e) =>
                      onUpdateEditorSettings({
                        terminalFontSize: Math.min(
                          32,
                          Math.max(8, parseInt(e.target.value, 10) || 13),
                        ),
                      })
                    }
                    className="w-12 h-8 text-sm text-center border-0 focus:outline-none focus:ring-0 tabular-nums bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        terminalFontSize: Math.min(32, editorSettings.terminalFontSize + 1),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-l border-border"
                    aria-label={t("interface.increase", {
                      setting: t("settings.terminalSection.fontSize"),
                    })}
                  >
                    <PlusIcon className="size-3" />
                  </button>
                  <span className="text-xs text-muted-foreground px-2 border-l border-border">
                    px
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between py-2">
                <label
                  htmlFor="editor-terminal-line-height"
                  className="text-sm font-medium text-foreground-secondary"
                >
                  {t("settings.terminalSection.lineHeight")}
                </label>
                <div className="settings-number-stepper">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        terminalLineHeight: Math.max(
                          1.0,
                          Math.round((editorSettings.terminalLineHeight - 0.1) * 10) / 10,
                        ),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-r border-border"
                    aria-label={t("interface.decrease", {
                      setting: t("settings.terminalSection.lineHeight"),
                    })}
                  >
                    <MinusIcon className="size-3" />
                  </button>
                  <input
                    id="editor-terminal-line-height"
                    type="number"
                    min="1.0"
                    max="3.0"
                    step="0.1"
                    value={editorSettings.terminalLineHeight.toFixed(1)}
                    onChange={(e) =>
                      onUpdateEditorSettings({
                        terminalLineHeight: Math.min(
                          3.0,
                          Math.max(1.0, parseFloat(e.target.value) || 1.4),
                        ),
                      })
                    }
                    className="w-12 h-8 text-sm text-center border-0 focus:outline-none focus:ring-0 tabular-nums bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEditorSettings({
                        terminalLineHeight: Math.min(
                          3.0,
                          Math.round((editorSettings.terminalLineHeight + 0.1) * 10) / 10,
                        ),
                      })
                    }
                    className="w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:bg-accent-hover transition-colors border-l border-border"
                    aria-label={t("interface.increase", {
                      setting: t("settings.terminalSection.lineHeight"),
                    })}
                  >
                    <PlusIcon className="size-3" />
                  </button>
                </div>
              </div>

              <SelectField
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
                <div className="pl-4 border-l-2 border-border ml-1 py-2">
                  <div className="flex items-center justify-between gap-4">
                    <label
                      htmlFor="editor-terminal-shell-path"
                      className="text-sm font-medium text-foreground-secondary shrink-0"
                    >
                      {t("settings.terminalSection.shellPath")}
                    </label>
                    <input
                      id="editor-terminal-shell-path"
                      type="text"
                      value={editorSettings.terminalShellPath}
                      onChange={(e) =>
                        onUpdateEditorSettings({
                          terminalShellPath: e.target.value,
                        })
                      }
                      placeholder={t("settings.terminalSection.shellPathPlaceholder")}
                      className="settings-control w-64 font-mono"
                    />
                  </div>
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-4 border-t border-border">
            <button
              type="button"
              onClick={handleResetEditorSettings}
              className="text-xs text-muted hover:text-foreground transition-colors flex items-center gap-1.5 group"
            >
              <ArrowCounterClockwiseIcon className="size-3.5 group-hover:rotate-[-45deg] transition-transform" />
              {t("settings.resetDefaults")}
            </button>
            <Dialog.Close className="btn btn-primary">{t("settings.done")}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
