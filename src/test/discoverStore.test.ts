import { describe, it, expect, vi, beforeEach } from "vitest";
import * as tauriBridge from "@/lib/tauri";
import { ScanRoot, DiscoveredProject, DiscoverResult, DiscoverImportResult } from "../types";

// Mock Tauri core before importing the store
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock Tauri event (used for streaming scan progress)
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { invoke } from "@tauri-apps/api/core";
import { useDiscoverStore } from "../stores/discoverStore";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockScanRoots: ScanRoot[] = [
  { path: "/home/user/Documents", label: "Documents", exists: true, enabled: true },
  { path: "/home/user/projects", label: "projects", exists: true, enabled: true },
  { path: "/home/user/nonexistent", label: "nonexistent", exists: false, enabled: false },
];

const mockDiscoveredProjects: DiscoveredProject[] = [
  {
    project_path: "/home/user/projects/my-app",
    project_name: "my-app",
    skills: [
      {
        id: "claude-code__my-app__deploy",
        name: "deploy",
        description: "Deploy the app",
        file_path: "/home/user/projects/my-app/.claude/skills/deploy/SKILL.md",
        dir_path: "/home/user/projects/my-app/.claude/skills/deploy",
        platform_id: "claude-code",
        platform_name: "Claude Code",
        project_path: "/home/user/projects/my-app",
        project_name: "my-app",
        is_already_central: false,
      },
      {
        id: "cursor__my-app__review",
        name: "review",
        description: "Review code",
        file_path: "/home/user/projects/my-app/.cursor/skills/review/SKILL.md",
        dir_path: "/home/user/projects/my-app/.cursor/skills/review",
        platform_id: "cursor",
        platform_name: "Cursor",
        project_path: "/home/user/projects/my-app",
        project_name: "my-app",
        is_already_central: true,
      },
    ],
  },
];

