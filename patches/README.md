# Dependency patches

## monaco-editor 0.55.1

The word highlighter schedules three `Delayer.trigger()` promises without rejection
handlers. Disposing an editor or restoring a selection cancels pending work and rejects
these promises with `CancellationError`, causing an unhandled rejection in the frontend.

The patch routes these three rejections through Monaco's existing `onUnexpectedError`
handler. That handler ignores expected cancellation and continues reporting other
errors. Word highlighting remains enabled. pnpm applies the patch during installation
for both development and packaged builds.

Run `node --test scripts/test/monaco-cancellation.test.mjs` after installing dependencies.
The regression tests execute the three scheduling statements from the installed
highlighter with Monaco's real `Delayer` and error handler. They check disposal,
normal execution, and reporting of non-cancellation failures. Recheck the patch and
tests when upgrading Monaco.
