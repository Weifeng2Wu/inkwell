# Inkwell

AI-native LaTeX editor for the desktop. Write papers in LaTeX while an AI coding agent
drives the edits; Inkwell keeps the compile loop, the project tree, and the document
preview in one window.

Built as a Tauri v2 application: a Rust backend over a Next.js static-export frontend.

## Features

- **LaTeX compile loop** — compiler detection, TeX distribution install, main-file
  detection, aux-file cleanup, and SyncTeX forward/inverse search.
- **Built-in editor** — Monaco with LaTeX-aware highlighting and diagnostics.
- **AI agent integration** — drives AI coding agents through a local daemon. No hosted
  backend and no cloud account.
- **Local-first** — a project stays a plain directory of `.tex` files on disk.
- **PDF preview** with bidirectional SyncTeX navigation.
- **Six themes** — light, dark, Caffeine, Tokyo Night, Catppuccin, Nord.

## Prerequisites

- **Node.js** ≥ 24.0.0
- **pnpm** 11.5.0, pinned through `packageManager` in `package.json`
  (if it is missing from your `PATH`: `npm install -g pnpm@11.5.0`)
- **Rust** stable toolchain with `cargo`, for the Tauri backend

## Quick start

```sh
pnpm install
pnpm tauri:dev          # Desktop app with hot reload
```

Frontend only, skipping the Rust build:

```sh
pnpm --filter @inkwell/desktop dev
```

## Common commands

| Command | Purpose |
| --- | --- |
| `pnpm tauri:dev` | Desktop app with hot reload |
| `pnpm build` | Build all workspaces |
| `pnpm tauri:build` | Produce desktop bundles (`.dmg`, `.app`) |
| `pnpm tauri:pkg` | Build a macOS `.pkg` installer |
| `pnpm lint` | Biome lint |
| `pnpm format` | Biome formatter write |
| `pnpm exec biome check .` | Lint and format check |

## Project layout

| Path | Contents |
| --- | --- |
| `apps/desktop/src/app` | Next.js routes; `page.tsx` is the app shell |
| `apps/desktop/src/components` | UI components |
| `apps/desktop/src/lib` | Frontend services, stores, and types |
| `apps/desktop/src-tauri` | Rust backend, commands, and bundle config |
| `docs` | Developer, design, and architecture references |
| `scripts` | Release and installer tooling |

## Documentation

- [`AGENTS.md`](./AGENTS.md) — repository conventions and invariants for contributors
- [`docs/dev.md`](./docs/dev.md) — development setup, commands, and architecture
- [`docs/DESIGN.md`](./docs/DESIGN.md) — design system and UI conventions
- [`docs/AGENT_FRAMEWORK.md`](./docs/AGENT_FRAMEWORK.md) — Inkwell Agent runtime and progressive-disclosure Skills framework