const mockImportResult: DiscoverImportResult = {
  skill_id: "deploy",
  target: "central",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("discoverStore", () => {
  beforeEach(() => {
    useDiscoverStore.setState({
      scanRoots: [],
      isLoadingRoots: false,
      isScanning: false,
      scanProgress: 0,
      currentPath: "",
      skillsFoundSoFar: 0,
      projectsFoundSoFar: 0,
      discoveredProjects: [],
      totalSkillsFound: 0,
      lastScanAt: null,
      groupBy: "project",
      platformFilter: null,
      searchQuery: "",
      selectedSkillIds: new Set<string>(),
      error: null,
    });
    vi.clearAllMocks();
  });

  // ── Initial State ─────────────────────────────────────────────────────────

  it("has correct initial state", () => {
    const state = useDiscoverStore.getState();
    expect(state.scanRoots).toEqual([]);
    expect(state.isLoadingRoots).toBe(false);
    expect(state.isScanning).toBe(false);
    expect(state.scanProgress).toBe(0);
    expect(state.currentPath).toBe("");
    expect(state.skillsFoundSoFar).toBe(0);
    expect(state.projectsFoundSoFar).toBe(0);
    expect(state.discoveredProjects).toEqual([]);
    expect(state.totalSkillsFound).toBe(0);
    expect(state.lastScanAt).toBeNull();
    expect(state.groupBy).toBe("project");
    expect(state.platformFilter).toBeNull();
    expect(state.searchQuery).toBe("");
    expect(state.selectedSkillIds).toEqual(new Set());
    expect(state.error).toBeNull();
  });

  // ── loadScanRoots ─────────────────────────────────────────────────────────

  it("calls get_scan_roots (persisted) on loadScanRoots", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockScanRoots);

    await useDiscoverStore.getState().loadScanRoots();

    expect(invoke).toHaveBeenCalledWith("get_scan_roots");
  });

  it("populates scanRoots after successful loadScanRoots", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockScanRoots);

    await useDiscoverStore.getState().loadScanRoots();

    const state = useDiscoverStore.getState();
    expect(state.scanRoots).toEqual(mockScanRoots);
    expect(state.isLoadingRoots).toBe(false);
    expect(state.error).toBeNull();
  });

  it("sets error when loadScanRoots fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("DB error"));

    await useDiscoverStore.getState().loadScanRoots();

    const state = useDiscoverStore.getState();
    expect(state.error).toContain("DB error");
    expect(state.isLoadingRoots).toBe(false);
  });

  // ── setScanRootEnabled ───────────────────────────────────────────────────

  it("optimistically updates local state and persists to backend", async () => {
    useDiscoverStore.setState({ scanRoots: mockScanRoots });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useDiscoverStore.getState().setScanRootEnabled("/home/user/Documents", false);

    // Local state updated optimistically
    const state = useDiscoverStore.getState();
    const changed = state.scanRoots.find((r) => r.path === "/home/user/Documents");
    expect(changed?.enabled).toBe(false);

    // Backend called
    expect(invoke).toHaveBeenCalledWith("set_scan_root_enabled", {
      path: "/home/user/Documents",
      enabled: false,
    });
  });

  it("reverts local state when persist fails", async () => {
    useDiscoverStore.setState({ scanRoots: mockScanRoots });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("persist failed"));

    await useDiscoverStore.getState().setScanRootEnabled("/home/user/Documents", false);

    const state = useDiscoverStore.getState();
    const changed = state.scanRoots.find((r) => r.path === "/home/user/Documents");
    expect(changed?.enabled).toBe(true); // reverted back to original
    expect(state.error).toContain("persist failed");
  });

  // ── startScan ─────────────────────────────────────────────────────────────

  it("calls start_project_scan and updates state", async () => {
    const result: DiscoverResult = {
      total_projects: 1,
      total_skills: 2,
      projects: mockDiscoveredProjects,
    };
    vi.mocked(invoke).mockResolvedValueOnce(result);

    useDiscoverStore.setState({ scanRoots: mockScanRoots });

    await useDiscoverStore.getState().startScan();

    expect(invoke).toHaveBeenCalledWith("start_project_scan", {
      roots: mockScanRoots,
    });

    const state = useDiscoverStore.getState();
    expect(state.isScanning).toBe(false);
    expect(state.scanProgress).toBe(100);
    expect(state.discoveredProjects).toEqual(mockDiscoveredProjects);
    expect(state.totalSkillsFound).toBe(2);
    expect(state.lastScanAt).not.toBeNull();
  });

  it("resets state when starting a scan", async () => {
    useDiscoverStore.setState({
      discoveredProjects: mockDiscoveredProjects,
      totalSkillsFound: 5,
      selectedSkillIds: new Set(["some-id"]),
    });

    const result: DiscoverResult = {
      total_projects: 0,
      total_skills: 0,
      projects: [],
    };
    vi.mocked(invoke).mockResolvedValueOnce(result);
    useDiscoverStore.setState({ scanRoots: mockScanRoots });

    await useDiscoverStore.getState().startScan();

    // Verify that state was reset before the scan result was set
    // (We check the final state after scan completes)
    const state = useDiscoverStore.getState();
    expect(state.selectedSkillIds).toEqual(new Set());
  });

  it("sets error when startScan fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("scan failed"));
    useDiscoverStore.setState({ scanRoots: mockScanRoots });

    await useDiscoverStore.getState().startScan();

    const state = useDiscoverStore.getState();
    expect(state.isScanning).toBe(false);
    expect(state.error).toContain("scan failed");
  });

  it("rescanFromDisk reloads persisted scan roots and reruns the real project scan", async () => {
    const result: DiscoverResult = {
      total_projects: 1,
      total_skills: 2,
      projects: mockDiscoveredProjects,
    };

    vi.mocked(invoke)
      .mockResolvedValueOnce(mockScanRoots)
      .mockResolvedValueOnce(result);

    await useDiscoverStore.getState().rescanFromDisk();

    expect(invoke).toHaveBeenNthCalledWith(1, "get_scan_roots");
    expect(invoke).toHaveBeenNthCalledWith(2, "start_project_scan", {
      roots: mockScanRoots,
    });
    expect(invoke).not.toHaveBeenCalledWith("get_discovered_skills");

    const state = useDiscoverStore.getState();
    expect(state.scanRoots).toEqual(mockScanRoots);
    expect(state.discoveredProjects).toEqual(mockDiscoveredProjects);
    expect(state.totalSkillsFound).toBe(2);
    expect(state.lastScanAt).not.toBeNull();
  });

  it("rescanFromDisk surfaces root-loading failures without starting a stale cached refresh", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("root load failed"));

    await useDiscoverStore.getState().rescanFromDisk();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_scan_roots");

    const state = useDiscoverStore.getState();
    expect(state.isLoadingRoots).toBe(false);
    expect(state.isScanning).toBe(false);
    expect(state.error).toContain("root load failed");
  });

  // ── stopScan ──────────────────────────────────────────────────────────────

  it("calls stop_project_scan on stopScan", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useDiscoverStore.getState().stopScan();

    expect(invoke).toHaveBeenCalledWith("stop_project_scan");
  });

  it("sets isScanning to false on stopScan", async () => {
    useDiscoverStore.setState({ isScanning: true });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useDiscoverStore.getState().stopScan();

    expect(useDiscoverStore.getState().isScanning).toBe(false);
  });

  // ── loadDiscoveredSkills ──────────────────────────────────────────────────

  it("calls get_discovered_skills on loadDiscoveredSkills", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockDiscoveredProjects);

    await useDiscoverStore.getState().loadDiscoveredSkills();

    expect(invoke).toHaveBeenCalledWith("get_discovered_skills");
  });

  it("populates discoveredProjects after successful loadDiscoveredSkills", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockDiscoveredProjects);

    await useDiscoverStore.getState().loadDiscoveredSkills();

    const state = useDiscoverStore.getState();
    expect(state.discoveredProjects).toEqual(mockDiscoveredProjects);
    expect(state.totalSkillsFound).toBe(2);
  });

  it("sets error when loadDiscoveredSkills fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("load failed"));

    await useDiscoverStore.getState().loadDiscoveredSkills();

    const state = useDiscoverStore.getState();
    expect(state.error).toContain("load failed");
  });

  it("returns deterministic browser fixture discover results when Tauri runtime is unavailable", async () => {
    const isTauriSpy = vi.spyOn(tauriBridge, "isTauriRuntime").mockReturnValue(false);

    await useDiscoverStore.getState().loadDiscoveredSkills();

    expect(invoke).not.toHaveBeenCalled();
    expect(useDiscoverStore.getState().discoveredProjects).toEqual([
      expect.objectContaining({
        project_name: "Fixture Project",
        project_path: "/Users/fixture/project",
        skills: [expect.objectContaining({ id: "fixture-central-skill", is_already_central: true })],
      }),
    ]);
    expect(useDiscoverStore.getState().totalSkillsFound).toBe(1);

    isTauriSpy.mockRestore();
  });

  // ── importToCentral ──────────────────────────────────────────────────────

  it("calls import_discovered_skill_to_central with correct args", async () => {
    useDiscoverStore.setState({ discoveredProjects: mockDiscoveredProjects });
    vi.mocked(invoke).mockResolvedValueOnce(mockImportResult);

    await useDiscoverStore.getState().importToCentral("claude-code__my-app__deploy");

    expect(invoke).toHaveBeenCalledWith("import_discovered_skill_to_central", {
      discoveredSkillId: "claude-code__my-app__deploy",
    });
  });

  it("removes imported skill from discoveredProjects", async () => {
    useDiscoverStore.setState({ discoveredProjects: mockDiscoveredProjects });
    vi.mocked(invoke).mockResolvedValueOnce(mockImportResult);

    await useDiscoverStore.getState().importToCentral("claude-code__my-app__deploy");

    const state = useDiscoverStore.getState();
    expect(state.discoveredProjects[0].skills).toHaveLength(1);
    expect(state.discoveredProjects[0].skills[0].id).toBe("cursor__my-app__review");
    expect(state.totalSkillsFound).toBe(1);
  });

  it("removes imported skill from selectedSkillIds", async () => {
    useDiscoverStore.setState({
      discoveredProjects: mockDiscoveredProjects,
      selectedSkillIds: new Set(["claude-code__my-app__deploy"]),
    });
    vi.mocked(invoke).mockResolvedValueOnce(mockImportResult);

    await useDiscoverStore.getState().importToCentral("claude-code__my-app__deploy");

    const state = useDiscoverStore.getState();
    expect(state.selectedSkillIds.has("claude-code__my-app__deploy")).toBe(false);
  });

  it("sets error when importToCentral fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("import failed"));

    await expect(
      useDiscoverStore.getState().importToCentral("nonexistent-id")
    ).rejects.toThrow();

    const state = useDiscoverStore.getState();
    expect(state.error).toContain("import failed");
  });

  // ── importToPlatform ──────────────────────────────────────────────────────

  it("calls import_discovered_skill_to_platform with correct args", async () => {
    useDiscoverStore.setState({ discoveredProjects: mockDiscoveredProjects });
    const platformResult: DiscoverImportResult = { skill_id: "deploy", target: "claude-code" };
    vi.mocked(invoke).mockResolvedValueOnce(platformResult);

    await useDiscoverStore.getState().importToPlatform("claude-code__my-app__deploy", "claude-code");

    expect(invoke).toHaveBeenCalledWith("import_discovered_skill_to_platform", {
      discoveredSkillId: "claude-code__my-app__deploy",
      agentId: "claude-code",
    });
  });

  // ── clearResults ──────────────────────────────────────────────────────────

  it("calls clear_discovered_skills and resets state", async () => {
    useDiscoverStore.setState({
      discoveredProjects: mockDiscoveredProjects,
      totalSkillsFound: 2,
      selectedSkillIds: new Set(["some-id"]),
    });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await useDiscoverStore.getState().clearResults();

    expect(invoke).toHaveBeenCalledWith("clear_discovered_skills");

    const state = useDiscoverStore.getState();
    expect(state.discoveredProjects).toEqual([]);
    expect(state.totalSkillsFound).toBe(0);
    expect(state.lastScanAt).toBeNull();
    expect(state.selectedSkillIds).toEqual(new Set());
  });

  // ── Grouping / Filtering ──────────────────────────────────────────────────

  it("setGroupBy updates groupBy state", () => {
    useDiscoverStore.getState().setGroupBy("platform");
    expect(useDiscoverStore.getState().groupBy).toBe("platform");

    useDiscoverStore.getState().setGroupBy("skill");
    expect(useDiscoverStore.getState().groupBy).toBe("skill");
  });

  it("setPlatformFilter updates platformFilter state", () => {
    useDiscoverStore.getState().setPlatformFilter("claude-code");
    expect(useDiscoverStore.getState().platformFilter).toBe("claude-code");

    useDiscoverStore.getState().setPlatformFilter(null);
    expect(useDiscoverStore.getState().platformFilter).toBeNull();
  });

  it("setSearchQuery updates searchQuery state", () => {
    useDiscoverStore.getState().setSearchQuery("deploy");
    expect(useDiscoverStore.getState().searchQuery).toBe("deploy");
  });

  // ── Selection ──────────────────────────────────────────────────────────────

  it("toggleSkillSelection adds and removes skill IDs", () => {
    useDiscoverStore.getState().toggleSkillSelection("skill-1");
    expect(useDiscoverStore.getState().selectedSkillIds.has("skill-1")).toBe(true);

    useDiscoverStore.getState().toggleSkillSelection("skill-1");
    expect(useDiscoverStore.getState().selectedSkillIds.has("skill-1")).toBe(false);
  });

  it("selectAllVisible adds all given IDs", () => {
    useDiscoverStore.getState().selectAllVisible(["skill-1", "skill-2", "skill-3"]);
    const state = useDiscoverStore.getState();
    expect(state.selectedSkillIds.has("skill-1")).toBe(true);
    expect(state.selectedSkillIds.has("skill-2")).toBe(true);
    expect(state.selectedSkillIds.has("skill-3")).toBe(true);
  });

  it("clearSelection removes all selected IDs", () => {
    useDiscoverStore.setState({ selectedSkillIds: new Set(["skill-1", "skill-2"]) });
    useDiscoverStore.getState().clearSelection();
    expect(useDiscoverStore.getState().selectedSkillIds).toEqual(new Set());
  });

  // ── Error ──────────────────────────────────────────────────────────────────

  it("clearError resets error to null", () => {
    useDiscoverStore.setState({ error: "something went wrong" });
    useDiscoverStore.getState().clearError();
    expect(useDiscoverStore.getState().error).toBeNull();
  });
});
