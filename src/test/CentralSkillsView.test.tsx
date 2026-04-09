import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CentralSkillsView } from "../pages/CentralSkillsView";
import { AgentWithStatus, SkillWithLinks } from "../types";

// Mock stores
vi.mock("../stores/centralSkillsStore", () => ({
  useCentralSkillsStore: vi.fn(),
}));

vi.mock("../stores/platformStore", () => ({
  usePlatformStore: vi.fn(),
}));

import { useCentralSkillsStore } from "../stores/centralSkillsStore";
import { usePlatformStore } from "../stores/platformStore";

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

const mockSkills: SkillWithLinks[] = [
  {
    id: "frontend-design",
    name: "frontend-design",
    description: "Build distinctive, production-grade frontend interfaces",
    file_path: "~/.agents/skills/frontend-design/SKILL.md",
    canonical_path: "~/.agents/skills/frontend-design",
    is_central: true,
    scanned_at: "2026-04-09T00:00:00Z",
    linked_agents: ["claude-code"],
  },
  {
    id: "code-reviewer",
    name: "code-reviewer",
    description: "Review code changes and identify high-confidence, actionable bugs",
    file_path: "~/.agents/skills/code-reviewer/SKILL.md",
    canonical_path: "~/.agents/skills/code-reviewer",
    is_central: true,
    scanned_at: "2026-04-09T00:00:00Z",
    linked_agents: [],
  },
];

const mockLoadCentralSkills = vi.fn();
const mockInstallSkill = vi.fn();
const mockRescan = vi.fn();

