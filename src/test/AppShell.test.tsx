import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { usePlatformStore } from "@/stores/platformStore";
import { useCentralSkillsStore } from "@/stores/centralSkillsStore";
import { useDiscoverStore } from "@/stores/discoverStore";

let triggerRescanInMock = false;

vi.mock("@/stores/platformStore", () => ({
  usePlatformStore: vi.fn(),
}));

vi.mock("@/stores/centralSkillsStore", () => ({
  useCentralSkillsStore: vi.fn(),
}));

vi.mock("@/stores/discoverStore", () => ({
  useDiscoverStore: vi.fn(),
}));

vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock("@/components/layout/TopBar", () => ({
  TopBar: ({ onSearchClick }: { onSearchClick: () => void }) => (
    <button type="button" onClick={onSearchClick}>
      open-search
    </button>
  ),
}));

vi.mock("@/components/layout/GlobalSearchDialog", () => ({
  GlobalSearchDialog: ({
    open,
    onAction,
  }: {
    open: boolean;
    onAction: (action: string) => void;
  }) =>
    open ? (
      triggerRescanInMock ? (
        <button type="button" onClick={() => onAction("rescan")}>
          trigger-rescan
        </button>
      ) : (
        <div data-testid="global-search-dialog" />
      )
    ) : null,
}));

const mockUsePlatformStore = vi.mocked(usePlatformStore);
const mockUseCentralSkillsStore = vi.mocked(useCentralSkillsStore);
const mockUseDiscoverStore = vi.mocked(useDiscoverStore);

let testNavigate: ReturnType<typeof useNavigate> | null = null;

function NavigationHarness() {
  testNavigate = useNavigate();
  return null;
}

function DummyPage({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col">
      <div>{label}</div>
      <div className="flex-1 overflow-auto p-4">
        <div style={{ height: 1600 }}>content</div>
      </div>
    </div>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testNavigate = null;
    triggerRescanInMock = false;

    mockUsePlatformStore.mockImplementation((selector?: unknown) => {
      const state = {
        initialize: vi.fn(),
        rescan: vi.fn(),
      };
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseCentralSkillsStore.mockImplementation((selector?: unknown) => {
      const state = {
        loadCentralSkills: vi.fn(),
      };
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseDiscoverStore.mockImplementation((selector?: unknown) => {
      const state = {
        refreshCounts: vi.fn(),
        rescanFromDisk: vi.fn(),
      };
      if (typeof selector === "function") return selector(state);
      return state;
    });
  });

  it("resets shell scroll and keeps main non-scrollable when the route changes", async () => {
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <NavigationHarness />
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="a" element={<DummyPage label="page-a" />} />
            <Route path="b" element={<DummyPage label="page-b" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    if (!main) return;

    expect(main.className).toContain("overflow-hidden");
    expect(main.className).not.toContain("overflow-auto");

    (main as HTMLElement).scrollTop = 240;

    await act(async () => {
      testNavigate?.("/b");
    });

    await waitFor(() => {
      expect(screen.getByText("page-b")).toBeInTheDocument();
    });

    expect((main as HTMLElement).scrollTop).toBe(0);
  });

  it("routes the global rescan action to the platform, central, and discover disk scan stores", async () => {
    const mockRescan = vi.fn().mockResolvedValue(undefined);
    const mockLoadCentralSkills = vi.fn().mockResolvedValue(undefined);
    const mockRefreshDiscoverCounts = vi.fn().mockResolvedValue(undefined);
    const mockRescanDiscoverFromDisk = vi.fn().mockResolvedValue(undefined);
    triggerRescanInMock = true;

    mockUsePlatformStore.mockImplementation((selector?: unknown) => {
      const state = {
        initialize: vi.fn(),
        rescan: mockRescan,
      };
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseCentralSkillsStore.mockImplementation((selector?: unknown) => {
      const state = {
        loadCentralSkills: mockLoadCentralSkills,
      };
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseDiscoverStore.mockImplementation((selector?: unknown) => {
      const state = {
        refreshCounts: mockRefreshDiscoverCounts,
        rescanFromDisk: mockRescanDiscoverFromDisk,
      };
      if (typeof selector === "function") return selector(state);
      return state;
    });

    render(
      <MemoryRouter initialEntries={["/a"]}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="a" element={<DummyPage label="page-a" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await act(async () => {
      screen.getByRole("button", { name: /open-search/i }).click();
    });

    await act(async () => {
      screen.getByRole("button", { name: /trigger-rescan/i }).click();
    });

    expect(mockRescan).toHaveBeenCalledTimes(1);
    expect(mockLoadCentralSkills).toHaveBeenCalledTimes(1);
    expect(mockRescanDiscoverFromDisk).toHaveBeenCalledTimes(1);
    expect(mockRefreshDiscoverCounts).not.toHaveBeenCalled();
  });

  it("waits for the platform rescan before refreshing central and rerunning discover from disk", async () => {
    let resolveRescan!: () => void;
    const rescanPromise = new Promise<void>((resolve) => {
      resolveRescan = () => resolve();
    });
    const mockRescan = vi.fn().mockReturnValue(rescanPromise);
    const mockLoadCentralSkills = vi.fn().mockResolvedValue(undefined);
    const mockRefreshDiscoverCounts = vi.fn().mockResolvedValue(undefined);
    const mockRescanDiscoverFromDisk = vi.fn().mockResolvedValue(undefined);
    triggerRescanInMock = true;

    mockUsePlatformStore.mockImplementation((selector?: unknown) => {
      const state = {
        initialize: vi.fn(),
        rescan: mockRescan,
      };
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseCentralSkillsStore.mockImplementation((selector?: unknown) => {
      const state = {
        loadCentralSkills: mockLoadCentralSkills,
      };
      if (typeof selector === "function") return selector(state);
      return state;
    });
    mockUseDiscoverStore.mockImplementation((selector?: unknown) => {
      const state = {
        refreshCounts: mockRefreshDiscoverCounts,
        rescanFromDisk: mockRescanDiscoverFromDisk,
      };
      if (typeof selector === "function") return selector(state);
      return state;
    });

    render(
      <MemoryRouter initialEntries={["/a"]}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="a" element={<DummyPage label="page-a" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await act(async () => {
      screen.getByRole("button", { name: /open-search/i }).click();
    });

    await act(async () => {
      screen.getByRole("button", { name: /trigger-rescan/i }).click();
    });

    expect(mockRescan).toHaveBeenCalledTimes(1);
    expect(mockLoadCentralSkills).not.toHaveBeenCalled();
    expect(mockRescanDiscoverFromDisk).not.toHaveBeenCalled();
    expect(mockRefreshDiscoverCounts).not.toHaveBeenCalled();

    resolveRescan();

    await waitFor(() => {
      expect(mockLoadCentralSkills).toHaveBeenCalledTimes(1);
      expect(mockRescanDiscoverFromDisk).toHaveBeenCalledTimes(1);
    });

    expect(mockRefreshDiscoverCounts).not.toHaveBeenCalled();
  });
});
