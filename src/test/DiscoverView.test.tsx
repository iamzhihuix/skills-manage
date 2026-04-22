import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DiscoverView } from "../pages/DiscoverView";
import { DiscoveredProject, DiscoveredSkill, AgentWithStatus } from "../types";
import { consumeScrollPosition } from "../lib/scrollRestoration";
import * as scrollRestoration from "../lib/scrollRestoration";

// Mock stores
vi.mock("../stores/discoverStore", () => ({
  useDiscoverStore: vi.fn(),
}));

vi.mock("../stores/platformStore", () => ({
  usePlatformStore: vi.fn(),
}));

// Mock the InstallDialog (heavy component with sub-dependencies)
vi.mock("../components/central/InstallDialog", () => ({
  InstallDialog: () => <div data-testid="install-dialog">InstallDialog</div>,
}));

vi.mock("../components/skill/SkillDetailDrawer", () => ({
  SkillDetailDrawer: ({
    open,
    skillId,
    onOpenChange,
    returnFocusRef,
  }: {
    open: boolean;
    skillId: string | null;
    onOpenChange: (open: boolean) => void;
    returnFocusRef?: { current: HTMLElement | null };
  }) =>
    open ? (
      <div data-testid="skill-detail-drawer">
        <div>drawer-skill:{skillId}</div>
        <button
          onClick={() => {
            onOpenChange(false);
            returnFocusRef?.current?.focus();
          }}
        >
          Close drawer
        </button>
      </div>
    ) : null,
}));

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "discover.title": "Discover Project Skills",
        "discover.resultsTitle": "Discovered Project Skills",
        "discover.foundSummary": `${params?.skills ?? 0} skills across ${params?.projects ?? 0} projects`,
        "discover.reScan": "Re-scan",
        "discover.searchPlaceholder": "Search discovered skills...",
        "discover.projectSearchPlaceholder": "Filter projects...",
        "discover.skillSearchPlaceholder": "Filter skills in this project...",
        "discover.scanning": "Scanning...",
        "discover.progress": `${params?.percent ?? 0}% — scanning ${params?.path ?? ""}`,
        "discover.foundSoFar": `${params?.skills ?? 0} skills in ${params?.projects ?? 0} projects`,
        "discover.stopAndShow": "Stop & Show Results",
        "discover.noResults": "No project skills discovered yet.",
        "discover.noResultsDesc": 'Click "Discover" to scan your project directories.',
        "discover.noMatch": `No skills match "${params?.query ?? ""}"`,
        "discover.noProjectMatch": `No projects match "${params?.query ?? ""}"`,
        "discover.clearSearch": "Clear search",
        "discover.installToCentral": "Install to Central",
        "discover.installToPlatform": "Install to Platform",
        "discover.alreadyCentral": "Already in Central",
        "discover.selected": `${params?.count ?? 0} selected`,
        "discover.installSelectedCentral": "Install selected to Central",
        "discover.deselectAll": "Deselect all",
        "discover.selectSkill": "Select skill",
        "discover.importSuccess": "Skill imported successfully",
        "discover.importError": "Import failed",
        "collection.skills": `Skills (${params?.count ?? 0})`,
        "central.viewDetailsLabel": `View details for ${params?.name ?? ""}`,
        "central.installLabel": `Install ${params?.name ?? ""} to platform`,
        "central.installTo": "Install to...",
        "central.toggleInstallLabel": `Toggle ${params?.platform ?? ""} for ${params?.skill ?? ""}`,
        "collection.removeSkillLabel": `Remove ${params?.name ?? ""}`,
        "marketplace.installed": "Installed",
        "sidebar.categoryLobster": "Lobster",
        "sidebar.categoryCoding": "Coding",
        "platform.sourceCentral": "Central Skills",
        "platform.sourceStandalone": "Standalone",
        "platform.sourceSymlinkLabel": "symlink",
        "platform.sourceCopyLabel": "copy",
        "platform.searchSkillLabel": `Search skill ${params?.name ?? ""}`,
      };
      return map[key] ?? key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useDiscoverStore } from "../stores/discoverStore";
