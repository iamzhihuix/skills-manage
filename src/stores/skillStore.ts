import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { ScannedSkill } from "@/types";

// ─── State ────────────────────────────────────────────────────────────────────

interface SkillState {
  skillsByAgent: Record<string, ScannedSkill[]>;
  loadingByAgent: Record<string, boolean>;
  error: string | null;

  // Actions
  getSkillsByAgent: (agentId: string) => Promise<void>;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSkillStore = create<SkillState>((set) => ({
  skillsByAgent: {},
  loadingByAgent: {},
  error: null,

  /**
   * Fetch skills for a specific agent by invoking the Tauri backend command.
   * Results are cached per agentId in skillsByAgent.
   */
  getSkillsByAgent: async (agentId: string) => {
    set((state) => ({
      loadingByAgent: { ...state.loadingByAgent, [agentId]: true },
      error: null,
    }));
    try {
      const skills = await invoke<ScannedSkill[]>("get_skills_by_agent", {
        agentId,
      });
      set((state) => ({
        skillsByAgent: { ...state.skillsByAgent, [agentId]: skills },
        loadingByAgent: { ...state.loadingByAgent, [agentId]: false },
      }));
    } catch (err) {
      set((state) => ({
        error: String(err),
        loadingByAgent: { ...state.loadingByAgent, [agentId]: false },
      }));
    }
  },
}));
