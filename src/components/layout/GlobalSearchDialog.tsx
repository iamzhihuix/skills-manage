import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Blocks,
  Radar,
  Layers,
  RefreshCw,
  Plus,
  ArrowUpRight,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useCentralSkillsStore } from "@/stores/centralSkillsStore";
import { useDiscoverStore } from "@/stores/discoverStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { usePlatformStore } from "@/stores/platformStore";
import { useHotkey } from "@/hooks/useHotkey";
import { PlatformIcon } from "@/components/platform/PlatformIcon";
import { buildSearchText, normalizeSearchQuery, scoreSearchMatch } from "@/lib/search";

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: string) => void;
}

type SearchItem = {
  id: string;
  label: string;
  description?: string;
  groupKey: "central" | "discovered" | "collections" | "platforms" | "actions";
  groupLabel: string;
  icon: React.ReactNode;
  searchText: string;
  labelText: string;
  descriptionText: string;
  onSelect: () => void;
};

export function GlobalSearchDialog({
  open,
  onOpenChange,
  onAction,
}: GlobalSearchDialogProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Data sources
  const centralSkills = useCentralSkillsStore((s) => s.skills);
  const discoveredProjects = useDiscoverStore((s) => s.discoveredProjects);
  const collections = useCollectionStore((s) => s.collections);
  const agents = usePlatformStore((s) => s.agents);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = useMemo(
    () => normalizeSearchQuery(deferredQuery),
    [deferredQuery]
  );

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const groupMeta = useMemo(
    () => [
      {
        key: "central" as const,
        label: t("globalSearch.centralSkills"),
        initialLimit: 8,
      },
      {
        key: "discovered" as const,
        label: t("globalSearch.discovered"),
        initialLimit: 8,
      },
      {
        key: "collections" as const,
        label: t("globalSearch.collections"),
        initialLimit: 8,
      },
      {
        key: "platforms" as const,
        label: t("globalSearch.platforms"),
        initialLimit: 10,
      },
      {
        key: "actions" as const,
        label: t("globalSearch.actions"),
        initialLimit: 10,
      },
    ],
    [t]
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  // Build flat search items
  const items = useMemo<SearchItem[]>(() => {
    if (!open) return [];

    const result: SearchItem[] = [];

    // Central Skills
    for (const skill of centralSkills) {
      const labelText = skill.name.toLowerCase();
      const descriptionText = (skill.description ?? "").toLowerCase();
      result.push({
        id: `central-${skill.id}`,
        label: skill.name,
        description: skill.description,
        groupKey: "central",
        groupLabel: t("globalSearch.centralSkills"),
        icon: <Blocks className="size-4 shrink-0 text-primary/70" />,
        searchText: buildSearchText([skill.name, skill.description]),
        labelText,
        descriptionText,
        onSelect: () => {
          close();
          navigate(`/skill/${skill.id}`);
        },
      });
    }

    // Discovered Skills
    const discoveredSkills = discoveredProjects.flatMap((p) => p.skills);
    for (const skill of discoveredSkills) {
      const description = `${skill.project_name} / ${skill.platform_name}`;
      result.push({
        id: `discovered-${skill.id}`,
        label: skill.name,
        description,
        groupKey: "discovered",
        groupLabel: t("globalSearch.discovered"),
        icon: <Radar className="size-4 shrink-0 text-primary/70" />,
        searchText: buildSearchText([skill.name, description, skill.project_path]),
        labelText: skill.name.toLowerCase(),
        descriptionText: description.toLowerCase(),
        onSelect: () => {
          close();
          navigate("/discover");
        },
      });
    }

    // Collections
    for (const col of collections) {
      result.push({
        id: `collection-${col.id}`,
        label: col.name,
        description: col.description,
        groupKey: "collections",
        groupLabel: t("globalSearch.collections"),
        icon: <Layers className="size-4 shrink-0 text-primary/70" />,
        searchText: buildSearchText([col.name, col.description]),
        labelText: col.name.toLowerCase(),
        descriptionText: (col.description ?? "").toLowerCase(),
        onSelect: () => {
          close();
          navigate(`/collection/${col.id}`);
        },
      });
    }

    // Platform Views
    const platformAgents = agents.filter(
      (a) => a.id !== "central" && a.is_enabled
    );
    for (const agent of platformAgents) {
      result.push({
        id: `platform-${agent.id}`,
        label: agent.display_name,
        description: agent.global_skills_dir,
        groupKey: "platforms",
        groupLabel: t("globalSearch.platforms"),
        icon: (
          <PlatformIcon agentId={agent.id} className="size-4 text-primary/70" />
        ),
        searchText: buildSearchText([agent.display_name, agent.global_skills_dir]),
        labelText: agent.display_name.toLowerCase(),
        descriptionText: agent.global_skills_dir.toLowerCase(),
        onSelect: () => {
          close();
          navigate(`/platform/${agent.id}`);
        },
      });
    }

    // Actions
    result.push(
      {
        id: "action-rescan",
        label: t("globalSearch.actionRescan"),
        groupKey: "actions",
        groupLabel: t("globalSearch.actions"),
        icon: <RefreshCw className="size-4 shrink-0 text-primary/70" />,
        searchText: buildSearchText([t("globalSearch.actionRescan")]),
        labelText: t("globalSearch.actionRescan").toLowerCase(),
        descriptionText: "",
        onSelect: () => {
          close();
          onAction("rescan");
        },
      },
      {
        id: "action-new-collection",
        label: t("globalSearch.actionNewCollection"),
        groupKey: "actions",
        groupLabel: t("globalSearch.actions"),
        icon: <Plus className="size-4 shrink-0 text-primary/70" />,
        searchText: buildSearchText([t("globalSearch.actionNewCollection")]),
        labelText: t("globalSearch.actionNewCollection").toLowerCase(),
        descriptionText: "",
        onSelect: () => {
          close();
          onAction("new-collection");
        },
      },
      {
        id: "action-discover",
        label: t("globalSearch.actionDiscover"),
        groupKey: "actions",
        groupLabel: t("globalSearch.actions"),
        icon: <ArrowUpRight className="size-4 shrink-0 text-primary/70" />,
        searchText: buildSearchText([t("globalSearch.actionDiscover")]),
        labelText: t("globalSearch.actionDiscover").toLowerCase(),
        descriptionText: "",
        onSelect: () => {
          close();
          navigate("/discover");
        },
      }
    );

    return result;
  }, [
    centralSkills,
    discoveredProjects,
    collections,
    agents,
    navigate,
    close,
    open,
    onAction,
    t,
  ]);

  const visibleGroups = useMemo(() => {
    if (!open) return [];

    if (!normalizedQuery) {
      return groupMeta
        .map((group) => ({
          key: group.key,
          heading: group.label,
          items: items
            .filter((item) => item.groupKey === group.key)
            .slice(0, group.initialLimit),
        }))
        .filter((group) => group.items.length > 0);
    }

    const matchedItems = items
      .map((item) => ({
        item,
        score: scoreSearchMatch(
          normalizedQuery,
          item.labelText,
          item.descriptionText,
          item.searchText
        ),
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score;
        }
        return left.item.label.localeCompare(right.item.label);
      })
      .slice(0, 50)
      .map((entry) => entry.item);

    return groupMeta
      .map((group) => ({
        key: group.key,
        heading: group.label,
        items: matchedItems.filter((item) => item.groupKey === group.key),
      }))
      .filter((group) => group.items.length > 0);
  }, [groupMeta, items, normalizedQuery, open]);

  // Cmd+K shortcut (also registered here so the dialog self-toggles)
  useHotkey("mod+k", () => onOpenChange(!open));

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("globalSearch.title")}
      description={t("globalSearch.description")}
      className="sm:max-w-lg"
      showCloseButton={false}
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t("globalSearch.placeholder")}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{t("globalSearch.noResults")}</CommandEmpty>
          {visibleGroups.map((group) => (
            <CommandGroup key={group.key} heading={group.heading}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.description ?? ""}`}
                  onSelect={item.onSelect}
                >
                  {item.icon}
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-sm">{item.label}</span>
                    {item.description && (
                      <span className="truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
