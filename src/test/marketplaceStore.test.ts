import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  isTauriRuntime: vi.fn(() => true),
}));

import { invoke, listen, isTauriRuntime } from "@/lib/tauri";

import { useMarketplaceStore } from "@/stores/marketplaceStore";

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
const mockIsTauriRuntime = vi.mocked(isTauriRuntime);

describe("marketplaceStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset();
    mockIsTauriRuntime.mockReset();
    mockIsTauriRuntime.mockReturnValue(true);
    mockListen.mockResolvedValue(vi.fn());
    useMarketplaceStore.setState({
      registries: [],
      skills: [],
      selectedRegistryId: null,
      searchQuery: "",
      isLoading: false,
      isSyncing: false,
      installingIds: new Set(),
      error: null,
      githubImport: {
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
      },
    });
  });

  it("uses cached sync by default and refreshes registry metadata", async () => {
    const skills = [
      {
        id: "skill-1",
        registry_id: "reg-1",
        name: "Skill One",
        description: "cached",
        download_url: "https://example.com/skill-1",
        is_installed: false,
        synced_at: "2026-04-16T00:00:00Z",
        cache_updated_at: "2026-04-16T00:00:00Z",
      },
    ];
    const registries = [
      {
        id: "reg-1",
        name: "Repo",
        source_type: "github",
        url: "https://github.com/acme/repo",
        is_builtin: false,
        is_enabled: true,
        last_synced: "2026-04-16T00:00:00Z",
        last_attempted_sync: "2026-04-16T00:00:00Z",
        last_sync_status: "success",
        last_sync_error: null,
        cache_updated_at: "2026-04-16T00:00:00Z",
        cache_expires_at: null,
        etag: null,
        last_modified: null,
        created_at: "2026-04-15T00:00:00Z",
      },
    ];

    mockInvoke
      .mockResolvedValueOnce(skills)
      .mockResolvedValueOnce(registries);

    await useMarketplaceStore.getState().syncRegistry("reg-1");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "sync_registry", { registryId: "reg-1" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "list_registries");
    expect(useMarketplaceStore.getState().skills).toEqual(skills);
    expect(useMarketplaceStore.getState().registries).toEqual(registries);
    expect(useMarketplaceStore.getState().isSyncing).toBe(false);
  });

  it("force refreshes via sync_registry_with_options and preserves refreshed metadata", async () => {
    const freshSkills = [
      {
        id: "skill-1",
        registry_id: "reg-1",
        name: "Skill One Fresh",
        description: "fresh",
        download_url: "https://example.com/skill-1",
        is_installed: false,
        synced_at: "2026-04-16T01:00:00Z",
        cache_updated_at: "2026-04-16T01:00:00Z",
      },
    ];
    const refreshedRegistries = [
      {
        id: "reg-1",
        name: "Repo",
        source_type: "github",
        url: "https://github.com/acme/repo",
        is_builtin: false,
        is_enabled: true,
        last_synced: "2026-04-16T01:00:00Z",
        last_attempted_sync: "2026-04-16T01:00:00Z",
        last_sync_status: "success",
        last_sync_error: null,
        cache_updated_at: "2026-04-16T01:00:00Z",
        cache_expires_at: null,
        etag: "\"etag\"",
        last_modified: null,
        created_at: "2026-04-15T00:00:00Z",
      },
    ];

    mockInvoke
      .mockResolvedValueOnce(freshSkills)
      .mockResolvedValueOnce(refreshedRegistries);

    await useMarketplaceStore.getState().syncRegistry("reg-1", true);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "sync_registry_with_options", {
      registryId: "reg-1",
      options: { forceRefresh: true },
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "list_registries");
    expect(useMarketplaceStore.getState().skills).toEqual(freshSkills);
    expect(useMarketplaceStore.getState().registries[0]?.last_synced).toBe("2026-04-16T01:00:00Z");
  });

  it("keeps last successful cached skills visible when force refresh fails", async () => {
    useMarketplaceStore.setState({
      skills: [
        {
          id: "skill-1",
          registry_id: "reg-1",
          name: "Cached Skill",
          description: "cached",
          download_url: "https://example.com/skill-1",
          is_installed: false,
          synced_at: "2026-04-16T00:00:00Z",
          cache_updated_at: "2026-04-16T00:00:00Z",
        },
      ],
      registries: [
        {
          id: "reg-1",
          name: "Repo",
          source_type: "github",
          url: "https://github.com/acme/repo",
          is_builtin: false,
          is_enabled: true,
          last_synced: "2026-04-16T00:00:00Z",
          last_attempted_sync: "2026-04-16T00:00:00Z",
          last_sync_status: "success",
          last_sync_error: null,
          cache_updated_at: "2026-04-16T00:00:00Z",
          cache_expires_at: null,
          etag: null,
          last_modified: null,
          created_at: "2026-04-15T00:00:00Z",
        },
      ],
    });

    mockInvoke
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([
        {
          id: "reg-1",
          name: "Repo",
          source_type: "github",
          url: "https://github.com/acme/repo",
          is_builtin: false,
          is_enabled: true,
          last_synced: "2026-04-16T00:00:00Z",
          last_attempted_sync: "2026-04-16T02:00:00Z",
          last_sync_status: "error",
          last_sync_error: "network down",
          cache_updated_at: "2026-04-16T00:00:00Z",
          cache_expires_at: null,
          etag: null,
          last_modified: null,
          created_at: "2026-04-15T00:00:00Z",
        },
      ]);

    await expect(useMarketplaceStore.getState().syncRegistry("reg-1", true)).rejects.toThrow(
      "network down"
    );

    expect(useMarketplaceStore.getState().skills[0]?.name).toBe("Cached Skill");
    expect(useMarketplaceStore.getState().registries[0]?.last_sync_status).toBe("error");
    expect(useMarketplaceStore.getState().error).toContain("network down");
    expect(useMarketplaceStore.getState().isSyncing).toBe(false);
  });

  it("normalizes GitHub identities when checking duplicate registries", () => {
    useMarketplaceStore.setState({
      registries: [
        {
          id: "official-1",
          name: "Official Repo",
          source_type: "github",
          url: "https://github.com/Anthropics/Skills",
          normalized_url: "github:anthropics/skills",
          is_builtin: true,
          is_enabled: true,
          last_synced: null,
          created_at: "2026-04-15T00:00:00Z",
        },
      ],
    });

    const duplicate = useMarketplaceStore
      .getState()
      .findDuplicateRegistry("https://github.com/anthropics/skills.git/");

    expect(duplicate?.id).toBe("official-1");
  });

  it("blocks addRegistry when normalized identity already exists", async () => {
    useMarketplaceStore.setState({
      registries: [
        {
          id: "official-1",
          name: "Official Repo",
          source_type: "github",
          url: "https://github.com/anthropics/skills",
          normalized_url: "github:anthropics/skills",
          is_builtin: true,
          is_enabled: true,
          last_synced: null,
          created_at: "2026-04-15T00:00:00Z",
        },
      ],
    });

    await expect(
      useMarketplaceStore
        .getState()
        .addRegistry("Skills", "github", "https://github.com/Anthropics/skills")
    ).rejects.toThrow("DUPLICATE_REGISTRY:");

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("stores github repo preview results before import", async () => {
    const preview = {
      repo: {
        owner: "anthropics",
        repo: "skills",
        branch: "main",
        normalizedUrl: "https://github.com/anthropics/skills",
      },
      skills: [
        {
          sourcePath: "skills/research/SKILL.md",
          skillId: "research",
          skillName: "research",
          description: "Research helper",
          rootDirectory: "skills",
          skillDirectoryName: "research",
          downloadUrl: "https://example.com/research",
          conflict: null,
        },
      ],
    };

    mockInvoke.mockResolvedValueOnce(preview);

    await expect(
      useMarketplaceStore
        .getState()
        .previewGitHubRepoImport("https://github.com/anthropics/skills")
    ).resolves.toEqual(preview);

    expect(mockInvoke).toHaveBeenCalledWith("preview_github_repo_import", {
      repoUrl: "https://github.com/anthropics/skills",
    });
    expect(useMarketplaceStore.getState().githubImport.preview).toEqual(preview);
    expect(useMarketplaceStore.getState().githubImport.previewedRepoUrl).toBe(
      "https://github.com/anthropics/skills"
    );
    expect(useMarketplaceStore.getState().githubImport.isPreviewLoading).toBe(false);
  });

  it("reports a friendly desktop-only error when preview is triggered outside Tauri", async () => {
    mockIsTauriRuntime.mockReturnValue(false);

    await expect(
      useMarketplaceStore
        .getState()
        .previewGitHubRepoImport("https://github.com/anthropics/skills")
    ).rejects.toThrow("Desktop-only feature: GitHub repo preview is available in the Tauri app.");

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useMarketplaceStore.getState().githubImport.error).toContain("Desktop-only feature");
    expect(useMarketplaceStore.getState().githubImport.previewedRepoUrl).toBe(
      "https://github.com/anthropics/skills"
    );
  });

  it("stores github repo import results", async () => {
    const result = {
      repo: {
        owner: "dorukardahan",
        repo: "twitterapi-io-skill",
        branch: "main",
        normalizedUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
      },
      importedSkills: [
        {
          sourcePath: "twitterapi-io-skill/SKILL.md",
          originalSkillId: "twitterapi-io",
          importedSkillId: "twitterapi-io",
          skillName: "twitterapi-io",
          targetDirectory: "/Users/test/.agents/skills/twitterapi-io",
          resolution: "overwrite",
        },
      ],
      skippedSkills: [],
    };

    mockInvoke.mockResolvedValueOnce(result);

    await expect(
      useMarketplaceStore.getState().importGitHubRepoSkills("https://github.com/dorukardahan/twitterapi-io-skill", [
        {
          sourcePath: "twitterapi-io-skill/SKILL.md",
          resolution: "overwrite",
          renamedSkillId: null,
        },
      ])
    ).resolves.toEqual(result);

    expect(mockInvoke).toHaveBeenCalledWith("import_github_repo_skills", {
      repoUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
      selections: [
        {
          sourcePath: "twitterapi-io-skill/SKILL.md",
          resolution: "overwrite",
          renamedSkillId: null,
        },
      ],
    });
    expect(useMarketplaceStore.getState().githubImport.importResult).toEqual(result);
    expect(useMarketplaceStore.getState().githubImport.isImporting).toBe(false);
  });

  it("reports a friendly desktop-only error when import is triggered outside Tauri", async () => {
    mockIsTauriRuntime.mockReturnValue(false);

    await expect(
      useMarketplaceStore.getState().importGitHubRepoSkills("https://github.com/dorukardahan/twitterapi-io-skill", [
        {
          sourcePath: "twitterapi-io-skill/SKILL.md",
          resolution: "overwrite",
          renamedSkillId: null,
        },
      ])
    ).rejects.toThrow("Desktop-only feature: GitHub repo import is available in the Tauri app.");

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useMarketplaceStore.getState().githubImport.error).toContain("Desktop-only feature");
    expect(useMarketplaceStore.getState().githubImport.isImporting).toBe(false);
  });

  it("tracks github import progress events while importing", async () => {
    const result = {
      repo: {
        owner: "dorukardahan",
        repo: "twitterapi-io-skill",
        branch: "main",
        normalizedUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
      },
      importedSkills: [],
      skippedSkills: [],
    };

    type GitHubImportProgressHandler = (event: {
      payload: {
        phase: "writing";
        currentSkill: string;
        currentPath: string;
        completedFiles: number;
        totalFiles: number;
        completedBytes: number;
        totalBytes: number;
      };
    }) => void;

    let progressHandler: GitHubImportProgressHandler | null = null;

    mockListen.mockImplementation(async (eventName, handler) => {
      if (eventName === "github-import:progress") {
        progressHandler = handler as GitHubImportProgressHandler;
      }
      return vi.fn();
    });

    type ResolveImport = (value: typeof result) => void;
    let resolveImport: ResolveImport | null = null;
    mockInvoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve as ResolveImport;
        }),
    );

    const importPromise = useMarketplaceStore
      .getState()
      .importGitHubRepoSkills("https://github.com/dorukardahan/twitterapi-io-skill", [
        {
          sourcePath: "twitterapi-io-skill/SKILL.md",
          resolution: "overwrite",
          renamedSkillId: null,
        },
      ]);

    expect(useMarketplaceStore.getState().githubImport.importStartedAt).not.toBeNull();
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("import_github_repo_skills", {
        repoUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
        selections: [
          {
            sourcePath: "twitterapi-io-skill/SKILL.md",
            resolution: "overwrite",
            renamedSkillId: null,
          },
        ],
      });
      expect(resolveImport).not.toBeNull();
    });

    if (!progressHandler) {
      throw new Error("Expected github import progress handler to be registered");
    }
    const progressHandlerFn = progressHandler as GitHubImportProgressHandler;

    progressHandlerFn({
      payload: {
        phase: "writing",
        currentSkill: "twitterapi-io-skill/SKILL.md",
        currentPath: "SKILL.md",
        completedFiles: 1,
        totalFiles: 4,
        completedBytes: 128,
        totalBytes: 512,
      },
    });

    expect(useMarketplaceStore.getState().githubImport.importProgress).toEqual({
      phase: "writing",
      currentSkill: "twitterapi-io-skill/SKILL.md",
      currentPath: "SKILL.md",
      completedFiles: 1,
      totalFiles: 4,
      completedBytes: 128,
      totalBytes: 512,
    });
    expect(useMarketplaceStore.getState().githubImport.importStartedAt).not.toBeNull();

    if (!resolveImport) {
      throw new Error("Expected github import promise resolver to be captured");
    }
    const resolveImportFn = resolveImport as ResolveImport;

    resolveImportFn(result);
    await expect(importPromise).resolves.toEqual(result);
    expect(useMarketplaceStore.getState().githubImport.importProgress).toBeNull();
    expect(useMarketplaceStore.getState().githubImport.importStartedAt).toBeNull();
  });
});
