import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentWithStatus, SkillWithLinks } from "../types";

// Mock Tauri core before importing the store
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useCentralSkillsStore } from "../stores/centralSkillsStore";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockSkills: SkillWithLinks[] = [
  {
    id: "frontend-design",
    name: "frontend-design",
    description: "Build distinctive frontend UIs",
    file_path: "~/.agents/skills/frontend-design/SKILL.md",
    canonical_path: "~/.agents/skills/frontend-design",
    is_central: true,
    scanned_at: "2026-04-09T00:00:00Z",
    linked_agents: ["claude-code", "cursor"],
  },
  {
    id: "code-reviewer",
    name: "code-reviewer",
    description: "Review code changes and identify bugs",
    file_path: "~/.agents/skills/code-reviewer/SKILL.md",
    canonical_path: "~/.agents/skills/code-reviewer",
    is_central: true,
    scanned_at: "2026-04-09T00:00:00Z",
    linked_agents: [],
  },
];

const mockAgents: AgentWithStatus[] = [
  {
    id: "claude-code",
    display_name: "Claude Code",
    category: "coding",
    global_skills_dir: "~/.claude/skills/",
    is_detected: true,
    is_builtin: true,
    is_enabled: true,
  },
  {
    id: "cursor",
    display_name: "Cursor",
    category: "coding",
    global_skills_dir: "~/.cursor/skills/",
    is_detected: true,
    is_builtin: true,
    is_enabled: true,
  },
  {
    id: "central",
    display_name: "Central Skills",
    category: "central",
    global_skills_dir: "~/.agents/skills/",
    is_detected: true,
    is_builtin: true,
    is_enabled: true,
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("centralSkillsStore", () => {
  beforeEach(() => {
    useCentralSkillsStore.setState({
      skills: [],
      agents: [],
      isLoading: false,
      isInstalling: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  // ── Initial State ─────────────────────────────────────────────────────────

  it("has correct initial state", () => {
    const state = useCentralSkillsStore.getState();
    expect(state.skills).toEqual([]);
    expect(state.agents).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.isInstalling).toBe(false);
    expect(state.error).toBeNull();
  });

  // ── loadCentralSkills ─────────────────────────────────────────────────────

  it("calls get_central_skills and get_agents on loadCentralSkills", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockSkills) // get_central_skills
      .mockResolvedValueOnce(mockAgents); // get_agents

    await useCentralSkillsStore.getState().loadCentralSkills();

    expect(invoke).toHaveBeenCalledWith("get_central_skills");
    expect(invoke).toHaveBeenCalledWith("get_agents");
  });

  it("populates skills and agents after successful loadCentralSkills", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockSkills)
      .mockResolvedValueOnce(mockAgents);

    await useCentralSkillsStore.getState().loadCentralSkills();

    const state = useCentralSkillsStore.getState();
    expect(state.skills).toEqual(mockSkills);
    expect(state.agents).toEqual(mockAgents);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("sets error when loadCentralSkills fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("DB error"));

    await useCentralSkillsStore.getState().loadCentralSkills();

    const state = useCentralSkillsStore.getState();
    expect(state.error).toContain("DB error");
    expect(state.isLoading).toBe(false);
  });

  // ── installSkill ──────────────────────────────────────────────────────────

  it("calls batch_install_to_agents then refreshes skills", async () => {
    const batchResult = { succeeded: ["cursor"], failed: [] };
    const updatedSkills = [
      { ...mockSkills[0], linked_agents: ["claude-code", "cursor", "gemini-cli"] },
      mockSkills[1],
    ];

    vi.mocked(invoke)
      .mockResolvedValueOnce(batchResult) // batch_install_to_agents
      .mockResolvedValueOnce(updatedSkills); // get_central_skills (refresh)

    await useCentralSkillsStore
      .getState()
      .installSkill("frontend-design", ["cursor"], "symlink");

    expect(invoke).toHaveBeenCalledWith("batch_install_to_agents", {
      skillId: "frontend-design",
      agentIds: ["cursor"],
      method: "symlink",
    });
    // Refresh call
    expect(invoke).toHaveBeenCalledWith("get_central_skills");

    const state = useCentralSkillsStore.getState();
    expect(state.skills).toEqual(updatedSkills);
    expect(state.isInstalling).toBe(false);
  });

  it("forwards 'copy' method to batch_install_to_agents", async () => {
    const batchResult = { succeeded: ["cursor"], failed: [] };
    vi.mocked(invoke)
      .mockResolvedValueOnce(batchResult)
      .mockResolvedValueOnce(mockSkills);

    await useCentralSkillsStore
      .getState()
      .installSkill("frontend-design", ["cursor"], "copy");

    expect(invoke).toHaveBeenCalledWith("batch_install_to_agents", {
      skillId: "frontend-design",
      agentIds: ["cursor"],
      method: "copy",
    });
  });

  it("returns the BatchInstallResult from installSkill", async () => {
    const batchResult = { succeeded: ["cursor"], failed: [] };
    vi.mocked(invoke)
      .mockResolvedValueOnce(batchResult)
      .mockResolvedValueOnce(mockSkills);

    const result = await useCentralSkillsStore
      .getState()
      .installSkill("frontend-design", ["cursor"], "symlink");

    expect(result).toEqual(batchResult);
  });

  it("sets error and re-throws when installSkill fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("symlink failed"));

    await expect(
      useCentralSkillsStore
        .getState()
        .installSkill("frontend-design", ["cursor"], "symlink")
    ).rejects.toThrow("symlink failed");

    const state = useCentralSkillsStore.getState();
    expect(state.error).toContain("symlink failed");
    expect(state.isInstalling).toBe(false);
  });
});
