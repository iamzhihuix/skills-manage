import { create } from "zustand";
import { UnlistenFn } from "@tauri-apps/api/event";
import {
  ScanRoot,
  DiscoveredProject,
  DiscoverResult,
  DiscoverProgressPayload,
  DiscoverFoundPayload,
  DiscoverCompletePayload,
  DiscoverImportResult,
} from "@/types";
import { invoke, listen, isTauriRuntime } from "@/lib/tauri";

const BROWSER_FIXTURE_DISCOVERED_PROJECTS: DiscoveredProject[] = [
  {
    project_path: "/Users/fixture/project",
    project_name: "Fixture Project",
    skills: [
      {
        id: "fixture-central-skill",
        name: "fixture-central-skill",
        description: "Browser validation fixture for Discover drawer entry.",
        file_path: "/Users/fixture/project/.skills/fixture-central-skill/SKILL.md",
        dir_path: "/Users/fixture/project/.skills/fixture-central-skill",
        platform_id: "claude-code",
        platform_name: "Claude Code",
        project_path: "/Users/fixture/project",
        project_name: "Fixture Project",
        is_already_central: true,
      },
    ],
  },
];

const BROWSER_FIXTURE_TOTAL_SKILLS = BROWSER_FIXTURE_DISCOVERED_PROJECTS.reduce(
  (sum, project) => sum + project.skills.length,
  0
);

// ─── State ────────────────────────────────────────────────────────────────────

interface DiscoverState {
  // Scan configuration
  scanRoots: ScanRoot[];
  isLoadingRoots: boolean;

  // Scan progress
  isScanning: boolean;
  scanProgress: number;
  currentPath: string;
  skillsFoundSoFar: number;
  projectsFoundSoFar: number;

  // Results
  discoveredProjects: DiscoveredProject[];
  totalSkillsFound: number;
  lastScanAt: string | null;

  // Grouping / filtering
  groupBy: "project" | "platform" | "skill";
  platformFilter: string | null;
  searchQuery: string;

  // Selection for batch ops
  selectedSkillIds: Set<string>;

  // Error
  error: string | null;

  // Actions
  loadScanRoots: () => Promise<void>;
  setScanRootEnabled: (path: string, enabled: boolean) => Promise<void>;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  loadDiscoveredSkills: () => Promise<void>;
  refreshCounts: () => Promise<void>;
  rescanFromDisk: () => Promise<void>;
  importToCentral: (skillId: string) => Promise<DiscoverImportResult>;
  importToPlatform: (skillId: string, agentId: string) => Promise<DiscoverImportResult>;
  clearResults: () => Promise<void>;
  setGroupBy: (groupBy: "project" | "platform" | "skill") => void;
  setPlatformFilter: (platformId: string | null) => void;
  setSearchQuery: (query: string) => void;
  toggleSkillSelection: (skillId: string) => void;
  selectAllVisible: (skillIds: string[]) => void;
  clearSelection: () => void;
  clearError: () => void;
}

// ─── Event listeners (managed outside store) ──────────────────────────────────

let unlistenProgress: UnlistenFn | null = null;
let unlistenFound: UnlistenFn | null = null;
let unlistenComplete: UnlistenFn | null = null;

