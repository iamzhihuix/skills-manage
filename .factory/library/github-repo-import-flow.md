# GitHub Repo Import Flow

Worker-facing design contract for Milestone 8 GitHub repo import work.

## Approved Scope

- **Input source:** GitHub repo URLs only for v1.
- **Primary entry:** Marketplace.
- **Secondary entry:** Central, launching the same wizard flow.
- **Required flow:** preview discovered skills before any write, select subset for multi-skill repos, resolve duplicates explicitly, import into canonical `~/.agents/skills/`, then optionally install to selected platforms.

## Supported Repo Layouts

The backend preview/import path must support the layouts already aligned with current repository scanning assumptions:

1. **Single-skill repo root layout** — repo root contains one skill directory / root `SKILL.md`.
2. **Top-level `skills/` multi-skill layout** — repo contains multiple skills under `skills/<skill-dir>/SKILL.md`.

Do not expand v1 into arbitrary nested repository traversal.

## Shared Flow

1. User opens the GitHub import wizard from Marketplace or Central.
2. User pastes a GitHub repo URL.
3. Backend returns a **read-only preview** of discovered skills plus duplicate/conflict metadata.
4. User selects the subset to import.
5. For conflicts with existing central skills, user chooses `overwrite`, `skip`, or `rename`.
6. User confirms import.
7. Selected skills are copied into canonical `~/.agents/skills/`.
8. User can optionally choose specific platforms for immediate installation.
9. Central, sidebar counts, and platform views refresh without manual reload.

## Backend Expectations

- Preview and import are separate operations.
- Preview performs **no filesystem writes** and no DB mutations.
- Import copies the **full skill directory**, not only `SKILL.md`.
- Duplicate handling is enforced in the import orchestration layer, not only in the UI.
- Import responses should return enough metadata for the UI to show imported skills and drive the optional platform-install step.
- Invalid / unsupported / no-skill repos must return recoverable errors and perform no writes.

## Frontend Expectations

- Build one reusable wizard/state machine, not separate Marketplace and Central implementations.
- Marketplace is the main CTA surface; Central should later reuse the same wizard component and backend contract.
- Multi-skill preview must support explicit subset selection.
- Conflict resolution UI must be explicit per selected skill; never silently overwrite.
- Post-import platform selection should reuse existing install patterns/stores where possible.
- On browser/Vite surfaces without the Tauri bridge, the wizard must show a friendly desktop-only unsupported state instead of throwing on `invoke()`.

## Validation Inputs

- **Single-skill repo:** `https://github.com/dorukardahan/twitterapi-io-skill`
- **Default multi-skill repo:** `https://github.com/anthropics/skills`
- **Backup multi-skill repo:** `https://github.com/cloudflare/skills`

Use the provided single-skill repo to validate the root-layout import path. Use `anthropics/skills` to validate subset selection against a top-level `skills/` layout. Fall back to `cloudflare/skills` only if `anthropics/skills` becomes unavailable or incompatible during validation.

Actual preview/import assertions must be exercised on a real Tauri runtime. The plain browser/Vite surface should only be used to confirm the non-Tauri fallback message and launcher parity.

## Out of Scope for Milestone 8

- Non-GitHub URLs
- Arbitrary nested repo traversal beyond root + top-level `skills/`
- Direct repo-to-platform installation that bypasses canonical central import
- Background auto-import / auto-install without explicit user confirmation
