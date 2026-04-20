import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Radar,
  RefreshCw,
  Loader2,
  Folder,
  ArrowUpRight,
  StopCircle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiscoverConfigDialog } from "@/components/discover/DiscoverConfigDialog";
import { UnifiedSkillCard } from "@/components/skill/UnifiedSkillCard";
import { SkillDetailDrawer } from "@/components/skill/SkillDetailDrawer";
import { InstallDialog } from "@/components/central/InstallDialog";
import { useDiscoverStore } from "@/stores/discoverStore";
import { usePlatformStore } from "@/stores/platformStore";
import { DiscoveredSkill, SkillWithLinks } from "@/types";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { consumeScrollPosition } from "@/lib/scrollRestoration";
import { VirtualizedList } from "@/components/ui/virtualized-list";
import { buildSearchText, normalizeSearchQuery } from "@/lib/search";

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
      <div className="p-4 rounded-full bg-muted/60">
        <Radar className="size-12 text-muted-foreground opacity-60" />
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

      <div className="flex justify-center pt-2">
        <Button variant="destructive" size="default" onClick={stopScan}>
          <StopCircle className="size-4 mr-1.5" />
          {t("discover.stopAndShow")}
        </Button>
      </div>
    </div>
  );
}

// ─── DiscoverView ─────────────────────────────────────────────────────────────