function buildCentralStoreState(overrides = {}) {
  return {
    skills: mockSkills,
    agents: mockAgents,
    isLoading: false,
    isInstalling: false,
    error: null,
    loadCentralSkills: mockLoadCentralSkills,
    installSkill: mockInstallSkill,
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

function renderCentralSkillsView() {
  vi.mocked(useCentralSkillsStore).mockImplementation((selector?: unknown) => {
    const state = buildCentralStoreState();
    if (typeof selector === "function") return selector(state);
    return state;
  });
  vi.mocked(usePlatformStore).mockImplementation((selector?: unknown) => {
    const state = buildPlatformStoreState();
    if (typeof selector === "function") return selector(state);
    return state;
  });

  return render(
    <MemoryRouter>
      <CentralSkillsView />
    </MemoryRouter>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CentralSkillsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Header ────────────────────────────────────────────────────────────────

  it("shows 'Central Skills' in header", () => {
    renderCentralSkillsView();
    expect(screen.getByText("Central Skills")).toBeInTheDocument();
  });

  it("shows the central skills directory path", () => {
    renderCentralSkillsView();
    expect(screen.getByText("~/.agents/skills/")).toBeInTheDocument();
  });

  it("shows a refresh button", () => {
    renderCentralSkillsView();
    expect(
      screen.getByRole("button", { name: /Refresh central skills/i })
    ).toBeInTheDocument();
  });

  it("shows a search input", () => {
    renderCentralSkillsView();
    expect(
      screen.getByPlaceholderText(/Search central skills/i)
    ).toBeInTheDocument();
  });

  // ── Skills List ───────────────────────────────────────────────────────────

  it("renders all central skills", () => {
    renderCentralSkillsView();
    expect(screen.getByText("frontend-design")).toBeInTheDocument();
    expect(screen.getByText("code-reviewer")).toBeInTheDocument();
  });

  it("renders skill descriptions", () => {
    renderCentralSkillsView();
    expect(
      screen.getByText(/Build distinctive, production-grade frontend interfaces/)
    ).toBeInTheDocument();
  });

  it("shows Install to... button for each skill", () => {
    renderCentralSkillsView();
    const installButtons = screen.getAllByRole("button", {
      name: /Install .* to platforms/i,
    });
    expect(installButtons).toHaveLength(2);
  });

  // ── Per-platform link status ──────────────────────────────────────────────

  it("shows link status icons for each non-central agent", () => {
    renderCentralSkillsView();
    // "Claude Code" label should appear for both skills
    const claudeLabels = screen.getAllByText("Claude Code");
    expect(claudeLabels.length).toBeGreaterThanOrEqual(2);
  });

  // ── Empty State ───────────────────────────────────────────────────────────

  it("shows empty state when no skills exist", () => {
    vi.mocked(useCentralSkillsStore).mockImplementation((selector?: unknown) => {
      const state = buildCentralStoreState({ skills: [] });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    render(
      <MemoryRouter>
        <CentralSkillsView />
      </MemoryRouter>
    );

    expect(
      screen.getByText(/No skills in Central Skills/)
    ).toBeInTheDocument();
  });

  it("shows loading state", () => {
    vi.mocked(useCentralSkillsStore).mockImplementation((selector?: unknown) => {
      const state = buildCentralStoreState({ isLoading: true, skills: [] });
      if (typeof selector === "function") return selector(state);
      return state;
    });

    render(
      <MemoryRouter>
        <CentralSkillsView />
      </MemoryRouter>
    );

    expect(screen.getByText("Loading skills...")).toBeInTheDocument();
  });

  // ── Search / Filter ───────────────────────────────────────────────────────

  it("filters skills by name when searching", async () => {
    renderCentralSkillsView();
    const searchInput = screen.getByPlaceholderText(/Search central skills/i);
    fireEvent.change(searchInput, { target: { value: "frontend" } });

    await waitFor(() => {
      expect(screen.getByText("frontend-design")).toBeInTheDocument();
      expect(screen.queryByText("code-reviewer")).not.toBeInTheDocument();
    });
  });

  it("filters skills by description when searching", async () => {
    renderCentralSkillsView();
    const searchInput = screen.getByPlaceholderText(/Search central skills/i);
    fireEvent.change(searchInput, { target: { value: "actionable" } });

    await waitFor(() => {
      expect(screen.getByText("code-reviewer")).toBeInTheDocument();
      expect(screen.queryByText("frontend-design")).not.toBeInTheDocument();
    });
  });

  it("shows empty state when search has no results", async () => {
    renderCentralSkillsView();
    const searchInput = screen.getByPlaceholderText(/Search central skills/i);
    fireEvent.change(searchInput, { target: { value: "zzz-nonexistent" } });

    await waitFor(() => {
      expect(screen.getByText(/No skills match/)).toBeInTheDocument();
    });
  });

  it("restores all skills when search is cleared", async () => {
    renderCentralSkillsView();
    const searchInput = screen.getByPlaceholderText(/Search central skills/i);
    fireEvent.change(searchInput, { target: { value: "frontend" } });
    fireEvent.change(searchInput, { target: { value: "" } });

    await waitFor(() => {
      expect(screen.getByText("frontend-design")).toBeInTheDocument();
      expect(screen.getByText("code-reviewer")).toBeInTheDocument();
    });
  });

  // ── Load on Mount ─────────────────────────────────────────────────────────

  it("calls loadCentralSkills on mount", () => {
    renderCentralSkillsView();
    expect(mockLoadCentralSkills).toHaveBeenCalledTimes(1);
  });

  // ── Refresh Button ────────────────────────────────────────────────────────

  it("calls rescan then loadCentralSkills when refresh button is clicked", async () => {
    renderCentralSkillsView();
    const refreshBtn = screen.getByRole("button", {
      name: /Refresh central skills/i,
    });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      // rescan is called once (only on refresh, not on mount)
      expect(mockRescan).toHaveBeenCalledTimes(1);
      // loadCentralSkills is called twice: once on mount, once on refresh
      expect(mockLoadCentralSkills).toHaveBeenCalledTimes(2);
    });
  });

  // ── Install Dialog ────────────────────────────────────────────────────────

  it("opens install dialog when 'Install to...' is clicked", async () => {
    renderCentralSkillsView();
    const installBtn = screen.getAllByRole("button", {
      name: /Install .* to platforms/i,
    })[0];
    fireEvent.click(installBtn);

    // Dialog should open (skill name should appear in dialog title)
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});
