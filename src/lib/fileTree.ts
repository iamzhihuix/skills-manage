import type { SkillDirectoryNode, SkillsShFileEntry } from "@/types";

export function buildSkillDirectoryTree(entries: SkillsShFileEntry[]): SkillDirectoryNode[] {
  const map = new Map<string, SkillDirectoryNode>();
  const dirs = entries.filter(e => e.is_dir);
  const files = entries.filter(e => !e.is_dir);

  for (const d of dirs) {
    const node: SkillDirectoryNode = { name: d.name, path: d.path, relative_path: d.path, is_dir: true, children: [] };
    map.set(d.path, node);
  }

  const rooted: SkillDirectoryNode[] = [];
  for (const [, node] of map) {
    const parentKey = node.path.lastIndexOf("/");
    if (parentKey > 0) {
      const parentPath = node.path.slice(0, parentKey);
      const parent = map.get(parentPath);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    rooted.push(node);
  }

  for (const f of files) {
    const node: SkillDirectoryNode = { name: f.name, path: f.path, relative_path: f.path, is_dir: false, children: [] };
    const parentKey = f.path.lastIndexOf("/");
    if (parentKey > 0) {
      const parentPath = f.path.slice(0, parentKey);
      const parent = map.get(parentPath);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    rooted.push(node);
  }

  rooted.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return rooted;
}

export function findFileNodeByPath(nodes: SkillDirectoryNode[], path: string): SkillDirectoryNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    if (node.children.length > 0) {
      const match = findFileNodeByPath(node.children, path);
      if (match) {
        return match;
      }
    }
  }
  return null;
}
