export const EXTERNAL_AGENTS = [
  { id: "pi", name: "Pi", installUrl: "https://github.com/badlogic/pi-mono", verified: true },
  { id: "opencode", name: "OpenCode", installUrl: "https://opencode.ai", verified: true },
  {
    id: "claude",
    name: "Claude Code",
    installUrl: "https://code.claude.com/docs/en/setup",
    verified: true,
  },
  {
    id: "codex",
    name: "Codex",
    installUrl: "https://developers.openai.com/codex/cli",
    verified: true,
  },
  {
    id: "antigravity",
    name: "Antigravity",
    installUrl: "https://antigravity.google/docs/getting-started?tab=cli",
    verified: true,
  },
  { id: "qoder", name: "Qoder CLI", installUrl: "https://qoder.com/cli", verified: true },
  { id: "grok", name: "Grok Build", installUrl: "https://x.ai/cli", verified: true },
  {
    id: "deepseek",
    name: "DeepSeek Harness",
    installUrl: "https://github.com/deepseek-ai/deepseek-harness",
    verified: true,
  },
  {
    id: "kimi",
    name: "Kimi Code",
    installUrl: "https://moonshotai.github.io/kimi-cli/",
    verified: true,
  },
  { id: "zcode", name: "ZCode", installUrl: "https://zcode.z.ai", verified: true },
] as const;

export type ExternalAgentId = (typeof EXTERNAL_AGENTS)[number]["id"];
export type AgentSelection = "builtin" | ExternalAgentId;
export type LaunchOverride = { command: string; args: string[] };
export type AgentStatus = {
  id: ExternalAgentId;
  installed: boolean;
  acpReady: boolean;
  path: string | null;
  adapterPath: string | null;
  installable: boolean;
};

export function isAgentSelection(value: unknown): value is AgentSelection {
  return value === "builtin" || EXTERNAL_AGENTS.some((agent) => agent.id === value);
}

export function parseLaunch(command: string, args: string): LaunchOverride | null {
  if (!command.trim()) return null;
  const parsed: unknown = JSON.parse(args || "[]");
  if (!Array.isArray(parsed) || !parsed.every((argument) => typeof argument === "string"))
    throw new Error("ACP arguments must be a JSON array of strings.");
  return { command: command.trim(), args: parsed };
}
