import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { ScanDirectory, AgentWithStatus, CustomAgentConfig, UpdateCustomAgentConfig } from "@/types";

// ─── State ────────────────────────────────────────────────────────────────────

interface SettingsState {
  scanDirectories: ScanDirectory[];
  isLoadingScanDirs: boolean;
  error: string | null;
  githubPat: string;
  isLoadingGitHubPat: boolean;
  isSavingGitHubPat: boolean;
  centralSkillsDir: string;
  defaultCentralSkillsDir: string;
  isLoadingCentralDir: boolean;
  isSavingCentralDir: boolean;

  // Actions — scan directories
  loadScanDirectories: () => Promise<void>;
  addScanDirectory: (path: string, label?: string) => Promise<ScanDirectory>;
  removeScanDirectory: (path: string) => Promise<void>;
  toggleScanDirectory: (path: string, active: boolean) => Promise<void>;

  // Actions — GitHub PAT
  loadGitHubPat: () => Promise<void>;
  saveGitHubPat: (value: string) => Promise<void>;
  clearGitHubPat: () => Promise<void>;

  // Actions — central skills dir
  loadCentralSkillsDir: () => Promise<void>;
  saveCentralSkillsDir: (path: string) => Promise<void>;
  resetCentralSkillsDir: () => Promise<void>;

  // Actions — custom agents
  addCustomAgent: (config: CustomAgentConfig) => Promise<AgentWithStatus>;
  updateCustomAgent: (agentId: string, config: UpdateCustomAgentConfig) => Promise<AgentWithStatus>;
  removeCustomAgent: (agentId: string) => Promise<void>;

  clearError: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>((set) => ({
  scanDirectories: [],
  isLoadingScanDirs: false,
  error: null,
  githubPat: "",
  isLoadingGitHubPat: false,
  isSavingGitHubPat: false,
  centralSkillsDir: "",
  defaultCentralSkillsDir: "",
  isLoadingCentralDir: false,
  isSavingCentralDir: false,

  // ── Scan Directories ───────────────────────────────────────────────────────

  /**
   * Load all scan directories from the backend.
   */
  loadScanDirectories: async () => {
    set({ isLoadingScanDirs: true, error: null });
    try {
      const dirs = await invoke<ScanDirectory[]>("get_scan_directories");
      set({ scanDirectories: dirs, isLoadingScanDirs: false });
    } catch (err) {
      set({ error: String(err), isLoadingScanDirs: false });
    }
  },

  /**
   * Add a new custom scan directory.
   * Returns the created ScanDirectory or throws on error.
   */
  addScanDirectory: async (path: string, label?: string) => {
    const dir = await invoke<ScanDirectory>("add_scan_directory", {
      path,
      label: label || null,
    });
    // Refresh the list
    set((state) => ({
      scanDirectories: [...state.scanDirectories, dir],
    }));
    return dir;
  },

  /**
   * Remove a custom scan directory by path.
   */
  removeScanDirectory: async (path: string) => {
    await invoke<void>("remove_scan_directory", { path });
    set((state) => ({
      scanDirectories: state.scanDirectories.filter((d) => d.path !== path),
    }));
  },

  /**
   * Toggle the active state of a custom scan directory.
   * Persists the change to the backend database.
   */
  toggleScanDirectory: async (path: string, active: boolean) => {
    await invoke<void>("set_scan_directory_active", { path, isActive: active });
    set((state) => ({
      scanDirectories: state.scanDirectories.map((d) =>
        d.path === path ? { ...d, is_active: active } : d
      ),
    }));
  },

  // ── GitHub PAT ────────────────────────────────────────────────────────────

  loadGitHubPat: async () => {
    set({ isLoadingGitHubPat: true, error: null });
    try {
      const value = await invoke<string | null>("get_setting", { key: "github_pat" });
      set({
        githubPat: value ?? "",
        isLoadingGitHubPat: false,
      });
    } catch (err) {
      set({
        error: String(err),
        isLoadingGitHubPat: false,
      });
    }
  },

  saveGitHubPat: async (value: string) => {
    set({ isSavingGitHubPat: true, error: null });
    try {
      await invoke("set_setting", { key: "github_pat", value });
      set({
        githubPat: value.trim(),
        isSavingGitHubPat: false,
      });
    } catch (err) {
      set({
        error: String(err),
        isSavingGitHubPat: false,
      });
      throw err;
    }
  },

  clearGitHubPat: async () => {
    set({ isSavingGitHubPat: true, error: null });
    try {
      await invoke("set_setting", { key: "github_pat", value: "" });
      set({
        githubPat: "",
        isSavingGitHubPat: false,
      });
    } catch (err) {
      set({
        error: String(err),
        isSavingGitHubPat: false,
      });
      throw err;
    }
  },

  // ── Central Skills Dir ─────────────────────────────────────────────────────

  loadCentralSkillsDir: async () => {
    set({ isLoadingCentralDir: true, error: null });
    try {
      const [path, defaultPath] = await Promise.all([
        invoke<string>("get_central_skills_dir"),
        invoke<string>("get_default_central_skills_dir"),
      ]);
      set({
        centralSkillsDir: path,
        defaultCentralSkillsDir: defaultPath,
        isLoadingCentralDir: false,
      });
    } catch (err) {
      set({ error: String(err), isLoadingCentralDir: false });
    }
  },

  saveCentralSkillsDir: async (newPath: string) => {
    set({ isSavingCentralDir: true, error: null });
    try {
      const expandedPath = await invoke<string>("set_central_skills_dir", { path: newPath });
      set({ centralSkillsDir: expandedPath, isSavingCentralDir: false });
    } catch (err) {
      set({ error: String(err), isSavingCentralDir: false });
      throw err;
    }
  },

  resetCentralSkillsDir: async () => {
    set({ isSavingCentralDir: true, error: null });
    try {
      const { defaultCentralSkillsDir } = useSettingsStore.getState();
      if (defaultCentralSkillsDir) {
        await invoke<string>("set_central_skills_dir", { path: defaultCentralSkillsDir });
        set({ centralSkillsDir: defaultCentralSkillsDir, isSavingCentralDir: false });
      }
    } catch (err) {
      set({ error: String(err), isSavingCentralDir: false });
      throw err;
    }
  },

  // ── Custom Agents ──────────────────────────────────────────────────────────

  /**
   * Register a new user-defined agent.
   * Returns the created AgentWithStatus or throws on error.
   */
  addCustomAgent: async (config: CustomAgentConfig) => {
    const agent = await invoke<AgentWithStatus>("add_custom_agent", { config });
    return agent;
  },

  /**
   * Update an existing user-defined agent.
   * Returns the updated AgentWithStatus or throws on error.
   */
  updateCustomAgent: async (agentId: string, config: UpdateCustomAgentConfig) => {
    const agent = await invoke<AgentWithStatus>("update_custom_agent", {
      agentId,
      config,
    });
    return agent;
  },

  /**
   * Remove a user-defined agent by ID.
   */
  removeCustomAgent: async (agentId: string) => {
    await invoke<void>("remove_custom_agent", { agentId });
  },

  // ── Misc ───────────────────────────────────────────────────────────────────

  clearError: () => set({ error: null }),
}));