async function setupEventListeners(set: (fn: Partial<DiscoverState> | ((s: DiscoverState) => Partial<DiscoverState>)) => void) {
  // Clean up any existing listeners.
  if (unlistenProgress) { unlistenProgress(); unlistenProgress = null; }
  if (unlistenFound) { unlistenFound(); unlistenFound = null; }
  if (unlistenComplete) { unlistenComplete(); unlistenComplete = null; }

  unlistenProgress = await listen<DiscoverProgressPayload>("discover:progress", (event) => {
    set({
      scanProgress: event.payload.percent,
      currentPath: event.payload.current_path,
      skillsFoundSoFar: event.payload.skills_found,
      projectsFoundSoFar: event.payload.projects_found,
    });
  });

  unlistenFound = await listen<DiscoverFoundPayload>("discover:found", (event) => {
    set((state) => {
      const newProject = event.payload.project;
      // Check if we already have this project (from a different root).
      const existingIdx = state.discoveredProjects.findIndex(
        (p) => p.project_path === newProject.project_path
      );
      let updatedProjects: DiscoveredProject[];
      if (existingIdx >= 0) {
        // Merge skills into existing project.
        updatedProjects = [...state.discoveredProjects];
        updatedProjects[existingIdx] = {
          ...updatedProjects[existingIdx],
          skills: [...updatedProjects[existingIdx].skills, ...newProject.skills],
        };
      } else {
        updatedProjects = [...state.discoveredProjects, newProject];
      }
      const totalSkills = updatedProjects.reduce((sum, p) => sum + p.skills.length, 0);
      return {
        discoveredProjects: updatedProjects,
        totalSkillsFound: totalSkills,
      };
    });
  });

  unlistenComplete = await listen<DiscoverCompletePayload>("discover:complete", () => {
    set({
      isScanning: false,
      scanProgress: 100,
      lastScanAt: new Date().toISOString(),
    });
  });
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useDiscoverStore = create<DiscoverState>((set, get) => ({
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

  // ── Scan Roots ─────────────────────────────────────────────────────────────

  loadScanRoots: async () => {
    set({ isLoadingRoots: true, error: null });
    try {
      // Use get_scan_roots which overlays persisted enabled/disabled states
      // from the DB, rather than discover_scan_roots which only auto-detects.
      const roots = await invoke<ScanRoot[]>("get_scan_roots");
      set({ scanRoots: roots, isLoadingRoots: false });
    } catch (err) {
      set({ error: String(err), isLoadingRoots: false });
    }
  },

  setScanRootEnabled: async (path: string, enabled: boolean) => {
    // Optimistically update local state.
    set((state) => ({
      scanRoots: state.scanRoots.map((r) =>
        r.path === path ? { ...r, enabled } : r
      ),
    }));
    // Persist the change to the backend.
    try {
      await invoke("set_scan_root_enabled", { path, enabled });
    } catch (err) {
      // Revert on failure.
      set((state) => ({
        scanRoots: state.scanRoots.map((r) =>
          r.path === path ? { ...r, enabled: !enabled } : r
        ),
        error: String(err),
      }));
    }
  },

  // ── Scan ───────────────────────────────────────────────────────────────────

  startScan: async () => {
    set({
      isScanning: true,
      scanProgress: 0,
      currentPath: "",
      skillsFoundSoFar: 0,
      projectsFoundSoFar: 0,
      discoveredProjects: [],
      totalSkillsFound: 0,
      error: null,
      selectedSkillIds: new Set<string>(),
    });

    // Set up event listeners for streaming updates.
    await setupEventListeners(set);

    try {
      const { scanRoots } = get();
      const result = await invoke<DiscoverResult>("start_project_scan", {
        roots: scanRoots,
      });
      set({
        isScanning: false,
        scanProgress: 100,
        discoveredProjects: result.projects,
        totalSkillsFound: result.total_skills,
        lastScanAt: new Date().toISOString(),
      });
    } catch (err) {
      set({
        isScanning: false,
        error: String(err),
      });
    }
  },

  stopScan: async () => {
    try {
      await invoke("stop_project_scan");
      set({ isScanning: false, lastScanAt: new Date().toISOString() });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // ── Load persisted results ─────────────────────────────────────────────────

  loadDiscoveredSkills: async () => {
    set({ error: null });
    if (!isTauriRuntime()) {
      set({
        discoveredProjects: BROWSER_FIXTURE_DISCOVERED_PROJECTS,
        totalSkillsFound: 1,
      });
      return;
    }
    try {
      const projects = await invoke<DiscoveredProject[]>("get_discovered_skills");
      const totalSkills = projects.reduce((sum, p) => sum + p.skills.length, 0);
      set({
        discoveredProjects: projects,
        totalSkillsFound: totalSkills,
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  refreshCounts: async () => {
    if (!isTauriRuntime()) {
      set({
        discoveredProjects: BROWSER_FIXTURE_DISCOVERED_PROJECTS,
        totalSkillsFound: BROWSER_FIXTURE_TOTAL_SKILLS,
      });
      return;
    }
    try {
      const projects = await invoke<DiscoveredProject[]>("get_discovered_skills");
      const totalSkills = projects.reduce((sum, p) => sum + p.skills.length, 0);
      set({
        discoveredProjects: projects,
        totalSkillsFound: totalSkills,
      });
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  rescanFromDisk: async () => {
    if (!isTauriRuntime()) {
      set({
        scanRoots: [],
        isLoadingRoots: false,
        isScanning: false,
        scanProgress: 100,
        currentPath: "",
        skillsFoundSoFar: BROWSER_FIXTURE_TOTAL_SKILLS,
        projectsFoundSoFar: BROWSER_FIXTURE_DISCOVERED_PROJECTS.length,
        discoveredProjects: BROWSER_FIXTURE_DISCOVERED_PROJECTS,
        totalSkillsFound: BROWSER_FIXTURE_TOTAL_SKILLS,
        lastScanAt: new Date().toISOString(),
        selectedSkillIds: new Set<string>(),
        error: null,
      });
      return;
    }

    set({ isLoadingRoots: true, error: null });
    try {
      const roots = await invoke<ScanRoot[]>("get_scan_roots");
      set({ scanRoots: roots, isLoadingRoots: false });

      set({
        isScanning: true,
        scanProgress: 0,
        currentPath: "",
        skillsFoundSoFar: 0,
        projectsFoundSoFar: 0,
        discoveredProjects: [],
        totalSkillsFound: 0,
        error: null,
        selectedSkillIds: new Set<string>(),
      });

      await setupEventListeners(set);

      const result = await invoke<DiscoverResult>("start_project_scan", {
        roots,
      });
      set({
        isScanning: false,
        scanProgress: 100,
        discoveredProjects: result.projects,
        totalSkillsFound: result.total_skills,
        lastScanAt: new Date().toISOString(),
      });
    } catch (err) {
      set({
        error: String(err),
        isLoadingRoots: false,
        isScanning: false,
      });
    }
  },

  // ── Import ─────────────────────────────────────────────────────────────────

  importToCentral: async (skillId: string) => {
    set({ error: null });
    try {
      const result = await invoke<DiscoverImportResult>(
        "import_discovered_skill_to_central",
        { discoveredSkillId: skillId }
      );
      // Remove the skill from discovered results.
      set((state) => {
        const updatedProjects = state.discoveredProjects
          .map((p) => ({
            ...p,
            skills: p.skills.filter((s) => s.id !== skillId),
          }))
          .filter((p) => p.skills.length > 0);
        const totalSkills = updatedProjects.reduce((sum, p) => sum + p.skills.length, 0);
        const newSelection = new Set(state.selectedSkillIds);
        newSelection.delete(skillId);
        return {
          discoveredProjects: updatedProjects,
          totalSkillsFound: totalSkills,
          selectedSkillIds: newSelection,
        };
      });
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  importToPlatform: async (skillId: string, agentId: string) => {
    set({ error: null });
    try {
      const result = await invoke<DiscoverImportResult>(
        "import_discovered_skill_to_platform",
        { discoveredSkillId: skillId, agentId }
      );
      // NOTE: We do NOT remove the skill from discovered results here because
      // the Rust backend no longer deletes the discovered record on platform
      // install (to support multi-platform install). The skill stays in the
      // list and will be shown with updated status after the next reload.
      return result;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  // ── Clear ──────────────────────────────────────────────────────────────────

  clearResults: async () => {
    try {
      await invoke("clear_discovered_skills");
      set({
        discoveredProjects: [],
        totalSkillsFound: 0,
        lastScanAt: null,
        selectedSkillIds: new Set<string>(),
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // ── Grouping / Filtering ───────────────────────────────────────────────────

  setGroupBy: (groupBy) => set({ groupBy }),
  setPlatformFilter: (platformFilter) => set({ platformFilter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  // ── Selection ──────────────────────────────────────────────────────────────

  toggleSkillSelection: (skillId) => {
    set((state) => {
      const newSelection = new Set(state.selectedSkillIds);
      if (newSelection.has(skillId)) {
        newSelection.delete(skillId);
      } else {
        newSelection.add(skillId);
      }
      return { selectedSkillIds: newSelection };
    });
  },

  selectAllVisible: (skillIds) => {
    set((state) => {
      const newSelection = new Set(state.selectedSkillIds);
      for (const id of skillIds) {
        newSelection.add(id);
      }
      return { selectedSkillIds: newSelection };
    });
  },

  clearSelection: () => set({ selectedSkillIds: new Set<string>() }),

  // ── Error ──────────────────────────────────────────────────────────────────

  clearError: () => set({ error: null }),
}));
