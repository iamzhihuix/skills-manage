# Changelog

All notable changes to this project will be documented in this file.

## 0.9.1 - 2026-04-23

Maintenance release focused on full-path display consistency and small README polish.

### Fixes

- Show full absolute paths in Central, Platform, Settings, Global Search, and platform-edit flows instead of collapsing paths to `~`.
- Render Windows paths with drive letters and backslashes in display-oriented UI surfaces.
- Keep auto-generated custom platform paths aligned with the detected home-directory style on each platform.

### Improvements

- Add a `Star History` section to the English and Chinese READMEs.
- Extend path helper tests and affected UI assertions to cover the new display rules.

## 0.9.0 - 2026-04-23

Cross-platform release centered on Windows support, universal macOS packaging, and reliability fixes.

### Highlights

- Add Windows x64 desktop support with `.msi` installer and portable `.zip` package outputs.
- Upgrade macOS packaging to universal builds with `.dmg`, `.zip`, and `.tar.gz` release artifacts.

### Features

- Add Windows-aware home and path handling across backend commands, scan-directory settings, and frontend path displays.
- Add automatic install fallback from symlink to copy on Windows when symlink creation is blocked.
- Add GitHub Actions packaging and release automation for Windows x64 and macOS universal desktop builds.

### Fixes

- Preserve Claude source-specific platform rows, detail actions, and explanation content across reloads and rescans.
- Refresh central, platform, and discover surfaces more reliably after global rescans.
- Improve path labels, sidebar/detail continuity, and a set of small accessibility and interaction refinements across settings and skill views.

## 0.8.0 - 2026-04-20

First public release.

### Features

- Launch `skills-manage` as a Tauri desktop app for managing AI agent skills across built-in and custom platforms from one place.
- Add platform and central skill views with install, uninstall, symlink-aware status, and canonical skill management.
- Add a full skill detail experience with markdown preview, in-place drawer navigation, install actions, and collection-aware workflows.
- Add collections management, custom platform settings, configurable scan roots, onboarding, toast feedback, and a responsive sidebar.
- Add Chinese and English UI support, a Catppuccin multi-flavor theme system, accent color controls, and a global command palette.
- Add project-level Discover scanning with recursive search, cached results, stop-scan controls, import to central, and improved navigation context.
- Add marketplace browsing, preview drawers, auto-centralized installs, and AI-generated skill explanations.
- Add GitHub repository import with preview, mirror fallback retries, optional authenticated requests, selection persistence, and post-import platform install flows.

### Performance

- Improve global search, central search, and project skill browsing with deferred queries, lazy indexing, lighter search result cards, and list virtualization for large datasets.

### Fixes

- Harden AI explanation generation by rejecting blank cached content and re-generating corrupted empty explanations.
- Improve frontmatter handling by extracting structured metadata such as `name`, `description`, and `version` instead of leaking raw YAML into markdown previews.
- Show existing collection membership in skill details and preselect already-added collections in add-to-collection flows.
- Refine detail drawer, marketplace preview, and GitHub import layouts to preserve context and reduce navigation friction.