export function DiscoverView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectPath } = useParams<{ projectPath: string }>();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const detailButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Store state
  const isScanning = useDiscoverStore((s) => s.isScanning);
  const discoveredProjects = useDiscoverStore((s) => s.discoveredProjects);
  const totalSkillsFound = useDiscoverStore((s) => s.totalSkillsFound);
  const selectedSkillIds = useDiscoverStore((s) => s.selectedSkillIds);
  const loadDiscoveredSkills = useDiscoverStore((s) => s.loadDiscoveredSkills);
  const refreshDiscoverCounts = useDiscoverStore((s) => s.refreshCounts);
  const importToCentral = useDiscoverStore((s) => s.importToCentral);
  const importToPlatform = useDiscoverStore((s) => s.importToPlatform);
  const toggleSkillSelection = useDiscoverStore((s) => s.toggleSkillSelection);
  const clearSelection = useDiscoverStore((s) => s.clearSelection);
  const loadScanRoots = useDiscoverStore((s) => s.loadScanRoots);

  const agents = usePlatformStore((s) => s.agents);
  const refreshCounts = usePlatformStore((s) => s.refreshCounts);

  // Local state
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [installTargetSkill, setInstallTargetSkill] =
    useState<DiscoveredSkill | null>(null);
  const [isInstallDialogOpen, setIsInstallDialogOpen] = useState(false);
  const [drawerSkillId, setDrawerSkillId] = useState<string | null>(null);
  const [drawerFilePath, setDrawerFilePath] = useState<string | null>(null);
  const [drawerDiscoverMeta, setDrawerDiscoverMeta] = useState<{
    name: string;
    description?: string;
    platformName: string;
    projectName: string;
    filePath: string;
    dirPath: string;
    isAlreadyCentral: boolean;
  } | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const deferredSkillSearch = useDeferredValue(skillSearch);
  const restorationState = location.state?.scrollRestoration as
    | { key?: string; scrollTop?: number }
    | undefined;
  const discoverContext = location.state?.discoverContext as
    | { projectPath?: string; skillSearch?: string }
    | undefined;

  // Load persisted results on mount.
  useEffect(() => {
    loadDiscoveredSkills();
  }, [loadDiscoveredSkills]);

  useEffect(() => {
    if (discoverContext?.skillSearch !== undefined) {
      setSkillSearch(discoverContext.skillSearch);
    }
  }, [discoverContext?.skillSearch]);

  // Auto-select first project when none is selected and projects exist.
  useEffect(() => {
    if (
      !projectPath &&
      discoveredProjects.length > 0 &&
      !discoverContext?.projectPath
    ) {
      navigate(`/discover/${encodeURIComponent(discoveredProjects[0].project_path)}`, { replace: true });
    }
  }, [projectPath, discoveredProjects, navigate, discoverContext?.projectPath]);

  useEffect(() => {
    if (!projectPath || !discoverContext?.projectPath) {
      return;
    }

    const decodedPath = decodeURIComponent(projectPath);
    if (decodedPath === discoverContext.projectPath) {
      return;
    }

    navigate(`/discover/${encodeURIComponent(discoverContext.projectPath)}`, {
      replace: true,
      state: location.state,
    });
  }, [projectPath, discoverContext?.projectPath, navigate, location.state]);

  // Trimmed/normalized search queries — memoized so case-conversion doesn't
  // happen during every filter pass when the user is just clicking between
  // projects or skills.
  const normalizedProjectQuery = useMemo(
    () => normalizeSearchQuery(projectSearch),
    [projectSearch]
  );

  // Filtered project list for the left panel.
  const filteredProjectList = useMemo(() => {
    if (!normalizedProjectQuery) return discoveredProjects;
    return discoveredProjects.filter(
      (p) =>
        p.project_name.toLowerCase().includes(normalizedProjectQuery) ||
        p.project_path.toLowerCase().includes(normalizedProjectQuery)
    );
  }, [discoveredProjects, normalizedProjectQuery]);

  // Currently selected project.
  const selectedProject = useMemo(() => {
    if (!projectPath) return null;
    const decoded = decodeURIComponent(projectPath);
    return discoveredProjects.find((p) => p.project_path === decoded) ?? null;
  }, [discoveredProjects, projectPath]);
  const effectiveSkillSearch =
    selectedProject && selectedProject.skills.length > 80
      ? deferredSkillSearch
      : skillSearch;
  const normalizedSkillQuery = useMemo(
    () => normalizeSearchQuery(effectiveSkillSearch),
    [effectiveSkillSearch]
  );
  const selectedProjectSkillEntries = useMemo(
    () =>
      (selectedProject?.skills ?? []).map((skill) => ({
        skill,
        searchText: buildSearchText([skill.name, skill.description]),
      })),
    [selectedProject]
  );

  // Whether the currently selected project still matches the active project
  // filter. When it doesn't we keep the selection (valid context) but dim the
  // inactive entry rather than force-navigating away mid-typing.
  const selectedProjectMatchesFilter = useMemo(() => {
    if (!selectedProject) return true;
    if (!normalizedProjectQuery) return true;
    return (
      selectedProject.project_name.toLowerCase().includes(normalizedProjectQuery) ||
      selectedProject.project_path.toLowerCase().includes(normalizedProjectQuery)
    );
  }, [selectedProject, normalizedProjectQuery]);

  // Skills for the selected project, filtered by skill search.
  const displayedSkills = useMemo(() => {
    if (!selectedProject) return [];
    if (!normalizedSkillQuery) return selectedProject.skills;
    return selectedProjectSkillEntries
      .filter(({ searchText }) => searchText.includes(normalizedSkillQuery))
      .map(({ skill }) => skill);
  }, [normalizedSkillQuery, selectedProject, selectedProjectSkillEntries]);

  useEffect(() => {
    if (!contentRef.current) return;
    contentRef.current.scrollTop = 0;
  }, [normalizedSkillQuery, selectedProject?.project_path]);

  useEffect(() => {
    if (!selectedProject || !restorationState?.key || !contentRef.current) {
      return;
    }

    // Prefer the in-memory map (populated by SkillDetail's back handler on the
    // real list → detail → back flow). Fall back to the scroll position that
    // was passed directly via location.state so that restoration still works
    // when the list is hydrated with state intact (no stale restore over a
    // filtered list, since the effect runs after data hydration and only
    // consumes the value once).
    let scrollTop = consumeScrollPosition(restorationState.key);
    if (scrollTop === null && typeof restorationState.scrollTop === "number") {
      scrollTop = restorationState.scrollTop;
    }
    if (scrollTop === null) {
      return;
    }

    contentRef.current.scrollTop = scrollTop;
  }, [
    selectedProject,
    displayedSkills.length,
    restorationState?.key,
    restorationState?.scrollTop,
  ]);

  // Available platform agents for install dialog.
  const platformAgents = useMemo(
    () => agents.filter((a) => a.id !== "central" && a.is_enabled),
    [agents]
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleInstallToCentral = useCallback(
    async (skillId: string) => {
      setImportingIds((prev) => new Set(prev).add(skillId));
      try {
        await importToCentral(skillId);
        await Promise.all([refreshCounts(), refreshDiscoverCounts()]);
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
    },
    [importToCentral, refreshCounts, refreshDiscoverCounts, t]
  );

  const handleInstallToPlatform = useCallback((skill: DiscoveredSkill) => {
    setInstallTargetSkill(skill);
    setIsInstallDialogOpen(true);
  }, []);

  const handleBatchInstallCentral = useCallback(async () => {
    const ids = Array.from(selectedSkillIds);
    for (const id of ids) {
      await handleInstallToCentral(id);
    }
  }, [selectedSkillIds, handleInstallToCentral]);

  const handleInstallFromDialog = useCallback(
    async (_skillId: string, agentIds: string[], _method: string) => {
      if (!installTargetSkill) return;
      const targetId = installTargetSkill.id;
      setImportingIds((prev) => new Set(prev).add(targetId));
      try {
        for (const agentId of agentIds) {
          await importToPlatform(targetId, agentId);
        }
        await Promise.all([refreshCounts(), refreshDiscoverCounts()]);
        toast.success(t("discover.importSuccess"));
      } catch (err) {
        toast.error(t("discover.importError", { error: String(err) }));
      } finally {
        setImportingIds((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
        setIsInstallDialogOpen(false);
        setInstallTargetSkill(null);
      }
    },
    [installTargetSkill, importToPlatform, refreshCounts, refreshDiscoverCounts, t]
  );

  const handleRescan = useCallback(async () => {
    await loadScanRoots();
    setIsConfigOpen(true);
  }, [loadScanRoots]);

  // Selecting a project is a purely navigational event — no store rescan or
  // heavy data reload is needed, just a URL change. Keep the current skill
  // search intact so the user's filter context is preserved across projects.
  const handleSelectProject = useCallback(
    (projectPathValue: string) => {
      const encoded = encodeURIComponent(projectPathValue);
      // Short-circuit if already selected so repeated clicks don't push new
      // history entries or trigger redundant re-renders.
      if (projectPath === projectPathValue) return;
      navigate(`/discover/${encoded}`);
    },
    [navigate, projectPath]
  );

  const setDetailButtonRef = useCallback(
    (skillId: string, node: HTMLButtonElement | null) => {
      detailButtonRefs.current[skillId] = node;
    },
    []
  );

  const handleOpenDrawer = useCallback((skillId: string) => {
    setDrawerSkillId(skillId);
    setDrawerFilePath(null);
    setDrawerDiscoverMeta(null);
    setIsDrawerOpen(true);
  }, []);

  const handleOpenDiscoverDrawer = useCallback((skill: DiscoveredSkill) => {
    setDrawerSkillId(null);
    setDrawerFilePath(skill.file_path);
    setDrawerDiscoverMeta({
      name: skill.name,
      description: skill.description,
      platformName: skill.platform_name,
      projectName: skill.project_name,
      filePath: skill.file_path,
      dirPath: skill.dir_path,
      isAlreadyCentral: skill.is_already_central,
    });
    setIsDrawerOpen(true);
  }, []);

  const handleOpenProjectPath = useCallback(
    async (projectPath: string) => {
      try {
        await invoke("open_in_file_manager", { path: projectPath });
      } catch (err) {
        toast.error(t("discover.openPathError", { error: String(err) }));
      }
    },
    [t]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  // Scanning or empty — full-width content
  if (isScanning) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border px-6 py-4">
          <h1 className="text-xl font-semibold">{t("discover.resultsTitle")}</h1>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <ProgressView />
        </div>
        <DiscoverConfigDialog open={isConfigOpen} onOpenChange={setIsConfigOpen} />
      </div>
    );
  }

  if (discoveredProjects.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t("discover.resultsTitle")}</h1>
          <Button variant="outline" size="sm" onClick={handleRescan}>
            <RefreshCw className="size-3.5 mr-1" />
            {t("discover.reScan")}
          </Button>
        </div>
        <div className="flex-1">
          <EmptyState />
        </div>
        <DiscoverConfigDialog open={isConfigOpen} onOpenChange={setIsConfigOpen} />
      </div>
    );
  }

  // ── Master-Detail Layout ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("discover.resultsTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("discover.foundSummary", {
              skills: totalSkillsFound,
              projects: discoveredProjects.length,
            })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRescan}>
          <RefreshCw className="size-3.5 mr-1" />
          {t("discover.reScan")}
        </Button>
      </div>

      {/* Master-Detail body */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left Panel: Project List (240px) ─────────────────────────────── */}
        <div className="w-60 shrink-0 border-r border-border flex flex-col">
          {/* Project search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t("discover.projectSearchPlaceholder")}
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                aria-label={t("discover.projectSearchPlaceholder")}
                className="pl-7 pr-7 h-7 text-xs bg-muted/40"
              />
              {projectSearch.length > 0 && (
                <button
                  type="button"
                  onClick={() => setProjectSearch("")}
                  aria-label={t("discover.clearSearch")}
                  title={t("discover.clearSearch")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          {/* Project list */}
          <div className="flex-1 overflow-y-auto py-1">
            {filteredProjectList.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-3 py-6 text-center">
                <p className="text-xs text-muted-foreground">
                  {t("discover.noProjectMatch", { query: projectSearch })}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setProjectSearch("")}
                  className="h-7 text-xs"
                >
                  <X className="size-3 mr-1" />
                  {t("discover.clearSearch")}
                </Button>
              </div>
            ) : (
              filteredProjectList.map((project) => {
                const isActive = selectedProject?.project_path === project.project_path;
                return (
                  <button
                    key={project.project_path}
                    onClick={() => handleSelectProject(project.project_path)}
                    title={project.project_path}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2 text-left transition-colors cursor-pointer border-l-2 rounded-md",
                      isActive
                        ? "bg-primary/15 border-primary text-foreground font-medium"
                        : "hover:bg-muted/40 border-transparent text-muted-foreground"
                    )}
                  >
                    <Folder className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-sm truncate flex-1">{project.project_name}</span>
                    <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
                      {project.skills.length}
                    </span>
                  </button>
                );
              })
            )}
            {/* Inactive-but-selected helper: when filter hides the current selection,
                still show it at the bottom so the user keeps project context. */}
            {selectedProject && !selectedProjectMatchesFilter && (
              <div className="mt-2 pt-2 px-2 border-t border-border/60 space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 px-1">
                  {t("discover.title")}
                </p>
                <button
                  onClick={() => handleSelectProject(selectedProject.project_path)}
                  title={selectedProject.project_path}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left transition-colors cursor-pointer border-l-2 rounded-md bg-primary/10 border-primary/60 text-foreground font-medium"
                >
                  <Folder className="size-3.5 shrink-0 text-primary" />
                  <span className="text-sm truncate flex-1">{selectedProject.project_name}</span>
                  <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
                    {selectedProject.skills.length}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Panel: Skills for selected project ─────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedProject ? (
            <>
              {/* Project header + skill search */}
              <div className="px-6 py-3 border-b border-border flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold truncate">{selectedProject.project_name}</h2>
                  <button
                    type="button"
                    onClick={() => handleOpenProjectPath(selectedProject.project_path)}
                    className="text-xs text-muted-foreground truncate hover:text-primary hover:underline cursor-pointer text-left block max-w-full"
                    title={t("discover.openInFileManager")}
                  >
                    {selectedProject.project_path}
                  </button>
                </div>
                <div className="relative w-48 shrink-0">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder={t("discover.skillSearchPlaceholder")}
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    aria-label={t("discover.skillSearchPlaceholder")}
                    className="pl-7 pr-7 h-7 text-xs bg-muted/40"
                  />
                  {skillSearch.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSkillSearch("")}
                      aria-label={t("discover.clearSearch")}
                      title={t("discover.clearSearch")}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {t("collection.skills", { count: displayedSkills.length })}
                </span>
              </div>

              {/* Skill cards */}
              <div ref={contentRef} className="flex-1 overflow-auto p-4">
                {displayedSkills.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
                    <Radar className="size-8 text-muted-foreground opacity-40" />
                    <p className="text-sm text-muted-foreground">
                      {normalizedSkillQuery
                        ? t("discover.noMatch", { query: skillSearch })
                        : t("discover.noResults")}
                    </p>
                    {normalizedSkillQuery && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSkillSearch("")}
                        className="h-7 text-xs"
                      >
                        <X className="size-3 mr-1" />
                        {t("discover.clearSearch")}
                      </Button>
                    )}
                  </div>
                ) : displayedSkills.length > 80 ? (
                  <VirtualizedList
                    items={displayedSkills}
                    itemHeight={120}
                    itemGap={8}
                    overscan={6}
                    scrollContainerRef={contentRef}
                    itemKey={(skill) => skill.id}
                    renderItem={(skill) => (
                      <UnifiedSkillCard
                        key={skill.id}
                        name={skill.name}
                        description={skill.description}
                        checkbox={{
                          checked: selectedSkillIds.has(skill.id),
                          onChange: () => toggleSkillSelection(skill.id),
                        }}
                        isCentral={skill.is_already_central}
                        platformBadge={{ id: skill.platform_id, name: skill.platform_name }}
                        projectBadge={skill.project_name}
                        onDetail={
                          skill.is_already_central
                            ? () => handleOpenDrawer(skill.dir_path.split("/").pop() ?? skill.id)
                            : () => handleOpenDiscoverDrawer(skill)
                        }
                        detailButtonRef={(node) => setDetailButtonRef(
                          skill.is_already_central
                            ? (skill.dir_path.split("/").pop() ?? skill.id)
                            : skill.id,
                          node,
                        )}
                        onInstallToCentral={() => handleInstallToCentral(skill.id)}
                        onInstallToPlatform={() => handleInstallToPlatform(skill)}
                        isLoading={importingIds.has(skill.id)}
                        className="h-[120px]"
                      />
                    )}
                  />
                ) : (
                  <div className="space-y-2">
                    {displayedSkills.map((skill) => (
                      <UnifiedSkillCard
                        key={skill.id}
                        name={skill.name}
                        description={skill.description}
                        checkbox={{
                          checked: selectedSkillIds.has(skill.id),
                          onChange: () => toggleSkillSelection(skill.id),
                        }}
                        isCentral={skill.is_already_central}
                        platformBadge={{ id: skill.platform_id, name: skill.platform_name }}
                        projectBadge={skill.project_name}
                        onDetail={
                          skill.is_already_central
                            ? () => handleOpenDrawer(skill.dir_path.split("/").pop() ?? skill.id)
                            : () => handleOpenDiscoverDrawer(skill)
                        }
                        detailButtonRef={(node) => setDetailButtonRef(
                          skill.is_already_central
                            ? (skill.dir_path.split("/").pop() ?? skill.id)
                            : skill.id,
                          node,
                        )}
                        onInstallToCentral={() => handleInstallToCentral(skill.id)}
                        onInstallToPlatform={() => handleInstallToPlatform(skill)}
                        isLoading={importingIds.has(skill.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              <Radar className="size-5 mr-2 opacity-40" />
              {t("discover.noResults")}
            </div>
          )}
        </div>
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

      <SkillDetailDrawer
        open={isDrawerOpen}
        skillId={drawerSkillId}
        filePath={drawerFilePath}
        discoverMetadata={drawerDiscoverMeta}
        onOpenChange={(open) => {
          setIsDrawerOpen(open);
          if (!open) {
            setDrawerSkillId(null);
            setDrawerFilePath(null);
            setDrawerDiscoverMeta(null);
          }
        }}
        returnFocusRef={
          (drawerSkillId || drawerFilePath)
            ? {
                current: detailButtonRefs.current[drawerSkillId ?? ""] ?? null,
              }
            : undefined
        }
      />
    </div>
  );
}
