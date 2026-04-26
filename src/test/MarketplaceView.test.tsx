import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  AgentWithStatus,
  GitHubRepoPreview,
  GitHubRepoImportResult,
  MarketplaceSkill,
  SkillsShSkill,
  SkillRegistry,
} from "@/types";

const mockLoadRegistries = vi.fn();
const mockLoadPreviewSkills = vi.fn<() => Promise<MarketplaceSkill[]>>();
const mockGetNormalizedRegistryIdentity = vi.fn<(url: string) => string | null>();
const mockInstallSkill = vi.fn();
const mockPreviewGitHubRepoImport = vi.fn();
const mockImportGitHubRepoSkills = vi.fn();
const mockResetGitHubImport = vi.fn();
const mockRescan = vi.fn();
const mockLoadCentralSkills = vi.fn();
const mockInstallCentralSkill = vi.fn();
const mockGetSkillsByAgent = vi.fn();
const mockSearchSkillsSh = vi.fn();
const mockInstallFromSkillsSh = vi.fn();

const platformAgents: AgentWithStatus[] = [
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
];

type StoreState = {
  registries: SkillRegistry[];
  installingIds: Set<string>;
  skillsShResults: SkillsShSkill[];
  isSkillsShLoading: boolean;
  githubImport: {
    isPreviewLoading: boolean;
    isImporting: boolean;
    preview: GitHubRepoPreview | null;
    importResult: GitHubRepoImportResult | null;
    previewedRepoUrl: string | null;
    error: string | null;
  };
};

const storeState: StoreState = {
  registries: [],
  installingIds: new Set<string>(),
  skillsShResults: [],
  isSkillsShLoading: false,
  githubImport: {
    isPreviewLoading: false,
    isImporting: false,
    preview: null,
    importResult: null,
    previewedRepoUrl: null,
    error: null,
  },
};

function normalizeRegistryIdentity(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const githubMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/)?$/i,
  );
  if (githubMatch) {
    return `github:${githubMatch[1].toLowerCase()}/${githubMatch[2].toLowerCase()}`;
  }
  return trimmed.toLowerCase();
}

function makeRegistry(id: string, url: string): SkillRegistry {
  return {
    id,
    name: id,
    source_type: "github",
    url,
    normalized_url: normalizeRegistryIdentity(url),
    is_builtin: true,
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
  };
}

function makePreview(skills: GitHubRepoPreview["skills"]): GitHubRepoPreview {
  return {
    repo: {
      owner: "openai",
      repo: "skills",
      branch: "main",
      normalizedUrl: "https://github.com/openai/skills",
    },
    skills,
  };
}

vi.mock("@/components/skill/UnifiedSkillCard", () => ({
  UnifiedSkillCard: ({
    name,
    description,
    onDetail,
  }: {
    name: string;
    description?: string;
    onDetail?: () => void;
  }) => (
    <div>
      <button type="button" onClick={onDetail}>
        {name}
      </button>
      {description ? <div>{description}</div> : null}
    </div>
  ),
}));

vi.mock("@/components/central/InstallDialog", () => ({
  InstallDialog: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/stores/marketplaceStore", () => ({
  useMarketplaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      registries: storeState.registries,
      installingIds: storeState.installingIds,
      skillsShResults: storeState.skillsShResults,
      isSkillsShLoading: storeState.isSkillsShLoading,
      githubImport: storeState.githubImport,
      loadRegistries: mockLoadRegistries,
      loadPreviewSkills: mockLoadPreviewSkills,
      getNormalizedRegistryIdentity: mockGetNormalizedRegistryIdentity,
      installSkill: mockInstallSkill,
      searchSkillsSh: mockSearchSkillsSh,
      installFromSkillsSh: mockInstallFromSkillsSh,
      previewGitHubRepoImport: mockPreviewGitHubRepoImport,
      importGitHubRepoSkills: mockImportGitHubRepoSkills,
      resetGitHubImport: mockResetGitHubImport,
    }),
}));

vi.mock("@/stores/platformStore", () => ({
  usePlatformStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      rescan: mockRescan,
      agents: platformAgents,
    }),
}));

vi.mock("@/stores/centralSkillsStore", () => ({
  useCentralSkillsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      skills: [],
      agents: platformAgents,
      loadCentralSkills: mockLoadCentralSkills,
      installSkill: mockInstallCentralSkill,
    }),
}));

vi.mock("@/stores/skillStore", () => ({
  useSkillStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      skillsByAgent: {},
      getSkillsByAgent: mockGetSkillsByAgent,
    }),
}));

import { MarketplaceView } from "@/pages/MarketplaceView";
import * as tauriBridge from "@/lib/tauri";

