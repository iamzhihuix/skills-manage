import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock the collection store
vi.mock("../stores/collectionStore", () => ({
  useCollectionStore: vi.fn(),
}));

import { CollectionEditor } from "../components/collection/CollectionEditor";
import { useCollectionStore } from "../stores/collectionStore";
import { Collection } from "../types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockCreateCollection = vi.fn();
const mockUpdateCollection = vi.fn();
const mockOnOpenChange = vi.fn();

function buildStoreState(overrides = {}) {
  return {
    collections: [],
    currentDetail: null,
    isLoading: false,
    isLoadingDetail: false,
    error: null,
    createCollection: mockCreateCollection,
    updateCollection: mockUpdateCollection,
    loadCollections: vi.fn(),
    deleteCollection: vi.fn(),
    loadCollectionDetail: vi.fn(),
    addSkillToCollection: vi.fn(),
    removeSkillFromCollection: vi.fn(),
    batchInstallCollection: vi.fn(),
    exportCollection: vi.fn(),
    importCollection: vi.fn(),
    ...overrides,
  };
}

function renderEditor(props: {
  open?: boolean;
  collection?: Collection | null;
} = {}) {
  vi.mocked(useCollectionStore).mockImplementation((selector) =>
    selector(buildStoreState())
  );

  return render(
    <CollectionEditor
      open={props.open ?? true}
      onOpenChange={mockOnOpenChange}
      collection={props.collection ?? null}
    />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CollectionEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  it("renders create mode when no collection is passed", () => {
    renderEditor({ collection: null });
    expect(screen.getByText(/新建技能集/i)).toBeInTheDocument();
  });

  it("renders edit mode when a collection is passed", () => {
    const collection: Collection = {
      id: "col-1",
      name: "Frontend",
      description: "Frontend skills",
      created_at: "2026-04-09T00:00:00Z",
      updated_at: "2026-04-09T00:00:00Z",
    };
    renderEditor({ collection });
    expect(screen.getByText(/编辑技能集/i)).toBeInTheDocument();
  });

  it("pre-fills name and description in edit mode", () => {
    const collection: Collection = {
      id: "col-1",
      name: "Frontend",
      description: "Frontend skills",
      created_at: "2026-04-09T00:00:00Z",
      updated_at: "2026-04-09T00:00:00Z",
    };
    renderEditor({ collection });
    const nameInput = screen.getByPlaceholderText(/技能集名称/i);
    expect(nameInput).toHaveValue("Frontend");
    const descInput = screen.getByPlaceholderText(/描述/i);
    expect(descInput).toHaveValue("Frontend skills");
  });

  it("shows empty fields in create mode", () => {
    renderEditor({ collection: null });
    const nameInput = screen.getByPlaceholderText(/技能集名称/i);
    expect(nameInput).toHaveValue("");
  });

  // ── Create Mode ───────────────────────────────────────────────────────────

  it("calls createCollection when form is submitted in create mode", async () => {
    mockCreateCollection.mockResolvedValueOnce({
      id: "col-new",
      name: "New Collection",
      created_at: "2026-04-10T00:00:00Z",
      updated_at: "2026-04-10T00:00:00Z",
    });

    renderEditor({ collection: null });

    const nameInput = screen.getByPlaceholderText(/技能集名称/i);
    fireEvent.change(nameInput, { target: { value: "New Collection" } });

    const submitButton = screen.getByRole("button", { name: /创建/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockCreateCollection).toHaveBeenCalledWith("New Collection", "");
    });
  });

  it("calls onOpenChange(false) after successful create", async () => {
    mockCreateCollection.mockResolvedValueOnce({
      id: "col-new",
      name: "New Collection",
      created_at: "2026-04-10T00:00:00Z",
      updated_at: "2026-04-10T00:00:00Z",
    });

    renderEditor({ collection: null });
    const nameInput = screen.getByPlaceholderText(/技能集名称/i);
    fireEvent.change(nameInput, { target: { value: "New Collection" } });
    const submitButton = screen.getByRole("button", { name: /创建/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows validation error when name is empty", async () => {
    renderEditor({ collection: null });
    const submitButton = screen.getByRole("button", { name: /创建/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/名称不能为空/i)).toBeInTheDocument();
    });
    expect(mockCreateCollection).not.toHaveBeenCalled();
  });

  // ── Edit Mode ─────────────────────────────────────────────────────────────

  it("calls updateCollection when form is submitted in edit mode", async () => {
    const collection: Collection = {
      id: "col-1",
      name: "Frontend",
      description: "Frontend skills",
      created_at: "2026-04-09T00:00:00Z",
      updated_at: "2026-04-09T00:00:00Z",
    };

    mockUpdateCollection.mockResolvedValueOnce({ ...collection, name: "Frontend Updated" });

    renderEditor({ collection });

    const nameInput = screen.getByPlaceholderText(/技能集名称/i);
    fireEvent.change(nameInput, { target: { value: "Frontend Updated" } });

    const submitButton = screen.getByRole("button", { name: /保存/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockUpdateCollection).toHaveBeenCalledWith("col-1", "Frontend Updated", "Frontend skills");
    });
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  it("closes dialog when cancel is clicked", () => {
    renderEditor({ collection: null });
    const cancelButton = screen.getByRole("button", { name: /取消/i });
    fireEvent.click(cancelButton);
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });
});
