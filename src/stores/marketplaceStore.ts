import { create } from "zustand";
import { UnlistenFn } from "@tauri-apps/api/event";
import { invoke, listen, isTauriRuntime } from "@/lib/tauri";
import { setupExplanationStreamListeners } from "@/lib/explanationStream";
import {
  SkillRegistry,
  MarketplaceSkill,
  SkillsShSkill,
  GitHubRepoPreview,
  GitHubRepoImportResult,
  GitHubSkillImportSelection,
  GitHubImportProgressPayload,
} from "@/types";

interface GitHubImportState {
  isPreviewLoading: boolean;
  isImporting: boolean;
  preview: GitHubRepoPreview | null;
  importResult: GitHubRepoImportResult | null;
  previewedRepoUrl: string | null;
  error: string | null;
  importProgress: GitHubImportProgressPayload | null;
  importStartedAt: number | null;
  skillMarkdown: Record<string, SkillMarkdownEntry>;
  aiSummaries: Record<string, GitHubImportAiSummaryEntry>;
}

export interface SkillMarkdownEntry {
  status: "loading" | "ready" | "error";
  content?: string;
  error?: string;
}

export interface GitHubImportAiSummaryEntry {
  summary: string | null;
  isLoading: boolean;
  isStreaming: boolean;
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
  // skills.sh search
  skillsShResults: SkillsShSkill[];
  skillsShQuery: string;
  isSkillsShLoading: boolean;

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
  fetchGitHubSkillMarkdown: (sourcePath: string, downloadUrl: string) => Promise<void>;
  generateGitHubImportAiSummary: (
    sourcePath: string,
    skillName: string,
    content: string,
    lang: string,
    refresh?: boolean
  ) => Promise<void>;
  resetGitHubImport: () => void;
  // skills.sh search
  searchSkillsSh: (query: string) => Promise<void>;
  installFromSkillsSh: (source: string, skillId: string) => Promise<void>;
}

const initialGitHubImportState = (): GitHubImportState => ({
  isPreviewLoading: false,
  isImporting: false,
  preview: null,
  importResult: null,
  previewedRepoUrl: null,
  error: null,
  importProgress: null,
  importStartedAt: null,
  skillMarkdown: {},
  aiSummaries: {},
});

let unlistenGitHubImportProgress: UnlistenFn | null = null;
const githubImportAiUnlisteners = new Map<string, UnlistenFn>();

function cleanupGitHubImportAiSummaryListener(sourcePath?: string) {
  if (sourcePath) {
    githubImportAiUnlisteners.get(sourcePath)?.();
    githubImportAiUnlisteners.delete(sourcePath);
    return;
  }

  for (const unlisten of githubImportAiUnlisteners.values()) {
    unlisten();
  }
  githubImportAiUnlisteners.clear();
}

