import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MarketplaceSkillDetailDrawer } from "@/components/marketplace/MarketplaceSkillDetailDrawer";

vi.mock("@/components/skill/SkillDetailDrawer", () => ({
  SkillDetailDrawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-markdown", () => ({
  default: ({
    children,
    remarkPlugins,
  }: {
    children: string;
    remarkPlugins?: unknown[];
  }) => (
    <div
      data-testid="react-markdown"
      data-has-remark-gfm={remarkPlugins && remarkPlugins.length > 0 ? "true" : "false"}
    >
      {children}
    </div>
  ),
}));

const skill = {
  id: "skill-1",
  name: "baoyu-imagine",
  downloadUrl: "https://example.com/skills/baoyu-imagine/SKILL.md",
  description: "AI image generation skill",
  sourceLabel: "Repo One",
  sourceUrl: "https://github.com/acme/repo-one",
  installed: false,
};

const skillWithFiles = {
  id: "skill-3",
  name: "file-tree-skill",
  downloadUrl: "https://raw.githubusercontent.com/acme/repo-one/main/skills/file-tree-skill/SKILL.md",
  publisher: "acme/repo-one",
  sourceLabel: "skills.sh",
  sourceUrl: "https://github.com/acme/repo-one",
  installed: false,
  files: [
    { name: "SKILL.md", path: "skills/file-tree-skill/SKILL.md", is_dir: false },
    { name: "scripts", path: "skills/file-tree-skill/scripts", is_dir: true },
    { name: "helper.ts", path: "skills/file-tree-skill/scripts/helper.ts", is_dir: false },
    { name: "README.md", path: "skills/file-tree-skill/README.md", is_dir: false },
  ],
};

const skillWithFilesNoSkillMd = {
  ...skillWithFiles,
  id: "skill-4",
  name: "no-skill-md",
  files: skillWithFiles.files!.filter((f) => f.name !== "SKILL.md"),
};

const mockSkillMdContent = `---
name: baoyu-imagine
version: 1.57.0
metadata:
  openclaw:
    requires:
      anyBins:
        - bun
        - npx
---

# Image Generation

Body content.`;

const mockHelperTsContent = `// Helper script
export function helper() {
  console.log("hello");
}
`;

const mockReadmeContent = `# README

Some documentation here.`;

