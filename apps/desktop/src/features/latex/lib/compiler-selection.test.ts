import { describe, expect, it, vi } from "vitest";
import { compileWithAutoFallback, selectAutoCompiler } from "./compiler-selection";
import type { CompilationResult, LaTeXCompilersStatus } from "./types";

function installed(...engines: string[]): LaTeXCompilersStatus {
  const info = (name: string) => ({
    name,
    available: engines.includes(name),
    path: null,
    version: null,
  });
  return {
    pdflatex: info("pdflatex"),
    xelatex: info("xelatex"),
    lualatex: info("lualatex"),
    latexmk: info("latexmk"),
  };
}

function reader(files: Record<string, string>) {
  return vi.fn(async (path: string) => {
    const source = files[path];
    if (source === undefined) throw new Error("File not found");
    return source;
  });
}

const allEngines = installed("pdflatex", "xelatex", "lualatex", "latexmk");

function select(files: Record<string, string>, status = allEngines) {
  return selectAutoCompiler({ status, mainFile: "paper.tex", readSource: reader(files) });
}

describe("Auto compiler selection", () => {
  it("prefers pdfLaTeX for ordinary documents", async () => {
    await expect(select({ "paper.tex": "\\documentclass{article}" })).resolves.toMatchObject({
      engine: "pdflatex",
    });
  });

  it("honors the AAAI template's engine guard instead of choosing XeLaTeX", async () => {
    const result = await select({
      "paper.tex": "\\documentclass{article}\n\\usepackage{aaai2027}",
      "aaai2027.sty": "\\RequirePackage{iftex}\n\\RequirePDFTeX",
    });
    expect(result.engine).toBe("pdflatex");
    expect(result.reason).toContain("aaai2027.sty");
  });

  it.each(["program", "TS-program"])("honors %% !TeX %s declarations", async (declaration) => {
    await expect(
      select({ "paper.tex": `% !TeX ${declaration} = lualatex\n\\documentclass{article}` }),
    ).resolves.toMatchObject({ engine: "lualatex" });
  });

  it.each([
    ["\\usepackage{fontspec}", "xelatex"],
    ["\\RequirePackage[option]{unicode-math}", "xelatex"],
    ["\\usepackage{amsmath,xeCJK}", "xelatex"],
    ["\\usepackage{luatexja}", "lualatex"],
    ["\\RequireXeTeX", "xelatex"],
    ["\\RequireLuaTeX", "lualatex"],
  ])("recognizes %s", async (source, engine) => {
    await expect(select({ "paper.tex": source })).resolves.toMatchObject({ engine });
  });

  it("uses LuaLaTeX for fontspec when XeLaTeX is unavailable", async () => {
    await expect(
      select({ "paper.tex": "\\usepackage{fontspec}" }, installed("pdflatex", "lualatex")),
    ).resolves.toMatchObject({ engine: "lualatex" });
  });

  it("traverses local classes, styles, and input files without looping", async () => {
    await expect(
      select({
        "paper.tex": "\\documentclass{custom}",
        "custom.cls": "\\RequirePackageWithOptions{local}",
        "local.sty": "\\input{sections/setup}",
        "sections/setup.tex": "\\input{paper}\n\\RequireLuaTeX",
      }),
    ).resolves.toMatchObject({ engine: "lualatex" });
  });

  it("ignores comments and content after endinput", async () => {
    await expect(
      select({
        "paper.tex": "% \\RequireXeTeX\n\\usepackage{custom}",
        "custom.sty": "\\endinput\n\\RequireLuaTeX",
      }),
    ).resolves.toMatchObject({ engine: "pdflatex" });
  });

  it("does not inspect unrelated templates", async () => {
    await expect(
      select({ "paper.tex": "Hello", "unused.sty": "\\RequireXeTeX" }),
    ).resolves.toMatchObject({ engine: "pdflatex" });
  });

  it("rejects conflicting declarations and template constraints", async () => {
    await expect(
      select({ "paper.tex": "% !TeX program = xelatex\n\\RequirePDFTeX" }),
    ).rejects.toThrow("Conflicting LaTeX engine requirements");
  });

  it("does not substitute an incompatible installed engine", async () => {
    await expect(
      select({ "paper.tex": "\\RequirePDFTeX" }, installed("xelatex", "latexmk")),
    ).rejects.toThrow("No available compatible LaTeX engine");
  });

  it("does not mistake latexmk for an installed TeX engine", async () => {
    await expect(
      select({ "paper.tex": "% !TeX program = latexmk" }, installed("latexmk")),
    ).rejects.toThrow("No available compatible LaTeX engine");
  });

  it("reports unreadable main files instead of guessing", async () => {
    await expect(select({})).rejects.toThrow("Cannot inspect paper.tex");
  });

  it("does not request files outside the project", async () => {
    const readSource = reader({ "paper.tex": "\\input{../outside}\n\\input{/absolute}" });
    await selectAutoCompiler({ status: allEngines, mainFile: "paper.tex", readSource });
    expect(readSource.mock.calls.map(([path]) => path)).toEqual(["paper.tex"]);
  });

  it("normalizes Windows main-file separators and resolves nested inputs", async () => {
    const result = await selectAutoCompiler({
      status: allEngines,
      mainFile: "src\\paper.tex",
      readSource: reader({ "src/paper.tex": "\\input{setup}", "src/setup.tex": "\\RequireLuaTeX" }),
    });
    expect(result.engine).toBe("lualatex");
  });

  it("reports detection failures", async () => {
    await expect(
      selectAutoCompiler({ status: null, mainFile: "paper.tex", readSource: reader({}) }),
    ).rejects.toThrow("Could not detect");
  });

  it("does not inspect a shadowed nested template", async () => {
    await expect(
      select({
        "paper.tex": "\\input{src/body}",
        "src/body.tex": "\\usepackage{custom}",
        "custom.sty": "\\RequirePDFTeX",
        "src/custom.sty": "\\RequireXeTeX",
      }),
    ).resolves.toMatchObject({ engine: "pdflatex" });
  });

  it("resolves same-named relative dependencies in different directories", async () => {
    await expect(
      select({
        "paper.tex": "\\input{first/body}\\input{second/body}",
        "first/body.tex": "\\input{setup}",
        "second/body.tex": "\\input{setup}",
        "first/setup.tex": "Hello",
        "second/setup.tex": "\\RequireLuaTeX",
      }),
    ).resolves.toMatchObject({ engine: "lualatex" });
  });
});

