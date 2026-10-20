import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compileFunction } from "node:vm";

const requireDesktop = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
const monacoRoot = dirname(requireDesktop.resolve("monaco-editor/package.json"));
const { Delayer } = await import(pathToFileURL(join(monacoRoot, "esm/vs/base/common/async.js")));
const { errorHandler, isCancellationError, onUnexpectedError } = await import(
  pathToFileURL(join(monacoRoot, "esm/vs/base/common/errors.js"))
);
const highlighter = await readFile(
  join(monacoRoot, "esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js"),
  "utf8",
);
const triggers = [...highlighter.matchAll(/this\.runDelayer\.trigger\([^\n]+/g)];
assert.equal(triggers.length, 3);

for (const [index, [source]] of triggers.entries()) {
  const trigger = compileFunction(`return ${source}`, ["onUnexpectedError", "e", "delay"]);

  test(`word highlighting trigger ${index + 1} handles cancellation during disposal`, async () => {
    const runDelayer = new Delayer(50);
    const context = {
      runDelayer,
      _onPositionChanged: () => assert.fail("Disposed task ran"),
      _run: () => assert.fail("Disposed task ran"),
    };
    const errors = [];
    const completion = trigger.call(
      context,
      (error) => {
        errors.push(error);
        return onUnexpectedError(error);
      },
      {},
      0,
    );
    runDelayer.dispose();
    await completion;
    assert.equal(errors.length, 1);
    assert.ok(isCancellationError(errors[0]));
  });

  test(`word highlighting trigger ${index + 1} still runs uncanceled work`, async () => {
    const runDelayer = new Delayer(0);
    let calls = 0;
    const execute = () => {
      calls += 1;
    };
    await trigger.call(
      { runDelayer, _onPositionChanged: execute, _run: execute },
      onUnexpectedError,
      {},
      0,
    );
    assert.equal(calls, 1);
    runDelayer.dispose();
  });

  test(`word highlighting trigger ${index + 1} still reports real failures`, async (context) => {
    const originalHandler = errorHandler.unexpectedErrorHandler;
    const failures = [];
    errorHandler.unexpectedErrorHandler = (error) => failures.push(error);
    context.after(() => {
      errorHandler.unexpectedErrorHandler = originalHandler;
    });
    const failure = new Error("Highlight provider failed");
    const execute = () => {
      throw failure;
    };
    const runDelayer = new Delayer(0);
    await trigger.call(
      { runDelayer, _onPositionChanged: execute, _run: execute },
      onUnexpectedError,
      {},
      0,
    );
    assert.deepEqual(failures, [failure]);
    runDelayer.dispose();
  });
}
