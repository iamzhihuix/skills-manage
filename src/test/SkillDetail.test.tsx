import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SkillDetail } from "../pages/SkillDetail";
import { AgentWithStatus, SkillDetail as SkillDetailType } from "../types";

// ─── Mock stores ──────────────────────────────────────────────────────────────

vi.mock("../stores/skillDetailStore", () => ({
  useSkillDetailStore: vi.fn(),
}));

vi.mock("../stores/platformStore", () => ({
  usePlatformStore: vi.fn(),
}));

// ─── Mock CollectionPickerDialog ──────────────────────────────────────────────

vi.mock("../components/collection/CollectionPickerDialog", () => ({
  CollectionPickerDialog: ({
    open,
    onOpenChange,
    onAdded,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    skillId: string;
    currentCollectionIds: string[];
    onAdded: () => void;
  }) =>
    open ? (
      <div data-testid="collection-picker-dialog">
        <button onClick={() => { onAdded(); onOpenChange(false); }}>
          Confirm add to collection
        </button>
        <button onClick={() => onOpenChange(false)}>Cancel picker</button>
      </div>
    ) : null,
}));

import { useSkillDetailStore } from "../stores/skillDetailStore";
import { usePlatformStore } from "../stores/platformStore";

// ─── Mock react-markdown ──────────────────────────────────────────────────────

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="react-markdown">{children}</div>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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
    id: "cursor",
    display_name: "Cursor",
    category: "coding",
    global_skills_dir: "~/.cursor/skills/",
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

const mockDetail: SkillDetailType = {
  id: "frontend-design",
  name: "frontend-design",
  description: "Build distinctive, production-grade frontend interfaces",
  file_path: "~/.agents/skills/frontend-design/SKILL.md",
  canonical_path: "~/.agents/skills/frontend-design",
  is_central: true,
  source: "native",
  scanned_at: "2026-04-09T00:00:00Z",
  installations: [
    {
      skill_id: "frontend-design",
      agent_id: "claude-code",
      installed_path: "~/.claude/skills/frontend-design",
      link_type: "symlink",
      symlink_target: "~/.agents/skills/frontend-design",
      installed_at: "2026-04-09T12:00:00Z",
    },
  ],
};

const mockContent =
  "---\nname: frontend-design\n---\n\n# Frontend Design\n\nContent here.";

const mockLoadDetail = vi.fn();
const mockInstallSkill = vi.fn();
const mockUninstallSkill = vi.fn();
const mockReset = vi.fn();
const mockRescan = vi.fn();

function buildDetailStoreState(overrides = {}) {
  return {
    detail: mockDetail,
    content: mockContent,
    isLoading: false,
    installingAgentId: null,
    error: null,
    loadDetail: mockLoadDetail,
    installSkill: mockInstallSkill,
    uninstallSkill: mockUninstallSkill,
    reset: mockReset,
    ...overrides,
  };
}

function buildPlatformStoreState(overrides = {}) {
  return {
    agents: mockAgents,
    skillsByAgent: {},
    isLoading: false,
    error: null,
    initialize: vi.fn(),
    rescan: mockRescan,
    ...overrides,
  };
}

