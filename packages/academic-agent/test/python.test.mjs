import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { digest, SkillLibrary } from "../src/library.mjs";
import { createPythonTool } from "../src/python.mjs";

async function workspace(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkwell-python-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  return realpath(root);
}

test("Python runs code in the review copy, returns arguments and errors, and cleans helpers", async (context) => {
  const root = await workspace(context);
  const tool = createPythonTool(root, "auto");
  const result = await tool.execute("call", {
    code: "import pathlib, sys, os\npathlib.Path('result.txt').write_text('computed')\nprint(6*7, sys.argv[1], os.environ['INKWELL_PYTHON_WORK'])",
    args: ["argument with spaces"],
  });
  assert.equal(result.details.exitCode, 0);
  assert.match(result.details.stdout, /^42 argument with spaces /);
  assert.equal(await readFile(path.join(root, "result.txt"), "utf8"), "computed");
  assert.deepEqual(await readdir(root), ["result.txt"]);
  const temporary = result.details.stdout.trim().slice("42 argument with spaces ".length);
  await assert.rejects(readFile(path.join(temporary, "main.py")), /ENOENT/);
  const failure = await tool.execute("call", { code: "raise RuntimeError('fixture failure')" });
  assert.equal(failure.isError, true);
  assert.equal(failure.details.exitCode, 1);
  assert.match(failure.details.stderr, /fixture failure/);
});

test("restricted mode disables Python and denied code never runs", async (context) => {
  const root = await workspace(context);
  assert.equal(createPythonTool(root, "restricted"), undefined);
  let approval;
  const tool = createPythonTool(root, "ask", async (change) => {
    approval = change;
    throw new Error("denied");
  });
  await assert.rejects(
    tool.execute("call", { code: "open('forbidden.txt', 'w').write('bad')" }),
    /denied/,
  );
  assert.equal(approval.kind, "python");
  assert.match(approval.after, /forbidden.txt/);
  assert.match(approval.after, /Local execution/);
  assert.deepEqual(await readdir(root), []);
});

test("Python does not inherit model credentials or Python startup settings", async (context) => {
  const root = await workspace(context);
  const secretKey = "INKWELL_TEST_PYTHON_SECRET";
  const previous = process.env[secretKey];
  process.env[secretKey] = "private-value";
  context.after(() => {
    if (previous === undefined) delete process.env[secretKey];
    else process.env[secretKey] = previous;
  });
  const result = await createPythonTool(root, "auto").execute("call", {
    code: `import os, sys\nprint(os.environ.get('${secretKey}', 'absent'), sys.flags.isolated)`,
  });
  assert.equal(result.details.stdout.trim(), "absent 1");
});

test("timeouts, cancellation and excessive output terminate Python", {
  timeout: 10000,
}, async (context) => {
  const root = await workspace(context);
  const tool = createPythonTool(root, "auto");
  await assert.rejects(
    tool.execute("call", { code: "import time\ntime.sleep(60)", timeoutSeconds: 1 }),
    /timed out/,
  );
  const abort = new AbortController();
  const pending = tool.execute("call", { code: "import time\ntime.sleep(60)" }, abort.signal);
  setTimeout(() => abort.abort(), 150);
  await assert.rejects(pending, /abort/i);
  await assert.rejects(tool.execute("call", { code: "print('x' * 200000)" }), /output exceeds/);
  await assert.rejects(
    tool.execute("call", { code: "print(1)", timeoutSeconds: 10000 }),
    /timeout/,
  );
});

test("Python materializes only verified resources of an enabled, loaded skill", async (context) => {
  const root = await workspace(context);
  const files = {
    "SKILL.md": "Fixture",
    "scripts/check.py":
      "from pathlib import Path\nprint((Path(__file__).parents[1] / 'rules.json').read_text())",
    "rules.json": '{"pages":8}',
  };
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.join(root, "fixture", relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  const selection = new SkillLibrary(root, {
    schemaVersion: 1,
    skills: [
      {
        id: "fixture",
        name: "Fixture",
        description: "Fixture",
        source: "Test",
        version: "1",
        entrypoint: { path: "SKILL.md", sha256: digest(files["SKILL.md"]) },
        resources: Object.entries(files)
          .filter(([name]) => name !== "SKILL.md")
          .map(([name, content]) => ({ path: name, sha256: digest(content) })),
      },
    ],
  }).select(["fixture"]);
  const tool = createPythonTool(root, "auto", undefined, selection);
  await assert.rejects(
    tool.execute("call", { skillId: "fixture", script: "scripts/check.py" }),
    /Load the enabled/,
  );
  await selection.load("fixture");
  const result = await tool.execute("call", { skillId: "fixture", script: "scripts/check.py" });
  assert.equal(result.details.stdout.trim(), '{"pages":8}');
  await assert.rejects(
    tool.execute("call", { skillId: "fixture", script: "../outside.py" }),
    /not declared/,
  );
  await writeFile(path.join(root, "fixture/scripts/check.py"), "print('modified')");
  await assert.rejects(
    tool.execute("call", { skillId: "fixture", script: "scripts/check.py" }),
    /changed/,
  );
});
