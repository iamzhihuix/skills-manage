import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CollectionPickerDialog } from "../components/collection/CollectionPickerDialog";
import { Collection } from "../types";

// ─── Mock stores ──────────────────────────────────────────────────────────────

vi.mock("../stores/collectionStore", () => ({
  useCollectionStore: vi.fn(),
}));

// Mock CollectionEditor to avoid rendering its internals
vi.mock("../components/collection/CollectionEditor", () => ({
  CollectionEditor: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="collection-editor">
        <button onClick={() => onOpenChange(false)}>Close editor</button>
      </div>
    ) : null,
}));

import { useCollectionStore } from "../stores/collectionStore";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockCollections: Collection[] = [
  {
    id: "col-1",
    name: "Frontend",
    description: "Frontend skills",
    created_at: "2026-04-09T00:00:00Z",
    updated_at: "2026-04-09T00:00:00Z",
  },
  {
    id: "col-2",
    name: "Backend",
    description: undefined,
    created_at: "2026-04-09T01:00:00Z",
    updated_at: "2026-04-09T01:00:00Z",
  },
  {
    id: "col-3",
    name: "DevOps",
    description: "DevOps tools",
    created_at: "2026-04-09T02:00:00Z",
    updated_at: "2026-04-09T02:00:00Z",
  },
];

const mockLoadCollections = vi.fn();
const mockAddSkillToCollection = vi.fn();

function buildStoreState(overrides = {}) {
  return {
    collections: mockCollections,
    currentDetail: null,
    isLoading: false,
    isLoadingDetail: false,
    error: null,
    loadCollections: mockLoadCollections,
    createCollection: vi.fn(),
    updateCollection: vi.fn(),
    deleteCollection: vi.fn(),
    loadCollectionDetail: vi.fn(),
    addSkillToCollection: mockAddSkillToCollection,
    removeSkillFromCollection: vi.fn(),
    batchInstallCollection: vi.fn(),
    exportCollection: vi.fn(),
    importCollection: vi.fn(),
    ...overrides,
  };
}

