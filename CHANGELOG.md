# Changelog

All notable changes to this project will be documented in this file.

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