import { usePlatformStore } from "../stores/platformStore";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockSkill: DiscoveredSkill = {
  id: "claude-code__my-app__deploy",
  name: "deploy",
  description: "Deploy the application",
  file_path: "/home/user/projects/my-app/.claude/skills/deploy/SKILL.md",
  dir_path: "/home/user/projects/my-app/.claude/skills/deploy",
  platform_id: "claude-code",
  platform_name: "Claude Code",
  project_path: "/home/user/projects/my-app",
  project_name: "my-app",
  is_already_central: false,
};

const mockAlreadyCentralSkill: DiscoveredSkill = {
  id: "cursor__my-app__review",
  name: "review",
  description: "Review code changes",
  file_path: "/home/user/projects/my-app/.cursor/skills/review/SKILL.md",
  dir_path: "/home/user/projects/my-app/.cursor/skills/review",
  platform_id: "cursor",
  platform_name: "Cursor",
  project_path: "/home/user/projects/my-app",
  project_name: "my-app",
  is_already_central: true,
};

const mockProjects: DiscoveredProject[] = [
  {
    project_path: "/home/user/projects/my-app",
    project_name: "my-app",
    skills: [mockSkill, mockAlreadyCentralSkill],
  },
];

// Multi-project fixture for search filter coverage.
const multiProjectSkillA: DiscoveredSkill = {
  id: "claude-code__alpha__alpha-skill",
  name: "alpha-skill",
  description: "Alpha handler",
  file_path: "/home/user/projects/alpha/.claude/skills/alpha-skill/SKILL.md",
  dir_path: "/home/user/projects/alpha/.claude/skills/alpha-skill",
  platform_id: "claude-code",
  platform_name: "Claude Code",
  project_path: "/home/user/projects/alpha",
  project_name: "alpha",
  is_already_central: false,
};

const multiProjectSkillB: DiscoveredSkill = {
  id: "claude-code__beta__beta-skill",
  name: "beta-skill",
  description: "Beta handler",
  file_path: "/home/user/projects/beta/.claude/skills/beta-skill/SKILL.md",
  dir_path: "/home/user/projects/beta/.claude/skills/beta-skill",
  platform_id: "claude-code",
  platform_name: "Claude Code",
  project_path: "/home/user/projects/beta",
  project_name: "beta",
  is_already_central: false,
};

const multiProjectSkillBExtra: DiscoveredSkill = {
  id: "claude-code__beta__other-beta",
  name: "other-beta",
  description: "Another beta-only helper",
  file_path: "/home/user/projects/beta/.claude/skills/other-beta/SKILL.md",
  dir_path: "/home/user/projects/beta/.claude/skills/other-beta",
  platform_id: "claude-code",
  platform_name: "Claude Code",
  project_path: "/home/user/projects/beta",
  project_name: "beta",
  is_already_central: false,
};

const multiProjects: DiscoveredProject[] = [
  {
    project_path: "/home/user/projects/alpha",
    project_name: "alpha",
    skills: [multiProjectSkillA],
  },
  {
    project_path: "/home/user/projects/beta",
    project_name: "beta",
    skills: [multiProjectSkillB, multiProjectSkillBExtra],
  },
];

