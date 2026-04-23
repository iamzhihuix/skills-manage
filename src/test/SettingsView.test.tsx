import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SettingsView } from "../pages/SettingsView";
import { ScanDirectory, AgentWithStatus } from "../types";
import { invoke } from "@tauri-apps/api/core";

// Mock stores
vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: vi.fn(),
}));

vi.mock("../stores/platformStore", () => ({
  usePlatformStore: vi.fn(),
}));

vi.mock("../stores/themeStore", () => ({
  useThemeStore: vi.fn(),
  ACCENT_NAMES: [
    "rosewater", "flamingo", "pink", "mauve", "red", "maroon",
    "peach", "yellow", "green", "teal", "sky", "sapphire",
    "blue", "lavender",
  ],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { useSettingsStore } from "../stores/settingsStore";
import { usePlatformStore } from "../stores/platformStore";
import { useThemeStore } from "../stores/themeStore";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockBuiltinDir: ScanDirectory = {
  id: 1,
  path: "/Users/test/.agents/skills/",
  label: "Central Skills",
  is_active: true,
  is_builtin: true,
  added_at: "2026-01-01T00:00:00Z",
};

const mockCustomDir: ScanDirectory = {
  id: 2,
  path: "/Users/test/projects/my-project",
  label: "My Project",
  is_active: true,
  is_builtin: false,
  added_at: "2026-01-02T00:00:00Z",
};

const mockCustomAgent: AgentWithStatus = {
  id: "custom-qclaw",
  display_name: "QClaw",
  category: "other",
  global_skills_dir: "/Users/test/.qclaw/skills/",
  is_detected: false,
  is_builtin: false,
  is_enabled: true,
};

const mockBuiltinAgent: AgentWithStatus = {
  id: "claude-code",
  display_name: "Claude Code",
  category: "coding",
  global_skills_dir: "/Users/test/.claude/skills/",
  is_detected: true,
  is_builtin: true,
  is_enabled: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupMocks({
  scanDirs = [] as ScanDirectory[],
  isLoadingScanDirs = false,
  agents = [] as AgentWithStatus[],
  loadScanDirectories = vi.fn(),
  addScanDirectory = vi.fn(),
  removeScanDirectory = vi.fn(),
  toggleScanDirectory = vi.fn(),
  addCustomAgent = vi.fn(),
  updateCustomAgent = vi.fn(),
  removeCustomAgent = vi.fn(),
  githubPat = "",
  isLoadingGitHubPat = false,
  isSavingGitHubPat = false,
  loadGitHubPat = vi.fn(),
  saveGitHubPat = vi.fn(),
  clearGitHubPat = vi.fn(),
  rescan = vi.fn(),
  refreshCounts = vi.fn(),
  flavor = "mocha" as const,
  setFlavor = vi.fn(),
  accent = "lavender" as const,
  setAccent = vi.fn(),
} = {}) {
  vi.mocked(useSettingsStore).mockImplementation((selector) =>
    selector({
      scanDirectories: scanDirs,
      isLoadingScanDirs,
      error: null,
      loadScanDirectories,
      addScanDirectory,
      removeScanDirectory,
      toggleScanDirectory,
      addCustomAgent,
      updateCustomAgent,
      removeCustomAgent,
      githubPat,
      isLoadingGitHubPat,
      isSavingGitHubPat,
      loadGitHubPat,
      saveGitHubPat,
      clearGitHubPat,
      clearError: vi.fn(),
    })
  );

  vi.mocked(usePlatformStore).mockImplementation((selector) =>
    selector({
      agents,
      skillsByAgent: {},
      isLoading: false,
      isRefreshing: false,
      error: null,
      initialize: vi.fn(),
      rescan,
      refreshCounts,
    })
  );

  vi.mocked(useThemeStore).mockImplementation((selector) =>
    selector({
      flavor,
      setFlavor,
      accent,
      setAccent,
      init: vi.fn(),
    })
  );
}

function renderSettingsView() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/settings" element={<SettingsView />} />
      </Routes>
    </MemoryRouter>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  it("renders the settings header", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
  });

  it("renders the github token section", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByText("GitHub 导入访问令牌")).toBeTruthy();
  });

  it("renders the existing settings sections", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByText("扫描目录")).toBeTruthy();
    expect(screen.getByText("自定义平台")).toBeTruthy();
    expect(screen.getByText("关于")).toBeTruthy();
  });

  it("calls loadScanDirectories on mount", () => {
    const loadScanDirectories = vi.fn();
    setupMocks({ loadScanDirectories });
    renderSettingsView();
    expect(loadScanDirectories).toHaveBeenCalled();
  });

  it("calls loadGitHubPat on mount", () => {
    const loadGitHubPat = vi.fn();
    setupMocks({ loadGitHubPat });
    renderSettingsView();
    expect(loadGitHubPat).toHaveBeenCalled();
  });

  it("renders the saved github pat value and explanation copy", () => {
    setupMocks({ githubPat: "github_pat_saved" });
    renderSettingsView();

    expect(screen.getByLabelText("GitHub Personal Access Token")).toHaveValue("github_pat_saved");
    expect(screen.getByText(/它绝不会被发送到公共镜像或代理回退链路/)).toBeTruthy();
    expect(screen.getByText(/当 GitHub 预览\/导入遇到限流/)).toBeTruthy();
  });

  it("saves the github pat from settings", async () => {
    const saveGitHubPat = vi.fn().mockResolvedValue(undefined);
    setupMocks({ githubPat: "", saveGitHubPat });
    renderSettingsView();

    fireEvent.change(screen.getByLabelText("GitHub Personal Access Token"), {
      target: { value: "  github_pat_new  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(saveGitHubPat).toHaveBeenCalledWith("  github_pat_new  ");
    });
    expect(await screen.findByText("GitHub 令牌已保存")).toBeTruthy();
  });

  it("clears the github pat from settings", async () => {
    const clearGitHubPat = vi.fn().mockResolvedValue(undefined);
    setupMocks({ githubPat: "github_pat_saved", clearGitHubPat });
    renderSettingsView();

    fireEvent.click(screen.getByRole("button", { name: "清除令牌" }));

    await waitFor(() => {
      expect(clearGitHubPat).toHaveBeenCalled();
    });
    expect(await screen.findByText("GitHub 令牌已清除")).toBeTruthy();
  });

  // ── Scan Directories section ──────────────────────────────────────────────

  it("shows loading state for scan directories", () => {
    setupMocks({ isLoadingScanDirs: true });
    renderSettingsView();
    expect(screen.getByText("加载中...")).toBeTruthy();
  });

  it("shows empty state when no scan directories", () => {
    setupMocks({ scanDirs: [] });
    renderSettingsView();
    expect(screen.getByText("暂无扫描目录")).toBeTruthy();
  });

  it("renders builtin scan directory with 内置目录 label", () => {
    setupMocks({ scanDirs: [mockBuiltinDir] });
    renderSettingsView();
    expect(screen.getAllByText(/内置目录/).length).toBeGreaterThan(0);
  });

  it("does not show remove button for builtin directories", () => {
    setupMocks({ scanDirs: [mockBuiltinDir] });
    renderSettingsView();
    // No delete button should be present for builtin dir
    expect(
      screen.queryByRole("button", { name: /删除目录 ~\/.agents\/skills\// })
    ).toBeNull();
  });

  it("shows remove button for custom directories", () => {
    setupMocks({ scanDirs: [mockCustomDir] });
    renderSettingsView();
    expect(
      screen.getByRole("button", { name: `删除目录 ${mockCustomDir.path}` })
    ).toBeTruthy();
  });

  it("shows toggle for custom directories", () => {
    setupMocks({ scanDirs: [mockCustomDir] });
    renderSettingsView();
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("does not show toggle for builtin directories", () => {
    setupMocks({ scanDirs: [mockBuiltinDir] });
    renderSettingsView();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("shows 启用 label when directory is active", () => {
    setupMocks({ scanDirs: [{ ...mockCustomDir, is_active: true }] });
    renderSettingsView();
    expect(screen.getByText("启用")).toBeTruthy();
  });

  it("shows 禁用 label when directory is inactive", () => {
    setupMocks({ scanDirs: [{ ...mockCustomDir, is_active: false }] });
    renderSettingsView();
    expect(screen.getByText("禁用")).toBeTruthy();
  });

  it("shows add directory button", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByRole("button", { name: "添加项目目录" })).toBeTruthy();
  });

  it("opens add directory dialog when button is clicked", async () => {
    setupMocks();
    renderSettingsView();
    fireEvent.click(screen.getByRole("button", { name: "添加项目目录" }));
    await waitFor(() => {
      expect(screen.getByText("添加项目目录")).toBeTruthy();
    });
  });

  it("removes a custom directory after inline confirmation", async () => {
    const removeScanDirectory = vi.fn().mockResolvedValue(undefined);
    const rescan = vi.fn().mockResolvedValue(undefined);
    setupMocks({
      scanDirs: [mockCustomDir],
      removeScanDirectory,
      rescan,
    });
    renderSettingsView();

    fireEvent.click(
      screen.getByRole("button", { name: `删除目录 ${mockCustomDir.path}` })
    );
    expect(removeScanDirectory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(removeScanDirectory).toHaveBeenCalledWith(mockCustomDir.path);
    });
  });

  it("refreshes counts after removing a directory", async () => {
    const removeScanDirectory = vi.fn().mockResolvedValue(undefined);
    const refreshCounts = vi.fn().mockResolvedValue(undefined);
    setupMocks({ scanDirs: [mockCustomDir], removeScanDirectory, refreshCounts });
    renderSettingsView();

    fireEvent.click(
      screen.getByRole("button", { name: `删除目录 ${mockCustomDir.path}` })
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(refreshCounts).toHaveBeenCalled();
    });
  });

  // ── Custom Platforms section ──────────────────────────────────────────────

  it("shows empty state when no custom platforms", () => {
    setupMocks({ agents: [mockBuiltinAgent] }); // only builtin agents
    renderSettingsView();
    expect(screen.getByText("暂无自定义平台。点击「添加平台」注册新平台。")).toBeTruthy();
  });

  it("renders custom platform with name and path", () => {
    setupMocks({ agents: [mockBuiltinAgent, mockCustomAgent] });
    renderSettingsView();
    expect(screen.getByText("QClaw")).toBeTruthy();
    expect(screen.getByText("/Users/test/.qclaw/skills/")).toBeTruthy();
  });

  it("shows edit button for custom platforms", () => {
    setupMocks({ agents: [mockBuiltinAgent, mockCustomAgent] });
    renderSettingsView();
    expect(
      screen.getByRole("button", { name: `编辑平台 ${mockCustomAgent.display_name}` })
    ).toBeTruthy();
  });

  it("shows remove button for custom platforms", () => {
    setupMocks({ agents: [mockBuiltinAgent, mockCustomAgent] });
    renderSettingsView();
    expect(
      screen.getByRole("button", { name: `删除平台 ${mockCustomAgent.display_name}` })
    ).toBeTruthy();
  });

  it("does not show builtin agents in custom platforms list", () => {
    setupMocks({ agents: [mockBuiltinAgent] });
    renderSettingsView();
    // builtin agent should not appear in custom platforms section
    expect(
      screen.queryByRole("button", { name: `编辑平台 ${mockBuiltinAgent.display_name}` })
    ).toBeNull();
  });

  it("shows add platform button", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByRole("button", { name: "添加自定义平台" })).toBeTruthy();
  });

  it("opens add platform dialog when button is clicked", async () => {
    setupMocks();
    renderSettingsView();
    fireEvent.click(screen.getByRole("button", { name: "添加自定义平台" }));
    await waitFor(() => {
      expect(screen.getByText("添加自定义平台")).toBeTruthy();
    });
  });

  it("opens edit platform dialog when edit button is clicked", async () => {
    setupMocks({ agents: [mockBuiltinAgent, mockCustomAgent] });
    renderSettingsView();
    fireEvent.click(
      screen.getByRole("button", { name: `编辑平台 ${mockCustomAgent.display_name}` })
    );
    await waitFor(() => {
      expect(screen.getByText("编辑自定义平台")).toBeTruthy();
    });
  });

  it("removes a custom platform after inline confirmation", async () => {
    const removeCustomAgent = vi.fn().mockResolvedValue(undefined);
    const rescan = vi.fn().mockResolvedValue(undefined);
    setupMocks({
      agents: [mockBuiltinAgent, mockCustomAgent],
      removeCustomAgent,
      rescan,
    });
    renderSettingsView();

    fireEvent.click(
      screen.getByRole("button", { name: `删除平台 ${mockCustomAgent.display_name}` })
    );
    expect(removeCustomAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(removeCustomAgent).toHaveBeenCalledWith(mockCustomAgent.id);
    });
  });

  it("triggers rescan after removing a platform", async () => {
    const removeCustomAgent = vi.fn().mockResolvedValue(undefined);
    const rescan = vi.fn().mockResolvedValue(undefined);
    setupMocks({
      agents: [mockBuiltinAgent, mockCustomAgent],
      removeCustomAgent,
      rescan,
    });
    renderSettingsView();

    fireEvent.click(
      screen.getByRole("button", { name: `删除平台 ${mockCustomAgent.display_name}` })
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(rescan).toHaveBeenCalled();
    });
  });

  // ── About section ─────────────────────────────────────────────────────────

  it("shows the app version in the about section", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByText("skills-manage v0.9.1")).toBeTruthy();
  });

  it("shows the database path in the about section", () => {
    setupMocks({ scanDirs: [mockBuiltinDir], agents: [mockBuiltinAgent] });
    renderSettingsView();
    expect(screen.getByText("/Users/test/.skillsmanage/db.sqlite")).toBeTruthy();
  });

  it("shows version label", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByText("应用版本")).toBeTruthy();
  });

  it("shows database path label", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByText("数据库路径")).toBeTruthy();
  });

  // ── Flavor Switcher ──────────────────────────────────────────────────────

  it("shows flavor label in about section", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByText("主题风格")).toBeTruthy();
  });

  it("renders all 4 flavor buttons", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByRole("button", { name: /Mocha/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Macchiato/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Frappé/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Latte/ })).toBeTruthy();
  });

  it("active flavor button has aria-pressed=true", () => {
    setupMocks({ flavor: "mocha" });
    renderSettingsView();
    const mochaBtn = screen.getByRole("button", { name: /Mocha/ });
    expect(mochaBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("inactive flavor button has aria-pressed=false", () => {
    setupMocks({ flavor: "mocha" });
    renderSettingsView();
    const latteBtn = screen.getByRole("button", { name: /Latte/ });
    expect(latteBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a flavor button calls setFlavor", () => {
    const setFlavor = vi.fn();
    setupMocks({ flavor: "mocha", setFlavor });
    renderSettingsView();
    fireEvent.click(screen.getByRole("button", { name: /Latte/ }));
    expect(setFlavor).toHaveBeenCalledWith("latte");
  });

  it("each flavor button shows a color dot", () => {
    setupMocks();
    renderSettingsView();
    // Each flavor button should have a colored dot (inline span with rounded-full)
    const buttons = [
      screen.getByRole("button", { name: /Mocha/ }),
      screen.getByRole("button", { name: /Macchiato/ }),
      screen.getByRole("button", { name: /Frappé/ }),
      screen.getByRole("button", { name: /Latte/ }),
    ];
    for (const btn of buttons) {
      const dot = btn.querySelector(".rounded-full");
      expect(dot).toBeTruthy();
    }
  });

  // ── Accent Color Picker ──────────────────────────────────────────────────

  it("shows accent color label in about section", () => {
    setupMocks();
    renderSettingsView();
    expect(screen.getByText("强调色")).toBeTruthy();
  });

  it("renders 14 accent color swatches", () => {
    setupMocks();
    renderSettingsView();
    const swatches = screen.getAllByRole("radio");
    expect(swatches).toHaveLength(14);
  });

  it("active accent swatch has aria-checked=true", () => {
    setupMocks({ accent: "lavender" });
    renderSettingsView();
    const lavenderSwatch = screen.getByRole("radio", { name: "薰衣草" });
    expect(lavenderSwatch).toHaveAttribute("aria-checked", "true");
  });

  it("inactive accent swatch has aria-checked=false", () => {
    setupMocks({ accent: "lavender" });
    renderSettingsView();
    const greenSwatch = screen.getByRole("radio", { name: "绿色" });
    expect(greenSwatch).toHaveAttribute("aria-checked", "false");
  });

  it("clicking an accent swatch calls setAccent", () => {
    const setAccent = vi.fn();
    setupMocks({ accent: "lavender", setAccent });
    renderSettingsView();
    fireEvent.click(screen.getByRole("radio", { name: "绿色" }));
    expect(setAccent).toHaveBeenCalledWith("green");
  });

  it("accent swatches use CSS custom properties for background color", () => {
    setupMocks();
    renderSettingsView();
    const rosewaterSwatch = screen.getByRole("radio", { name: "玫瑰水" });
    expect(rosewaterSwatch.style.backgroundColor).toBe("var(--ctp-rosewater)");
  });
});