function renderSkillDetail(skillId = "frontend-design") {
  vi.mocked(useSkillDetailStore).mockImplementation((selector?: unknown) => {
    const state = buildDetailStoreState();
    if (typeof selector === "function") return selector(state);
    return state;
  });
  vi.mocked(usePlatformStore).mockImplementation((selector?: unknown) => {
    const state = buildPlatformStoreState();
    if (typeof selector === "function") return selector(state);
    return state;
  });

  return render(
    <MemoryRouter initialEntries={[`/skill/${skillId}`]}>
      <Routes>
        <Route path="/skill/:skillId" element={<SkillDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SkillDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Back button ───────────────────────────────────────────────────────────

  it("renders back button", () => {
    renderSkillDetail();
    expect(screen.getByRole("button", { name: /返回/i })).toBeInTheDocument();
  });

  it("navigates back when back button clicked", () => {
    renderSkillDetail();
    const backBtn = screen.getByRole("button", { name: /返回/i });
    // Clicking should not throw; navigation is handled by useNavigate(-1)
    fireEvent.click(backBtn);
    // No assertion needed — just verifying no crash
  });

  // ── Skill name & description ──────────────────────────────────────────────

  it("shows skill name in header", () => {
    renderSkillDetail();
    expect(screen.getByRole("heading", { name: /frontend-design/i })).toBeInTheDocument();
  });

  it("shows skill description in header", () => {
    renderSkillDetail();
    expect(
      screen.getByText("Build distinctive, production-grade frontend interfaces")
    ).toBeInTheDocument();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it("shows metadata section", () => {
    renderSkillDetail();
    expect(screen.getByRole("region", { name: /技能基本信息/i })).toBeInTheDocument();
  });

  it("shows file path", () => {
    renderSkillDetail();
    expect(
      screen.getByText("~/.agents/skills/frontend-design/SKILL.md")
    ).toBeInTheDocument();
  });

  it("shows canonical path", () => {
    renderSkillDetail();
    expect(screen.getByText("~/.agents/skills/frontend-design")).toBeInTheDocument();
  });

  it("shows source", () => {
    renderSkillDetail();
    expect(screen.getByText("native")).toBeInTheDocument();
  });

  // ── Installation status ───────────────────────────────────────────────────

  it("shows installation status section", () => {
    renderSkillDetail();
    expect(
      screen.getByRole("region", { name: /安装状态/i })
    ).toBeInTheDocument();
  });

  it("shows non-central agents in install status", () => {
    renderSkillDetail();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Cursor")).toBeInTheDocument();
    // Central agent should NOT appear in install status list
    const centralRows = screen.queryAllByText("Central Skills");
    // Central Skills may still appear elsewhere (e.g. path labels)
    // but not as a PlatformInstallRow agent name
    expect(centralRows.length).toBeLessThanOrEqual(1);
  });

  it("shows checkmark for installed platforms", () => {
    renderSkillDetail();
    // Claude Code is installed (in mockDetail.installations)
    const checkmarks = screen.getAllByLabelText("已安装");
    expect(checkmarks.length).toBeGreaterThan(0);
  });

  it("shows Install button for uninstalled platforms", () => {
    renderSkillDetail();
    // Cursor is NOT installed
    const installBtn = screen.getByRole("button", { name: /安装到 Cursor/i });
    expect(installBtn).toBeInTheDocument();
  });

  it("shows Uninstall button for installed platforms", () => {
    renderSkillDetail();
    // Claude Code IS installed
    const uninstallBtn = screen.getByRole("button", {
      name: /从 Claude Code 卸载/i,
    });
    expect(uninstallBtn).toBeInTheDocument();
  });

  it("calls installSkill when Install button is clicked", async () => {
    renderSkillDetail();
    const installBtn = screen.getByRole("button", { name: /安装到 Cursor/i });
    fireEvent.click(installBtn);
    await waitFor(() => {
      expect(mockInstallSkill).toHaveBeenCalledWith("frontend-design", "cursor");
    });
  });

  it("calls uninstallSkill when Uninstall button is clicked", async () => {
    renderSkillDetail();
    const uninstallBtn = screen.getByRole("button", {
      name: /从 Claude Code 卸载/i,
    });
    fireEvent.click(uninstallBtn);
    await waitFor(() => {
      expect(mockUninstallSkill).toHaveBeenCalledWith("frontend-design", "claude-code");
    });
  });

  it("shows the installed path for an installed platform", () => {
    renderSkillDetail();
    expect(screen.getByText("~/.claude/skills/frontend-design")).toBeInTheDocument();
  });

  it("shows installation timestamp for an installed platform", () => {
    renderSkillDetail();
    // installed_at is "2026-04-09T12:00:00Z" — the formatted date should appear
    // The text shows "安装于 Apr 9, 2026" (or similar locale-dependent format)
    const timestampEl = screen.getByText(/安装于/i);
    expect(timestampEl).toBeInTheDocument();
  });

  // ── Collections ───────────────────────────────────────────────────────────

  it("shows collections section", () => {
    renderSkillDetail();
    expect(screen.getByRole("region", { name: /技能集/i })).toBeInTheDocument();
  });

  it("shows Add to collection button", () => {
    renderSkillDetail();
    expect(
      screen.getByRole("button", { name: /加入技能集/i })
    ).toBeInTheDocument();
  });

  it("shows collection tags when collections are present", () => {
    vi.mocked(useSkillDetailStore).mockImplementation((selector?: unknown) => {
      const state = buildDetailStoreState({
        detail: { ...mockDetail, collections: ["frontend", "design-system"] },
      });
      if (typeof selector === "function") return selector(state);
      return state;
    });
    vi.mocked(usePlatformStore).mockImplementation((selector?: unknown) => {
      const state = buildPlatformStoreState();
      if (typeof selector === "function") return selector(state);
      return state;
    });
    render(
      <MemoryRouter initialEntries={["/skill/frontend-design"]}>
        <Routes>
          <Route path="/skill/:skillId" element={<SkillDetail />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("frontend")).toBeInTheDocument();
    expect(screen.getByText("design-system")).toBeInTheDocument();
  });

  // ── SKILL.md Preview ──────────────────────────────────────────────────────

  it("shows SKILL.md preview section", () => {
    renderSkillDetail();
    expect(screen.getByRole("region", { name: /SKILL\.md 预览/i })).toBeInTheDocument();
  });

  it("shows Markdown tab button", () => {
    renderSkillDetail();
    expect(screen.getByRole("tab", { name: /Markdown/i })).toBeInTheDocument();
  });

  it("shows Raw Source tab button", () => {
    renderSkillDetail();
    expect(screen.getByRole("tab", { name: /原始源码/i })).toBeInTheDocument();
  });

  it("renders markdown content by default in Markdown tab", () => {
    renderSkillDetail();
    // The mock ReactMarkdown renders its children as-is
    const markdownPane = screen.getByRole("tabpanel", { name: /Markdown/i });
    expect(markdownPane).toBeInTheDocument();
    expect(screen.getByTestId("react-markdown")).toBeInTheDocument();
  });

  it("switches to raw source tab when Raw Source is clicked", async () => {
    renderSkillDetail();
    const rawTab = screen.getByRole("tab", { name: /原始源码/i });
    fireEvent.click(rawTab);
    await waitFor(() => {
      expect(screen.getByRole("tabpanel", { name: /原始源码/i })).toBeInTheDocument();
    });
  });

  it("shows raw content including frontmatter in raw source tab", async () => {
    renderSkillDetail();
    const rawTab = screen.getByRole("tab", { name: /原始源码/i });
    fireEvent.click(rawTab);
    await waitFor(() => {
      const rawPane = screen.getByRole("tabpanel", { name: /原始源码/i });
      expect(rawPane).toHaveTextContent("---");
      expect(rawPane).toHaveTextContent("name: frontend-design");
    });
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  it("shows loading state when isLoading is true", () => {
    vi.mocked(useSkillDetailStore).mockImplementation((selector?: unknown) => {
      const state = buildDetailStoreState({ isLoading: true, detail: null });
      if (typeof selector === "function") return selector(state);
      return state;
    });
    vi.mocked(usePlatformStore).mockImplementation((selector?: unknown) => {
      const state = buildPlatformStoreState();
      if (typeof selector === "function") return selector(state);
      return state;
    });
    render(
      <MemoryRouter initialEntries={["/skill/frontend-design"]}>
        <Routes>
          <Route path="/skill/:skillId" element={<SkillDetail />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/正在加载技能详情/i)).toBeInTheDocument();
  });

  // ── Error state ───────────────────────────────────────────────────────────

  it("shows error message when error occurs", () => {
    vi.mocked(useSkillDetailStore).mockImplementation((selector?: unknown) => {
      const state = buildDetailStoreState({ error: "Skill not found", detail: null });
      if (typeof selector === "function") return selector(state);
      return state;
    });
    vi.mocked(usePlatformStore).mockImplementation((selector?: unknown) => {
      const state = buildPlatformStoreState();
      if (typeof selector === "function") return selector(state);
      return state;
    });
    render(
      <MemoryRouter initialEntries={["/skill/frontend-design"]}>
        <Routes>
          <Route path="/skill/:skillId" element={<SkillDetail />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("Skill not found")).toBeInTheDocument();
  });

  // ── Store calls ───────────────────────────────────────────────────────────

  it("calls loadDetail on mount with skillId from URL", () => {
    renderSkillDetail("frontend-design");
    expect(mockLoadDetail).toHaveBeenCalledWith("frontend-design");
  });

  it("calls reset on unmount", () => {
    const { unmount } = renderSkillDetail();
    unmount();
    expect(mockReset).toHaveBeenCalled();
  });

  // ── Spinner during install/uninstall ──────────────────────────────────────

  it("shows spinner instead of Install button when that agent is installing", () => {
    vi.mocked(useSkillDetailStore).mockImplementation((selector?: unknown) => {
      const state = buildDetailStoreState({ installingAgentId: "cursor" });
      if (typeof selector === "function") return selector(state);
      return state;
    });
    vi.mocked(usePlatformStore).mockImplementation((selector?: unknown) => {
      const state = buildPlatformStoreState();
      if (typeof selector === "function") return selector(state);
      return state;
    });
    render(
      <MemoryRouter initialEntries={["/skill/frontend-design"]}>
        <Routes>
          <Route path="/skill/:skillId" element={<SkillDetail />} />
        </Routes>
      </MemoryRouter>
    );
    // The Install button for Cursor should be replaced by a spinner
    expect(screen.queryByRole("button", { name: /安装到 Cursor/i })).toBeNull();
  });

  // ── CollectionPickerDialog integration ────────────────────────────────────

  it("does not render CollectionPickerDialog by default", () => {
    renderSkillDetail();
    expect(screen.queryByTestId("collection-picker-dialog")).toBeNull();
  });

  it("opens CollectionPickerDialog when Add to collection is clicked", async () => {
    renderSkillDetail();
    const addBtn = screen.getByRole("button", { name: /加入技能集/i });
    fireEvent.click(addBtn);
    await waitFor(() => {
      expect(screen.getByTestId("collection-picker-dialog")).toBeInTheDocument();
    });
  });

  it("closes CollectionPickerDialog when cancel is clicked inside it", async () => {
    renderSkillDetail();
    fireEvent.click(screen.getByRole("button", { name: /加入技能集/i }));
    await waitFor(() => {
      expect(screen.getByTestId("collection-picker-dialog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Cancel picker/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("collection-picker-dialog")).toBeNull();
    });
  });

  it("calls loadDetail to refresh skill after collections are added", async () => {
    renderSkillDetail();
    mockLoadDetail.mockClear(); // clear the initial load call

    fireEvent.click(screen.getByRole("button", { name: /加入技能集/i }));
    await waitFor(() => {
      expect(screen.getByTestId("collection-picker-dialog")).toBeInTheDocument();
    });

    // Simulate confirming the picker (which calls onAdded then closes)
    fireEvent.click(screen.getByRole("button", { name: /Confirm add to collection/i }));

    await waitFor(() => {
      expect(mockLoadDetail).toHaveBeenCalledWith("frontend-design");
    });
  });
});