describe("MarketplaceSkillDetailDrawer", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock = vi.fn((url: string) => {
      let text: string;
      if (url.includes("SKILL.md")) {
        text = mockSkillMdContent;
      } else if (url.includes("README.md")) {
        text = mockReadmeContent;
      } else if (url.includes("helper.ts")) {
        text = mockHelperTsContent;
      } else {
        text = mockSkillMdContent;
      }
      return Promise.resolve({ ok: true, text: async () => text });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  // ─── Legacy mode (no files) ────────────────────────────────────────────

  it("renders frontmatter card in markdown preview", async () => {
    render(
      <MarketplaceSkillDetailDrawer
        open
        skill={skill}
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        isInstalling={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Frontmatter/i })).toBeInTheDocument();
    });

    const frontmatter = screen.getByRole("heading", { name: /Frontmatter/i }).closest("section");
    expect(frontmatter).not.toBeNull();
    expect(within(frontmatter as HTMLElement).getByText("baoyu-imagine")).toBeInTheDocument();
    expect(within(frontmatter as HTMLElement).getByText(/v1\.57\.0/i)).toBeInTheDocument();
    expect(within(frontmatter as HTMLElement).getByText("bun")).toBeInTheDocument();
    expect(within(frontmatter as HTMLElement).getByText("npx")).toBeInTheDocument();
    expect(screen.getByTestId("react-markdown")).toHaveTextContent("# Image Generation");
  });

  it("keeps raw source tab showing original frontmatter fences", async () => {
    render(
      <MarketplaceSkillDetailDrawer
        open
        skill={skill}
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        isInstalling={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("react-markdown")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /原始源码/i }));

    await waitFor(() => {
      expect(screen.getByText(/name: baoyu-imagine/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/---/)).toBeInTheDocument();
  });

  // ─── skills.sh mode: auto-select SKILL.md ──────────────────────────────

  it("auto-selects SKILL.md and shows frontmatter card when drawer opens with files", async () => {
    render(
      <MarketplaceSkillDetailDrawer
        open
        skill={skillWithFiles}
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        isInstalling={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Frontmatter/i })).toBeInTheDocument();
    });

    // Should fetch from the constructed raw.githubusercontent URL
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/acme/repo-one/main/skills/file-tree-skill/SKILL.md"
    );

    // SKILL.md path should be highlighted in the tree
    const treeItem = screen.getByRole("button", { name: "SKILL.md" });
    expect(treeItem).toHaveClass("bg-primary/10");
  });

  it("renders marketplace file entries as interactive clickable buttons", async () => {
    render(
      <MarketplaceSkillDetailDrawer
        open
        skill={skillWithFiles}
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        isInstalling={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Files \(4\)/i)).toBeInTheDocument();
    });

    // Expand the scripts directory
    fireEvent.click(screen.getByRole("button", { name: "scripts" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "helper.ts" })).toBeInTheDocument();
    });
  });

  // ─── skills.sh mode: click file → fetch & preview ──────────────────────

  it("loads and displays non-markdown file content as raw text when clicked", async () => {
    render(
      <MarketplaceSkillDetailDrawer
        open
        skill={skillWithFiles}
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        isInstalling={false}
      />
    );

    // Wait for initial SKILL.md load
    await waitFor(() => {
      expect(screen.getByTestId("react-markdown")).toBeInTheDocument();
    });

    // Expand scripts and click helper.ts
    fireEvent.click(screen.getByRole("button", { name: "scripts" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "helper.ts" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "helper.ts" }));

    // Should fetch the helper.ts file
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://raw.githubusercontent.com/acme/repo-one/main/skills/file-tree-skill/scripts/helper.ts"
      );
    });

    // Should switch to raw view and show the content as pre text
    await waitFor(() => {
      expect(screen.getByText(/Helper script/i)).toBeInTheDocument();
    });

    // Should NOT show ReactMarkdown (raw mode for non-markdown file)
    // The view shows pre, not ReactMarkdown
    const pre = screen.getByText(/Helper script/i).closest("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveTextContent("console.log");
  });

  it("loads and displays markdown file content in markdown view", async () => {
    render(
      <MarketplaceSkillDetailDrawer
        open
        skill={skillWithFiles}
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        isInstalling={false}
      />
    );

    // Wait for initial load, then click README.md
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "README.md" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://raw.githubusercontent.com/acme/repo-one/main/skills/file-tree-skill/README.md"
      );
    });

    // Should render as markdown (README.md is markdown)
    await waitFor(() => {
      expect(screen.getByTestId("react-markdown")).toBeInTheDocument();
    });

    // Should NOT show frontmatter card for non-SKILL.md files
    expect(screen.queryByRole("heading", { name: /Frontmatter/i })).not.toBeInTheDocument();
  });

  // ─── skills.sh mode: no SKILL.md ────────────────────────────────────────

  it("shows empty raw view when files have no SKILL.md", async () => {
    render(
      <MarketplaceSkillDetailDrawer
        open
        skill={skillWithFilesNoSkillMd}
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        isInstalling={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Files \(3\)/i)).toBeInTheDocument();
    });

    // No content should be loaded, no markdown, no frontmatter
    await waitFor(() => {
      expect(screen.queryByTestId("react-markdown")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: /Frontmatter/i })).not.toBeInTheDocument();

    // Tabs still exist; clicking a file loads it
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    await waitFor(() => {
      expect(screen.getByTestId("react-markdown")).toBeInTheDocument();
    });
  });

  // ─── skills.sh mode: raw/markdown toggle behavior ──────────────────────

  it("marks selected file in file tree", async () => {
    render(
      <MarketplaceSkillDetailDrawer
        open
        skill={skillWithFiles}
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        isInstalling={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "SKILL.md" })).toBeInTheDocument();
    });

    // SKILL.md starts highlighted
    const skillMdBtn = screen.getByRole("button", { name: "SKILL.md" });
    expect(skillMdBtn).toHaveClass("bg-primary/10");

    // Click README.md → unhighlight SKILL.md, highlight README.md
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "README.md" })).toHaveClass("bg-primary/10");
    });
    expect(screen.getByRole("button", { name: "SKILL.md" })).not.toHaveClass("bg-primary/10");
  });

  it("switches between markdown and raw view mode for markdown files", async () => {
    render(
      <MarketplaceSkillDetailDrawer
        open
        skill={skillWithFiles}
        onOpenChange={vi.fn()}
        onInstall={vi.fn()}
        isInstalling={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("react-markdown")).toBeInTheDocument();
    });

    // Switch to raw — should show raw content (with frontmatter fences)
    fireEvent.click(screen.getByRole("button", { name: /原始源码/i }));
    await waitFor(() => {
      expect(screen.getByText(/name: baoyu-imagine/i)).toBeInTheDocument();
    });

    // Switch back to markdown
    fireEvent.click(screen.getByRole("button", { name: /Markdown/i }));
    await waitFor(() => {
      expect(screen.getByTestId("react-markdown")).toBeInTheDocument();
    });
  });
});
