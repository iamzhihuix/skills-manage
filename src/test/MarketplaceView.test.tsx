import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { GitHubRepoPreview, MarketplaceSkill, SkillRegistry } from "@/types";

type StoreState = {
  registries: SkillRegistry[];
  skills: MarketplaceSkill[];
  selectedRegistryId: string;
  searchQuery: string;
  isLoading: boolean;
  isSyncing: boolean;
  installingIds: Set<string>;
  error: string | null;
  githubImport: {
    isPreviewLoading: boolean;
    isImporting: boolean;
    preview: GitHubRepoPreview | null;
    importResult: unknown | null;
    previewedRepoUrl: string | null;
    error: string | null;
  };
};

const storeState: StoreState = {
  registries: [
    {
      id: "reg-1",
      name: "Repo One",
      source_type: "github",
      url: "https://github.com/acme/repo-one",
      is_builtin: false,
      is_enabled: true,
      last_synced: "2026-04-16T00:00:00Z",
      last_attempted_sync: "2026-04-16T00:10:00Z",
      last_sync_status: "success",
      last_sync_error: null,
      cache_updated_at: "2026-04-16T00:00:00Z",
      cache_expires_at: "2026-04-17T00:00:00Z",
      etag: null,
      last_modified: null,
      created_at: "2026-04-15T00:00:00Z",
    },
  ],
  skills: [
    {
      id: "skill-1",
      registry_id: "reg-1",
      name: "Cached Skill",
      description: "Skill from cache",
      download_url: "https://example.com/skill-1",
      is_installed: false,
      synced_at: "2026-04-16T00:00:00Z",
      cache_updated_at: "2026-04-16T00:00:00Z",
    },
  ],
  selectedRegistryId: "reg-1",
  searchQuery: "",
  isLoading: false,
  isSyncing: false,
  installingIds: new Set<string>(),
  error: null as string | null,
  githubImport: {
    isPreviewLoading: false,
    isImporting: false,
    preview: null,
    importResult: null,
    previewedRepoUrl: null,
    error: null,
  },
};

vi.mock("@/components/skill/UnifiedSkillCard", () => ({
  UnifiedSkillCard: ({
    name,
    description,
    onDetail,
    onInstall,
    isInstalled,
  }: {
    name: string;
    description?: string;
    onDetail?: () => void;
    onInstall?: () => void;
    isInstalled?: boolean;
  }) => (
    <div>
      <button type="button" onClick={onDetail}>
        {name}
      </button>
      {description ? <div>{description}</div> : null}
      {onInstall ? (
        <button type="button" onClick={onInstall}>
          {isInstalled ? "Installed" : "Install"}
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/central/InstallDialog", () => ({
  InstallDialog: () => null,
}));

const mockLoadRegistries = vi.fn();
const mockSelectRegistry = vi.fn();
const mockSetSearchQuery = vi.fn();
const mockSyncRegistry = vi.fn();
const mockInstallSkill = vi.fn();
const mockAddRegistry = vi.fn();
const mockRemoveRegistry = vi.fn();
const mockFindDuplicateRegistry = vi.fn();
const mockLoadPreviewSkills = vi.fn();
const mockRescan = vi.fn();
const mockPreviewGitHubRepoImport = vi.fn();
const mockImportGitHubRepoSkills = vi.fn();
const mockResetGitHubImport = vi.fn();
const mockLoadCentralSkills = vi.fn();
const mockInstallCentralSkill = vi.fn();
const mockGetSkillsByAgent = vi.fn();

vi.mock("sonner", async () => {
  const actual = await vi.importActual<typeof import("sonner")>("sonner");
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("@/stores/marketplaceStore", () => ({
  useMarketplaceStore: (selector: (state: typeof storeState & Record<string, unknown>) => unknown) =>
    selector({
      ...storeState,
      loadRegistries: mockLoadRegistries,
      selectRegistry: mockSelectRegistry,
      setSearchQuery: mockSetSearchQuery,
      syncRegistry: mockSyncRegistry,
      installSkill: mockInstallSkill,
      addRegistry: mockAddRegistry,
      removeRegistry: mockRemoveRegistry,
      findDuplicateRegistry: mockFindDuplicateRegistry,
      loadPreviewSkills: mockLoadPreviewSkills,
      githubImport: storeState.githubImport,
      previewGitHubRepoImport: mockPreviewGitHubRepoImport,
      importGitHubRepoSkills: mockImportGitHubRepoSkills,
      resetGitHubImport: mockResetGitHubImport,
    }),
}));

vi.mock("@/stores/platformStore", () => ({
  usePlatformStore: (selector: (state: { rescan: typeof mockRescan; agents: Array<{ id: string; display_name: string; category: string; global_skills_dir: string; is_detected: boolean; is_builtin: boolean; is_enabled: boolean }> }) => unknown) =>
    selector({
      rescan: mockRescan,
      agents: [
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
          id: "central",
          display_name: "Central Skills",
          category: "central",
          global_skills_dir: "~/.agents/skills/",
          is_detected: true,
          is_builtin: true,
          is_enabled: true,
        },
      ],
    }),
}));

vi.mock("@/stores/centralSkillsStore", () => ({
  useCentralSkillsStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        skills: [],
        agents: [],
        loadCentralSkills: mockLoadCentralSkills,
        installSkill: mockInstallCentralSkill,
      }),
    {
      getState: () => ({ skills: [] }),
    }
  ),
}));

vi.mock("@/stores/skillStore", () => ({
  useSkillStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      skillsByAgent: {},
      loadingByAgent: {},
      error: null,
      getSkillsByAgent: mockGetSkillsByAgent,
    }),
}));

