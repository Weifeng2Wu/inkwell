/** Diffs larger than this are truncated before being sent to the model. */
export const AI_COMMIT_DIFF_LIMIT = 30000;

/** How long to wait for the agent to produce a commit message. */
export const AI_COMMIT_TIMEOUT_MS = 90000;

/**
 * Strips the wrappers a model tends to add around a commit message — code fences, a
 * "commit message:" prefix, and surrounding quotes — so the result can be committed as-is.
 */
export function sanitizeAiCommitMessage(raw: string): string {
  let text = raw.trim();

  text = text.replace(/^```[a-zA-Z]*\s*/m, "");
  text = text.replace(/\s*```$/, "");
  text = text.replace(/^commit message\s*[:：]\s*/i, "");

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  return text.trim();
}

export function buildAiCommitPrompt(diff: string, scope: "staged" | "unstaged"): string {
  return [
    `Generate a git commit message from the following ${scope} changes.`,
    "Do not call tools. Only output the final commit message.",
    "Output rules:",
    "1. Return only the commit message text, no markdown and no code block.",
    "2. First line is a concise subject in imperative mood, <= 72 chars.",
    "3. Add a short body only when necessary.",
    "",
    "Diff:",
    diff,
  ].join("\n");
}
