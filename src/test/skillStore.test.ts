import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScannedSkill } from "../types";

// Mock Tauri core before importing the store
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useSkillStore } from "../stores/skillStore";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockSkills: ScannedSkill[] = [
  {
    id: "frontend-design",
    name: "frontend-design",
    description: "Build distinctive, production-grade frontend interfaces",
    file_path: "~/.claude/skills/frontend-design/SKILL.md",
    dir_path: "~/.claude/skills/frontend-design",
    link_type: "symlink",
    symlink_target: "~/.agents/skills/frontend-design",
    is_central: true,
  },
  {
    id: "code-reviewer",
    name: "code-reviewer",
    description: "Review code changes and identify high-confidence, actionable bugs",
    file_path: "~/.claude/skills/code-reviewer/SKILL.md",
    dir_path: "~/.claude/skills/code-reviewer",
    link_type: "copy",
    is_central: false,
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("skillStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useSkillStore.setState({
      skillsByAgent: {},
      loadingByAgent: {},
      error: null,
    });
    vi.clearAllMocks();
  });

  // ── Initial State ─────────────────────────────────────────────────────────

  it("has correct initial state", () => {
    const state = useSkillStore.getState();
    expect(state.skillsByAgent).toEqual({});
    expect(state.loadingByAgent).toEqual({});
    expect(state.error).toBeNull();
  });

  // ── getSkillsByAgent ──────────────────────────────────────────────────────

  it("calls invoke('get_skills_by_agent') with agentId (camelCase)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockSkills);

    await useSkillStore.getState().getSkillsByAgent("claude-code");

    expect(invoke).toHaveBeenCalledWith("get_skills_by_agent", {
      agentId: "claude-code",
    });
  });

  it("populates skillsByAgent after successful fetch", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockSkills);

    await useSkillStore.getState().getSkillsByAgent("claude-code");

    const state = useSkillStore.getState();
    expect(state.skillsByAgent["claude-code"]).toEqual(mockSkills);
    expect(state.loadingByAgent["claude-code"]).toBe(false);
    expect(state.error).toBeNull();
  });

  it("sets loading to true while fetching", async () => {
    let resolveSkills!: (value: ScannedSkill[]) => void;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise<ScannedSkill[]>((r) => (resolveSkills = r))
    );

    const fetchPromise = useSkillStore.getState().getSkillsByAgent("claude-code");

    // Loading should be true while the call is pending
    expect(useSkillStore.getState().loadingByAgent["claude-code"]).toBe(true);

    resolveSkills(mockSkills);
    await fetchPromise;

    expect(useSkillStore.getState().loadingByAgent["claude-code"]).toBe(false);
  });

  it("sets error and clears loading when fetch fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Agent not found"));

    await useSkillStore.getState().getSkillsByAgent("claude-code");

    const state = useSkillStore.getState();
    expect(state.error).toContain("Agent not found");
    expect(state.loadingByAgent["claude-code"]).toBe(false);
    expect(state.skillsByAgent["claude-code"]).toBeUndefined();
  });

  it("can hold skills for multiple agents independently", async () => {
    const cursorSkills: ScannedSkill[] = [
      {
        id: "deploy",
        name: "deploy",
        description: "Deploy the application",
        file_path: "~/.cursor/skills/deploy/SKILL.md",
        dir_path: "~/.cursor/skills/deploy",
        link_type: "symlink",
        is_central: true,
      },
    ];

    vi.mocked(invoke)
      .mockResolvedValueOnce(mockSkills)
      .mockResolvedValueOnce(cursorSkills);

    await useSkillStore.getState().getSkillsByAgent("claude-code");
    await useSkillStore.getState().getSkillsByAgent("cursor");

    const state = useSkillStore.getState();
    expect(state.skillsByAgent["claude-code"]).toEqual(mockSkills);
    expect(state.skillsByAgent["cursor"]).toEqual(cursorSkills);
  });
});