import { MarketplaceView } from "@/pages/MarketplaceView";
import { toast } from "sonner";
import * as tauriBridge from "@/lib/tauri";

const mockedToast = vi.mocked(toast);
const mockToastSuccess = mockedToast.success as unknown as ReturnType<typeof vi.fn>;
const mockToastError = mockedToast.error as unknown as ReturnType<typeof vi.fn>;

describe("MarketplaceView", () => {
  beforeEach(() => {
    mockLoadRegistries.mockReset();
    mockSelectRegistry.mockReset();
    mockSetSearchQuery.mockReset();
    mockSyncRegistry.mockReset();
    mockInstallSkill.mockReset();
    mockAddRegistry.mockReset();
    mockRemoveRegistry.mockReset();
    mockFindDuplicateRegistry.mockReset();
    mockLoadPreviewSkills.mockReset();
    mockRescan.mockReset();
    mockPreviewGitHubRepoImport.mockReset();
    mockImportGitHubRepoSkills.mockReset();
    mockResetGitHubImport.mockReset();
    mockLoadCentralSkills.mockReset();
    mockInstallCentralSkill.mockReset();
    mockGetSkillsByAgent.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();

    storeState.registries = [
      {
        id: "reg-1",
        name: "Repo One",
        source_type: "github",
        url: "https://github.com/acme/repo-one",
        is_builtin: false,
        is_enabled: true,
        last_synced: "2026-04-16T00:00:00Z",
        last_attempted_sync: "2026-04-16T00:10:00Z",
        last_sync_status: "success",
        last_sync_error: null,
        cache_updated_at: "2026-04-16T00:00:00Z",
        cache_expires_at: "2026-04-17T00:00:00Z",
        etag: null,
        last_modified: null,
        created_at: "2026-04-15T00:00:00Z",
      },
    ];
    storeState.skills = [
      {
        id: "skill-1",
        registry_id: "reg-1",
        name: "Cached Skill",
        description: "Skill from cache",
        download_url: "https://example.com/skill-1",
        is_installed: false,
        synced_at: "2026-04-16T00:00:00Z",
        cache_updated_at: "2026-04-16T00:00:00Z",
      },
    ];
    storeState.selectedRegistryId = "reg-1";
    storeState.searchQuery = "";
    storeState.isLoading = false;
    storeState.isSyncing = false;
    storeState.installingIds = new Set<string>();
    storeState.error = null as string | null;
    storeState.githubImport = {
      isPreviewLoading: false,
      isImporting: false,
      preview: null,
      importResult: null,
      previewedRepoUrl: null,
      error: null,
    };
    mockFindDuplicateRegistry.mockImplementation(() => null);
    mockLoadPreviewSkills.mockResolvedValue([
      {
        id: "official-skill-1",
        registry_id: "official-1",
        name: "Knowledge Work Plugin",
        description: "Useful repo preview content",
        download_url: "https://example.com/official-skill-1",
        is_installed: false,
        synced_at: "2026-04-16T00:00:00Z",
        cache_updated_at: "2026-04-16T00:00:00Z",
      },
    ]);
  });

  function renderView() {
    return render(
      <MemoryRouter>
        <MarketplaceView />
      </MemoryRouter>
    );
  }

  it("shows cached status for the selected source and keeps cached skills visible", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));

    expect(await screen.findByText("Cached Skill")).toBeInTheDocument();
    expect(screen.getByText(/Cached ·|缓存可用/i)).toBeInTheDocument();
    expect(screen.getByText(/Reopening this source reuses backend cache/i)).toBeInTheDocument();
    expect(screen.getByText(/Cache valid until:/i)).toBeInTheDocument();
  });

  it("uses cached update without forcing a refresh", async () => {
    mockSyncRegistry.mockResolvedValue(undefined);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(mockSyncRegistry).toHaveBeenCalledWith("reg-1", false);
    });
    expect(mockToastSuccess).not.toHaveBeenCalledWith("Marketplace cache updated");
  });

  it("force refreshes and reports cached fallback after a failure", async () => {
    mockSyncRegistry.mockRejectedValue(new Error("network down"));
    storeState.error = "Error: network down" as string | null;
    storeState.registries = [
      {
        ...storeState.registries[0],
        last_sync_status: "error",
        last_sync_error: "network down",
      },
    ];

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Force Refresh" }));

    await waitFor(() => {
      expect(mockSyncRegistry).toHaveBeenCalledWith("reg-1", true);
    });
    expect(await screen.findByText(/Refresh failed, showing cached data/i)).toBeInTheDocument();
    expect(screen.getByText("Cached Skill")).toBeInTheDocument();
  });

  it("shows persisted source metadata and deletes a source from My Sources", async () => {
    mockRemoveRegistry.mockResolvedValue(undefined);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));

    expect(screen.getByText("Repo One")).toBeInTheDocument();
    expect(screen.getByText(/Source identity and sync metadata persist/i)).toBeInTheDocument();
    expect(screen.getByText(/Cache updated:/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => {
      expect(mockRemoveRegistry).toHaveBeenCalledWith("reg-1");
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Source deleted");
  });

  it("warns when adding a source that duplicates an official source", async () => {
    mockAddRegistry.mockRejectedValue(
      new Error(
        'DUPLICATE_REGISTRY:{"id":"official-1","name":"Anthropic","url":"https://github.com/anthropics/skills","isBuiltin":true}'
      )
    );

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Official Directory" }));
    fireEvent.click(screen.getByRole("button", { name: /Anthropic/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /\+ Add to My Sources/i })[0]);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "This repo already exists in Official Directory: Anthropic"
      );
    });
  });

  it("loads official directory preview skills from backend cache instead of showing an empty fallback", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Official Directory" }));
    fireEvent.click(screen.getByRole("button", { name: /Anthropic/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /Browse Skills/i })[0]);

    await waitFor(() => {
      expect(mockLoadPreviewSkills).toHaveBeenCalled();
    });

    expect(await screen.findByText("Knowledge Work Plugin")).toBeInTheDocument();
    expect(screen.getByText("Useful repo preview content")).toBeInTheDocument();
    expect(screen.queryByText("No skills found")).not.toBeInTheDocument();
  });

  it("shows stable browser fallback copy when official preview runs without Tauri", async () => {
    const isTauriSpy = vi.spyOn(tauriBridge, "isTauriRuntime").mockReturnValue(false);

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Official Directory" }));
    fireEvent.click(screen.getByRole("button", { name: /Anthropic/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /Browse Skills/i })[0]);

    expect(await screen.findByText(/Preview unavailable in browser mode/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Open this flow in the desktop app to browse and install repository skills/i)
    ).toBeInTheDocument();
    expect(mockLoadPreviewSkills).not.toHaveBeenCalled();

    isTauriSpy.mockRestore();
  });

  it("opens a marketplace preview drawer without leaving the marketplace route", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Cached Skill" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Cached Skill")).toBeInTheDocument();
    expect(within(dialog).getByText(/Source/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Repo One/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(within(dialog).getByTestId("skill-detail-right-sidebar")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Open SKILL.md/i })).toHaveAttribute(
      "href",
      "https://example.com/skill-1"
    );
    expect(window.location.pathname).toBe("/");
  });

  it("restores focus to the originating marketplace card when the preview drawer closes", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    const trigger = screen.getByRole("button", { name: "Cached Skill" });

    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Cached Skill" })).toHaveFocus();
  });

  it("installs from the preview drawer and refreshes shared state without a manual reload", async () => {
    mockInstallSkill.mockResolvedValue(undefined);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "My Sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Cached Skill" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(mockInstallSkill).toHaveBeenCalledWith("skill-1");
    });
    await waitFor(() => {
      expect(mockRescan).toHaveBeenCalled();
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Installed successfully");
  });

  it("opens the shared github import wizard and previews before import", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "dorukardahan",
            repo: "twitterapi-io-skill",
            branch: "main",
            normalizedUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
          },
          skills: [
            {
              sourcePath: "twitterapi-io-skill/SKILL.md",
              skillId: "twitterapi-io",
              skillName: "twitterapi-io",
              description: "Twitter API helper",
              rootDirectory: ".",
              skillDirectoryName: "twitterapi-io-skill",
              downloadUrl: "https://example.com/twitterapi-io",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Import GitHub repo" }));
    fireEvent.change(screen.getByLabelText("GitHub repository URL"), {
      target: { value: "https://github.com/dorukardahan/twitterapi-io-skill" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    await waitFor(() => {
      expect(mockPreviewGitHubRepoImport).toHaveBeenCalledWith(
        "https://github.com/dorukardahan/twitterapi-io-skill"
      );
    });
    expect(await screen.findByText("twitterapi-io")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-summary-list")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-detail-pane")).toBeInTheDocument();
    expect(screen.getByText(/Preview is read-only and performs no write/i)).toBeInTheDocument();
    expect(mockImportGitHubRepoSkills).not.toHaveBeenCalled();
  });

  it("uses an expanded desktop width for the github preview shell while keeping the split layout", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
            {
              sourcePath: "skills/second/SKILL.md",
              skillId: "second-skill",
              skillName: "Second Skill",
              description: "Second skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "second",
              downloadUrl: "https://example.com/second",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Import GitHub repo" }));
    fireEvent.change(screen.getByLabelText("GitHub repository URL"), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    const dialog = await screen.findByRole("dialog");
    const content = dialog.querySelector('[data-slot="dialog-content"]');
    expect(content?.className).toContain("w-[min(98vw,1520px)]");
    expect(content?.className).toContain("xl:w-[min(99vw,1680px)]");

    const splitLayout = screen
      .getByTestId("github-import-summary-list")
      .closest(".grid");
    expect(splitLayout?.className).toContain(
      "lg:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.65fr)]"
    );
    expect(splitLayout?.className).toContain(
      "xl:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.8fr)]"
    );
  });

  it("uses the wide desktop shell from the initial github import input step", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Import GitHub repo" }));

    const dialog = await screen.findByRole("dialog");
    const content = dialog.querySelector('[data-slot="dialog-content"]');

    expect(content?.className).toContain("w-[min(98vw,1520px)]");
    expect(content?.className).toContain("max-w-[min(98vw,1520px)]");
    expect(content?.className).toContain("xl:w-[min(99vw,1680px)]");
    expect(content?.className).toContain("xl:max-w-[min(99vw,1680px)]");
  });

  it("shows only the selected github preview skill description in the detail pane", async () => {
    mockPreviewGitHubRepoImport.mockImplementation(async () => {
      storeState.githubImport = {
        isPreviewLoading: false,
        isImporting: false,
        preview: {
          repo: {
            owner: "anthropics",
            repo: "skills",
            branch: "main",
            normalizedUrl: "https://github.com/anthropics/skills",
          },
          skills: [
            {
              sourcePath: "skills/first/SKILL.md",
              skillId: "first-skill",
              skillName: "First Skill",
              description: "First skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "first",
              downloadUrl: "https://example.com/first",
              conflict: null,
            },
            {
              sourcePath: "skills/second/SKILL.md",
              skillId: "second-skill",
              skillName: "Second Skill",
              description: "Second skill full description",
              rootDirectory: "skills",
              skillDirectoryName: "second",
              downloadUrl: "https://example.com/second",
              conflict: null,
            },
          ],
        },
        importResult: null,
        previewedRepoUrl: "https://github.com/anthropics/skills",
        error: null,
      };
    });

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Import GitHub repo" }));
    fireEvent.change(screen.getByLabelText("GitHub repository URL"), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("First Skill")).toBeInTheDocument();
    const detailPane = screen.getByTestId("github-import-detail-pane");
    expect(within(detailPane).getByText("First skill full description")).toBeInTheDocument();
    expect(within(detailPane).queryByText("Second skill full description")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Second Skill/i }));

    await waitFor(() => {
      expect(within(detailPane).getByText("Second skill full description")).toBeInTheDocument();
    });
    expect(within(detailPane).queryByText("First skill full description")).not.toBeInTheDocument();
  });

  it("offers post-import platform installation for imported github skills", async () => {
    storeState.githubImport = {
      isPreviewLoading: false,
      isImporting: false,
      preview: null,
      importResult: {
        repo: {
          owner: "dorukardahan",
          repo: "twitterapi-io-skill",
          branch: "main",
          normalizedUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
        },
        importedSkills: [
          {
            sourcePath: "twitterapi-io-skill/SKILL.md",
            originalSkillId: "cached-skill",
            importedSkillId: "cached-skill",
            skillName: "Cached Skill",
            targetDirectory: "/Users/test/.agents/skills/cached-skill",
            resolution: "overwrite",
          },
        ],
        skippedSkills: [],
      },
      previewedRepoUrl: "https://github.com/dorukardahan/twitterapi-io-skill",
      error: null,
    };

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Import GitHub repo" }));

    expect(await screen.findByRole("button", { name: /Install to platforms/i })).toBeInTheDocument();
  });

  it("shows a friendly desktop-only state for the github import wizard in browser mode", async () => {
    const isTauriSpy = vi.spyOn(tauriBridge, "isTauriRuntime").mockReturnValue(false);

    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Import GitHub repo" }));
    fireEvent.change(screen.getByLabelText("GitHub repository URL"), {
      target: { value: "https://github.com/anthropics/skills" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    await waitFor(() => {
      expect(mockPreviewGitHubRepoImport).toHaveBeenCalledWith("https://github.com/anthropics/skills");
    });
    expect(
      await screen.findByText(/This shared wizard is available in the browser for guidance/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Desktop-only feature: GitHub repo preview is available in the Tauri app/i)).toBeInTheDocument();
    expect(mockImportGitHubRepoSkills).not.toHaveBeenCalled();

    isTauriSpy.mockRestore();
  });
});
