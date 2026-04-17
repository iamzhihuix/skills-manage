---
name: react-frontend-worker
description: Implements React frontend features including UI components, pages, stores, and Tauri command integration.
---

# React Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:
- React components (pages, layouts, dialogs)
- Zustand stores and hooks
- Tauri `invoke()` integration from frontend
- Tailwind CSS / shadcn/ui styling
- React Router routes and navigation
- Frontend search/filter logic

## Required Skills

- `agent-browser` — MUST be invoked to verify UI flows after implementation.

## Work Procedure

1. **Read the feature description** carefully. Read `docs/desktop-design.md` sections 5 (UI Layout) for wireframes. Read `.factory/library/architecture.md` for data flow.

2. **Write tests first (TDD)**:
   - Write Vitest + React Testing Library tests BEFORE implementation.
   - Test component rendering, user interactions, state changes.
   - Mock `@tauri-apps/api/core` invoke calls using `vi.mock`.
   - Test Zustand store actions independently.

3. **Implement the feature**:
   - Use shadcn/ui components as building blocks (Button, Card, Dialog, Input, ScrollArea, etc.).
   - Use Tailwind CSS 4 for all custom styling — no inline styles or CSS modules.
   - Zustand stores call `invoke()` and manage loading/error states.
   - Follow existing component patterns in the codebase.
   - Use React Router `useNavigate` and `useParams` for navigation.

4. **Verify with commands**:
   - Run `pnpm test` — all Vitest tests pass.
   - Run `pnpm typecheck` (tsc --noEmit) — no type errors.
   - Run `pnpm lint` — no lint errors.
   - If the full Vitest suite hits failures that are already documented in mission guidance as pre-existing/unrelated, run the relevant targeted tests for your feature as well and clearly distinguish baseline noise from new regressions in the handoff.

5. **Verify with agent-browser** (REQUIRED):
   - Invoke the `agent-browser` skill to verify the UI.
   - Navigate to the page/component being built.
   - Verify visual rendering, interactions, navigation.
   - Each UI flow verified = one `interactiveChecks` entry.
   - If the feature depends on Tauri runtime-only commands, verify the real end-to-end behavior on an actual Tauri dev/native surface. The plain Vite/browser surface is only acceptable for confirming graceful fallback behavior there (for example, a desktop-only unsupported state instead of a thrown `invoke` error).

## Example Handoff

```json
{
  "salientSummary": "Built Platform View page showing skill list with source indicators. Verified via agent-browser: clicked Claude Code in sidebar, saw 5 skills with correct symlink/copy labels, search filtered to 2 results.",
  "whatWasImplemented": "PlatformView.tsx with SkillList and SkillCard components. platformStore.ts with getSkillsByAgent action calling Tauri invoke. Search filter using useMemo. Empty state component. Route /platform/:agentId.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "pnpm test", "exitCode": 0, "observation": "18 tests passed" },
      { "command": "pnpm typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "pnpm lint", "exitCode": 0, "observation": "No lint errors" }
    ],
    "interactiveChecks": [
      { "action": "Clicked Claude Code in sidebar", "observed": "Platform view loaded showing 5 skills with header 'Claude Code — ~/.claude/skills/'" },
      { "action": "Checked skill card source indicators", "observed": "3 skills show 'Central Skills · symlink', 2 show '独立安装 · copy'" },
      { "action": "Typed 'front' in search bar", "observed": "List filtered to 1 skill: frontend-design" },
      { "action": "Clicked a skill card", "observed": "Navigated to /skill/frontend-design detail page" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/components/platform/PlatformView.test.tsx",
        "cases": [
          { "name": "renders skill list for agent", "verifies": "Fetches and displays skills for given agent ID" },
          { "name": "shows empty state when no skills", "verifies": "Displays message when agent has 0 skills" },
          { "name": "search filters by name", "verifies": "Typing in search filters the skill list" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Tauri command interface doesn't match what the frontend expects
- shadcn/ui component not installed yet (need to run `npx shadcn@latest add <component>`)
- Design spec is ambiguous about interaction behavior