async function setupGitHubImportEventListeners(
  set: (
    fn:
      | Partial<MarketplaceState>
      | ((s: MarketplaceState) => Partial<MarketplaceState>),
  ) => void,
) {
  if (unlistenGitHubImportProgress) {
    unlistenGitHubImportProgress();
    unlistenGitHubImportProgress = null;
  }

  unlistenGitHubImportProgress = await listen<GitHubImportProgressPayload>(
    "github-import:progress",
    (event) => {
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          importProgress: event.payload,
        },
      }));
    },
  );
}

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
  skillsShResults: [],
  skillsShQuery: "",
  isSkillsShLoading: false,

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
    if (!isTauriRuntime()) {
      const error = "Desktop-only feature: GitHub repo preview is available in the Tauri app.";
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          isPreviewLoading: false,
          preview: null,
          importResult: null,
          previewedRepoUrl: repoUrl,
          error,
          importProgress: null,
          importStartedAt: null,
        },
      }));
      throw new Error(error);
    }

    set((state) => ({
      githubImport: {
        ...state.githubImport,
        isPreviewLoading: true,
        preview: null,
        importResult: null,
        previewedRepoUrl: repoUrl,
        error: null,
        importProgress: null,
        importStartedAt: null,
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
          importProgress: null,
          importStartedAt: null,
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
          importProgress: null,
          importStartedAt: null,
        },
      }));
      throw err;
    }
  },

  importGitHubRepoSkills: async (repoUrl: string, selections: GitHubSkillImportSelection[]) => {
    if (!isTauriRuntime()) {
      const error = "Desktop-only feature: GitHub repo import is available in the Tauri app.";
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          isImporting: false,
          error,
          importProgress: null,
          importStartedAt: null,
        },
      }));
      throw new Error(error);
    }

    set((state) => ({
      githubImport: {
        ...state.githubImport,
        isImporting: true,
        error: null,
        importProgress: {
          phase: "preparing",
          currentSkill: null,
          currentPath: null,
          completedFiles: 0,
          totalFiles: 0,
          completedBytes: 0,
          totalBytes: 0,
        },
        importStartedAt: Date.now(),
      },
    }));

    try {
      await setupGitHubImportEventListeners(set);

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
          importProgress: null,
          importStartedAt: null,
        },
      }));
      return importResult;
    } catch (err) {
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          isImporting: false,
          error: String(err),
          importProgress: null,
          importStartedAt: null,
        },
      }));
      throw err;
    }
  },

  fetchGitHubSkillMarkdown: async (sourcePath: string, downloadUrl: string) => {
    const existing = get().githubImport.skillMarkdown[sourcePath];
    if (existing?.status === "loading" || existing?.status === "ready") {
      return;
    }

    if (!isTauriRuntime()) {
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          skillMarkdown: {
            ...state.githubImport.skillMarkdown,
            [sourcePath]: {
              status: "error",
              error: "Desktop-only feature: GitHub markdown preview is available in the Tauri app.",
            },
          },
        },
      }));
      return;
    }

    set((state) => ({
      githubImport: {
        ...state.githubImport,
        skillMarkdown: {
          ...state.githubImport.skillMarkdown,
          [sourcePath]: { status: "loading" },
        },
      },
    }));

    try {
      const content = await invoke<string>("fetch_github_skill_markdown", {
        downloadUrl,
      });
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          skillMarkdown: {
            ...state.githubImport.skillMarkdown,
            [sourcePath]: { status: "ready", content },
          },
        },
      }));
    } catch (err) {
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          skillMarkdown: {
            ...state.githubImport.skillMarkdown,
            [sourcePath]: { status: "error", error: String(err) },
          },
        },
      }));
    }
  },

  generateGitHubImportAiSummary: async (
    sourcePath: string,
    skillName: string,
    content: string,
    lang: string,
    refresh = false
  ) => {
    const existing = get().githubImport.aiSummaries[sourcePath];
    if (!refresh && (existing?.isLoading || existing?.summary)) {
      return;
    }

    if (!isTauriRuntime()) {
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          aiSummaries: {
            ...state.githubImport.aiSummaries,
            [sourcePath]: {
              summary: null,
              isLoading: false,
              isStreaming: false,
              error: "AI summary requires the Tauri desktop runtime.",
            },
          },
        },
      }));
      return;
    }

    set((state) => ({
      githubImport: {
        ...state.githubImport,
        aiSummaries: {
          ...state.githubImport.aiSummaries,
          [sourcePath]: {
            summary: null,
            isLoading: true,
            isStreaming: false,
            error: null,
          },
        },
      },
    }));

    try {
      cleanupGitHubImportAiSummaryListener(sourcePath);
      const prompt = lang === "en"
        ? `Summarize this SKILL.md for import decisions in English. Use 3 short parts: 1) What it does 2) When to import it 3) Dependencies or cautions. Keep it concise.\n\nSkill: ${skillName}\n\n${content}`
        : `请基于下面的 SKILL.md 内容，生成适合导入决策的中文摘要。分成 3 个简短部分：1）做什么 2）什么时候值得导入 3）依赖或注意事项。保持简洁。\n\n技能名：${skillName}\n\n${content}`;

      const command = refresh ? "refresh_skill_explanation" : "explain_skill_stream";
      const skillId = `github-import:${sourcePath}`;
      const stopListening = await setupExplanationStreamListeners(skillId, {
        onChunk: (chunkText) => {
          set((state) => ({
            githubImport: {
              ...state.githubImport,
              aiSummaries: {
                ...state.githubImport.aiSummaries,
                [sourcePath]: {
                  summary: `${state.githubImport.aiSummaries[sourcePath]?.summary ?? ""}${chunkText}`,
                  isLoading: false,
                  isStreaming: true,
                  error: null,
                },
              },
            },
          }));
        },
        onComplete: (payload) => {
          cleanupGitHubImportAiSummaryListener(sourcePath);
          set((state) => {
            const currentSummary = state.githubImport.aiSummaries[sourcePath]?.summary;
            const nextSummary = payload.explanation ?? currentSummary ?? null;
            const hasSummary = Boolean(nextSummary?.trim());
            return {
              githubImport: {
                ...state.githubImport,
                aiSummaries: {
                  ...state.githubImport.aiSummaries,
                  [sourcePath]: {
                    summary: hasSummary ? nextSummary : null,
                    isLoading: false,
                    isStreaming: false,
                    error: hasSummary ? null : "AI summary returned no content.",
                  },
                },
              },
            };
          });
        },
        onError: (payload) => {
          cleanupGitHubImportAiSummaryListener(sourcePath);
          set((state) => ({
            githubImport: {
              ...state.githubImport,
              aiSummaries: {
                ...state.githubImport.aiSummaries,
                [sourcePath]: {
                  summary: null,
                  isLoading: false,
                  isStreaming: false,
                  error: payload.error ?? "Unknown explanation error",
                },
              },
            },
          }));
        },
      });
      githubImportAiUnlisteners.set(sourcePath, stopListening);
      await invoke(command, { skillId, content: prompt, lang });
      const summary = await invoke<string | null>("get_skill_explanation", { skillId, lang }).catch(() => null);
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          aiSummaries: {
            ...state.githubImport.aiSummaries,
            [sourcePath]: {
              summary: summary ?? state.githubImport.aiSummaries[sourcePath]?.summary ?? null,
              isLoading: false,
              isStreaming: false,
              error: null,
            },
          },
        },
      }));
    } catch (err) {
      cleanupGitHubImportAiSummaryListener(sourcePath);
      set((state) => ({
        githubImport: {
          ...state.githubImport,
          aiSummaries: {
            ...state.githubImport.aiSummaries,
            [sourcePath]: {
              summary: null,
              isLoading: false,
              isStreaming: false,
              error: String(err),
            },
          },
        },
      }));
    }
  },

  searchSkillsSh: async (query: string) => {
    set({ skillsShQuery: query, isSkillsShLoading: true, error: null });
    try {
      const results = await invoke<SkillsShSkill[]>("search_skills_sh", {
        query,
        limit: 20,
      });
      set({ skillsShResults: results ?? [], isSkillsShLoading: false });
    } catch (err) {
      set({ error: String(err), isSkillsShLoading: false });
    }
  },

  installFromSkillsSh: async (source: string, skillId: string) => {
    set((s) => ({ installingIds: new Set(s.installingIds).add(skillId) }));
    try {
      await invoke("install_from_skills_sh", { source, skillId });
      set((s) => {
        const next = new Set(s.installingIds);
        next.delete(skillId);
        return { installingIds: next };
      });
    } catch (err) {
      set((s) => {
        const next = new Set(s.installingIds);
        next.delete(skillId);
        return { installingIds: next, error: String(err) };
      });
      throw err;
    }
  },

  resetGitHubImport: () => {
    cleanupGitHubImportAiSummaryListener();
    set({ githubImport: initialGitHubImportState() });
  },
}));
