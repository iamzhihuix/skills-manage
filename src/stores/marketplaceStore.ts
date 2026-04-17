import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  SkillRegistry,
  MarketplaceSkill,
  GitHubRepoPreview,
  GitHubRepoImportResult,
  GitHubSkillImportSelection,
} from "@/types";

interface GitHubImportState {
  isPreviewLoading: boolean;
  isImporting: boolean;
  preview: GitHubRepoPreview | null;
  importResult: GitHubRepoImportResult | null;
  previewedRepoUrl: string | null;
  error: string | null;
}

interface MarketplaceState {
  registries: SkillRegistry[];
  skills: MarketplaceSkill[];
  selectedRegistryId: string | null;
  searchQuery: string;
  isLoading: boolean;
  isSyncing: boolean;
  installingIds: Set<string>;
  error: string | null;
  githubImport: GitHubImportState;

  loadRegistries: () => Promise<void>;
  selectRegistry: (id: string) => void;
  setSearchQuery: (query: string) => void;
  syncRegistry: (registryId: string, forceRefresh?: boolean) => Promise<void>;
  loadSkills: (registryId: string, query?: string) => Promise<void>;
  loadPreviewSkills: (registryId: string) => Promise<MarketplaceSkill[]>;
  installSkill: (skillId: string) => Promise<void>;
  addRegistry: (name: string, sourceType: string, url: string) => Promise<SkillRegistry>;
  removeRegistry: (registryId: string) => Promise<void>;
  getNormalizedRegistryIdentity: (url: string) => string | null;
  findDuplicateRegistry: (url: string) => SkillRegistry | null;
  previewGitHubRepoImport: (repoUrl: string) => Promise<GitHubRepoPreview>;
  importGitHubRepoSkills: (
    repoUrl: string,
    selections: GitHubSkillImportSelection[]
  ) => Promise<GitHubRepoImportResult>;
  resetGitHubImport: () => void;
}