describe("Auto compiler fallback", () => {
  const failure: CompilationResult = {
    success: false,
    exit_code: 1,
    pdf_path: null,
    error: "PDF was not generated",
  };
  const success: CompilationResult = {
    success: true,
    exit_code: 0,
    pdf_path: "paper.pdf",
    error: null,
  };

  function options(log: string) {
    return {
      status: allEngines,
      mainFile: "paper.tex",
      readSource: reader({ "paper.tex": "\\documentclass{article}" }),
      run: vi.fn().mockResolvedValueOnce(failure).mockResolvedValue(success),
      readLog: vi.fn().mockResolvedValue(log),
      report: vi.fn(),
      isCancelled: () => false,
    };
  }

  it("selects pdfLaTeX when the runtime log rejects a previous XeLaTeX attempt", async () => {
    await expect(
      selectAutoCompiler({
        status: allEngines,
        mainFile: "paper.tex",
        readSource: reader({ "paper.tex": "\\documentclass{article}" }),
        excluded: ["xelatex"],
        runtimeLog: "pdfTeX is required to compile this document.",
      }),
    ).resolves.toMatchObject({ engine: "pdflatex" });
  });

  it("retries Unicode engines for fontspec errors", async () => {
    const config = options(
      "Fatal Package fontspec Error: The fontspec package requires either XeTeX or LuaTeX.",
    );
    await expect(compileWithAutoFallback(config)).resolves.toEqual(success);
    expect(config.run.mock.calls.map(([engine]) => engine)).toEqual(["pdflatex", "xelatex"]);
  });

  it("recognizes wrapped fontspec errors with package prefixes", async () => {
    const config = options("The fontspec package requires either XeTeX or\n(fontspec) LuaTeX.");
    await expect(compileWithAutoFallback(config)).resolves.toEqual(success);
    expect(config.run.mock.calls.map(([engine]) => engine)).toEqual(["pdflatex", "xelatex"]);
  });

  it("tries each compatible engine at most once", async () => {
    const config = options("The fontspec package requires either XeTeX or LuaTeX.");
    config.run.mockReset().mockResolvedValue(failure);
    await expect(compileWithAutoFallback(config)).rejects.toThrow(
      "No compatible LaTeX engine remains",
    );
    expect(config.run.mock.calls.map(([engine]) => engine)).toEqual([
      "pdflatex",
      "xelatex",
      "lualatex",
    ]);
  });

  it.each([
    "Undefined control sequence",
    "File `missing.sty' not found",
    "Emergency stop.",
  ])("does not retry ordinary errors: %s", async (log) => {
    const config = options(log);
    await expect(compileWithAutoFallback(config)).resolves.toEqual(failure);
    expect(config.run).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the required engine is unavailable", async () => {
    const config = options("XeTeX is required to compile this document.");
    config.status = installed("pdflatex");
    await expect(compileWithAutoFallback(config)).rejects.toThrow("No available compatible");
    expect(config.run).toHaveBeenCalledTimes(1);
  });

  it("does not retry after cancellation", async () => {
    const config = options("XeTeX is required to compile this document.");
    config.isCancelled = () => config.run.mock.calls.length > 0;
    await expect(compileWithAutoFallback(config)).resolves.toEqual(failure);
    expect(config.run).toHaveBeenCalledTimes(1);
  });

  it("does not read a stale log after successful compilation", async () => {
    const config = options("XeTeX is required to compile this document.");
    config.run.mockReset().mockResolvedValue(success);
    await expect(compileWithAutoFallback(config)).resolves.toEqual(success);
    expect(config.readLog).not.toHaveBeenCalled();
  });
});
