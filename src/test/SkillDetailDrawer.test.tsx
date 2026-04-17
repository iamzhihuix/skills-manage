import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SkillDetailDrawer } from "@/components/skill/SkillDetailDrawer";
import { useSkillDetailStore } from "@/stores/skillDetailStore";
import { usePlatformStore } from "@/stores/platformStore";
import type { AgentWithStatus, SkillDetail as SkillDetailType } from "@/types";

vi.mock("@/stores/skillDetailStore", () => ({
  useSkillDetailStore: vi.fn(),
}));

vi.mock("@/stores/platformStore", () => ({
  usePlatformStore: vi.fn(),
}));

vi.mock("@/components/collection/CollectionPickerDialog", () => ({
  CollectionPickerDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="collection-picker-dialog" /> : null,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="react-markdown">{children}</div>,
}));

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
  installations: [],
  collections: [],
};

const mockLoadDetail = vi.fn();
const mockLoadCachedExplanation = vi.fn();
const mockInstallSkill = vi.fn();
const mockUninstallSkill = vi.fn();
const mockGenerateExplanation = vi.fn();
const mockRefreshExplanation = vi.fn();
const mockReset = vi.fn();
const mockRefreshCounts = vi.fn();
const mockRefreshInstallations = vi.fn();

function applyStoreMocks(detailOverrides = {}, platformOverrides = {}) {
  vi.mocked(useSkillDetailStore).mockImplementation((selector?: unknown) => {
    const state = {
      detail: mockDetail,
      content: "# Frontend Design",
      isLoading: false,
      installingAgentId: null,
      error: null,
      explanation: null,
      isExplanationLoading: false,
      isExplanationStreaming: false,
      explanationError: null,
      explanationErrorInfo: null,
      loadDetail: mockLoadDetail,
      loadCachedExplanation: mockLoadCachedExplanation,
      generateExplanation: mockGenerateExplanation,
      refreshExplanation: mockRefreshExplanation,
      installSkill: mockInstallSkill,
      uninstallSkill: mockUninstallSkill,
      refreshInstallations: mockRefreshInstallations,
      cleanupExplanationListeners: vi.fn(),
      reset: mockReset,
      ...detailOverrides,
    };
    if (typeof selector === "function") return selector(state);
    return state;
  });

  vi.mocked(usePlatformStore).mockImplementation((selector?: unknown) => {
    const state = {
      agents: mockAgents,
      skillsByAgent: {},
      isLoading: false,
      isRefreshing: false,
      error: null,
      initialize: vi.fn(),
      rescan: vi.fn(),
      refreshCounts: mockRefreshCounts,
      ...platformOverrides,
    };
    if (typeof selector === "function") return selector(state);
    return state;
  });
}

function TestHarness({
  initialOpen = true,
  skillId = "frontend-design",
}: {
  initialOpen?: boolean;
  skillId?: string | null;
}) {
  const [open, setOpen] = React.useState(initialOpen);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const renderCount = React.useRef(0);
  renderCount.current += 1;

  return (
    <MemoryRouter>
      <div data-testid="parent-shell" data-render-count={renderCount.current}>
        <button ref={triggerRef} onClick={() => setOpen(true)}>
          Open drawer
        </button>
        <SkillDetailDrawer
          open={open}
          skillId={skillId}
          onOpenChange={setOpen}
          returnFocusRef={triggerRef}
        />
      </div>
    </MemoryRouter>
  );
}

describe("SkillDetailDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyStoreMocks();
  });

  it("renders a dialog with overlay and close button when open", async () => {
    render(<TestHarness />);

    const drawer = await screen.findByTestId("skill-detail-drawer");
    expect(drawer).toHaveAttribute("role", "dialog");
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("skill-detail-drawer-overlay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("does not render drawer contents when closed", () => {
    render(<TestHarness initialOpen={false} />);
    expect(screen.queryByTestId("skill-detail-drawer")).toBeNull();
  });

  it("closes via close button and restores focus to returnFocusRef", async () => {
    render(<TestHarness />);

    const closeButton = await screen.findByRole("button", { name: /close/i });
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail-drawer")).toBeNull();
    });
    expect(screen.getByRole("button", { name: /open drawer/i })).toHaveFocus();
    expect(mockReset).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    render(<TestHarness />);

    const drawer = await screen.findByTestId("skill-detail-drawer");
    fireEvent.keyDown(drawer, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail-drawer")).toBeNull();
    });
  });

  it("closes on overlay click", async () => {
    render(<TestHarness />);

    fireEvent.click(await screen.findByTestId("skill-detail-drawer-overlay"));

    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail-drawer")).toBeNull();
    });
  });

  it("fully unmounts the shared overlay after close", async () => {
    render(<TestHarness />);

    expect(await screen.findByTestId("skill-detail-drawer-overlay")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail-drawer")).toBeNull();
      expect(screen.queryByTestId("skill-detail-drawer-overlay")).toBeNull();
      expect(document.querySelector("[data-base-ui-inert]")).toBeNull();
    });
  });

  it("removes panel and overlay together when closed from the shell", async () => {
    render(<TestHarness />);

    const closeButton = await screen.findByRole("button", { name: /close/i });
    const overlay = screen.getByTestId("skill-detail-drawer-overlay");
    const drawer = screen.getByTestId("skill-detail-drawer");

    expect(overlay).toBeInTheDocument();
    expect(drawer).toBeInTheDocument();

    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail-drawer")).toBeNull();
      expect(screen.queryByTestId("skill-detail-drawer-overlay")).toBeNull();
    });
  });

  it("wires aria-labelledby to the SkillDetailView heading", async () => {
    render(<TestHarness />);

    const drawer = await screen.findByTestId("skill-detail-drawer");
    const heading = screen.getByRole("heading", { name: /frontend-design/i });
    expect(drawer).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("applies responsive drawer and sidebar class expectations", async () => {
    render(<TestHarness />);

    const drawer = await screen.findByTestId("skill-detail-drawer");
    const layout = screen.getByTestId("skill-detail-two-column-layout");
    const sidebar = screen.getByTestId("skill-detail-right-sidebar");

    expect(drawer.className).toContain("w-screen");
    expect(drawer.className).toContain("md:w-[min(900px,90vw)]");
    expect(layout.className).toContain("flex-col");
    expect(layout.className).toContain("md:flex-row");
    expect(sidebar.className).toContain("border-t");
    expect(sidebar.className).toContain("md:border-l");
    expect(sidebar.className).toContain("md:border-t-0");
  });

  it("does not unmount the parent container during open/close", async () => {
    render(<TestHarness />);

    const parent = screen.getByTestId("parent-shell");
    const initialNode = parent;

    fireEvent.click(await screen.findByRole("button", { name: /close/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail-drawer")).toBeNull();
    });

    expect(screen.getByTestId("parent-shell")).toBe(initialNode);
    expect(screen.getByTestId("parent-shell")).toHaveAttribute("data-render-count", "2");
  });
});
