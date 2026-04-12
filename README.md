# skills-manage

A cross-platform desktop app for managing AI coding agent skills across multiple platforms. Built with Tauri v2, React, and TypeScript.

## Overview

**skills-manage** provides a unified interface to discover, organize, and install AI agent skills (markdown instruction files) across 11 built-in platforms. It follows the [Agent Skills](https://github.com/anthropics/agent-skills) open standard with a central canonical directory at `~/.agents/skills/`. Skills are installed to individual platforms via symlinks, so a single source of truth drives all your AI coding tools.

## Supported Platforms

| Category | Platform | Skills Directory |
|----------|----------|-----------------|
| Coding | Claude Code | `~/.claude/skills/` |
| Coding | Codex CLI | `~/.agents/skills/` |
| Coding | Cursor | `~/.cursor/skills/` |
| Coding | Gemini CLI | `~/.gemini/skills/` |
| Coding | Trae | `~/.trae/skills/` |
| Coding | Factory Droid | `~/.factory/skills/` |
| Lobster | OpenClaw (开爪) | `~/.openclaw/skills/` |
| Lobster | QClaw (千爪) | `~/.qclaw/skills/` |
| Lobster | EasyClaw (简爪) | `~/.easyclaw/skills/` |
| Lobster | AutoClaw/WorkBuddy (打工搭子) | `~/.workbuddy/skills/` |
| Central | Central Skills | `~/.agents/skills/` |

Custom platforms can be added through Settings.

## Features

- **Platform Views** — Browse skills installed for each AI coding tool
- **Central Skills** — Manage canonical skills in `~/.agents/skills/` with install/uninstall to any platform
- **Skill Detail** — View skill content with full markdown preview
- **Collections** — Create, edit, and delete skill collections; batch-install to platforms; export/import as JSON
- **Settings** — Configure custom scan directories and custom platforms
- **Catppuccin Themes** — 4 switchable flavors (Mocha, Macchiato, Frappé, Latte) with instant switching and persistence
- **i18n** — Chinese and English language support with persistent preference
- **Responsive Sidebar** — Collapsible navigation with platform grouping and SVG platform icons
- **First-Visit Guidance** — Onboarding flow for new users
- **Error Toasts** — User-friendly error notifications via sonner

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | Tauri v2 |
| Frontend | React 19, TypeScript, Tailwind CSS 4 |
| UI components | shadcn/ui, Lucide icons |
| State management | Zustand |
| Markdown | react-markdown |
| i18n | react-i18next, i18next-browser-languagedetector |
| Theming | Catppuccin 4-flavor palette |
| Backend | Rust (serde, sqlx, chrono, uuid) |
| Database | SQLite via sqlx (WAL mode) |
| Routing | react-router-dom v7 |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [pnpm](https://pnpm.io/)
- [Rust toolchain](https://rustup.rs/) (stable)
- Tauri v2 system dependencies — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install

```bash
pnpm install
```

### Development

```bash
pnpm tauri dev
```

The Vite dev server runs on port **24200**.

## Testing

### Frontend (297 tests)

```bash
pnpm test          # Vitest + React Testing Library
pnpm typecheck     # TypeScript type checking
pnpm lint          # ESLint
```

### Rust backend (181 tests)

```bash
cd src-tauri && cargo test
cd src-tauri && cargo clippy -- -D warnings
```

## Project Structure

```
skills-manage/
├── src/                        # React frontend
│   ├── pages/                  # Route views
│   │   ├── PlatformView.tsx
│   │   ├── CentralSkillsView.tsx
│   │   ├── CollectionView.tsx
│   │   ├── SkillDetail.tsx
│   │   └── SettingsView.tsx
│   ├── components/             # UI components
│   │   ├── layout/             # Sidebar, app shell
│   │   ├── central/            # Central skills components
│   │   ├── collection/         # Collection editor, picker
│   │   ├── platform/           # Platform skill cards
│   │   ├── settings/           # Settings components
│   │   └── ui/                 # shadcn/ui primitives
│   ├── stores/                 # Zustand state stores (including themeStore)
│   ├── i18n/                   # i18n config + locale files (zh, en)
│   ├── test/                   # Test files + setup
│   └── types/                  # TypeScript type definitions
├── src-tauri/                  # Rust backend
│   └── src/
│       ├── lib.rs              # Tauri app setup + plugin registration
│       ├── db.rs               # SQLite schema, migrations, queries
│       ├── main.rs             # Entry point
│       └── commands/           # Tauri IPC command handlers
│           ├── scanner.rs      # Skill file discovery
│           ├── agents.rs       # Platform CRUD
│           ├── linker.rs       # Symlink install/uninstall
│           ├── skills.rs       # Skill queries + content reading
│           ├── collections.rs  # Collection management
│           └── settings.rs     # Scan dirs + app settings
└── public/                     # Static assets
```

## Database

SQLite database stored at `~/.skillsmanage/db.sqlite` with WAL mode enabled. The schema is initialized automatically on first launch, including seeding all built-in platform entries.