const initialGitHubImportState = (): GitHubImportState => ({
  isPreviewLoading: false,
  isImporting: false,
  preview: null,
  importResult: null,
  previewedRepoUrl: null,
  error: null,
});

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  registries: [],
  skills: [],
  selectedRegistryId: null,
  searchQuery: "",
  isLoading: false,
  isSyncing: false,
  installingIds: new Set(),
  error: null,
  githubImport: initialGitHubImportState(),

  getNormalizedRegistryIdentity: (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return null;

    const githubMatch = trimmed.match(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/)?$/i
    );
    if (githubMatch) {
      return `github:${githubMatch[1].toLowerCase()}/${githubMatch[2].toLowerCase()}`;
    }

    try {
      const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      const pathname = parsed.pathname.replace(/\/+$/, "");
      return `${parsed.hostname.toLowerCase()}${pathname.toLowerCase()}`;
    } catch {
      return trimmed.toLowerCase();
    }
  },

  findDuplicateRegistry: (url: string) => {
    const normalized = get().getNormalizedRegistryIdentity(url);
    if (!normalized) return null;

    return (
      get().registries.find((registry) => {
        const existingIdentity =
          registry.normalized_url ?? get().getNormalizedRegistryIdentity(registry.url);
        return existingIdentity === normalized;
      }) ?? null
    );
  },

  loadRegistries: async () => {
    set({ isLoading: true, error: null });
    try {
      const registries = await invoke<SkillRegistry[]>("list_registries");
      set({ registries: registries ?? [], isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  selectRegistry: (id: string) => {
    set({ selectedRegistryId: id, searchQuery: "" });
    get().loadSkills(id);
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    const { selectedRegistryId } = get();
    if (selectedRegistryId) {
      get().loadSkills(selectedRegistryId, query);
    }
  },

  syncRegistry: async (registryId: string, forceRefresh = false) => {
    set({ isSyncing: true, error: null });
    try {
      const command = forceRefresh ? "sync_registry_with_options" : "sync_registry";
      const skills = forceRefresh
        ? await invoke<MarketplaceSkill[]>(command, {
            registryId,
            options: { forceRefresh: true },
          })
        : await invoke<MarketplaceSkill[]>(command, { registryId });
      const registries = await invoke<SkillRegistry[]>("list_registries");
      set({
        skills: skills ?? [],
        registries: registries ?? [],
        isSyncing: false,
      });
    } catch (err) {
      const registries = await invoke<SkillRegistry[]>("list_registries").catch(() => null);
      set({
        error: String(err),
        registries: registries ?? get().registries,
        isSyncing: false,
      });
      throw err;
    }
  },

  loadSkills: async (registryId: string, query?: string) => {
    set({ isLoading: true, error: null });
    try {
      const skills = await invoke<MarketplaceSkill[]>("search_marketplace_skills", {
        registryId,
        query: query || null,
      });
      set({ skills: skills ?? [], isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  loadPreviewSkills: async (registryId: string) => {
    return invoke<MarketplaceSkill[]>("search_marketplace_skills", {
      registryId,
      query: null,
    });
  },

  installSkill: async (skillId: string) => {
    set((s) => ({ installingIds: new Set(s.installingIds).add(skillId) }));
    try {
      await invoke("install_marketplace_skill", { skillId });
      // Update the skill's is_installed status locally
      set((s) => ({
        skills: s.skills.map((sk) =>
          sk.id === skillId ? { ...sk, is_installed: true } : sk
        ),
        installingIds: (() => {
          const next = new Set(s.installingIds);
          next.delete(skillId);
          return next;
        })(),
      }));
    } catch (err) {
      set((s) => {
        const next = new Set(s.installingIds);
        next.delete(skillId);
        return { installingIds: next, error: String(err) };
      });
      throw err;
    }
  },

  addRegistry: async (name: string, sourceType: string, url: string) => {
    const duplicate = get().findDuplicateRegistry(url);
    if (duplicate) {
      throw new Error(
        `DUPLICATE_REGISTRY:${JSON.stringify({
          id: duplicate.id,
          name: duplicate.name,
          url: duplicate.url,
          isBuiltin: duplicate.is_builtin,
        })}`
      );
    }
    const registry = await invoke<SkillRegistry>("add_registry", { name, sourceType, url });
    const registries = await invoke<SkillRegistry[]>("list_registries");
    set({ registries: registries ?? [] });
    return registry;
  },

  removeRegistry: async (registryId: string) => {
    await invoke("remove_registry", { registryId });
    const registries = await invoke<SkillRegistry[]>("list_registries");
    set((s) => ({
      registries: registries ?? [],
      selectedRegistryId: s.selectedRegistryId === registryId ? null : s.selectedRegistryId,
    }));
  },

  previewGitHubRepoImport: async (repoUrl: string) => {
    set((state) => ({
      githubImport: {
        ...state.githubImport,
        isPreviewLoading: true,
        preview: null,
        importResult: null,
        previewedRepoUrl: repoUrl,
        error: null,
      },
    }));

    try {
      const preview = await invoke<GitHubRepoPreview>("preview_github_repo_import", {
        repoUrl,
      });
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          isPreviewLoading: false,
          preview,
          importResult: null,
          previewedRepoUrl: repoUrl,
          error: null,
        },
      }));
      return preview;
    } catch (err) {
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          isPreviewLoading: false,
          preview: null,
          importResult: null,
          previewedRepoUrl: repoUrl,
          error: String(err),
        },
      }));
      throw err;
    }
  },

  importGitHubRepoSkills: async (repoUrl: string, selections: GitHubSkillImportSelection[]) => {
    set((state) => ({
      githubImport: {
        ...state.githubImport,
        isImporting: true,
        error: null,
      },
    }));

    try {
      const importResult = await invoke<GitHubRepoImportResult>("import_github_repo_skills", {
        repoUrl,
        selections,
      });
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          isImporting: false,
          importResult,
          error: null,
        },
      }));
      return importResult;
    } catch (err) {
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          isImporting: false,
          error: String(err),
        },
      }));
      throw err;
    }
  },

  resetGitHubImport: () => {
    set({ githubImport: initialGitHubImportState() });
  },
}));
