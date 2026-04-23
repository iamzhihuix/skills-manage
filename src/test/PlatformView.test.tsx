import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { PlatformView } from "../pages/PlatformView";
import { AgentWithStatus, ScannedSkill } from "../types";

// Mock stores
vi.mock("../stores/platformStore", () => ({
  usePlatformStore: vi.fn(),
}));

vi.mock("../stores/skillStore", () => ({
  useSkillStore: vi.fn(),
}));

vi.mock("../stores/centralSkillsStore", () => ({
  useCentralSkillsStore: vi.fn(),
}));

vi.mock("../components/skill/SkillDetailDrawer", () => ({
  SkillDetailDrawer: ({
    open,
    skillId,
    agentId,
    rowId,
    onOpenChange,
    returnFocusRef,
  }: {
    open: boolean;
    skillId: string | null;
    agentId?: string | null;
    rowId?: string | null;
    onOpenChange: (open: boolean) => void;
    returnFocusRef?: { current: HTMLElement | null };
  }) =>
    open ? (
      <div data-testid="skill-detail-drawer">
        <div>drawer-skill:{skillId}</div>
        <div>drawer-agent:{agentId ?? "none"}</div>
        <div>drawer-row:{rowId ?? "none"}</div>
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

import { usePlatformStore } from "../stores/platformStore";
import { useSkillStore } from "../stores/skillStore";
import { useCentralSkillsStore } from "../stores/centralSkillsStore";
import * as tauriBridge from "@/lib/tauri";

const userSourceText = /用户来源|User source/i;
const pluginSourceText = /插件来源|Plugin source/i;
const readOnlyText = /只读|Read-only/i;
const badgeQueryOptions = { selector: "span" } as const;
const claudeTabName = (label: string, count?: number) =>
  count == null
    ? new RegExp(`^${label}(?:\\s*\\(\\d+\\))?$`)
    : new RegExp(`^${label}\\s*\\(${count}\\)$`);
const getCardBadgeMatches = (matcher: RegExp) =>
  screen
    .queryAllByText(matcher, badgeQueryOptions)
    .filter((element) => element.closest(".rounded-xl"));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockAgent: AgentWithStatus = {
  id: "claude-code",
  display_name: "Claude Code",
  category: "coding",
  global_skills_dir: "/Users/test/.claude/skills/",
  is_detected: true,
  is_builtin: true,
  is_enabled: true,
};

const mockCursorAgent: AgentWithStatus = {
  id: "cursor",
  display_name: "Cursor",
  category: "coding",
  global_skills_dir: "/Users/test/.cursor/skills/",
  is_detected: true,
  is_builtin: true,
  is_enabled: true,
};

const mockSkills: ScannedSkill[] = [
  {
    id: "frontend-design",
    name: "frontend-design",
    description: "Build distinctive, production-grade frontend interfaces",
    file_path: "~/.claude/skills/frontend-design/SKILL.md",
    dir_path: "~/.claude/skills/frontend-design",
    link_type: "symlink",
    symlink_target: "~/.agents/skills/frontend-design",
    is_central: true,
  },
  {
    id: "code-reviewer",
    name: "code-reviewer",
    description: "Review code changes and identify high-confidence actionable bugs",
    file_path: "~/.claude/skills/code-reviewer/SKILL.md",
    dir_path: "~/.claude/skills/code-reviewer",
    link_type: "copy",
    is_central: false,
  },
];

const mockCursorSkills: ScannedSkill[] = [
  {
    id: "cursor-helper",
    name: "cursor-helper",
    description: "Cursor-specific helper skill",
    file_path: "~/.cursor/skills/cursor-helper/SKILL.md",
    dir_path: "~/.cursor/skills/cursor-helper",
    link_type: "symlink",
    symlink_target: "~/.agents/skills/cursor-helper",
    is_central: true,
  },
];

const mockDuplicateClaudeSkills: ScannedSkill[] = [
  {
    id: "shared-skill",
    row_id: "claude-code::user::shared-skill",
    name: "shared-skill",
    description: "User-source copy",
    file_path: "~/.claude/skills/shared-skill/SKILL.md",
    dir_path: "~/.claude/skills/shared-skill",
    link_type: "native",
    is_central: false,
    source_kind: "user",
    source_root: "~/.claude/skills",
    is_read_only: false,
    conflict_count: 2,
  },
  {
    id: "shared-skill",
    row_id: "claude-code::plugin::shared-skill",
    name: "shared-skill",
    description: "Plugin copy",
    file_path: "~/.claude/plugins/cache/publisher/plugin-a/1.0.0/skills/shared-skill/SKILL.md",
    dir_path: "~/.claude/plugins/cache/publisher/plugin-a/1.0.0/skills/shared-skill",
    link_type: "native",
    is_central: false,
    source_kind: "plugin",
    source_root: "~/.claude/plugins/cache/publisher/plugin-a/1.0.0",
    is_read_only: true,
    conflict_count: 2,
  },
];

const mockDuplicateClaudeSkillsWithDistinctIds: ScannedSkill[] = [
  {
    id: "shared-skill-id",
    row_id: "claude-code::user::shared-skill-id",
    name: "Shared skill",
    description: "User-source copy",
    file_path: "~/.claude/skills/shared-skill/SKILL.md",
    dir_path: "~/.claude/skills/shared-skill",
    link_type: "native",
    is_central: false,
    source_kind: "user",
    source_root: "~/.claude/skills",
    is_read_only: false,
    conflict_count: 2,
  },
  {
    id: "shared-skill-id",
    row_id: "claude-code::plugin::shared-skill-id",
    name: "Shared skill",
    description: "Plugin copy",
    file_path: "~/.claude/plugins/cache/publisher/plugin-a/1.0.0/skills/shared-skill/SKILL.md",
    dir_path: "~/.claude/plugins/cache/publisher/plugin-a/1.0.0/skills/shared-skill",
    link_type: "native",
    is_central: false,
    source_kind: "plugin",
    source_root: "~/.claude/plugins/cache/publisher/plugin-a/1.0.0",
    is_read_only: true,
    conflict_count: 2,
  },
];

const mockClaudePluginSliceDuplicates: ScannedSkill[] = [
  {
    id: "shared-skill",
    row_id: "claude-code::user::shared-skill",
    name: "shared-skill",
    description: "User-source copy",
    file_path: "~/.claude/skills/shared-skill/SKILL.md",
    dir_path: "~/.claude/skills/shared-skill",
    link_type: "native",
    is_central: false,
    source_kind: "user",
    source_root: "~/.claude/skills",
    is_read_only: false,
    conflict_count: 3,
  },
  {
    id: "shared-skill",
    row_id: "claude-code::plugin::publisher-a::shared-skill",
    name: "shared-skill",
    description: "Plugin A copy",
    file_path: "~/.claude/plugins/cache/publisher-a/plugin-a/1.0.0/skills/shared-skill/SKILL.md",
    dir_path: "~/.claude/plugins/cache/publisher-a/plugin-a/1.0.0/skills/shared-skill",
    link_type: "native",
    is_central: false,
    source_kind: "plugin",
    source_root: "~/.claude/plugins/cache/publisher-a/plugin-a/1.0.0",
    is_read_only: true,
    conflict_count: 3,
  },
  {
    id: "shared-skill",
    row_id: "claude-code::plugin::publisher-b::shared-skill",
    name: "shared-skill",
    description: "Plugin B copy",
    file_path: "~/.claude/plugins/cache/publisher-b/plugin-b/2.0.0/.claude/skills/shared-skill/SKILL.md",
    dir_path: "~/.claude/plugins/cache/publisher-b/plugin-b/2.0.0/.claude/skills/shared-skill",
    link_type: "native",
    is_central: false,
    source_kind: "plugin",
    source_root: "~/.claude/plugins/cache/publisher-b/plugin-b/2.0.0",
    is_read_only: true,
    conflict_count: 3,
  },
];

const mockGetSkillsByAgent = vi.fn();
const mockLoadCentralSkills = vi.fn();
const mockInstallSkill = vi.fn();
const mockUninstallSkillFromAgent = vi.fn();
const mockRefreshCounts = vi.fn();
const mockUsePlatformStore = vi.mocked(usePlatformStore);
const mockUseSkillStore = vi.mocked(useSkillStore);
const mockUseCentralSkillsStore = vi.mocked(useCentralSkillsStore);

function buildPlatformStoreState(overrides = {}) {
  return {
    agents: [mockAgent],
    skillsByAgent: { "claude-code": 2 },
    isLoading: false,
    isRefreshing: false,
    scanGeneration: 1,
    error: null,
    initialize: vi.fn(),
    rescan: vi.fn(),
    refreshCounts: mockRefreshCounts,
    ...overrides,
  };
}

function buildSkillStoreState(overrides = {}) {
  return {
    skillsByAgent: { "claude-code": mockSkills },
    loadingByAgent: { "claude-code": false },
    pendingSkillActionKeys: {},
    error: null,
    getSkillsByAgent: mockGetSkillsByAgent,
    uninstallSkillFromAgent: mockUninstallSkillFromAgent,
    ...overrides,
  };
}

function buildCentralSkillsStoreState(overrides = {}) {
  return {
    skills: [],
    agents: [mockAgent],
    loadCentralSkills: mockLoadCentralSkills,
    installSkill: mockInstallSkill,
    ...overrides,
  };
}

function installDefaultStoreMocks() {
  mockUsePlatformStore.mockImplementation((selector?: unknown) => {
    const state = buildPlatformStoreState();
    if (typeof selector === "function") return selector(state);
    return state;
  });
  mockUseSkillStore.mockImplementation((selector?: unknown) => {
    const state = buildSkillStoreState();
    if (typeof selector === "function") return selector(state);
    return state;
  });
  mockUseCentralSkillsStore.mockImplementation((selector?: unknown) => {
    const state = buildCentralSkillsStoreState();
    if (typeof selector === "function") return selector(state);
    return state;
  });
}

function renderPlatformView(agentId = "claude-code") {
  return render(
    <MemoryRouter initialEntries={[`/platform/${agentId}`]}>
      <Routes>
        <Route path="/platform/:agentId" element={<PlatformView />} />
      </Routes>
    </MemoryRouter>
  );
}

let testNavigate: ReturnType<typeof useNavigate> | null = null;

function NavigationHarness() {
  testNavigate = useNavigate();
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PlatformView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testNavigate = null;
    mockRefreshCounts.mockReset();
    mockUninstallSkillFromAgent.mockReset();
    installDefaultStoreMocks();
  });

  // ── Header ────────────────────────────────────────────────────────────────

  it("shows platform name in header", () => {
    renderPlatformView();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("shows platform directory path in header", () => {
    renderPlatformView();
    expect(screen.getByText("/Users/test/.claude/skills/")).toBeInTheDocument();
  });

  // ── Skill List ────────────────────────────────────────────────────────────

  it("renders skill cards for all skills", () => {
    renderPlatformView();
    expect(screen.getByText("frontend-design")).toBeInTheDocument();
    expect(screen.getByText("code-reviewer")).toBeInTheDocument();
  });

  it("shows source indicator on skill cards", () => {
    renderPlatformView();
    expect(
      screen.getAllByText((_, element) => element?.textContent?.replace(/\s+/g, " ").trim() === "中央技能库 - 符号链接")
        .length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText((_, element) => element?.textContent?.replace(/\s+/g, " ").trim() === "独立安装 - 复制安装")
        .length
    ).toBeGreaterThan(0);
  });

  it("renders browser fixture installed card on the localhost validation surface without Tauri", async () => {
    const isTauriSpy = vi.spyOn(tauriBridge, "isTauriRuntime").mockReturnValue(false);

    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: {
          "claude-code": [
            {
              id: "fixture-central-skill",
              name: "fixture-central-skill",
              description: "Browser fixture skill sourced from the central library",
              file_path: "~/.claude/skills/fixture-central-skill/SKILL.md",
              dir_path: "~/.claude/skills/fixture-central-skill",
              link_type: "symlink",
              symlink_target: "~/.agents/skills/fixture-central-skill",
              is_central: true,
            },
          ],
        },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    render(
      <MemoryRouter initialEntries={["/platform/claude-code"]}>
        <Routes>
          <Route path="/platform/:agentId" element={<PlatformView />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("button", { name: /查看 fixture-central-skill 的详情/i })).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) => element?.textContent?.replace(/\s+/g, " ").trim() === "中央技能库 - 符号链接")
        .length
    ).toBeGreaterThan(0);

    isTauriSpy.mockRestore();
  });

  // ── Empty State ───────────────────────────────────────────────────────────

  it("shows empty state when platform has no skills", () => {
    mockUsePlatformStore.mockImplementation((selector?: unknown) => {
      const state = buildPlatformStoreState({
        skillsByAgent: { "claude-code": 0 },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: { "claude-code": [] },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    render(
      <MemoryRouter initialEntries={["/platform/claude-code"]}>
        <Routes>
          <Route path="/platform/:agentId" element={<PlatformView />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      screen.getByText(/该平台暂无技能/)
    ).toBeInTheDocument();
  });

  // ── Platform Not Found ────────────────────────────────────────────────────

  it("shows not found when agent doesn't exist", () => {
    mockUsePlatformStore.mockImplementation((selector?: unknown) => {
      const state = buildPlatformStoreState({ agents: [] });
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({ skillsByAgent: {} });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    render(
      <MemoryRouter initialEntries={["/platform/unknown"]}>
        <Routes>
          <Route path="/platform/:agentId" element={<PlatformView />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("未找到平台")).toBeInTheDocument();
  });

  // ── Search / Filter ───────────────────────────────────────────────────────

  it("renders search input", () => {
    renderPlatformView();
    expect(
      screen.getByPlaceholderText(/搜索技能/)
    ).toBeInTheDocument();
  });

  it("filters skills by name when searching", async () => {
    renderPlatformView();
    const searchInput = screen.getByPlaceholderText(/搜索技能/);
    fireEvent.change(searchInput, { target: { value: "frontend" } });

    await waitFor(() => {
      expect(screen.getByText("frontend-design")).toBeInTheDocument();
      expect(screen.queryByText("code-reviewer")).not.toBeInTheDocument();
    });
  });

  it("filters skills by description when searching", async () => {
    renderPlatformView();
    const searchInput = screen.getByPlaceholderText(/搜索技能/);
    fireEvent.change(searchInput, { target: { value: "actionable" } });

    await waitFor(() => {
      expect(screen.getByText("code-reviewer")).toBeInTheDocument();
      expect(screen.queryByText("frontend-design")).not.toBeInTheDocument();
    });
  });

  it("shows all skills when search is cleared", async () => {
    renderPlatformView();
    const searchInput = screen.getByPlaceholderText(/搜索技能/);
    fireEvent.change(searchInput, { target: { value: "frontend" } });
    fireEvent.change(searchInput, { target: { value: "" } });

    await waitFor(() => {
      expect(screen.getByText("frontend-design")).toBeInTheDocument();
      expect(screen.getByText("code-reviewer")).toBeInTheDocument();
    });
  });

  it("shows empty state message when search has no results", async () => {
    renderPlatformView();
    const searchInput = screen.getByPlaceholderText(/搜索技能/);
    fireEvent.change(searchInput, { target: { value: "nonexistent-skill-xyz" } });

    await waitFor(() => {
      expect(screen.getByText(/没有匹配的技能/)).toBeInTheDocument();
    });
  });

  // ── Data Loading ──────────────────────────────────────────────────────────

  it("calls getSkillsByAgent on mount", () => {
    renderPlatformView();
    expect(mockGetSkillsByAgent).toHaveBeenCalledWith("claude-code");
  });

  it("opens the skill detail drawer without navigating away", async () => {
    renderPlatformView();

    fireEvent.click(screen.getByRole("button", { name: /查看 frontend-design 的详情/i }));

    await waitFor(() => {
      expect(screen.getByTestId("skill-detail-drawer")).toBeInTheDocument();
    });
    expect(screen.getByText("drawer-skill:frontend-design")).toBeInTheDocument();
  });

  it("passes Claude row identity into the drawer when duplicate platform rows share a skill id", async () => {
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: { "claude-code": mockDuplicateClaudeSkills },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    renderPlatformView();

    const detailButtons = screen.getAllByRole("button", { name: /查看 shared-skill 的详情/i });
    expect(detailButtons).toHaveLength(2);

    fireEvent.click(detailButtons[1]);

    await waitFor(() => {
      expect(screen.getByTestId("skill-detail-drawer")).toBeInTheDocument();
    });

    expect(screen.getByText("drawer-skill:shared-skill")).toBeInTheDocument();
    expect(screen.getByText("drawer-agent:claude-code")).toBeInTheDocument();
    expect(
      screen.getByText("drawer-row:claude-code::plugin::shared-skill")
    ).toBeInTheDocument();
  });

  it("shows duplicate Claude rows with explicit source markers and read-only list treatment", () => {
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: { "claude-code": mockDuplicateClaudeSkills },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    renderPlatformView();

    expect(screen.getAllByRole("button", { name: /查看 shared-skill 的详情/i })).toHaveLength(2);

    const [userBadge] = getCardBadgeMatches(userSourceText);
    const [pluginBadge] = getCardBadgeMatches(pluginSourceText);
    const [readOnlyBadge] = getCardBadgeMatches(readOnlyText);

    expect(userBadge).toBeDefined();
    expect(pluginBadge).toBeDefined();
    expect(readOnlyBadge).toBeDefined();
    const userCard = userBadge.closest(".rounded-xl");
    const pluginCard = pluginBadge.closest(".rounded-xl");

    expect(userCard).not.toBeNull();
    expect(pluginCard).not.toBeNull();
    expect(readOnlyBadge.closest(".rounded-xl")).toBe(pluginCard);

    if (!userCard || !pluginCard) {
      return;
    }

    expect(
      within(userCard as HTMLElement).getByRole("button", {
        name: /将 shared-skill 安装到平台/i,
      })
    ).toBeInTheDocument();
    expect(
      within(userCard as HTMLElement).getByRole("button", {
        name: /从 Claude Code 卸载 shared-skill/i,
      })
    ).toBeInTheDocument();
    expect(
      within(pluginCard as HTMLElement).queryByRole("button", {
        name: /将 shared-skill 安装到平台/i,
      })
    ).not.toBeInTheDocument();
    expect(
      within(pluginCard as HTMLElement).queryByRole("button", {
        name: /从 Claude Code 卸载 shared-skill/i,
      })
    ).not.toBeInTheDocument();
  });

  it("renders uninstall actions for writable platform skills", () => {
    renderPlatformView();

    expect(
      screen.getByRole("button", { name: /从 Claude Code 卸载 frontend-design/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /从 Claude Code 卸载 code-reviewer/i })
    ).toBeInTheDocument();
  });

  it("uninstalls a skill from the current platform and refreshes counts", async () => {
    renderPlatformView();

    fireEvent.click(
      screen.getByRole("button", { name: /从 Claude Code 卸载 frontend-design/i })
    );
    expect(mockUninstallSkillFromAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /确认删除/i }));

    await waitFor(() => {
      expect(mockUninstallSkillFromAgent).toHaveBeenCalledWith(
        "frontend-design",
        "claude-code"
      );
    });
    expect(mockRefreshCounts).toHaveBeenCalledTimes(1);
  });

  it("cancels the armed uninstall state when clicking outside the card actions", async () => {
    renderPlatformView();

    fireEvent.click(
      screen.getByRole("button", { name: /从 Claude Code 卸载 frontend-design/i })
    );
    expect(screen.getByRole("button", { name: /确认删除/i })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /确认删除/i })).not.toBeInTheDocument();
    });
    expect(mockUninstallSkillFromAgent).not.toHaveBeenCalled();
  });

  it("shows Claude-only source tabs with 全部 selected by default", () => {
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: { "claude-code": mockClaudePluginSliceDuplicates },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    renderPlatformView();

    expect(screen.getByRole("tab", { name: claudeTabName("全部", 3) })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: claudeTabName("用户来源", 1) })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: claudeTabName("插件来源", 2) })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /查看 shared-skill 的详情/i })).toHaveLength(3);
  });

  it("filters Claude rows by the active source tab and keeps duplicate rows visible inside the selected slice", async () => {
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: { "claude-code": mockClaudePluginSliceDuplicates },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    renderPlatformView();

    fireEvent.click(screen.getByRole("tab", { name: claudeTabName("插件来源", 2) }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /查看 shared-skill 的详情/i })).toHaveLength(2);
    });

    expect(getCardBadgeMatches(userSourceText)).toHaveLength(0);
    expect(getCardBadgeMatches(pluginSourceText)).toHaveLength(2);
    expect(getCardBadgeMatches(readOnlyText)).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: claudeTabName("用户来源", 1) }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /查看 shared-skill 的详情/i })).toHaveLength(1);
    });

    expect(getCardBadgeMatches(userSourceText)).toHaveLength(1);
    expect(getCardBadgeMatches(pluginSourceText)).toHaveLength(0);
    expect(getCardBadgeMatches(readOnlyText)).toHaveLength(0);
  });

  it("searches only inside the active Claude source tab", async () => {
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: { "claude-code": mockClaudePluginSliceDuplicates },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    renderPlatformView();

    fireEvent.click(screen.getByRole("tab", { name: claudeTabName("用户来源", 1) }));
    fireEvent.change(screen.getByPlaceholderText(/搜索技能/), {
      target: { value: "shared-skill" },
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /查看 shared-skill 的详情/i })).toHaveLength(1);
    });

    expect(getCardBadgeMatches(userSourceText)).toHaveLength(1);
    expect(getCardBadgeMatches(pluginSourceText)).toHaveLength(0);
    expect(getCardBadgeMatches(readOnlyText)).toHaveLength(0);
  });

  it("searching by duplicated Claude skill id keeps both source rows and badges visible", async () => {
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: { "claude-code": mockDuplicateClaudeSkillsWithDistinctIds },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    renderPlatformView();

    fireEvent.change(screen.getByPlaceholderText(/搜索技能/), {
      target: { value: "shared-skill-id" },
    });

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /查看 Shared skill 的详情/i })
      ).toHaveLength(2);
    });

    expect(getCardBadgeMatches(userSourceText)).toHaveLength(1);
    expect(getCardBadgeMatches(pluginSourceText)).toHaveLength(1);
    expect(getCardBadgeMatches(readOnlyText)).toHaveLength(1);
  });

  it("does not render Claude source tabs on non-Claude platform pages", () => {
    mockUsePlatformStore.mockImplementation((selector?: unknown) => {
      const state = buildPlatformStoreState({
        agents: [mockAgent, mockCursorAgent],
        skillsByAgent: {
          "claude-code": mockSkills.length,
          cursor: mockCursorSkills.length,
        },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: {
          "claude-code": mockSkills,
          cursor: mockCursorSkills,
        },
        loadingByAgent: {
          "claude-code": false,
          cursor: false,
        },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    renderPlatformView("cursor");

    expect(screen.queryByRole("tab", { name: claudeTabName("全部") })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: claudeTabName("用户来源") })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: claudeTabName("插件来源") })).not.toBeInTheDocument();
  });

  it("preserves platform search and scroll state when closing the drawer and restores focus", async () => {
    renderPlatformView();

    const searchInput = screen.getByPlaceholderText(/搜索技能/);
    fireEvent.change(searchInput, { target: { value: "frontend" } });

    const scroller = searchInput.closest(".flex.flex-col.h-full")?.querySelector(".flex-1.overflow-auto.p-6");
    expect(scroller).not.toBeNull();
    if (!scroller) return;
    (scroller as HTMLDivElement).scrollTop = 180;

    const trigger = screen.getByRole("button", { name: /查看 frontend-design 的详情/i });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId("skill-detail-drawer")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /close drawer/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail-drawer")).not.toBeInTheDocument();
    });

    expect(searchInput).toHaveValue("frontend");
    expect((scroller as HTMLDivElement).scrollTop).toBe(180);
    expect(trigger).toHaveFocus();
  });

  it("restores focus to the originating duplicate Claude row trigger", async () => {
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: { "claude-code": mockDuplicateClaudeSkills },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    renderPlatformView();

    const [userTrigger] = screen.getAllByRole("button", {
      name: /查看 shared-skill 的详情/i,
    });
    fireEvent.click(userTrigger);

    await waitFor(() => {
      expect(screen.getByTestId("skill-detail-drawer")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /close drawer/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail-drawer")).not.toBeInTheDocument();
    });

    expect(userTrigger).toHaveFocus();
  });

  it("re-fetches the live Claude list after a scan generation change and removes stale duplicate rows without clearing the search query", async () => {
    let platformState = buildPlatformStoreState({
      scanGeneration: 1,
      skillsByAgent: { "claude-code": 2 },
    });
    let skillState = buildSkillStoreState({
      skillsByAgent: { "claude-code": mockDuplicateClaudeSkillsWithDistinctIds },
    });

    mockUsePlatformStore.mockImplementation((selector?: unknown) => {
      if (typeof selector === "function") return selector(platformState);
      return platformState;
    });
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      if (typeof selector === "function") return selector(skillState);
      return skillState;
    });

    const view = renderPlatformView();

    const searchInput = screen.getByPlaceholderText(/搜索技能/);
    fireEvent.change(searchInput, { target: { value: "shared-skill-id" } });

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /查看 Shared skill 的详情/i })
      ).toHaveLength(2);
    });

    mockGetSkillsByAgent.mockClear();

    platformState = buildPlatformStoreState({
      scanGeneration: 2,
      skillsByAgent: { "claude-code": 2 },
    });
    skillState = buildSkillStoreState({
      skillsByAgent: {
        "claude-code": [
          mockDuplicateClaudeSkillsWithDistinctIds[1],
          {
            id: "other-skill",
            name: "Other skill",
            description: "Non-matching survivor",
            file_path: "~/.claude/skills/other-skill/SKILL.md",
            dir_path: "~/.claude/skills/other-skill",
            link_type: "native",
            is_central: false,
            source_kind: "user",
            source_root: "~/.claude/skills",
            is_read_only: false,
          },
        ],
      },
    });

    view.rerender(
      <MemoryRouter initialEntries={["/platform/claude-code"]}>
        <Routes>
          <Route path="/platform/:agentId" element={<PlatformView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockGetSkillsByAgent).toHaveBeenCalledWith("claude-code");
    });

    expect(searchInput).toHaveValue("shared-skill-id");
    expect(
      screen.getAllByRole("button", { name: /查看 Shared skill 的详情/i })
    ).toHaveLength(1);
    expect(getCardBadgeMatches(userSourceText)).toHaveLength(0);
    expect(getCardBadgeMatches(pluginSourceText)).toHaveLength(1);
    expect(getCardBadgeMatches(readOnlyText)).toHaveLength(1);
    expect(screen.queryByText("Other skill")).not.toBeInTheDocument();
  });

  it("resets the platform content scroll when navigating to another platform", async () => {
    mockUsePlatformStore.mockImplementation((selector?: unknown) => {
      const state = buildPlatformStoreState({
        agents: [mockAgent, mockCursorAgent],
        skillsByAgent: {
          "claude-code": mockSkills.length,
          cursor: mockCursorSkills.length,
        },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseSkillStore.mockImplementation((selector?: unknown) => {
      const state = buildSkillStoreState({
        skillsByAgent: {
          "claude-code": mockSkills,
          cursor: mockCursorSkills,
        },
        loadingByAgent: {
          "claude-code": false,
          cursor: false,
        },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    render(
      <MemoryRouter initialEntries={["/platform/claude-code"]}>
        <NavigationHarness />
        <Routes>
          <Route path="/platform/:agentId" element={<PlatformView />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Claude Code")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/搜索技能/);
    const scroller = searchInput
      .closest(".flex.flex-col.h-full")
      ?.querySelector(".flex-1.overflow-auto.p-6");
    expect(scroller).not.toBeNull();
    if (!scroller) return;

    (scroller as HTMLDivElement).scrollTop = 180;

    await act(async () => {
      testNavigate?.("/platform/cursor");
    });

    await waitFor(() => {
      expect(screen.getByText("Cursor")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect((scroller as HTMLDivElement).scrollTop).toBe(0);
    });
  });
});
