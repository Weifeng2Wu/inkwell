"use client";

import { FilePlusIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { useId, useRef, useState } from "react";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { useI18n } from "@/features/i18n";
import { EXTERNAL_AGENTS } from "../lib/external-agent-catalog";
import {
  formatReviewPrompt,
  MAX_REQUIREMENT_BYTES,
  parseFormatRules,
  type RequirementSource,
} from "../lib/format-review";
import { REQUIREMENT_ACCEPT, readRequirementFiles } from "../lib/requirement-files";
import type { AcademicAgentController } from "../lib/use-academic-agent";
import type { AgentSelectionController } from "../lib/use-agent-selection";
import type { ExternalAgentController } from "../lib/use-external-agent";
import { AgentLogo } from "./agent-logo";

type Draft = {
  name: string;
  rules: ReturnType<typeof parseFormatRules>;
  sources: RequirementSource[];
  instructions: string;
};

export function FormatSkillBuilder({
  agent,
  selection,
  externalAgent,
}: {
  agent: AcademicAgentController;
  selection?: AgentSelectionController;
  externalAgent?: ExternalAgentController;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [sources, setSources] = useState<RequirementSource[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const pending = useRef(false);
  const upload = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const textId = useId();
  const selected = selection?.selected ?? "builtin";
  const external = selected !== "builtin";
  const runner = external ? externalAgent : agent;
  const agentName = external
    ? EXTERNAL_AGENTS.find((entry) => entry.id === selected)?.name
    : "Inkwell Agent";
  const activeScope = useRef("");
  activeScope.current = JSON.stringify([agent.directory, selected]);
  const disabled =
    busy ||
    Boolean(runner?.working) ||
    !agent.directory ||
    !agent.configReady ||
    !runner ||
    Boolean(selection && !selection.ready) ||
    (external && !externalAgent?.connected);

  async function attach(files: File[]) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const added = await readRequirementFiles(
        files,
        {
          limit: t("formatSkill.fileLimit"),
          unsupported: t("formatSkill.unsupported"),
          unreadable: t("formatSkill.unreadable"),
          emptyPdf: t("formatSkill.emptyPdf"),
          tooLong: t("formatSkill.tooLong"),
          layoutMissing: t("layoutParser.missing"),
        },
        (names) => setSkipped((current) => [...current, ...names]),
      );
      const merged = [...sources, ...added];
      if (merged.length > 80) throw new Error(t("formatSkill.tooLong"));
      if (
        new TextEncoder().encode(merged.map((source) => source.text).join("\n")).length >
        MAX_REQUIREMENT_BYTES
      )
        throw new Error(t("formatSkill.tooLong"));
      setSources(merged.map((source, index) => ({ ...source, id: `S${index + 1}` })));
      setDraft(null);
    } catch (caught) {
      setError(String(caught));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function generate() {
    if (disabled || pending.current || !runner) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSuccess(false);
    setDraft(null);
    const scope = activeScope.current;
    try {
      const inputs = sources.map((source, index) => ({ ...source, id: `S${index + 1}` }));
      if (text.trim())
        inputs.push({
          id: `S${inputs.length + 1}`,
          name: t("formatSkill.pasted"),
          text: text.trim(),
        });
      if (!name.trim() || !inputs.length) throw new Error(t("formatSkill.required"));
      if (
        new TextEncoder().encode(inputs.map((source) => source.text).join("\n")).length >
        MAX_REQUIREMENT_BYTES
      )
        throw new Error(t("formatSkill.tooLong"));
      const response = await runner.generateFormatSkill(formatReviewPrompt(name.trim(), inputs));
      if (activeScope.current !== scope) return;
      let rules: ReturnType<typeof parseFormatRules>;
      try {
        rules = parseFormatRules(response, inputs);
      } catch {
        throw new Error(t("formatSkill.invalidOutput"));
      }
      const request = { name: name.trim(), rules, sources: inputs };
      const preview = await invoke<{ instructions: string }>("agent_shared_skills", {
        request: { ...request, type: "format_skill_preview" },
      });
      if (activeScope.current === scope)
        setDraft({ ...request, instructions: preview.instructions });
    } catch (caught) {
      if (activeScope.current === scope) setError(String(caught));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function save() {
    if (!draft || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await invoke("agent_shared_skills", {
        request: {
          name: draft.name,
          rules: draft.rules,
          sources: draft.sources,
          type: "format_skill_create",
        },
      });
      await agent.refreshSkills();
      setDraft(null);
      setSuccess(true);
    } catch (caught) {
      setError(String(caught));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="mb-5 space-y-4 rounded-lg border border-border bg-background p-4"
      aria-label={t("formatSkill.title")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("formatSkill.title")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t("formatSkill.scope")}</p>
        </div>
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label={open ? t("common.close") : t("formatSkill.create")}
          title={t("formatSkill.create")}
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <XIcon className="size-4" aria-hidden="true" />
          ) : (
            <FilePlusIcon className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {open && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted">
            {external && <AgentLogo id={selected} className="size-5" />}
            <span>{t("formatSkill.usingAgent", { name: agentName ?? selected })}</span>
          </div>
          <p className="text-xs leading-relaxed text-muted">{t("formatSkill.privacy")}</p>
          <div className="space-y-1.5">
            <label htmlFor={titleId} className="text-xs font-medium">
              {t("formatSkill.name")}
            </label>
            <input
              id={titleId}
              className="settings-control w-full"
              value={name}
              maxLength={80}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
                setDraft(null);
                setSuccess(false);
              }}
              placeholder={t("formatSkill.namePlaceholder")}
            />
          </div>
          <input
            ref={upload}
            type="file"
            multiple
            accept={REQUIREMENT_ACCEPT}
            className="hidden"
            aria-label={t("formatSkill.upload")}
            onChange={(event) => {
              void attach(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => upload.current?.click()}
          >
            <FilePlusIcon className="size-4" aria-hidden="true" />
            {t("formatSkill.upload")}
          </button>
          <p className="text-xs text-muted">{t("formatSkill.formats")}</p>
          {skipped.length > 0 && (
            <details className="rounded-md border border-border p-3 text-xs text-warning">
              <summary className="cursor-pointer">
                {t("formatSkill.skipped", { count: skipped.length })}
              </summary>
              <p className="mt-2">{t("formatSkill.skippedHint")}</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
                {Array.from(new Set(skipped)).map((name) => (
                  <li key={name} className="break-all">
                    {name}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {sources.length > 0 && (
            <ul className="space-y-1">
              {sources.map((source) => (
                <li
                  key={source.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-surface-secondary px-3 py-1 text-xs"
                >
                  <span className="truncate">{source.name}</span>
                  <button
                    type="button"
                    className="toolbar-icon-button"
                    disabled={busy}
                    aria-label={t("formatSkill.remove", { name: source.name })}
                    onClick={() => {
                      setSources(sources.filter((entry) => entry !== source));
                      setDraft(null);
                    }}
                  >
                    <XIcon className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1.5">
            <label htmlFor={textId} className="text-xs font-medium">
              {t("formatSkill.paste")}
            </label>
            <textarea
              id={textId}
              className="settings-control min-h-36 w-full resize-none py-2"
              value={text}
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value);
                setDraft(null);
                setSuccess(false);
              }}
            />
          </div>
          {!agent.directory && (
            <p className="text-xs text-warning">{t("formatSkill.openProject")}</p>
          )}
          {external && !externalAgent?.connected && (
            <p className="text-xs text-warning">{t("formatSkill.connectFirst")}</p>
          )}
          {externalAgent?.authentication && external && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-xs">{t("formatSkill.authorize")}</p>
              {externalAgent.authentication.methods.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => externalAgent.authentication?.choose(method.id)}
                >
                  {method.name}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="text-xs text-success">
              {t("formatSkill.saved")}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={disabled || !name.trim() || (!sources.length && !text.trim())}
            onClick={() => void generate()}
          >
            <SparkleIcon className="size-4" aria-hidden="true" />
            {busy ? t("formatSkill.working") : t("formatSkill.generate")}
          </button>
          {draft && (
            <div className="space-y-4 border-t border-border pt-4">
              <h4 className="text-sm font-semibold">
                {t("formatSkill.preview", { count: draft.rules.length })}
              </h4>
              <p className="text-xs text-muted">{t("formatSkill.reviewHint")}</p>
              <div className="max-h-80 space-y-3 overflow-y-auto">
                {draft.rules.map((rule, index) => (
                  <article
                    key={`${rule.source}-${rule.requirement}-${rule.evidence}`}
                    className="rounded-md border border-border p-3 text-xs"
                  >
                    <p className="font-medium">
                      R{index + 1} ·{" "}
                      {t(
                        rule.severity === "required"
                          ? "formatSkill.requiredRule"
                          : "formatSkill.recommended",
                      )}{" "}
                      · {rule.requirement}
                    </p>
                    <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-2 text-muted">
                      {rule.source} —{" "}
                      {draft.sources.find((source) => source.id === rule.source)?.name}:{" "}
                      {rule.evidence}
                    </blockquote>
                    <p className="mt-2">{rule.check}</p>
                  </article>
                ))}
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-muted">SKILL.md</summary>
                <div className="mt-3 max-h-64 overflow-auto">
                  <MarkdownContent text={draft.instructions} />
                </div>
              </details>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => void save()}
              >
                {t("formatSkill.save")}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
