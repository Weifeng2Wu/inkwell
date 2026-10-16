export interface CompilerInfo {
  name: string;
  path: string | null;
  available: boolean;
  version: string | null;
}

export interface LaTeXCompilersStatus {
  pdflatex: CompilerInfo;
  xelatex: CompilerInfo;
  lualatex: CompilerInfo;
  latexmk: CompilerInfo;
}

export interface LaTeXSettings {
  mainFile: string | null;
  compiler?: "pdflatex" | "xelatex" | "lualatex" | "latexmk" | "auto";
}

export const DEFAULT_LATEX_SETTINGS: LaTeXSettings = {
  mainFile: null,
  compiler: "auto",
};

export interface CompilationResult {
  success: boolean;
  exit_code: number | null;
  pdf_path: string | null;
  error: string | null;
}

export interface CompileOutputEvent {
  line: string;
  is_error: boolean;
  is_warning: boolean;
}


export const COMPILE_PROMPT = `Please compile the LaTeX document.

Main file: {mainFile}

Guidelines:
1. First, read .inkwell/COMPILE_NOTES.md for previous compilation notes and preferences
2. If the main file does not exist, auto-detect the correct main .tex file (look for \\documentclass in .tex files)
3. Prefer xelatex or pdflatex, but feel free to choose the most appropriate compiler based on the document content
4. Always pass the -synctex=1 flag to generate a SyncTeX file (.synctex.gz) for PDF-to-source navigation
5. If packages are missing, try installing them with tlmgr
6. For bibliography or cross-references, consider running multiple passes or using latexmk
7. If compilation fails, check the .log file to diagnose and fix the issue
8. After compilation (success or failure), update .inkwell/COMPILE_NOTES.md with any useful information: working compiler, installed packages, resolved issues, or tips for future compilations
9. After successful compilation, let me know the output PDF path`;

// LaTeX Installation Types
export interface LaTeXDistribution {
  name: string;
  id: string;
  description: string;
  install_command: string | null;
  download_url: string | null;
}

export interface InstallProgress {
  stage: "starting" | "checking" | "downloading" | "installing" | "complete" | "error";
  message: string;
  progress: number | null;
}

export interface InstallResult {
  success: boolean;
  message: string;
  needs_restart: boolean;
}

// SyncTeX inverse search result
export interface SynctexResult {
  file: string;
  line: number;
  column: number;
}

// Main file detection types
export interface MainFileDetectionResult {
  main_file: string | null;
  tex_files: string[];
  detection_method: "configured" | "single_file" | "auto_detected" | "ambiguous" | "none";
  needs_user_input: boolean;
  message: string;
}
