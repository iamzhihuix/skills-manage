# skills-manage

A cross-platform desktop app for managing AI coding agent skills across multiple platforms. Built with Tauri v2, React, and TypeScript.

> **Disclaimer**
> `skills-manage` is an independent, unofficial desktop application for managing local AI agent skill directories and importing public skill metadata. It is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, GitHub, MiniMax, or any other supported platform, publisher, or trademark owner. Product names are used only to describe compatibility and interoperability.

## Overview

**skills-manage** provides a unified interface to discover, organize, and install AI agent skills (markdown instruction files) across 28 built-in platforms. It follows the [Agent Skills](https://github.com/anthropics/agent-skills) open standard with a central canonical directory at `~/.agents/skills/`. Skills are installed to individual platforms via symlinks, so a single source of truth drives all your AI coding tools.

## Supported Platforms

| Category | Platform | Skills Directory |
|----------|----------|-----------------|
| Coding | Claude Code | `~/.claude/skills/` |
| Coding | Codex CLI | `~/.agents/skills/` |
| Coding | Cursor | `~/.cursor/skills/` |
| Coding | Gemini CLI | `~/.gemini/skills/` |
| Coding | Trae | `~/.trae/skills/` |
| Coding | Factory Droid | `~/.factory/skills/` |
| Coding | Junie | `~/.junie/skills/` |
| Coding | Qwen | `~/.qwen/skills/` |
| Coding | Trae CN | `~/.trae-cn/skills/` |
| Coding | Windsurf | `~/.windsurf/skills/` |
| Coding | Qoder | `~/.qoder/skills/` |
| Coding | Augment | `~/.augment/skills/` |
| Coding | OpenCode | `~/.opencode/skills/` |
| Coding | KiloCode | `~/.kilocode/skills/` |
| Coding | OB1 | `~/.ob1/skills/` |
| Coding | Amp | `~/.amp/skills/` |
| Coding | Kiro | `~/.kiro/skills/` |
| Coding | CodeBuddy | `~/.codebuddy/skills/` |
| Coding | Hermes | `~/.hermes/skills/` |
| Coding | Copilot | `~/.copilot/skills/` |
| Coding | Aider | `~/.aider/skills/` |
| Lobster | OpenClaw (开爪) | `~/.openclaw/skills/` |
| Lobster | QClaw (千爪) | `~/.qclaw/skills/` |
| Lobster | EasyClaw (简爪) | `~/.easyclaw/skills/` |
| Lobster | EasyClaw V2 | `~/.easyclaw-20260322-01/skills/` |
| Lobster | AutoClaw | `~/.openclaw-autoclaw/skills/` |
| Lobster | WorkBuddy (打工搭子) | `~/.workbuddy/skills-marketplace/skills/` |
| Central | Central Skills | `~/.agents/skills/` |

Custom platforms can be added through Settings.

## Features

- **Platform Views** — Browse skills installed for each AI coding tool
- **Central Skills** — Manage canonical skills in `~/.agents/skills/` with install/uninstall to any platform
- **Skill Detail** — View skill content with full markdown preview
- **Collections** — Create, edit, and delete skill collections; batch-install to platforms; export/import as JSON
- **Settings** — Configure custom scan directories and custom platforms
- **Discover** — Full-disk project-level skill scanner with dedicated Discover page, recursive scanning, configurable scan roots, import to central, stop scan, and cached results
- **Catppuccin Themes** — 4 switchable flavors (Mocha, Macchiato, Frappé, Latte) with instant switching and persistence
- **i18n** — Chinese and English language support with persistent preference
- **Responsive Sidebar** — Collapsible navigation with platform grouping and SVG platform icons
- **First-Visit Guidance** — Onboarding flow for new users
- **Error Toasts** — User-friendly error notifications via sonner

## Privacy & Security

- **Local-first** — Skill metadata, collections, scan results, app settings, and cached AI explanations are stored locally in `~/.skillsmanage/db.sqlite` or in the skill directories you manage.
- **No telemetry** — The app does not include analytics, crash reporting, or usage tracking.
- **Outbound network requests are opt-in by feature** — The app only contacts external services when you explicitly use marketplace sync/download, GitHub repository import, or AI explanation generation.
- **Credential handling** — GitHub Personal Access Tokens and AI API keys, if configured, are stored locally in the SQLite settings table. They are not encrypted at rest by the app.
- **AI explanation privacy** — Generating an AI explanation sends the selected skill content and prompt to the provider configured in Settings.
- **Public issue hygiene** — Never post real tokens, private keys, or credential files in issues, pull requests, screenshots, or logs.

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

### Frontend (385 tests)

```bash
pnpm test          # Vitest + React Testing Library
pnpm typecheck     # TypeScript type checking
pnpm lint          # ESLint
```

### Rust backend (214 tests)

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
│   │   ├── DiscoverView.tsx
│   │   └── SettingsView.tsx
│   ├── components/             # UI components
│   │   ├── layout/             # Sidebar, app shell
│   │   ├── central/            # Central skills components
│   │   ├── collection/         # Collection editor, picker
│   │   ├── discover/           # Discover scan components
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
│           ├── discover.rs     # Full-disk skill discovery scanner
│           └── settings.rs     # Scan dirs + app settings
└── public/                     # Static assets
```

## Database

SQLite database stored at `~/.skillsmanage/db.sqlite` with WAL mode enabled. The schema is initialized automatically on first launch, including seeding all built-in platform entries.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, validation commands, and pull request expectations.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and data-handling notes.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
