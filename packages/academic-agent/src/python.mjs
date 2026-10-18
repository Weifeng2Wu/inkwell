import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isWithin } from "./library.mjs";

const MAX_CODE = 128 * 1024;
const MAX_OUTPUT = 128 * 1024;

function pythonEnvironment(temporary) {
  const env = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "LANG",
    "LC_ALL",
    "LD_LIBRARY_PATH",
    "DYLD_LIBRARY_PATH",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    INKWELL_PYTHON_WORK: temporary,
  };
}

async function runProcess(script, args, cwd, temporary, timeout, signal) {
  signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "python" : "python3",
      ["-I", "-u", script, ...args],
      {
        cwd,
        env: pythonEnvironment(temporary),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      },
    );
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let failure;
    let killTimer;
    const kill = (force = false) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        // taskkill terminates descendants as well as the interpreter.
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.on("error", () => child.kill());
        killer.unref();
      } else {
        try {
          process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
        } catch {}
      }
    };
    const stop = (error) => {
      failure ??= error;
      kill();
      killTimer ??= setTimeout(() => kill(true), 500);
    };
    const abort = () => stop(new Error("Python execution aborted."));
    const timer = setTimeout(
      () => stop(new Error(`Python execution timed out after ${timeout} seconds.`)),
      timeout * 1000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (chunks) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) stop(new Error("Python output exceeds the 128 KiB limit."));
      else chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    // A script cannot leave child processes holding stdout open after it exits.
    child.on("exit", () => kill(true));
    const onHostExit = () => kill(true);
    process.once("exit", onHostExit);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      process.removeListener("exit", onHostExit);
    };
    child.on("error", (error) => {
      cleanup();
      reject(
        error.code === "ENOENT"
          ? new Error(
              "Python 3 was not found. Install Python 3 and make it available on PATH, then retry.",
            )
          : error,
      );
    });
    child.on("close", (exitCode, exitSignal) => {
      cleanup();
      if (failure) reject(failure);
      else
        resolve({
          exitCode,
          signal: exitSignal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
    });
  });
}

export function createPythonTool(project, permissionMode, approve, selection) {
  if (permissionMode === "restricted") return undefined;
  if (!["ask", "auto"].includes(permissionMode)) throw new Error("Invalid Python permission mode.");
  return {
    name: "run_python",
    label: "Run Python",
    description:
      "Run Python 3 code or a declared Python script from an enabled, already-loaded skill. The working directory is the manuscript review copy. This is LOCAL CODE EXECUTION, not an OS sandbox: code has the current account's filesystem/network access. Respect the user's scope, never read credentials or original files outside the review copy, and do not install packages without being asked. Temporary scripts/resources are deleted after execution. stdout/stderr and nonzero exit codes are returned. For skill scripts, use absolute manuscript paths rooted in the working directory when the script changes directories. Ask mode shows the code for approval; auto mode executes immediately. Restricted mode disables Python.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "Python source; mutually exclusive with skillId/script. Use os.environ['INKWELL_PYTHON_WORK'] for temporary files.",
          maxLength: MAX_CODE,
        },
        skillId: {
          type: "string",
          description: "Enabled skill whose instructions have already been loaded",
          maxLength: 64,
        },
        script: {
          type: "string",
          description:
            "Declared .py resource path, e.g. scripts/run_checks.py. Its verified resources are materialized alongside it.",
          maxLength: 256,
        },
        args: { type: "array", items: { type: "string", maxLength: 4096 }, maxItems: 80 },
        timeoutSeconds: {
          type: "integer",
          minimum: 1,
          maximum: 120,
          description: "Execution timeout, default 60 seconds",
        },
      },
      additionalProperties: false,
    },
    executionMode: "sequential",
    async execute(_callId, input, signal) {
      const { code, skillId, script, args = [], timeoutSeconds = 60 } = input;
      const inline = typeof code === "string" && Boolean(code.trim());
      if (
        inline
          ? skillId !== undefined || script !== undefined
          : typeof skillId !== "string" || typeof script !== "string" || code !== undefined
      )
        throw new Error("Provide either Python code or a skillId and declared .py script.");
      if (inline && (Buffer.byteLength(code) > MAX_CODE || code.includes("\0")))
        throw new Error("Invalid or oversized Python code.");
      if (
        !Number.isInteger(timeoutSeconds) ||
        timeoutSeconds < 1 ||
        timeoutSeconds > 120 ||
        !Array.isArray(args) ||
        args.length > 80 ||
        args.some((arg) => typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"))
      )
        throw new Error("Invalid Python arguments or timeout.");
      signal?.throwIfAborted();
      const temporary = await mkdtemp(path.join(os.tmpdir(), "inkwell-python-"));
      try {
        let filename = path.join(temporary, "main.py");
        if (inline) await writeFile(filename, code, { mode: 0o600 });
        else {
          if (!script.endsWith(".py") || !selection?.loaded.has(skillId))
            throw new Error("Load the enabled skill before running its declared Python script.");
          const skill = selection.find(skillId);
          if (!skill.resources.some((resource) => resource.path === script))
            throw new Error("Python script is not declared by this skill.");
          let total = 0;
          for (const resource of [skill.entrypoint, ...skill.resources]) {
            const destination = path.resolve(temporary, resource.path);
            if (!isWithin(temporary, destination))
              throw new Error("Skill resource escapes the Python workspace.");
            const content = await selection.readResource(skill, resource);
            total += Buffer.byteLength(content);
            if (total > 2 * 1024 * 1024) throw new Error("Python skill resources exceed 2 MiB.");
            await mkdir(path.dirname(destination), { recursive: true });
            await writeFile(destination, content, { mode: 0o600 });
          }
          filename = path.join(temporary, script);
        }
        const cwd = await realpath(project);
        if (permissionMode === "ask")
          await approve(
            {
              kind: "python",
              path: inline ? "Python" : `${skillId}/${script}`,
              before: null,
              after: `Working directory: ${cwd}\nTimeout: ${timeoutSeconds}s\nArguments: ${JSON.stringify(args)}\nLocal execution with this account's file and network access.\n\n${await readFile(filename, "utf8")}`,
            },
            signal,
          );
        signal?.throwIfAborted();
        const result = await runProcess(filename, args, cwd, temporary, timeoutSeconds, signal);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
          isError: result.exitCode !== 0,
        };
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  };
}
