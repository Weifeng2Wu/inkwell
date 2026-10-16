import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CompilationResult,
  CompileOutputEvent,
  LaTeXCompilersStatus,
  LaTeXSettings,
} from "@/features/latex/lib/types";
import { pathSync } from "@/lib/path";
import { compileWithAutoFallback, selectAutoCompiler } from "./compiler-selection";

export interface UseLatexCompilerOptions {
  settings: LaTeXSettings;
  projectPath: string | null;
}

export function useLatexCompiler({ settings, projectPath }: UseLatexCompilerOptions) {
  const [compilersStatus, setCompilersStatus] = useState<LaTeXCompilersStatus | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileLogs, setCompileLogs] = useState<CompileOutputEvent[]>([]);
  const [lastResult, setLastResult] = useState<CompilationResult | null>(null);
  const compilationGeneration = useRef(0);

  // Detect installed compilers
  const detectCompilers = useCallback(async () => {
    if (!isTauri()) {
      return null;
    }
    setIsDetecting(true);
    try {
      const result = await invoke<LaTeXCompilersStatus>("latex_detect_compilers");
      setCompilersStatus(result);
      return result;
    } catch (error) {
      console.error("Failed to detect compilers:", error);
      return null;
    } finally {
      setIsDetecting(false);
    }
  }, []);

  // Detect compilers on mount
  useEffect(() => {
    if (!isTauri()) return;
    detectCompilers();
  }, [detectCompilers]);

  // Listen to compiler output stream
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    listen<CompileOutputEvent>("latex-compile-output", (event) => {
      setCompileLogs((prev) => [...prev, event.payload]);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to listen to latex-compile-output:", err);
        }
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Determine which compiler executable to invoke
  const resolveCompiler = useCallback(
    async (
      status: LaTeXCompilersStatus | null,
      preferred?: string,
      mainFile = settings.mainFile,
    ) => {
      if (preferred && preferred !== "auto") {
        return preferred;
      }
      if (!projectPath || !mainFile) throw new Error("No project or main file selected.");
      const selection = await selectAutoCompiler({
        status,
        mainFile,
        readSource: (relativePath) =>
          invoke<string>("read_file", {
            path: pathSync.join(projectPath, relativePath),
          }),
      });
      return selection.engine;
    },
    [projectPath, settings.mainFile],
  );

  // Execute local compilation
  const compile = useCallback(
    async (mainFile: string, compilerOverride?: string): Promise<CompilationResult> => {
      if (!isTauri()) {
        const errorMsg = "Tauri IPC is not available";
        const errResult: CompilationResult = {
          success: false,
          exit_code: null,
          pdf_path: null,
          error: errorMsg,
        };
        setLastResult(errResult);
        return errResult;
      }

      if (!projectPath) {
        const errorMsg = "No project directory open";
        const errResult: CompilationResult = {
          success: false,
          exit_code: null,
          pdf_path: null,
          error: errorMsg,
        };
        setLastResult(errResult);
        return errResult;
      }

      setIsCompiling(true);
      setCompileLogs([]);
      const generation = ++compilationGeneration.current;
      const isCancelled = () => compilationGeneration.current !== generation;

      try {
        const currentStatus = compilersStatus ?? (await detectCompilers());
        const preferred = compilerOverride || settings.compiler || "auto";
        const readSource = (relativePath: string) =>
          invoke<string>("read_file", {
            path: pathSync.join(projectPath, relativePath),
          });
        const run = (compiler: string) => {
          if (isCancelled()) throw new Error("Compilation cancelled.");
          const info = currentStatus?.[compiler as keyof LaTeXCompilersStatus];
          return invoke<CompilationResult>("latex_compile", {
            directory: projectPath,
            compiler,
            mainFile,
            args: compiler === "latexmk" ? ["-pdf"] : [],
            customPath: info?.path ?? null,
          });
        };
        const result =
          preferred === "auto"
            ? await compileWithAutoFallback({
                status: currentStatus,
                mainFile,
                readSource,
                run,
                readLog: () => readSource(pathSync.basename(mainFile).replace(/\.tex$/i, ".log")),
                report: (line) =>
                  setCompileLogs((previous) => [
                    ...previous,
                    { line, is_error: false, is_warning: false },
                  ]),
                isCancelled,
              })
            : await run(preferred);
        if (!isCancelled()) setLastResult(result);
        return result;
      } catch (error) {
        const errResult: CompilationResult = {
          success: false,
          exit_code: null,
          pdf_path: null,
          error: String(error),
        };
        if (!isCancelled()) {
          setLastResult(errResult);
          setCompileLogs((previous) => [
            ...previous,
            { line: String(error), is_error: true, is_warning: false },
          ]);
        }
        return errResult;
      } finally {
        if (!isCancelled()) setIsCompiling(false);
      }
    },
    [projectPath, compilersStatus, detectCompilers, settings.compiler],
  );

  // Stop active compilation process
  const stopCompilation = useCallback(async () => {
    if (!isTauri()) return;
    const generation = ++compilationGeneration.current;
    try {
      await invoke("latex_stop_compilation");
    } catch (error) {
      console.error("Failed to stop compilation:", error);
    } finally {
      if (compilationGeneration.current === generation) setIsCompiling(false);
    }
  }, []);

  // Clean auxiliary files (.aux, .log, .out, etc.)
  const cleanAuxFiles = useCallback(
    async (mainFile: string) => {
      if (!isTauri() || !projectPath) return;
      try {
        await invoke("latex_clean_aux_files", {
          directory: projectPath,
          mainFile,
        });
      } catch (error) {
        console.error("Failed to clean auxiliary files:", error);
      }
    },
    [projectPath],
  );

  return {
    compilersStatus,
    isDetecting,
    detectCompilers,
    isCompiling,
    compileLogs,
    lastResult,
    compile,
    stopCompilation,
    cleanAuxFiles,
    resolveCompiler,
  };
}
