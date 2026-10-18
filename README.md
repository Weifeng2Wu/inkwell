<div align="center">

# Inkwell

**Your research. Your agents. Your final say.**

A local-first, AI-native LaTeX workspace for writing, reviewing, and versioning research papers.

[![Desktop build](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml/badge.svg)](https://github.com/Weifeng2Wu/inkwell/actions/workflows/desktop-build.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Weifeng2Wu/inkwell?style=flat)](https://github.com/Weifeng2Wu/inkwell)

**English** | [简体中文](README_zh.md) | [한국어](README_ko.md)

[Features](#built-around-your-paper) · [Quick Start](#quick-start) · [Desktop Builds](#desktop-builds) · [Documentation](#documentation)

</div>

---

## Why Inkwell?

Your research workflow should not be a copy-paste loop between a LaTeX editor, a PDF viewer, an AI chat, and a terminal. Inkwell brings them into one desktop workspace—with a review step between an Agent's suggestion and your manuscript.

Ask for a rewrite, inspect the changes in context, accept what you want, then compile and commit. Your paper remains a normal folder of files, not a proprietary document format.

> **Under active development.** Windows, macOS, and Linux build jobs are configured. A configured target is not a guarantee that its installer has passed native build and installation testing. See [build notes](docs/DESKTOP_BUILDS.md).

## Built Around Your Paper

| Workflow | Features |
| --- | --- |
| Write | Monaco editor, LaTeX highlighting, bibliography completion, tabs, and split layouts |
| Review | Inline Agent suggestions: red original text, green replacement, and per-change accept/reject controls |
| Compile | Compiler detection, main-file selection, TeX installation helpers, build output, and auxiliary-file cleanup |
| Read | Integrated PDF preview and SyncTeX source/PDF navigation when synchronization data is available |
| Collaborate | Git status, history, staging, commits, push/pull, and GitHub repository publishing |
| Customize | Built-in and external Agents, reusable Skills, terminal access, fonts, shortcuts, and light/dark theme palettes |

## AI Changes You Can Review

Agent-assisted manuscript edits use a review working copy rather than silently replacing your source files.

```text
You:   “Make this paragraph more concise without changing its claims.”
Agent: Proposes changes in a review copy.
You:   Inspect the red original and green replacement in the same editor.
       Accept or reject each change, then compile the paper.
```

- Original and suggested text appear together, not in a separate side-by-side page.
- Accept or reject individual changes instead of blindly accepting a whole rewrite.
- Switch file tabs and return to pending suggestions without losing the decision controls.
- Built-in and external Agents share a pre-prompt describing the review workflow and your response preferences.

This is a manuscript-review workflow, **not an operating-system sandbox**. External tools retain their granted permissions; use trusted tools and inspect permission requests.

## Bring Your Agent

Configure **Inkwell Agent** with an OpenAI-, Anthropic-, or Gemini-compatible API, or connect an external Agent through ACP (Agent Client Protocol).

The integration catalog includes **Pi, OpenCode, Claude Code, Codex, Antigravity, Qoder CLI, Grok Build, DeepSeek Harness, Kimi Code, and ZCode**. Default Agent selection shows the built-in Agent and detected installed Agents; installation and adapter configuration are managed separately in settings.

Reuse response preferences and project-enabled Skills across supported backends. Configure endpoint, model, and API key for the built-in Agent; authenticate external Agents through their own CLI or supported adapter flow. Connection failures do not silently switch to another Agent.

Adapter authentication, permissions, and tool capabilities vary. Catalog inclusion does not imply end-to-end validation of every upstream version. See [external Agent documentation](docs/external-agents.md).

## Skills for Academic Work

One library for discovery, installation, and project activation:

- Import a **folder, ZIP, Markdown Skill file, or GitHub URL** through one import entry.
- Filter installed Skills and enable only those needed by the current project.
- View GitHub source links and compact star counts on library cards.
- Supported GitHub-backed entries check upstream revisions during library refresh, subject to a check interval and network availability; installed snapshots can update without automatically installing the entire catalog.
- Turn submission requirements and supported author-kit files into reusable formatting guidance.

These optional collections are listed in the library; **neither is installed by default**:

| Collection | Focus | Source |
| --- | --- | --- |
| Research Paper Writing | Research-paper writing guidance | [Master-cai/Research-Paper-Writing-Skills](https://github.com/Master-cai/Research-Paper-Writing-Skills) |
| Nature Academic Writing Suite | Writing, polishing, proposals, citations, availability statements, statistical reporting, mock review, reviewer responses, and reference verification | [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills) |

Skills provide instructions, not missing tools. Search, citation verification, and document workflows still require appropriate capabilities. The text-resource integration does not execute upstream Skill scripts. Journal-style guidance is not official policy or an acceptance guarantee.

## LaTeX, PDF, and Git Together

Detect compilers, use TeX installation helpers, compile with supported engines, inspect errors, and move between source and PDF with SyncTeX. Unicode/CJK documents depend on engine, fonts, and packages; XeLaTeX or LuaLaTeX is usually the appropriate starting point.

Git operates per opened workspace, so separate paper folders can have independent repositories and histories. Local status, diffs, and commits do not require GitHub login. Remote operations need the corresponding credentials; GitHub publishing uses GitHub CLI authentication and supports private repositories. An integrated terminal remains available for CLI workflows.

## Local First

Your manuscripts remain ordinary files. Conversations use JSONL; settings and indexes are being moved to SQLite in the application persistence layer. This describes ongoing storage work, not a guarantee that migration is complete. Model, image, search and layout-parser API keys are stored unencrypted in a dedicated table in the local `academic-agent/inkwell.sqlite` application database, separate from project settings and ordinary settings responses. Database files are restricted to the current user on macOS/Linux. Keys previously saved in the operating system credential vault must be entered again once; Inkwell no longer accesses that vault or triggers its authorization prompt.

No Inkwell cloud account or hosted application backend is required. AI requests send context to the provider or Agent you select; Git operations, updates, and downloads can also use the network. **Local-first does not mean every feature is offline or that content never leaves your device.**

## Quick Start

### Desktop App

Download the installer for your platform from [GitHub Releases](https://github.com/Weifeng2Wu/inkwell/releases/latest).

**macOS — before the first launch:** Open the DMG and drag Inkwell into Applications. The current build is not signed with an Apple Developer certificate or notarized, so macOS may report that the app is damaged. After confirming you downloaded it from the official release above, run these commands in Terminal:

```sh
sudo xattr -dr com.apple.quarantine "/Applications/Inkwell.app"
open "/Applications/Inkwell.app"
```

Enter your Mac login password when prompted; Terminal will not display characters while you type.

1. Open your paper's project folder and configure a LaTeX compiler.
2. Configure Inkwell Agent or connect an installed external Agent.
3. Optionally install Skills and enable them for this project.
4. Request edits, review suggestions, compile, and commit.

### From Source

Prerequisites: **Node.js 24.x**, **pnpm 11.5.0**, **Rust stable**, Git, and [Tauri platform dependencies](https://v2.tauri.app/start/prerequisites/). Paper compilation needs a TeX distribution; external Agent installation may require npm, uv, or a provider installer.

```sh
git clone https://github.com/Weifeng2Wu/inkwell.git
cd inkwell
pnpm install
pnpm agent:setup  # Prepare the built-in SDK for this OS and architecture
pnpm tauri:dev
```

Install pnpm if needed: `npm install -g pnpm@11.5.0`. Agent setup downloads and builds the pinned upstream runtime; it needs network access but makes no model completion request. Use Windows Node.js, not WSL Node.js, when preparing a Windows app.

Frontend only: `pnpm --filter @inkwell/desktop dev`. Native filesystem, compile, Git, and Agent features require the Tauri app.

## Desktop Builds

| Target | Formats | Notes |
| --- | --- | --- |
| Windows x64 | NSIS `.exe` | Requires WebView2; the configured installer can download its bootstrapper |
| macOS Apple Silicon / Intel | `.dmg` | Configured minimum: macOS 13.5 |
| Linux x64 | `.deb`, `.AppImage` | CI uses Ubuntu 22.04; distribution compatibility needs validation |

Run `pnpm tauri:build` on the native platform, or select **Actions → Desktop build → Run workflow**. Packaging stages the Agent SDK and Node sidecar. **Developer certificates and notarization are not configured**; test installers may trigger operating-system security warnings. Installation and launch testing remain necessary. See [build instructions](docs/DESKTOP_BUILDS.md).

## Development

| Command | Purpose |
| --- | --- |
| `pnpm tauri:dev` | Desktop development with hot reload |
| `pnpm build` | Workspace/frontend production build |
| `pnpm tauri:build` | Prepare runtime and build native installers |
| `pnpm --filter @inkwell/desktop typecheck` | Frontend TypeScript check |
| `pnpm --filter @inkwell/desktop test` | Frontend tests |
| `pnpm agent:test` | Agent tests |
| `node --test scripts/test/*.test.mjs` | Packaging helper tests |
| `cd apps/desktop/src-tauri && cargo check` | Rust backend check |
| `pnpm exec biome check .` | Lint and formatting check |

Built with **Tauri v2 + Rust**, **Next.js static export + React**, and **Monaco**. Feature modules live in `apps/desktop/src/features`; native commands live in `apps/desktop/src-tauri/src/commands`. The desktop architecture has no Next.js server component or hosted backend.

## Documentation

- [Developer guide](docs/dev.md)
- [Design system](docs/DESIGN.md)
- [Agent and Skills framework](docs/AGENT_FRAMEWORK.md)
- [External Agents](docs/external-agents.md)
- [Desktop builds](docs/DESKTOP_BUILDS.md)
- [Contributor instructions](AGENTS.md)

## License and Acknowledgments

Inkwell uses the [MIT License](LICENSE). Third-party runtimes, Skills, and assets retain their own licenses; see [third-party notices](packages/academic-agent/THIRD_PARTY_NOTICES.md) and [Agent logo attribution](apps/desktop/public/agent-logos/LICENSE.txt).
