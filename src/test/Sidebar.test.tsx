import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { usePlatformStore } from "../stores/platformStore";

// Mock the platformStore to avoid real Tauri invocations
vi.mock("../stores/platformStore", () => ({
  usePlatformStore: vi.fn(),
}));

// Mock the collectionStore
vi.mock("../stores/collectionStore", () => ({
  useCollectionStore: vi.fn(),
}));

// Mock the discoverStore
vi.mock("../stores/discoverStore", () => ({
  useDiscoverStore: vi.fn(),
}));

import { useCollectionStore } from "../stores/collectionStore";
import { useDiscoverStore } from "../stores/discoverStore";

const mockAgents = [
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

const defaultStoreState = {
  agents: mockAgents,
  skillsByAgent: {
    "claude-code": 5,
    cursor: 3,
    central: 10,
  },
  isLoading: false,
  isRefreshing: false,
  error: null,
  initialize: vi.fn(),
  rescan: vi.fn(),
  refreshCounts: vi.fn(),
};

const defaultCollectionState = {
  collections: [],
  currentDetail: null,
  isLoading: false,
  isLoadingDetail: false,
  error: null,
  loadCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  loadCollectionDetail: vi.fn(),
  addSkillToCollection: vi.fn(),
  removeSkillFromCollection: vi.fn(),
  batchInstallCollection: vi.fn(),
  exportCollection: vi.fn(),
  importCollection: vi.fn(),
  refreshCounts: vi.fn(),
};

const defaultDiscoverState = {
  totalSkillsFound: 0,
  discoveredProjects: [],
  loadDiscoveredSkills: vi.fn(),
};

function renderSidebar(initialPath = "/central") {
  vi.mocked(usePlatformStore).mockReturnValue(defaultStoreState);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useDiscoverStore).mockImplementation((selector: any) =>
    selector(defaultDiscoverState)
  );
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage?.clear?.();
    // Default: collection store returns empty state.
    vi.mocked(useCollectionStore).mockImplementation((selector) =>
      selector(defaultCollectionState)
    );
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  it("renders expanded sidebar by default", () => {
    const { container } = renderSidebar();
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("w-52");
  });

  it("renders platform agents as icon buttons", () => {
    renderSidebar();
    // Should show platform agents as buttons with title tooltips (not the central one)
    expect(screen.getByRole("button", { name: /Claude Code/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cursor/ })).toBeInTheDocument();
  });

  it("renders Central Skills icon button", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /中央技能库/ })).toBeInTheDocument();
  });

  it("renders Collections icon button", () => {
    renderSidebar();
    // Use exact string match to avoid also matching "导入技能集"
    expect(screen.getByRole("button", { name: "技能集合" })).toBeInTheDocument();
  });

  it("new/import collection buttons are on the list page, not sidebar", () => {
    renderSidebar();
    expect(screen.queryByRole("button", { name: /新建技能集/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导入技能集/i })).not.toBeInTheDocument();
  });

  it("does not render Settings (moved to TopBar)", () => {
    renderSidebar();
    // Settings button no longer exists in sidebar
    expect(screen.queryByRole("button", { name: /设置/ })).not.toBeInTheDocument();
  });

  it("does not render legacy section headers", () => {
    renderSidebar();
    // No "By Tool" header
    expect(screen.queryByText("按工具")).not.toBeInTheDocument();
    // No "+新建" text button
    expect(screen.queryByText("+ 新建")).not.toBeInTheDocument();
  });

  // ── Loading State ─────────────────────────────────────────────────────────

  it("shows loading spinner when isLoading is true", () => {
    vi.mocked(usePlatformStore).mockReturnValue({
      ...defaultStoreState,
      isLoading: true,
    });
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    // Should show a spinner (Loader2 with animate-spin)
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("hides platform buttons when loading", () => {
    vi.mocked(usePlatformStore).mockReturnValue({
      ...defaultStoreState,
      isLoading: true,
    });
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /Claude Code/ })).not.toBeInTheDocument();
  });

  // ── Active Route Highlighting ─────────────────────────────────────────────

  it("highlights active platform route in sidebar", () => {
    renderSidebar("/platform/claude-code");
    const claudeButton = screen.getByRole("button", { name: /Claude Code/ });
    expect(claudeButton.className).toContain("bg-hover-bg");
  });

  it("highlights Central Skills when on /central", () => {
    renderSidebar("/central");
    const centralButton = screen.getByRole("button", { name: /中央技能库/ });
    expect(centralButton.className).toContain("bg-hover-bg");
  });

  it("does not highlight Settings in sidebar (moved to TopBar)", () => {
    renderSidebar("/settings");
    // No settings button in sidebar anymore
    expect(screen.queryByRole("button", { name: /设置/ })).not.toBeInTheDocument();
  });

  // ── Empty States ──────────────────────────────────────────────────────────

  it("shows no platform buttons when only central agent exists", () => {
    vi.mocked(usePlatformStore).mockReturnValue({
      ...defaultStoreState,
      agents: [
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
    });
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /Claude Code/ })).not.toBeInTheDocument();
  });

  it("hides agents with zero skills by default", () => {
    vi.mocked(usePlatformStore).mockReturnValue({
      ...defaultStoreState,
      skillsByAgent: {
        "claude-code": 0,
        cursor: 3,
        central: 10,
      },
    });
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /Claude Code/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cursor/ })).toBeInTheDocument();
  });

  it("shows hidden agents after clicking toggle", () => {
    vi.mocked(usePlatformStore).mockReturnValue({
      ...defaultStoreState,
      skillsByAgent: {
        "claude-code": 0,
        cursor: 3,
        central: 10,
      },
    });
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "显示所有平台" }));
    expect(screen.getByRole("button", { name: /Claude Code/ })).toBeInTheDocument();
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  it("platform buttons are clickable", () => {
    renderSidebar();
    const claudeButton = screen.getByRole("button", { name: /Claude Code/ });
    expect(claudeButton).not.toBeDisabled();
    fireEvent.click(claudeButton);
  });

  it("Central Skills button is clickable", () => {
    renderSidebar();
    const centralButton = screen.getByRole("button", { name: /中央技能库/ });
    expect(centralButton).not.toBeDisabled();
    fireEvent.click(centralButton);
  });

  // ── Collections ───────────────────────────────────────────────────────────

  it("collections button navigates to /collections list page", () => {
    vi.mocked(useCollectionStore).mockImplementation((selector) =>
      selector({
        ...defaultCollectionState,
        collections: [
          { id: "col-1", name: "Frontend", created_at: "2026-04-09T00:00:00Z", updated_at: "2026-04-09T00:00:00Z" },
          { id: "col-2", name: "Backend", created_at: "2026-04-09T00:00:00Z", updated_at: "2026-04-09T00:00:00Z" },
        ],
      })
    );
    renderSidebar();
    expect(screen.getByRole("button", { name: "技能集合" })).toBeInTheDocument();
  });

  it("highlights active collection route", () => {
    vi.mocked(useCollectionStore).mockImplementation((selector) =>
      selector({
        ...defaultCollectionState,
        collections: [
          { id: "col-1", name: "Frontend", created_at: "2026-04-09T00:00:00Z", updated_at: "2026-04-09T00:00:00Z" },
        ],
      })
    );
    vi.mocked(usePlatformStore).mockReturnValue(defaultStoreState);
    render(
      <MemoryRouter initialEntries={["/collections"]}>
        <Sidebar />
      </MemoryRouter>
    );
    // The collections icon button should be highlighted (exact match)
    const colButton = screen.getByRole("button", { name: "技能集合" });
    expect(colButton.className).toContain("bg-hover-bg");
  });

  // ── Discover ─────────────────────────────────────────────────────────────

  it("renders Discover entry in sidebar", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "项目技能库" })).toBeInTheDocument();
  });

  it("renders show all platforms toggle", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "显示所有平台" })).toBeInTheDocument();
  });

  // ── Collapse Toggle ───────────────────────────────────────────────────────

  it("renders collapse toggle button", () => {
    renderSidebar();
    // Default is expanded, so the button label is "collapse"
    expect(screen.getByRole("button", { name: /折叠侧边栏/i })).toBeInTheDocument();
  });
});
