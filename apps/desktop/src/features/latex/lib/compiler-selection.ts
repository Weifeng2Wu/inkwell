import type { CompilationResult, LaTeXCompilersStatus } from "./types";

export type LatexEngine = "pdflatex" | "xelatex" | "lualatex";
type ReadSource = (relativePath: string) => Promise<string>;
interface Requirement {
  engines: LatexEngine[];
  reason: string;
}

const ENGINES: LatexEngine[] = ["pdflatex", "xelatex", "lualatex"];

function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      for (let index = 0; index < line.length; index++) {
        if (line[index] !== "%") continue;
        let escapes = 0;
        for (let previous = index - 1; previous >= 0 && line[previous] === "\\"; previous--) {
          escapes++;
        }
        if (escapes % 2 === 0) return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
}

function relativePath(path: string): string | null {
  if (/^(?:[a-z]:|[\\/])/i.test(path) || /[{}\\]/.test(path)) return null;
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
    } else if (segment && segment !== ".") {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

function sourceRequirements(source: string, path: string): Requirement[] {
  const requirements: Requirement[] = [];
  for (const [guard, engine] of [
    ["PDFTeX", "pdflatex"],
    ["XeTeX", "xelatex"],
    ["LuaTeX", "lualatex"],
  ] as const) {
    if (new RegExp(`\\\\Require${guard}\\b`).test(source)) {
      requirements.push({ engines: [engine], reason: `${path}: \\Require${guard}` });
    }
  }
  const packages =
    /\\(?:usepackage|RequirePackage(?:WithOptions)?|documentclass|LoadClass(?:WithOptions)?)(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g;
  for (const match of source.matchAll(packages)) {
    for (const name of (match[1] ?? "").split(",").map((value) => value.trim())) {
      if (["fontspec", "unicode-math"].includes(name)) {
        requirements.push({ engines: ["xelatex", "lualatex"], reason: `${path}: ${name}` });
      } else if (["xeCJK", "xunicode", "xltxtra"].includes(name)) {
        requirements.push({ engines: ["xelatex"], reason: `${path}: ${name}` });
      } else if (["luacode", "luatexja", "luatexja-fontspec"].includes(name)) {
        requirements.push({ engines: ["lualatex"], reason: `${path}: ${name}` });
      }
    }
  }
  return requirements;
}

export function engineRequirementsFromLog(log: string): Requirement[] {
  log = log.replace(/\((?:fontspec|unicode-math)\)/g, " ").replace(/\s+/g, " ");
  if (/pdfTeX is required to compile this document/i.test(log)) {
    return [{ engines: ["pdflatex"], reason: "compiler log requires pdfTeX" }];
  }
  if (/XeTeX is required to compile this document/i.test(log)) {
    return [{ engines: ["xelatex"], reason: "compiler log requires XeTeX" }];
  }
  if (/LuaTeX is required to compile this document/i.test(log)) {
    return [{ engines: ["lualatex"], reason: "compiler log requires LuaTeX" }];
  }
  if (
    /(?:fontspec|unicode-math)[\s\S]{0,300}requires? (?:either )?Xe(?:TeX|LaTeX) (?:or|and) Lua(?:TeX|LaTeX)/i.test(
      log,
    )
  ) {
    return [{ engines: ["xelatex", "lualatex"], reason: "compiler log requires a Unicode engine" }];
  }
  return [];
}

export async function selectAutoCompiler({
  status,
  mainFile,
  readSource,
  runtimeLog = "",
  excluded = [],
}: {
  status: LaTeXCompilersStatus | null;
  mainFile: string;
  readSource: ReadSource;
  runtimeLog?: string;
  excluded?: LatexEngine[];
}): Promise<{ engine: LatexEngine; reason: string }> {
  if (!status)
    throw new Error("Could not detect installed LaTeX compilers. Refresh compiler detection.");
  const root = relativePath(mainFile.replace(/\\/g, "/"));
  if (!root) throw new Error("Main file must be inside the project directory.");
  const requirements: Requirement[] = [];
  const visited = new Set<string>();
  const missing = new Set<string>();
  const pending: { path: string; required: boolean; depth: number; fallback?: string }[] = [
    { path: root, required: true, depth: 0 },
  ];
  let preferred: LatexEngine | undefined;
  let characters = 0;

  while (pending.length) {
    const entry = pending.shift();
    if (!entry) continue;
    if (visited.has(entry.path)) {
      if (missing.has(entry.path) && entry.fallback) {
        pending.push({ path: entry.fallback, required: false, depth: entry.depth });
      }
      continue;
    }
    if (visited.size >= 128 || entry.depth > 16) {
      throw new Error("Auto compiler inspection limit exceeded. Select a compiler explicitly.");
    }
    visited.add(entry.path);
    let raw: string;
    try {
      raw = await readSource(entry.path);
    } catch (error) {
      if (entry.required) throw new Error(`Cannot inspect ${entry.path}: ${String(error)}`);
      missing.add(entry.path);
      if (entry.fallback) {
        pending.unshift({ path: entry.fallback, required: false, depth: entry.depth });
      }
      continue;
    }
    characters += raw.length;
    if (characters > 2_000_000) {
      throw new Error(
        "Auto compiler inspection size limit exceeded. Select a compiler explicitly.",
      );
    }
    if (entry.path === root) {
      const magic = /^\s*%\s*!\s*TeX\s+(?:TS-)?program\s*=\s*(\S+)/gim;
      for (const match of raw.matchAll(magic)) {
        const program = match[1]?.toLowerCase();
        if (ENGINES.includes(program as LatexEngine)) {
          preferred = program as LatexEngine;
          requirements.push({
            engines: [preferred],
            reason: `${root}: % !TeX program = ${program}`,
          });
        } else if (program !== "latexmk") {
          throw new Error(`Unsupported TeX program declaration: ${program}`);
        }
      }
    }
    const source = stripComments(raw).replace(/\\endinput\b[\s\S]*$/, "");
    requirements.push(...sourceRequirements(source, entry.path));
    const references =
      /\\(documentclass|LoadClass|LoadClassWithOptions|usepackage|RequirePackage|RequirePackageWithOptions|input|include|subfile)(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g;
    for (const match of source.matchAll(references)) {
      const command = match[1] ?? "";
      const extension = /[Cc]lass/.test(command)
        ? ".cls"
        : /[Pp]ackage/.test(command)
          ? ".sty"
          : ".tex";
      for (const reference of (match[2] ?? "").split(",")) {
        const name = reference.trim();
        if (!name || /^(?:[a-z]:|[\\/])/i.test(name) || /[{}\\]/.test(name)) continue;
        const target = name.endsWith(extension) ? name : `${name}${extension}`;
        const directory = entry.path.slice(0, entry.path.lastIndexOf("/") + 1);
        const candidates = [...new Set([target, `${directory}${target}`])]
          .map(relativePath)
          .filter((path): path is string => Boolean(path));
        const path = candidates[0];
        if (path)
          pending.push({ path, fallback: candidates[1], required: false, depth: entry.depth + 1 });
      }
    }
  }

  requirements.push(...engineRequirementsFromLog(runtimeLog));
  const compatible = ENGINES.filter((engine) =>
    requirements.every((requirement) => requirement.engines.includes(engine)),
  );
  const evidence = requirements.map((requirement) => requirement.reason).join("; ");
  if (!compatible.length) throw new Error(`Conflicting LaTeX engine requirements: ${evidence}`);
  const order = preferred
    ? [preferred, ...ENGINES.filter((engine) => engine !== preferred)]
    : ENGINES;
  const engine = order.find(
    (candidate) =>
      compatible.includes(candidate) &&
      status[candidate].available &&
      !excluded.includes(candidate),
  );
  if (!engine) {
    throw new Error(
      `No available compatible LaTeX engine. Required: ${compatible.join(" or ")}. ${evidence || "Install a LaTeX engine."}`,
    );
  }
  return {
    engine,
    reason: evidence || "No explicit engine requirements; prefer pdfLaTeX for standard LaTeX.",
  };
}

export async function compileWithAutoFallback({
  status,
  mainFile,
  readSource,
  run,
  readLog,
  report,
  isCancelled,
}: {
  status: LaTeXCompilersStatus | null;
  mainFile: string;
  readSource: ReadSource;
  run: (engine: LatexEngine) => Promise<CompilationResult>;
  readLog: () => Promise<string>;
  report: (message: string) => void;
  isCancelled: () => boolean;
}): Promise<CompilationResult> {
  const excluded: LatexEngine[] = [];
  let runtimeLog = "";
  while (excluded.length < ENGINES.length) {
    const { engine, reason } = await selectAutoCompiler({
      status,
      mainFile,
      readSource,
      runtimeLog,
      excluded,
    });
    if (isCancelled()) throw new Error("Compilation cancelled.");
    report(`[Auto] ${engine}: ${reason}`);
    const result = await run(engine);
    if (result.success || isCancelled()) return result;
    excluded.push(engine);
    try {
      runtimeLog = await readLog();
    } catch {
      return result;
    }
    if (isCancelled() || !engineRequirementsFromLog(runtimeLog).length) return result;
    report(
      `[Auto] ${engine} failed because of an engine mismatch; checking compatible alternatives.`,
    );
  }
  throw new Error("No compatible LaTeX engine remains after automatic retries.");
}
