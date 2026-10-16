"use client";

import { StarIcon } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-shell";
import { useId, useState } from "react";
import { ContextMenu } from "@/components/ui/context-menu";
import { InputDialog } from "@/components/ui/input-dialog";
import { useI18n } from "@/features/i18n";
import { filterSkills, type SkillFilter } from "../lib/filter-skills";
import { formatStars } from "../lib/format-stars";
import type { AcademicAgentController } from "../lib/use-academic-agent";

export function SkillsMarket({ agent }: { agent: AcademicAgentController }) {
  const { t } = useI18n();
  const {
    labels,
    market,
    working,
    changeSkill,
    uploadSkill,
    importGitHubSkill,
    config,
    setConfig,
    directory,
    configReady,
  } = agent;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [importMenu, setImportMenu] = useState<{ x: number; y: number } | null>(null);
  const [githubDialog, setGithubDialog] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fieldId = useId();
  const filtered = filterSkills(market, query, filter);
  return (
    <section className="space-y-3" aria-label={labels.skills}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{labels.skills}</h3>
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
          {labels.importSkills}
        </button>
      </div>
      {importMenu && (
        <ContextMenu
          x={importMenu.x}
          y={importMenu.y}
          items={[
            { label: labels.uploadSkill, onClick: () => void uploadSkill(false) },
            { label: labels.uploadFolder, onClick: () => void uploadSkill(true) },
            { label: labels.uploadZip, onClick: () => void uploadSkill("zip") },
            { label: labels.importGitHub, onClick: () => setGithubDialog(true) },
          ]}
          onClose={() => setImportMenu(null)}
        />
      )}
      {githubDialog && (
        <InputDialog
          title={labels.importGitHub}
          placeholder="https://github.com/owner/repository"
          confirmLabel={labels.importSkills}
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
                : labels.invalidGitHubLink;
            } catch {
              return labels.invalidGitHubLink;
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
        {labels.marketSearch}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={fieldId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.marketSearch}
          className="settings-control min-w-0 flex-1"
        />
        <select
          aria-label={labels.skillFilter}
          value={filter}
          onChange={(event) => setFilter(event.target.value === "installed" ? "installed" : "all")}
          className="settings-control"
        >
          <option value="all">{labels.allSkills}</option>
          <option value="installed">{labels.installed}</option>
        </select>
      </div>
      {filtered.length === 0 && (
        <p className="text-xs text-muted-foreground">{labels.marketEmpty}</p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((skill) => (
          <article
            key={skill.id}
            className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <h4 className="min-w-0 truncate text-xs font-medium" title={skill.name}>
                {skill.name}
              </h4>
              {skill.installed && (
                <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                  {labels.installed}
                </span>
              )}
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {skill.source.startsWith("https://github.com/") ? (
                <a
                  href={skill.source}
                  className="text-accent hover:underline"
                  onClick={(event) => {
                    event.preventDefault();
                    void open(skill.source).catch((error: unknown) =>
                      setPreviewError(String(error)),
                    );
                  }}
                >
                  GitHub
                </a>
              ) : (
                skill.source
              )}
              {skill.stars !== undefined && (
                <span className="inline-flex items-center gap-1" title={t("interface.stars")}>
                  <StarIcon size={12} aria-hidden="true" />
                  <span className="sr-only">GitHub stars: </span>
                  {formatStars(skill.stars)}
                </span>
              )}
            </div>
            {!skill.managed && <p className="text-xs text-warning">{labels.marketConflict}</p>}
            <div className="flex items-center justify-between gap-2">
              {skill.installed && (
                <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={config.skillIds.includes(skill.id)}
                    aria-label={`${labels.enableForProject}: ${skill.name}`}
                    title={directory ? undefined : labels.openProject}
                    checked={config.skillIds.includes(skill.id)}
                    disabled={working || !directory || !configReady}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        skillIds: event.target.checked
                          ? [...new Set([...config.skillIds, skill.id])]
                          : config.skillIds.filter((identifier) => identifier !== skill.id),
                      })
                    }
                  />
                  {labels.enableForProject}
                </label>
              )}
              <button
                type="button"
                className="btn btn-sm ml-auto"
                disabled={working || !skill.managed}
                onClick={() => changeSkill(skill.id, !skill.installed)}
              >
                {skill.installed ? labels.remove : labels.install}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