const mockAgents: AgentWithStatus[] = [
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

const mockLoadDiscoveredSkills = vi.fn();
const mockLoadScanRoots = vi.fn();
const mockImportToCentral = vi.fn();
const mockImportToPlatform = vi.fn();
const mockToggleSkillSelection = vi.fn();
const mockClearSelection = vi.fn();
const mockRescan = vi.fn();
const mockRescanFromDisk = vi.fn();
const mockStopScan = vi.fn();
const mockUseDiscoverStore = vi.mocked(useDiscoverStore);
const mockUsePlatformStore = vi.mocked(usePlatformStore);

function buildDiscoverStoreState(overrides = {}) {
  return {
    isScanning: false,
    discoveredProjects: mockProjects,
    totalSkillsFound: 2,
    groupBy: "project" as const,
    platformFilter: null as string | null,
    searchQuery: "",
    selectedSkillIds: new Set<string>(),
    scanProgress: 0,
    currentPath: "",
    skillsFoundSoFar: 0,
    projectsFoundSoFar: 0,
    scanRoots: [],
    isLoadingRoots: false,
    loadDiscoveredSkills: mockLoadDiscoveredSkills,
    importToCentral: mockImportToCentral,
    importToPlatform: mockImportToPlatform,
    toggleSkillSelection: mockToggleSkillSelection,
    clearSelection: mockClearSelection,
    setGroupBy: vi.fn(),
    setPlatformFilter: vi.fn(),
    setSearchQuery: vi.fn(),
    loadScanRoots: mockLoadScanRoots,
    startScan: vi.fn(),
    stopScan: mockStopScan,
    setScanRootEnabled: vi.fn(),
    clearResults: vi.fn(),
    selectAllVisible: vi.fn(),
    refreshCounts: vi.fn(),
    rescanFromDisk: mockRescanFromDisk,
    clearError: vi.fn(),
    error: null,
    lastScanAt: null,
    ...overrides,
  };
}

function buildPlatformStoreState(overrides = {}) {
  return {
    agents: mockAgents,
    skillsByAgent: {},
    isLoading: false,
    isRefreshing: false,
    error: null,
    initialize: vi.fn(),
    rescan: mockRescan,
    refreshCounts: vi.fn(),
    ...overrides,
  };
}

// Render with routing that matches App.tsx routes
function renderDiscoverView(initialPath = "/discover") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/discover" element={<DiscoverView />} />
        <Route path="/discover/:projectPath" element={<DiscoverView />} />
      </Routes>
    </MemoryRouter>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DiscoverView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDiscoverStore.mockImplementation((selector) => selector(buildDiscoverStoreState()));
    mockUsePlatformStore.mockImplementation((selector) => selector(buildPlatformStoreState()));
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  it("renders the page title", () => {
    renderDiscoverView();
    expect(screen.getByText("Discovered Project Skills")).toBeInTheDocument();
  });

  it("shows discovered skills count in summary", () => {
    renderDiscoverView();
    expect(screen.getByText("2 skills across 1 projects")).toBeInTheDocument();
  });

  it("renders the re-scan button", () => {
    renderDiscoverView();
    expect(screen.getByText("Re-scan")).toBeInTheDocument();
  });

  it("renders project list in left panel", () => {
    renderDiscoverView();
    // "my-app" appears in both the project list and the detail header
    expect(screen.getAllByText("my-app").length).toBeGreaterThanOrEqual(1);
  });

  // ── Loading cached results on mount ──────────────────────────────────────

  it("calls loadDiscoveredSkills on mount", () => {
    renderDiscoverView();
    expect(mockLoadDiscoveredSkills).toHaveBeenCalled();
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  it("shows empty state when no discovered projects", () => {
    mockUseDiscoverStore.mockImplementation((selector) =>
      selector(buildDiscoverStoreState({
        discoveredProjects: [],
        totalSkillsFound: 0,
      }))
    );

    renderDiscoverView();
    expect(screen.getByText("No project skills discovered yet.")).toBeInTheDocument();
  });

  // ── Scanning state ─────────────────────────────────────────────────────────

  it("shows progress view during scan", () => {
    mockUseDiscoverStore.mockImplementation((selector) =>
      selector(buildDiscoverStoreState({ isScanning: true }))
    );

    renderDiscoverView();
    expect(screen.getByText("Scanning...")).toBeInTheDocument();
    expect(screen.getByText("Stop & Show Results")).toBeInTheDocument();
  });

  it("stop button calls stopScan when clicked during active scan", async () => {
    mockStopScan.mockResolvedValueOnce(undefined);
    mockUseDiscoverStore.mockImplementation((selector) =>
      selector(buildDiscoverStoreState({ isScanning: true }))
    );

    renderDiscoverView();

    const stopBtn = screen.getByRole("button", { name: /stop & show results/i });
    expect(stopBtn).toBeVisible();
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(mockStopScan).toHaveBeenCalled();
    });
  });

  // ── Skill cards (with project selected via route) ─────────────────────────

  it("renders discovered skill cards when project is selected", () => {
    const encoded = encodeURIComponent("/home/user/projects/my-app");
    renderDiscoverView(`/discover/${encoded}`);
    expect(screen.getByText("deploy")).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("shows 'Already in Central' badge for already-central skills", () => {
    const encoded = encodeURIComponent("/home/user/projects/my-app");
    renderDiscoverView(`/discover/${encoded}`);
    expect(screen.getByText("Already in Central")).toBeInTheDocument();
  });

  it("opens the skill detail drawer without navigating away or using scroll restoration helpers", async () => {
    const encoded = encodeURIComponent("/home/user/projects/my-app");
    const saveScrollSpy = vi.spyOn(scrollRestoration, "saveScrollPosition");
    const location = window.location.pathname;

    renderDiscoverView(`/discover/${encoded}`);

    fireEvent.click(screen.getByRole("button", { name: /view details for review/i }));

    await waitFor(() => {
      expect(screen.getByTestId("skill-detail-drawer")).toBeInTheDocument();
    });

    expect(screen.getByText("drawer-skill:review")).toBeInTheDocument();
    expect(window.location.pathname).toBe(location);
    expect(saveScrollSpy).not.toHaveBeenCalled();
  });

  it("renders a visible detail trigger for the browser validation fixture route", async () => {
    const encoded = encodeURIComponent("/Users/fixture/project");

    mockUseDiscoverStore.mockImplementation((selector) =>
      selector(
        buildDiscoverStoreState({
          discoveredProjects: [
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
          ],
          totalSkillsFound: 1,
        })
      )
    );

    renderDiscoverView(`/discover/${encoded}`);

    expect(
      await screen.findByRole("button", { name: /view details for fixture-central-skill/i })
    ).toBeInTheDocument();
  });

  it("restores discover project scroll after async hydration completes", async () => {
    let discoverState = buildDiscoverStoreState({
      discoveredProjects: [],
      totalSkillsFound: 0,
    });

    mockUseDiscoverStore.mockImplementation((selector) => selector(discoverState));

    const encoded = encodeURIComponent("/home/user/projects/my-app");
    const { rerender } = render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: `/discover/${encoded}`,
            state: {
              discoverContext: {
                projectPath: "/home/user/projects/my-app",
                skillSearch: "",
              },
              scrollRestoration: {
                key: "discover:/home/user/projects/my-app",
                scrollTop: 360,
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/discover/:projectPath" element={<DiscoverView />} />
        </Routes>
      </MemoryRouter>
    );

    expect(consumeScrollPosition("discover:/home/user/projects/my-app")).toBeNull();

    discoverState = buildDiscoverStoreState();
    rerender(
      <MemoryRouter
        initialEntries={[
          {
            pathname: `/discover/${encoded}`,
            state: {
              discoverContext: {
                projectPath: "/home/user/projects/my-app",
                skillSearch: "",
              },
              scrollRestoration: {
                key: "discover:/home/user/projects/my-app",
                scrollTop: 360,
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/discover/:projectPath" element={<DiscoverView />} />
        </Routes>
      </MemoryRouter>
    );

    const scroller = screen.getByText("deploy").closest("[class*='overflow-auto']");
    expect(scroller).not.toBeNull();
    if (!scroller) return;

    await waitFor(() => {
      expect((scroller as HTMLDivElement).scrollTop).toBe(360);
    });
  });

  it("shows install affordances and platform status metadata on discover cards", () => {
    const encoded = encodeURIComponent("/home/user/projects/my-app");
    renderDiscoverView(`/discover/${encoded}`);

    expect(screen.getAllByTitle("Install to Platform").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Install to Central").length).toBe(1);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("preserves selected project and right-panel scroll when closing the drawer and restores focus", async () => {
    const encoded = encodeURIComponent("/home/user/projects/my-app");
    renderDiscoverView(`/discover/${encoded}`);

    const trigger = screen.getByRole("button", { name: /view details for review/i });
    const scroller = trigger.closest("[class*='overflow-auto']");
    expect(scroller).not.toBeNull();
    if (!scroller) return;
    (scroller as HTMLDivElement).scrollTop = 275;

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId("skill-detail-drawer")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /close drawer/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail-drawer")).not.toBeInTheDocument();
    });

    expect(screen.getAllByText("my-app").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("review")).toBeInTheDocument();
    expect((scroller as HTMLDivElement).scrollTop).toBe(275);
    expect(trigger).toHaveFocus();
  });

  // ── Selection ──────────────────────────────────────────────────────────────

  it("shows selection action bar when skills are selected", () => {
    mockUseDiscoverStore.mockImplementation((selector) =>
      selector(buildDiscoverStoreState({
        selectedSkillIds: new Set(["claude-code__my-app__deploy"]),
      }))
    );

    const encoded = encodeURIComponent("/home/user/projects/my-app");
    renderDiscoverView(`/discover/${encoded}`);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByText("Install selected to Central")).toBeInTheDocument();
    expect(screen.getByText("Deselect all")).toBeInTheDocument();
  });

  // ── Install to Central ─────────────────────────────────────────────────────

  it("calls importToCentral when install-to-central button is clicked", async () => {
    mockImportToCentral.mockResolvedValueOnce({ skill_id: "deploy", target: "central" });
    mockRescan.mockResolvedValueOnce(undefined);

    const encoded = encodeURIComponent("/home/user/projects/my-app");
    renderDiscoverView(`/discover/${encoded}`);

    const installBtn = screen.getAllByTitle("Install to Central")[0];
    fireEvent.click(installBtn);

    await waitFor(() => {
      expect(mockImportToCentral).toHaveBeenCalledWith("claude-code__my-app__deploy");
    });
  });

  // ── Search behaviour (DISC-SEARCH-001 / 002) ──────────────────────────────

  describe("search behaviour", () => {
    function renderWithMultiProjects(initialPath = "/discover") {
      mockUseDiscoverStore.mockImplementation((selector) =>
        selector(
          buildDiscoverStoreState({
            discoveredProjects: multiProjects,
            totalSkillsFound: 3,
          })
        )
      );
      return renderDiscoverView(initialPath);
    }

    it("filters project list by project search query", () => {
      renderWithMultiProjects();
      const projectSearchInput = screen.getByLabelText("Filter projects...") as HTMLInputElement;
      fireEvent.change(projectSearchInput, { target: { value: "alpha" } });
      // alpha appears in project list + detail header, beta should be absent
      expect(screen.getAllByText("alpha").length).toBeGreaterThan(0);
      expect(screen.queryByText("beta")).not.toBeInTheDocument();
    });

    it("shows a no-project-match empty state with a clear-search affordance", () => {
      renderWithMultiProjects();
      const projectSearchInput = screen.getByLabelText("Filter projects...") as HTMLInputElement;
      fireEvent.change(projectSearchInput, { target: { value: "nonexistent" } });

      expect(
        screen.getByText('No projects match "nonexistent"')
      ).toBeInTheDocument();

      // A Clear-search button in the empty state should reset the input and restore projects.
      const clearButtons = screen.getAllByText("Clear search");
      expect(clearButtons.length).toBeGreaterThan(0);
      fireEvent.click(clearButtons[0]);

      expect(projectSearchInput.value).toBe("");
      expect(screen.getAllByText("alpha").length).toBeGreaterThan(0);
      expect(screen.getAllByText("beta").length).toBeGreaterThan(0);
    });

    it("clearing the project search X button restores the prior project list", () => {
      renderWithMultiProjects();
      const projectSearchInput = screen.getByLabelText("Filter projects...") as HTMLInputElement;
      fireEvent.change(projectSearchInput, { target: { value: "alpha" } });
      expect(screen.queryByText("beta")).not.toBeInTheDocument();

      const clearX = screen.getByRole("button", { name: "Clear search" });
      fireEvent.click(clearX);

      expect(projectSearchInput.value).toBe("");
      expect(screen.getAllByText("alpha").length).toBeGreaterThan(0);
      expect(screen.getAllByText("beta").length).toBeGreaterThan(0);
    });

    it("keeps the currently selected project visible even when the project filter would hide it", () => {
      const encoded = encodeURIComponent("/home/user/projects/beta");
      renderWithMultiProjects(`/discover/${encoded}`);

      const projectSearchInput = screen.getByLabelText("Filter projects...") as HTMLInputElement;
      fireEvent.change(projectSearchInput, { target: { value: "alpha" } });

      // The "beta-skill" detail pane must still render because beta is still
      // the active project (valid context preserved) — we don't force-navigate
      // the user away mid-typing.
      expect(screen.getByText("beta-skill")).toBeInTheDocument();
      // And beta must still appear somewhere (in the "current selection"
      // fallback section of the project list).
      expect(screen.getAllByText("beta").length).toBeGreaterThan(0);
    });

    it("filters skill list by skill search query within the selected project", () => {
      const encoded = encodeURIComponent("/home/user/projects/beta");
      renderWithMultiProjects(`/discover/${encoded}`);

      const skillSearchInput = screen.getByLabelText(
        "Filter skills in this project..."
      ) as HTMLInputElement;
      fireEvent.change(skillSearchInput, { target: { value: "other" } });

      expect(screen.getByText("other-beta")).toBeInTheDocument();
      expect(screen.queryByText("beta-skill")).not.toBeInTheDocument();
    });

    it("shows a no-skill-match empty state with a clear-search affordance", () => {
      const encoded = encodeURIComponent("/home/user/projects/beta");
      renderWithMultiProjects(`/discover/${encoded}`);

      const skillSearchInput = screen.getByLabelText(
        "Filter skills in this project..."
      ) as HTMLInputElement;
      fireEvent.change(skillSearchInput, { target: { value: "zzz" } });

      expect(screen.getByText('No skills match "zzz"')).toBeInTheDocument();
      const clearButtons = screen.getAllByText("Clear search");
      expect(clearButtons.length).toBeGreaterThan(0);

      fireEvent.click(clearButtons[clearButtons.length - 1]);

      expect(skillSearchInput.value).toBe("");
      expect(screen.getByText("beta-skill")).toBeInTheDocument();
      expect(screen.getByText("other-beta")).toBeInTheDocument();
    });

    it("preserves the skill search query when switching between projects", () => {
      const encoded = encodeURIComponent("/home/user/projects/beta");
      renderWithMultiProjects(`/discover/${encoded}`);

      const skillSearchInput = screen.getByLabelText(
        "Filter skills in this project..."
      ) as HTMLInputElement;
      fireEvent.change(skillSearchInput, { target: { value: "other" } });
      expect(skillSearchInput.value).toBe("other");

      // Switch to another project (alpha) via the project list button.
      fireEvent.click(screen.getByRole("button", { name: /alpha/i }));

      const persistedSkillInput = screen.getByLabelText(
        "Filter skills in this project..."
      ) as HTMLInputElement;
      expect(persistedSkillInput.value).toBe("other");
    });
  });

  // ── Performance (DISC-PERF-001) ────────────────────────────────────────────

  describe("selection responsiveness", () => {
    it("does not re-invoke loadDiscoveredSkills when switching between projects", () => {
      mockUseDiscoverStore.mockImplementation((selector) =>
        selector(
          buildDiscoverStoreState({
            discoveredProjects: multiProjects,
            totalSkillsFound: 3,
          })
        )
      );

      const encoded = encodeURIComponent("/home/user/projects/alpha");
      renderDiscoverView(`/discover/${encoded}`);

      // Initial mount calls loadDiscoveredSkills exactly once.
      expect(mockLoadDiscoveredSkills).toHaveBeenCalledTimes(1);

      // Click a different project — this is a purely navigational event and
      // should not trigger another full reload (no heavy recomputation path).
      fireEvent.click(screen.getByRole("button", { name: /beta/i }));

      expect(mockLoadDiscoveredSkills).toHaveBeenCalledTimes(1);
      // The right pane now reflects the beta project without any additional
      // store-reload requests.
      expect(screen.getByText("beta-skill")).toBeInTheDocument();
    });
  });
});