function renderDialog(props: Partial<React.ComponentProps<typeof CollectionPickerDialog>> = {}) {
  vi.mocked(useCollectionStore).mockImplementation((selector) =>
    selector(buildStoreState())
  );

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    skillId: "frontend-design",
    currentCollectionIds: [],
    onAdded: vi.fn(),
  };

  return render(<CollectionPickerDialog {...defaultProps} {...props} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CollectionPickerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  it("renders dialog title", () => {
    renderDialog();
    expect(screen.getByText("添加到技能集")).toBeInTheDocument();
  });

  it("shows all collections as checkboxes", () => {
    renderDialog();
    expect(screen.getByText("Frontend")).toBeInTheDocument();
    expect(screen.getByText("Backend")).toBeInTheDocument();
    expect(screen.getByText("DevOps")).toBeInTheDocument();
  });

  it("shows collection descriptions when available", () => {
    renderDialog();
    expect(screen.getByText("Frontend skills")).toBeInTheDocument();
    expect(screen.getByText("DevOps tools")).toBeInTheDocument();
  });

  it("calls loadCollections on open", () => {
    renderDialog();
    expect(mockLoadCollections).toHaveBeenCalledTimes(1);
  });

  it("renders Create new collection button", () => {
    renderDialog();
    expect(
      screen.getByRole("button", { name: /新建技能集/i })
    ).toBeInTheDocument();
  });

  // ── Pre-checked and disabled collections ─────────────────────────────────

  it("marks already-member collections as pre-checked and disabled", () => {
    renderDialog({ currentCollectionIds: ["col-1"] });

    const frontendCheckbox = screen.getByRole("checkbox", { name: "Frontend" });
    expect(frontendCheckbox).toBeChecked();
    // base-ui Checkbox uses aria-disabled rather than the native disabled attribute
    expect(frontendCheckbox).toHaveAttribute("aria-disabled", "true");
  });

  it("shows 'Already a member' label for collections the skill already belongs to", () => {
    renderDialog({ currentCollectionIds: ["col-1"] });
    expect(screen.getByText("已在其中")).toBeInTheDocument();
  });

  it("does not disable checkboxes for collections skill is not in", () => {
    renderDialog({ currentCollectionIds: ["col-1"] });

    const backendCheckbox = screen.getByRole("checkbox", { name: "Backend" });
    expect(backendCheckbox).not.toHaveAttribute("aria-disabled", "true");
    expect(backendCheckbox).not.toBeChecked();
  });

  // ── Selection ─────────────────────────────────────────────────────────────

  it("allows selecting a collection by clicking the checkbox", () => {
    renderDialog();
    const backendCheckbox = screen.getByRole("checkbox", { name: "Backend" });
    fireEvent.click(backendCheckbox);
    expect(backendCheckbox).toBeChecked();
  });

  it("allows deselecting a collection by clicking it again", () => {
    renderDialog();
    const backendCheckbox = screen.getByRole("checkbox", { name: "Backend" });
    fireEvent.click(backendCheckbox);
    fireEvent.click(backendCheckbox);
    expect(backendCheckbox).not.toBeChecked();
  });

  it("Confirm button is disabled when no new collection is selected", () => {
    renderDialog();
    const confirmBtn = screen.getByRole("button", { name: /添加/ });
    expect(confirmBtn).toBeDisabled();
  });

  it("Confirm button becomes enabled when a collection is selected", () => {
    renderDialog();
    const backendCheckbox = screen.getByRole("checkbox", { name: "Backend" });
    fireEvent.click(backendCheckbox);
    const confirmBtn = screen.getByRole("button", { name: /添加/ });
    expect(confirmBtn).not.toBeDisabled();
  });

  // ── Adding to collections ─────────────────────────────────────────────────

  it("calls addSkillToCollection for each selected collection on confirm", async () => {
    const onAdded = vi.fn();
    const onOpenChange = vi.fn();
    mockAddSkillToCollection.mockResolvedValue(undefined);

    renderDialog({ onAdded, onOpenChange });

    // Select col-2 (Backend)
    fireEvent.click(screen.getByRole("checkbox", { name: "Backend" }));
    // Select col-3 (DevOps)
    fireEvent.click(screen.getByRole("checkbox", { name: "DevOps" }));

    const confirmBtn = screen.getByRole("button", { name: /添加/ });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockAddSkillToCollection).toHaveBeenCalledWith("col-2", "frontend-design");
      expect(mockAddSkillToCollection).toHaveBeenCalledWith("col-3", "frontend-design");
    });
  });

  it("calls onAdded after successful confirm", async () => {
    const onAdded = vi.fn();
    mockAddSkillToCollection.mockResolvedValue(undefined);

    renderDialog({ onAdded });

    fireEvent.click(screen.getByRole("checkbox", { name: "Backend" }));
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledTimes(1);
    });
  });

  it("closes dialog after successful confirm", async () => {
    const onOpenChange = vi.fn();
    mockAddSkillToCollection.mockResolvedValue(undefined);

    renderDialog({ onOpenChange });

    fireEvent.click(screen.getByRole("checkbox", { name: "Backend" }));
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows error when addSkillToCollection fails", async () => {
    mockAddSkillToCollection.mockRejectedValue(new Error("Failed to add"));

    renderDialog();

    fireEvent.click(screen.getByRole("checkbox", { name: "Backend" }));
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to add");
    });
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  it("shows empty state when there are no collections", () => {
    vi.mocked(useCollectionStore).mockImplementation((selector) =>
      selector(buildStoreState({ collections: [] }))
    );
    render(
      <CollectionPickerDialog
        open={true}
        onOpenChange={vi.fn()}
        skillId="frontend-design"
        currentCollectionIds={[]}
        onAdded={vi.fn()}
      />
    );
    expect(screen.getByText(/暂无技能集/i)).toBeInTheDocument();
  });

  it("shows loading state when collections are loading", () => {
    vi.mocked(useCollectionStore).mockImplementation((selector) =>
      selector(buildStoreState({ isLoading: true, collections: [] }))
    );
    render(
      <CollectionPickerDialog
        open={true}
        onOpenChange={vi.fn()}
        skillId="frontend-design"
        currentCollectionIds={[]}
        onAdded={vi.fn()}
      />
    );
    expect(screen.getByText(/正在加载技能集/i)).toBeInTheDocument();
  });

  // ── Create new collection ─────────────────────────────────────────────────

  it("opens CollectionEditor when Create new collection is clicked", () => {
    renderDialog();
    const createBtn = screen.getByRole("button", { name: /新建技能集/i });
    fireEvent.click(createBtn);
    expect(screen.getByTestId("collection-editor")).toBeInTheDocument();
  });

  it("refreshes collections after CollectionEditor closes", () => {
    renderDialog();
    mockLoadCollections.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /新建技能集/i }));
    // Close the editor
    fireEvent.click(screen.getByText("Close editor"));

    expect(mockLoadCollections).toHaveBeenCalledTimes(1);
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    fireEvent.click(screen.getByRole("button", { name: /取消/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not call addSkillToCollection when Cancel is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: "Backend" }));
    fireEvent.click(screen.getByRole("button", { name: /取消/i }));
    expect(mockAddSkillToCollection).not.toHaveBeenCalled();
  });
});
