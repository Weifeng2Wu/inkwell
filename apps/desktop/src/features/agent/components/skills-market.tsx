"use client";

import {
  ArrowSquareOutIcon,
  CircleNotchIcon,
  GithubLogoIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-shell";
import { useId, useMemo, useRef, useState } from "react";
import { ContextMenu } from "@/components/ui/context-menu";
import { InputDialog } from "@/components/ui/input-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { errorMessage, useI18n } from "@/features/i18n";
import { filterSkills, type SkillFilter } from "../lib/filter-skills";
import { formatStars } from "../lib/format-stars";
import { localizeSkill } from "../lib/skill-presentation";
import type { AcademicAgentController } from "../lib/use-academic-agent";

export function SkillsMarket({ agent }: { agent: AcademicAgentController }) {
  const { t, locale } = useI18n();
  const { market, working, changeSkill, uploadSkill, importGitHubSkill } = agent;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [importMenu, setImportMenu] = useState<{ x: number; y: number } | null>(null);
  const [githubDialog, setGithubDialog] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);
  const order = useRef<string[]>([]);
  const fieldId = useId();
  const orderedMarket = useMemo(() => {
    for (const skill of market) if (!order.current.includes(skill.id)) order.current.push(skill.id);
    return [...market].sort(
      (first, second) => order.current.indexOf(first.id) - order.current.indexOf(second.id),
    );
  }, [market]);
  const filtered = filterSkills(orderedMarket, query, filter, t).map((skill) =>
    localizeSkill(skill, t),
  );
  async function toggleSkill(skillId: string, install: boolean) {
    setPendingSkill(skillId);
    try {
      await changeSkill(skillId, install);
    } finally {
      setPendingSkill(null);
    }
  }
  return (
    <section className="space-y-3" aria-label={t("agent.skills.title")}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t("agent.skills.title")}</h3>
        <button
          type="button"
          className="btn btn-sm"
          aria-haspopup="menu"
          aria-expanded={importMenu !== null}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setImportMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
          disabled={working}
        >
          {t("agent.skills.import")}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t("agent.skills.scopeHint")}</p>
      {importMenu && (
        <ContextMenu
          x={importMenu.x}
          y={importMenu.y}
          items={[
            { label: t("agent.skills.importFile"), onClick: () => void uploadSkill(false) },
            { label: t("agent.skills.importFolder"), onClick: () => void uploadSkill(true) },
            { label: t("agent.skills.importZip"), onClick: () => void uploadSkill("zip") },
            { label: t("agent.skills.importGitHub"), onClick: () => setGithubDialog(true) },
          ]}
          onClose={() => setImportMenu(null)}
        />
      )}
      {githubDialog && (
        <InputDialog
          title={t("agent.skills.githubTitle")}
          placeholder="https://github.com/owner/repository"
          confirmLabel={t("agent.skills.import")}
          validator={(value) => {
            try {
              const url = new URL(value.trim());
              return url.protocol === "https:" &&
                url.hostname === "github.com" &&
                !url.port &&
                !url.username &&
                !url.password &&
                /^\/[^/]+\/[^/]+(?:\/tree\/[^/]+(?:\/.*)?)?\/?$/.test(url.pathname)
                ? null
                : t("agent.skills.invalidGitHubLink");
            } catch {
              return t("agent.skills.invalidGitHubLink");
            }
          }}
          onConfirm={(value) => {
            setGithubDialog(false);
            void importGitHubSkill(value);
          }}
          onCancel={() => setGithubDialog(false)}
        />
      )}
      {previewError && (
        <p role="alert" className="text-xs text-error">
          {previewError}
        </p>
      )}
      <label className="sr-only" htmlFor={fieldId}>
        {t("agent.skills.search")}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={fieldId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("agent.skills.search")}
          className="settings-control min-w-0 flex-1"
        />
        <select
          aria-label={t("agent.skills.filter")}
          value={filter}
          onChange={(event) => setFilter(event.target.value === "installed" ? "installed" : "all")}
          className="settings-control"
        >
          <option value="all">{t("agent.skills.all")}</option>
          <option value="installed">{t("agent.skills.installed")}</option>
        </select>
      </div>
      {filtered.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("agent.skills.empty")}</p>
      )}
      <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((skill) => (
          <article
            key={skill.id}
            className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-2.5 transition-colors duration-200 motion-reduce:transition-none"
          >
            <div className="flex items-start justify-between gap-2">
              <h4 className="min-w-0 break-words text-xs font-medium">{skill.name}</h4>
              {skill.installed && (
                <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[11px] text-success">
                  {t("agent.skills.installed")}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <p
                id={`${fieldId}-${skill.id}-description`}
                className={`whitespace-pre-wrap break-words text-xs text-muted-foreground ${expanded.has(skill.id) ? "" : "line-clamp-2"}`}
              >
                {skill.description}
              </p>
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                aria-expanded={expanded.has(skill.id)}
                aria-controls={`${fieldId}-${skill.id}-description`}
                onClick={() =>
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(skill.id)) next.delete(skill.id);
                    else next.add(skill.id);
                    return next;
                  })
                }
              >
                {t(
                  expanded.has(skill.id)
                    ? "skillCatalog.hideDescription"
                    : "skillCatalog.showDescription",
                )}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {skill.source.startsWith("https://github.com/") ? (
                <Tooltip label={skill.source.replace("https://", "")} side="top">
                  <a
                    href={skill.source}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-surface px-2 py-1 font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    onClick={(event) => {
                      event.preventDefault();
                      void open(skill.source).catch((error: unknown) =>
                        setPreviewError(errorMessage(error, t)),
                      );
                    }}
                  >
                    <GithubLogoIcon size={13} weight="fill" aria-hidden="true" />
                    GitHub
                    <ArrowSquareOutIcon size={11} aria-hidden="true" />
                  </a>
                </Tooltip>
              ) : (
                skill.source
              )}
              {skill.stars !== undefined && (
                <Tooltip
                  label={t("agent.skills.stars", { count: formatStars(skill.stars, locale) })}
                  side="top"
                >
                  <span
                    role="img"
                    aria-label={t("agent.skills.stars", {
                      count: formatStars(skill.stars, locale),
                    })}
                    className="inline-flex items-center gap-1"
                  >
                    <StarIcon size={12} aria-hidden="true" />
                    <span aria-hidden="true">{formatStars(skill.stars, locale)}</span>
                  </span>
                </Tooltip>
              )}
            </div>
            {!skill.managed && <p className="text-xs text-warning">{t("agent.skills.conflict")}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn btn-sm ml-auto inline-flex min-w-20 items-center justify-center gap-1.5 transition-transform duration-150 active:scale-95 motion-reduce:transition-none"
                disabled={working || !skill.managed || pendingSkill !== null}
                aria-busy={pendingSkill === skill.id}
                onClick={() => void toggleSkill(skill.id, !skill.installed)}
              >
                {pendingSkill === skill.id ? (
                  <>
                    <CircleNotchIcon className="animate-spin" size={12} aria-hidden="true" />
                    {skill.installed ? t("agent.skills.removing") : t("agent.skills.installing")}
                  </>
                ) : skill.installed ? (
                  t("agent.skills.remove")
                ) : (
                  t("agent.skills.install")
                )}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
