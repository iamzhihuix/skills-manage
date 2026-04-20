import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

import { usePlatformStore } from "../stores/platformStore";
import { useSkillStore } from "../stores/skillStore";
import { useCentralSkillsStore } from "../stores/centralSkillsStore";
import * as tauriBridge from "@/lib/tauri";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockAgent: AgentWithStatus = {
  id: "claude-code",
  display_name: "Claude Code",
  category: "coding",
  global_skills_dir: "~/.claude/skills/",
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

const mockGetSkillsByAgent = vi.fn();
const mockLoadCentralSkills = vi.fn();
const mockInstallSkill = vi.fn();
const mockUsePlatformStore = vi.mocked(usePlatformStore);
const mockUseSkillStore = vi.mocked(useSkillStore);
const mockUseCentralSkillsStore = vi.mocked(useCentralSkillsStore);

function buildPlatformStoreState(overrides = {}) {
  return {
    agents: [mockAgent],
    skillsByAgent: { "claude-code": 2 },
    isLoading: false,
    isRefreshing: false,
    error: null,
    initialize: vi.fn(),
    rescan: vi.fn(),
    refreshCounts: vi.fn(),
    ...overrides,
  };
}

function buildSkillStoreState(overrides = {}) {
  return {
    skillsByAgent: { "claude-code": mockSkills },
    loadingByAgent: { "claude-code": false },
    error: null,
    getSkillsByAgent: mockGetSkillsByAgent,
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PlatformView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultStoreMocks();
  });

  // ── Header ────────────────────────────────────────────────────────────────

  it("shows platform name in header", () => {
    renderPlatformView();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("shows platform directory path in header", () => {
    renderPlatformView();
    expect(screen.getByText("~/.claude/skills/")).toBeInTheDocument();
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
});
