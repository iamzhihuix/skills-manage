import { useEffect, useMemo, useState } from "react";
import {
  Search,
  FolderSearch,
  RefreshCw,
  Loader2,
  Folder,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiscoverConfigDialog } from "@/components/discover/DiscoverConfigDialog";
import { DiscoveredSkillCard } from "@/components/discover/DiscoveredSkillCard";
import { InstallDialog } from "@/components/central/InstallDialog";
import { useDiscoverStore } from "@/stores/discoverStore";
import { usePlatformStore } from "@/stores/platformStore";
import { DiscoveredProject, DiscoveredSkill, SkillWithLinks } from "@/types";

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
      <div className="p-4 rounded-full bg-muted/60">
        <FolderSearch className="size-12 text-muted-foreground opacity-60" />
      </div>
      <p className="text-sm text-muted-foreground font-medium">
        {t("discover.noResults")}
      </p>
      <p className="text-xs text-muted-foreground text-center max-w-sm">
        {t("discover.noResultsDesc")}
      </p>
    </div>
  );
}

// ─── ProgressView ─────────────────────────────────────────────────────────────

function ProgressView() {
  const { t } = useTranslation();
  const scanProgress = useDiscoverStore((s) => s.scanProgress);
  const currentPath = useDiscoverStore((s) => s.currentPath);
  const skillsFoundSoFar = useDiscoverStore((s) => s.skillsFoundSoFar);
  const projectsFoundSoFar = useDiscoverStore((s) => s.projectsFoundSoFar);
  const stopScan = useDiscoverStore((s) => s.stopScan);

  return (
    <div className="space-y-4 py-6 max-w-lg mx-auto">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        <span className="font-medium">{t("discover.scanning")}</span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full transition-all duration-300"
          style={{ width: `${scanProgress}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("discover.progress", { percent: scanProgress, path: currentPath })}</span>
        <span>
          {t("discover.foundSoFar", {
            skills: skillsFoundSoFar,
            projects: projectsFoundSoFar,
          })}
        </span>
      </div>

      <div className="flex justify-center">
        <Button variant="outline" size="sm" onClick={stopScan}>
          {t("discover.stopAndShow")}
        </Button>
      </div>
    </div>
  );
}

// ─── Project Group ────────────────────────────────────────────────────────────

function ProjectGroup({
  project,
  selectedSkillIds,
  onToggleSelect,
  onInstallToCentral,
  onInstallToPlatform,
  importingIds,
}: {
  project: DiscoveredProject;
  selectedSkillIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onInstallToCentral: (id: string) => void;
  onInstallToPlatform: (skill: DiscoveredSkill) => void;
  importingIds: Set<string>;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Project header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border">
        <Folder className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate">{project.project_name}</span>
        <span className="text-xs text-muted-foreground ml-1">
          {project.project_path}
        </span>
        <span className="ml-auto text-xs text-muted-foreground shrink-0">
          {project.skills.length} skill{project.skills.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Skill cards */}
      <div className="p-3 space-y-2">
        {project.skills.map((skill) => (
          <DiscoveredSkillCard
            key={skill.id}
            skill={skill}
            isSelected={selectedSkillIds.has(skill.id)}
            onToggleSelect={() => onToggleSelect(skill.id)}
            onInstallToCentral={() => onInstallToCentral(skill.id)}
            onInstallToPlatform={() => onInstallToPlatform(skill)}
            isImporting={importingIds.has(skill.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Platform Group ───────────────────────────────────────────────────────────

function PlatformGroup({
  platformName,
  skills,
  selectedSkillIds,
  onToggleSelect,
  onInstallToCentral,
  onInstallToPlatform,
  importingIds,
}: {
  platformName: string;
  skills: DiscoveredSkill[];
  selectedSkillIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onInstallToCentral: (id: string) => void;
  onInstallToPlatform: (skill: DiscoveredSkill) => void;
  importingIds: Set<string>;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border">
        <span className="text-sm font-medium">{platformName}</span>
        <span className="ml-auto text-xs text-muted-foreground shrink-0">
          {skills.length} skill{skills.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="p-3 space-y-2">
        {skills.map((skill) => (
          <DiscoveredSkillCard
            key={skill.id}
            skill={skill}
            isSelected={selectedSkillIds.has(skill.id)}
            onToggleSelect={() => onToggleSelect(skill.id)}
            onInstallToCentral={() => onInstallToCentral(skill.id)}
            onInstallToPlatform={() => onInstallToPlatform(skill)}
            isImporting={importingIds.has(skill.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── DiscoverView ─────────────────────────────────────────────────────────────

export function DiscoverView() {
  const { t } = useTranslation();

  // Store state
  const isScanning = useDiscoverStore((s) => s.isScanning);
  const discoveredProjects = useDiscoverStore((s) => s.discoveredProjects);
  const totalSkillsFound = useDiscoverStore((s) => s.totalSkillsFound);
  const groupBy = useDiscoverStore((s) => s.groupBy);
  const platformFilter = useDiscoverStore((s) => s.platformFilter);
  const searchQuery = useDiscoverStore((s) => s.searchQuery);
  const selectedSkillIds = useDiscoverStore((s) => s.selectedSkillIds);
  const loadDiscoveredSkills = useDiscoverStore((s) => s.loadDiscoveredSkills);
  const importToCentral = useDiscoverStore((s) => s.importToCentral);
  const importToPlatform = useDiscoverStore((s) => s.importToPlatform);
  const setGroupBy = useDiscoverStore((s) => s.setGroupBy);
  const setPlatformFilter = useDiscoverStore((s) => s.setPlatformFilter);
  const setSearchQuery = useDiscoverStore((s) => s.setSearchQuery);
  const toggleSkillSelection = useDiscoverStore((s) => s.toggleSkillSelection);
  // selectAllVisible — available for "select all" feature
  const clearSelection = useDiscoverStore((s) => s.clearSelection);
  // clearResults — available for clearing scan results
  // startScan — triggered from DiscoverConfigDialog
  const loadScanRoots = useDiscoverStore((s) => s.loadScanRoots);

  const agents = usePlatformStore((s) => s.agents);
  const rescan = usePlatformStore((s) => s.rescan);

  // Local state
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [installTargetSkill, setInstallTargetSkill] =
    useState<DiscoveredSkill | null>(null);
  const [isInstallDialogOpen, setIsInstallDialogOpen] = useState(false);

  // Load persisted results on mount.
  useEffect(() => {
    loadDiscoveredSkills();
  }, [loadDiscoveredSkills]);

  // All skills flattened for filtering/searching.
  const allSkills = useMemo(
    () => discoveredProjects.flatMap((p) => p.skills),
    [discoveredProjects]
  );

  // Filtered skills based on search and platform filter.
  const filteredProjects = useMemo(() => {
    let projects = discoveredProjects;

    // Filter by platform.
    if (platformFilter) {
      projects = projects.map((p) => ({
        ...p,
        skills: p.skills.filter((s) => s.platform_id === platformFilter),
      })).filter((p) => p.skills.length > 0);
    }

    // Filter by search query.
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      projects = projects.map((p) => ({
        ...p,
        skills: p.skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.description?.toLowerCase().includes(q) ||
            s.project_name.toLowerCase().includes(q)
        ),
      })).filter((p) => p.skills.length > 0);
    }

    return projects;
  }, [discoveredProjects, platformFilter, searchQuery]);

  // Grouped by platform.
  const platformGroups = useMemo(() => {
    const filtered = filteredProjects.flatMap((p) => p.skills);
    const groups = new Map<string, DiscoveredSkill[]>();
    for (const skill of filtered) {
      const key = skill.platform_name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(skill);
    }
    return Array.from(groups.entries()).map(([name, skills]) => ({
      name,
      skills,
    }));
  }, [filteredProjects]);

  // Flat skills list (group by skill).
  const flatSkills = useMemo(() => {
    return filteredProjects.flatMap((p) => p.skills).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredProjects]);

  // Visible skill IDs for "select all" — will be used when selectAllVisible is wired up
  // const visibleSkillIds = useMemo(
  //   () => filteredProjects.flatMap((p) => p.skills.map((s) => s.id)),
  //   [filteredProjects]
  // );

  // Available platform agents for install dialog.
  const platformAgents = useMemo(
    () => agents.filter((a) => a.id !== "central" && a.is_enabled),
    [agents]
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleInstallToCentral(skillId: string) {
    setImportingIds((prev) => new Set(prev).add(skillId));
    try {
      await importToCentral(skillId);
      await rescan();
      // Refresh discovered skills list — importToCentral removes the record
      // from the DB, so the skill will disappear from the list on reload.
      await loadDiscoveredSkills();
      toast.success(t("discover.importSuccess"));
    } catch (err) {
      toast.error(t("discover.importError", { error: String(err) }));
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    }
  }

  function handleInstallToPlatform(skill: DiscoveredSkill) {
    setInstallTargetSkill(skill);
    setIsInstallDialogOpen(true);
  }

  async function handleBatchInstallCentral() {
    const ids = Array.from(selectedSkillIds);
    for (const id of ids) {
      await handleInstallToCentral(id);
    }
  }

  // ── Install dialog handler ─────────────────────────────────────────────────

  async function handleInstallFromDialog(
    _skillId: string,
    agentIds: string[],
    _method: string
  ) {
    if (!installTargetSkill) return;
    // For discovered skills, we directly install to each selected agent.
    setImportingIds((prev) => new Set(prev).add(installTargetSkill!.id));
    try {
      for (const agentId of agentIds) {
        await importToPlatform(installTargetSkill!.id, agentId);
      }
      await rescan();
      // Refresh discovered skills list to reflect updated install status.
      // The Rust backend keeps discovered records after platform install,
      // so we need to reload to show the latest is_already_central state.
      await loadDiscoveredSkills();
      toast.success(t("discover.importSuccess"));
    } catch (err) {
      toast.error(t("discover.importError", { error: String(err) }));
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev);
        next.delete(installTargetSkill!.id);
        return next;
      });
      setIsInstallDialogOpen(false);
      setInstallTargetSkill(null);
    }
  }

  // ── Re-scan ────────────────────────────────────────────────────────────────

  async function handleRescan() {
    await loadScanRoots();
    setIsConfigOpen(true);
  }

  // ── Group-by buttons ───────────────────────────────────────────────────────

  const groupOptions: Array<{ value: "project" | "platform" | "skill"; label: string }> = [
    { value: "project", label: t("discover.groupByProject") },
    { value: "platform", label: t("discover.groupByPlatform") },
    { value: "skill", label: t("discover.groupBySkill") },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("discover.resultsTitle")}</h1>
          {totalSkillsFound > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("discover.foundSummary", {
                skills: totalSkillsFound,
                projects: discoveredProjects.length,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRescan}
            aria-label={t("discover.reScan")}
          >
            <RefreshCw className="size-3.5 mr-1" />
            {t("discover.reScan")}
          </Button>
        </div>
      </div>

      {/* Toolbar: search, group-by, filter */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t("discover.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 bg-muted/40 h-8 text-sm"
            aria-label={t("discover.searchPlaceholder")}
          />
        </div>

        {/* Group by */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">{t("discover.groupBy")}:</span>
          {groupOptions.map((opt) => (
            <Button
              key={opt.value}
              variant={groupBy === opt.value ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => setGroupBy(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {/* Platform filter */}
        <select
          className="h-7 text-xs rounded-md border border-border bg-background px-2"
          value={platformFilter ?? ""}
          onChange={(e) => setPlatformFilter(e.target.value || null)}
          aria-label={t("discover.filterAll")}
        >
          <option value="">{t("discover.filterAll")}</option>
          {[...new Set(allSkills.map((s) => s.platform_id))].map((id) => {
            const name = allSkills.find((s) => s.platform_id === id)?.platform_name ?? id;
            return (
              <option key={id} value={id}>
                {name}
              </option>
            );
          })}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isScanning ? (
          <ProgressView />
        ) : discoveredProjects.length === 0 ? (
          <EmptyState />
        ) : filteredProjects.length === 0 && searchQuery.trim() ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
            <div className="p-4 rounded-full bg-muted/60">
              <FolderSearch className="size-12 text-muted-foreground opacity-60" />
            </div>
            <p className="text-sm text-muted-foreground font-medium">
              {t("discover.noMatch", { query: searchQuery })}
            </p>
          </div>
        ) : groupBy === "project" ? (
          <div className="space-y-4">
            {filteredProjects.map((project) => (
              <ProjectGroup
                key={project.project_path}
                project={project}
                selectedSkillIds={selectedSkillIds}
                onToggleSelect={toggleSkillSelection}
                onInstallToCentral={handleInstallToCentral}
                onInstallToPlatform={handleInstallToPlatform}
                importingIds={importingIds}
              />
            ))}
          </div>
        ) : groupBy === "platform" ? (
          <div className="space-y-4">
            {platformGroups.map((group) => (
              <PlatformGroup
                key={group.name}
                platformName={group.name}
                skills={group.skills}
                selectedSkillIds={selectedSkillIds}
                onToggleSelect={toggleSkillSelection}
                onInstallToCentral={handleInstallToCentral}
                onInstallToPlatform={handleInstallToPlatform}
                importingIds={importingIds}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {flatSkills.map((skill) => (
              <DiscoveredSkillCard
                key={skill.id}
                skill={skill}
                isSelected={selectedSkillIds.has(skill.id)}
                onToggleSelect={() => toggleSkillSelection(skill.id)}
                onInstallToCentral={() => handleInstallToCentral(skill.id)}
                onInstallToPlatform={() => handleInstallToPlatform(skill)}
                isImporting={importingIds.has(skill.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selection action bar */}
      {selectedSkillIds.size > 0 && (
        <div className="border-t border-border px-6 py-3 flex items-center gap-3 bg-muted/20">
          <span className="text-sm text-muted-foreground">
            {t("discover.selected", { count: selectedSkillIds.size })}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchInstallCentral}
            >
              <ArrowUpRight className="size-3.5 mr-1" />
              {t("discover.installSelectedCentral")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
            >
              {t("discover.deselectAll")}
            </Button>
          </div>
        </div>
      )}

      {/* Config Dialog */}
      <DiscoverConfigDialog
        open={isConfigOpen}
        onOpenChange={setIsConfigOpen}
      />

      {/* Install Dialog */}
      {installTargetSkill && (
        <InstallDialog
          open={isInstallDialogOpen}
          onOpenChange={(open) => {
            setIsInstallDialogOpen(open);
            if (!open) setInstallTargetSkill(null);
          }}
          skill={{
            id: installTargetSkill.id,
            name: installTargetSkill.name,
            description: installTargetSkill.description,
            file_path: installTargetSkill.file_path,
            is_central: false,
            linked_agents: [],
            scanned_at: new Date().toISOString(),
          } as SkillWithLinks}
          agents={platformAgents}
          onInstall={handleInstallFromDialog}
        />
      )}
    </div>
  );
}
