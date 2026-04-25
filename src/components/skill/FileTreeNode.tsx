import { ChevronDown, ChevronRight, FileText, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SelectedSkillFile, SkillDirectoryNode } from "@/types";

interface FileTreeNodeProps {
  node: SkillDirectoryNode;
  level: number;
  selectedPath?: string | null;
  expandedDirectories: Set<string>;
  onToggleDirectory: (path: string) => void;
  onSelectFile?: (file: SelectedSkillFile) => void;
}

export function FileTreeNode({
  node,
  level,
  selectedPath,
  expandedDirectories,
  onToggleDirectory,
  onSelectFile,
}: FileTreeNodeProps) {
  const paddingLeft = `${level * 12}px`;

  if (node.is_dir) {
    const isExpanded = expandedDirectories.has(node.path);
    return (
      <div className="space-y-1">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => onToggleDirectory(node.path)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground cursor-pointer"
          style={{ paddingLeft }}
        >
          {isExpanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            level={level + 1}
            selectedPath={selectedPath}
            expandedDirectories={expandedDirectories}
            onToggleDirectory={onToggleDirectory}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    );
  }

  const isSelected = node.path === selectedPath;
  return (
    <button
      type="button"
      onClick={() => onSelectFile?.({ path: node.path, relativePath: node.relative_path })}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors cursor-pointer",
        isSelected
          ? "bg-primary/10 text-primary"
          : "text-foreground/80 hover:bg-muted/60 hover:text-foreground"
      )}
      style={{ paddingLeft }}
      title={node.relative_path}
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