describe("MarketplaceView", () => {
  beforeEach(() => {
    mockLoadRegistries.mockReset();
    mockLoadPreviewSkills.mockReset();
    mockGetNormalizedRegistryIdentity.mockReset();
    mockInstallSkill.mockReset();
    mockPreviewGitHubRepoImport.mockReset();
    mockImportGitHubRepoSkills.mockReset();
    mockResetGitHubImport.mockReset();
    mockRescan.mockReset();
    mockLoadCentralSkills.mockReset();
    mockInstallCentralSkill.mockReset();
    mockGetSkillsByAgent.mockReset();
    mockSearchSkillsSh.mockReset();
    mockInstallFromSkillsSh.mockReset();
    vi.unstubAllGlobals();

    mockGetNormalizedRegistryIdentity.mockImplementation(normalizeRegistryIdentity);
    mockLoadPreviewSkills.mockResolvedValue([
      {
        id: "openai::knowledge-work-plugin",
        registry_id: "openai",
        name: "Knowledge Work Plugin",
        description: "Useful repo preview content",
        download_url: "https://example.com/openai/knowledge-work-plugin/SKILL.md",
        is_installed: false,
        synced_at: "2026-04-16T00:00:00Z",
        cache_updated_at: "2026-04-16T00:00:00Z",
      },
    ]);

    storeState.registries = [makeRegistry("openai", "https://github.com/openai/skills")];
    storeState.installingIds = new Set<string>();
    storeState.skillsShResults = [];
    storeState.isSkillsShLoading = false;
    storeState.githubImport = {
      isPreviewLoading: false,
      isImporting: false,
      preview: null,
      importResult: null,
      previewedRepoUrl: null,
      error: null,
    };
  });

  function renderView() {
    return render(
      <MemoryRouter>
        <MarketplaceView />
      </MemoryRouter>,
    );
  }

  it("loads registries on mount", () => {
    renderView();
    expect(mockLoadRegistries).toHaveBeenCalledTimes(1);
  });

  it("shows recommended skills by default and filters them with search", () => {
    renderView();

    expect(screen.getByRole("button", { name: /Recommended|推荐/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "web-artifacts-builder" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search skills|搜索技能/i), {
      target: { value: "frontend-design" },
    });

    expect(screen.getByRole("button", { name: "frontend-design" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "web-artifacts-builder" })).not.toBeInTheDocument();
  });

  it("loads official directory preview skills from backend cache", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Official Directory|官方源目录/i }));
    fireEvent.click(screen.getByRole("button", { name: /OpenAI/i }));
    fireEvent.click(screen.getByRole("button", { name: /Browse Skills|浏览 Skills/i }));

    await waitFor(() => {
      expect(mockLoadPreviewSkills).toHaveBeenCalledWith("openai");
    });
    expect(await screen.findByText("Knowledge Work Plugin")).toBeInTheDocument();
    expect(screen.getByText("Useful repo preview content")).toBeInTheDocument();
  });

  it("shows browser fallback copy when official preview runs without Tauri", async () => {
    const isTauriSpy = vi.spyOn(tauriBridge, "isTauriRuntime").mockReturnValue(false);

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Official Directory|官方源目录/i }));
    fireEvent.click(screen.getByRole("button", { name: /OpenAI/i }));
    fireEvent.click(screen.getByRole("button", { name: /Browse Skills|浏览 Skills/i }));

    expect(
      await screen.findByText(/Preview unavailable in browser mode|浏览器模式下暂不支持预览/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/desktop app|桌面应用/i),
    ).toBeInTheDocument();
    expect(mockLoadPreviewSkills).not.toHaveBeenCalled();

    isTauriSpy.mockRestore();
  });

  it("opens the GitHub import wizard from the marketplace CTA", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/GitHub repository URL|GitHub 仓库 URL/i)).toBeInTheDocument();
  });

  it("renders the shared github preview workspace when preview data already exists", async () => {
    storeState.githubImport.preview = makePreview([
      {
        sourcePath: "skills/.curated/openai-docs",
        skillId: "openai-docs",
        skillName: "OpenAI Docs",
        description: "OpenAI docs skill description",
        rootDirectory: "skills/.curated",
        skillDirectoryName: "openai-docs",
        downloadUrl: "https://example.com/openai-docs/SKILL.md",
        conflict: null,
      },
    ]);

    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    expect(await screen.findByTestId("github-import-preview-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-repo-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-summary-list")).toBeInTheDocument();
    expect(screen.getByTestId("github-import-detail-pane")).toBeInTheDocument();
  });

  it("switches the selected preview skill inside the import wizard", async () => {
    storeState.githubImport.preview = makePreview([
      {
        sourcePath: "skills/.curated/openai-docs",
        skillId: "openai-docs",
        skillName: "OpenAI Docs",
        description: "First skill full description",
        rootDirectory: "skills/.curated",
        skillDirectoryName: "openai-docs",
        downloadUrl: "https://example.com/openai-docs/SKILL.md",
        conflict: null,
      },
      {
        sourcePath: "skills/.system/skill-creator",
        skillId: "skill-creator",
        skillName: "Skill Creator",
        description: "Second skill full description",
        rootDirectory: "skills/.system",
        skillDirectoryName: "skill-creator",
        downloadUrl: "https://example.com/skill-creator/SKILL.md",
        conflict: null,
      },
    ]);

    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    const detailPane = await screen.findByTestId("github-import-detail-pane");
    expect(within(detailPane).getByText("OpenAI Docs")).toBeInTheDocument();
    expect(within(detailPane).queryByText("Skill Creator")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Skill Creator/ }));

    await waitFor(() => {
      expect(within(detailPane).getByText("Skill Creator")).toBeInTheDocument();
    });
    expect(within(detailPane).queryByText("OpenAI Docs")).not.toBeInTheDocument();
  });

  it("turns conflict resolution into a confirm summary after renaming", async () => {
    storeState.githubImport.preview = makePreview([
      {
        sourcePath: "skills/.system/skill-creator",
        skillId: "skill-creator",
        skillName: "Skill Creator",
        description: "Create skills safely",
        rootDirectory: "skills/.system",
        skillDirectoryName: "skill-creator",
        downloadUrl: "https://example.com/skill-creator/SKILL.md",
        conflict: {
          existingSkillId: "skill-creator",
          existingName: "Skill Creator",
          existingCanonicalPath: "/Users/test/.agents/skills/skill-creator",
          proposedSkillId: "skill-creator",
          proposedName: "Skill Creator",
        },
      },
    ]);

    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    await screen.findByTestId("github-import-preview-workspace");
    fireEvent.click(screen.getByRole("button", { name: /Rename|重命名/i }));
    fireEvent.change(screen.getByPlaceholderText(/New skill id|新的技能 ID/i), {
      target: { value: "skill-creator-renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm|确认/i }));
    fireEvent.click(screen.getByRole("button", { name: /Review import|检查导入内容/i }));

    const confirmSummary = await screen.findByTestId("github-import-confirm-summary");
    expect(confirmSummary).toBeInTheDocument();
    expect(confirmSummary).toHaveTextContent("skill-creator-renamed");
    expect(screen.getByTestId("github-import-shell-footer")).toHaveAttribute(
      "data-footer-mode",
      "confirm",
    );
  });

  it("renders the result hub when an import result already exists", async () => {
    storeState.githubImport.importResult = {
      repo: {
        owner: "openai",
        repo: "skills",
        branch: "main",
        normalizedUrl: "https://github.com/openai/skills",
      },
      importedSkills: [
        {
          sourcePath: "skills/.curated/openai-docs",
          originalSkillId: "openai-docs",
          importedSkillId: "openai-docs",
          skillName: "OpenAI Docs",
          targetDirectory: "/Users/test/.agents/skills/openai-docs",
          resolution: "overwrite",
        },
      ],
      skippedSkills: ["legacy-skill"],
    };

    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    const resultHub = await screen.findByTestId("github-import-result-hub");
    expect(resultHub).toBeInTheDocument();
    expect(within(resultHub).getByRole("button", { name: /Continue platform setup|继续配置平台安装/i })).toBeInTheDocument();
    expect(within(resultHub).getByRole("button", { name: /Open Central|打开中央技能库/i })).toBeInTheDocument();
    expect(within(resultHub).getByRole("button", { name: /Start another import|开始新的导入/i })).toBeInTheDocument();
    expect(within(resultHub).getByText("legacy-skill")).toBeInTheDocument();
  });

  it("shows settings guidance when github preview fails with auth or rate-limit help", async () => {
    storeState.githubImport.error = "GitHub API rate limit exceeded. Save a Personal Access Token in Settings and retry.";

    renderView();
    fireEvent.click(screen.getByRole("button", { name: /Import GitHub repo|导入 GitHub 仓库/i }));

    expect(
      await screen.findByText(/GitHub Personal Access Token/i),
    ).toBeInTheDocument();
  });

  it("routes skills.sh detail install through installFromSkillsSh", async () => {
    storeState.skillsShResults = [
      {
        id: "skillssh-openai-docs",
        skill_id: "openai-docs",
        name: "OpenAI Docs",
        source: "openai/skills",
        installs: 321,
        stars: 1200,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "---\nname: OpenAI Docs\n---\n\nBody",
      }),
    );

    const invokeSpy = vi.spyOn(tauriBridge, "invoke").mockImplementation(async (command) => {
      if (command === "resolve_skills_sh_url") {
        return "https://example.com/openai-docs/SKILL.md";
      }
      if (command === "browse_skills_sh_directory") {
        return [];
      }
      return undefined as never;
    });

    mockInstallFromSkillsSh.mockResolvedValue(undefined);

    renderView();

    fireEvent.click(screen.getByRole("button", { name: /skills\.sh/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Detail|详情/i }));

    const sidebar = await screen.findByTestId("skill-detail-right-sidebar");
    fireEvent.click(within(sidebar).getByRole("button", { name: /Install|安装/i }));

    await waitFor(() => {
      expect(mockInstallFromSkillsSh).toHaveBeenCalledWith("openai/skills", "openai-docs");
    });
    expect(mockInstallSkill).not.toHaveBeenCalled();
    invokeSpy.mockRestore();
  });
});
