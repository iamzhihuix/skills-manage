import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { AgentWithStatus, BatchInstallResult, SkillWithLinks } from "@/types";

// ─── State ────────────────────────────────────────────────────────────────────

interface CentralSkillsState {
  skills: SkillWithLinks[];
  agents: AgentWithStatus[];
  isLoading: boolean;
  isInstalling: boolean;
  error: string | null;

  // Actions
  loadCentralSkills: () => Promise<void>;
  installSkill: (
    skillId: string,
    agentIds: string[],
    method: string
  ) => Promise<BatchInstallResult>;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useCentralSkillsStore = create<CentralSkillsState>((set) => ({
  skills: [],
  agents: [],
  isLoading: false,
  isInstalling: false,
  error: null,

  /**
   * Load all Central Skills with per-platform link status, along with the
   * list of all registered agents. Called when navigating to /central.
   */
  loadCentralSkills: async () => {
    set({ isLoading: true, error: null });
    try {
      const [skills, agents] = await Promise.all([
        invoke<SkillWithLinks[]>("get_central_skills"),
        invoke<AgentWithStatus[]>("get_agents"),
      ]);
      set({ skills: skills ?? [], agents: agents ?? [], isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  /**
   * Install a skill to one or more agents. Refreshes the skill list after
   * a successful (or partial) install so link status icons update.
   */
  installSkill: async (skillId, agentIds, method) => {
    set({ isInstalling: true, error: null });
    try {
      const result = await invoke<BatchInstallResult>("batch_install_to_agents", {
        skillId,
        agentIds,
        method,
      });

      // Refresh central skills to get updated link status.
      const skills = await invoke<SkillWithLinks[]>("get_central_skills");
      set({ skills, isInstalling: false });

      return result;
    } catch (err) {
      set({ error: String(err), isInstalling: false });
      throw err;
    }
  },
}));
