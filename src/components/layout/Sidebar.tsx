import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Loader2,
  Blocks,
  Layers,
  Radar,
  Store,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PlatformIcon } from "@/components/platform/PlatformIcon";
import { usePlatformStore } from "@/stores/platformStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { useDiscoverStore } from "@/stores/discoverStore";
import { cn } from "@/lib/utils";

// ─── Nav Item ────────────────────────────────────────────────────────────────

function NavItem({
  label,
  isActive,
  onClick,
  icon,
  expanded,
  count,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  expanded: boolean;
  count?: number;
}) {
  return (
    <div className="relative">
      <button
        onClick={onClick}
        title={label}
        aria-label={label}
        className={cn(
          "flex items-center w-full rounded-md transition-colors cursor-pointer",
          !isActive && "hover:bg-primary/15 hover:text-primary",
          isActive && "bg-hover-bg text-white",
          expanded ? "gap-2.5 px-2.5 py-1.5 text-sm" : "justify-center py-2 px-1.5"
        )}
      >
        <span className="shrink-0">{icon}</span>
        {expanded && (
          <>
            <span className="truncate flex-1 text-left">{label}</span>
            {count !== undefined && count > 0 && (
              <span className={cn(
                "text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-full shrink-0",
                isActive
                  ? "bg-white/20 text-white"
                  : "bg-muted/60 text-muted-foreground"
              )}>
                {count}
              </span>
            )}
          </>
        )}
      </button>
      {isActive && (
        <span
          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-white"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const SHOW_ALL_PLATFORMS_KEY = "skills-manage:show-all-platforms";
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { agents, skillsByAgent, isLoading } = usePlatformStore();

  const collections = useCollectionStore((s) => s.collections);
  const loadCollections = useCollectionStore((s) => s.loadCollections);

  const totalDiscovered = useDiscoverStore((s) => s.totalSkillsFound);
  const loadDiscoveredSkills = useDiscoverStore((s) => s.loadDiscoveredSkills);

  const [expanded, setExpanded] = useState(true);
  const [showAllPlatforms, setShowAllPlatforms] = useState(() => {
    try {
      return window.localStorage.getItem(SHOW_ALL_PLATFORMS_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    loadCollections();
    loadDiscoveredSkills();
  }, [loadCollections, loadDiscoveredSkills]);

  function toggleShowAllPlatforms() {
    setShowAllPlatforms((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(SHOW_ALL_PLATFORMS_KEY, String(next));
      } catch {
        // Ignore storage failures and keep the in-memory preference.
      }
      return next;
    });
  }

  const platformAgents = agents.filter(
    (a) =>
      a.id !== "central" &&
      a.is_enabled &&
      (showAllPlatforms || (skillsByAgent[a.id] ?? 0) > 0)
  );
  const lobsterAgents = platformAgents.filter((a) => a.category === "lobster");
  const codingAgents = platformAgents.filter((a) => a.category !== "lobster");

  const isCollectionActive = pathname === "/collections";

  function handleCollectionClick() {
    navigate("/collections");
  }

  return (
    <nav
      className={cn(
        "flex flex-col shrink-0 h-full border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        expanded ? "w-52" : "w-14"
      )}
      aria-label={t("sidebar.mainNav")}
    >
      {/* Toggle button */}
      <div
        className={cn(
          "flex items-center border-b border-border",
          expanded ? "justify-between px-3 py-2" : "justify-center py-2"
        )}
      >
        {expanded && (
          <span className="text-sm font-bold tracking-tight text-sidebar-primary">
            {t("app.name")}
          </span>
        )}
        <button
          onClick={() => setExpanded((e) => !e)}
          className={cn(
            "p-1 rounded-md transition-colors cursor-pointer",
            "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
          aria-label={expanded ? t("sidebar.collapseSidebar") : t("sidebar.expandSidebar")}
          title={expanded ? t("sidebar.collapseSidebar") : t("sidebar.expandSidebar")}
        >
          {expanded ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
      </div>

      {/* Scrollable nav items */}
      <div className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
        {/* Central Skills */}
        <NavItem
          label={t("sidebar.centralSkills")}
          isActive={pathname === "/central" || pathname === "/"}
          onClick={() => navigate("/central")}
          icon={<Blocks className="size-4" />}
          expanded={expanded}
          count={skillsByAgent["central"]}
        />

        {/* Discover */}
        <NavItem
          label={t("sidebar.discovered")}
          isActive={pathname.startsWith("/discover")}
          onClick={() => navigate("/discover")}
          icon={<Radar className="size-4" />}
          expanded={expanded}
          count={totalDiscovered}
        />

        {/* Marketplace */}
        <NavItem
          label={t("marketplace.title")}
          isActive={pathname === "/marketplace"}
          onClick={() => navigate("/marketplace")}
          icon={<Store className="size-4" />}
          expanded={expanded}
        />

        {/* Collections */}
        <NavItem
          label={t("sidebar.collections")}
          isActive={isCollectionActive}
          onClick={handleCollectionClick}
          icon={<Layers className="size-4" />}
          expanded={expanded}
          count={collections.length}
        />

        {/* Divider */}
        <div className="border-t border-sidebar-border/70 my-2" />

        {/* Platform icons */}
        {isLoading ? (
          <div className={cn(
            "flex items-center py-2 text-muted-foreground text-sm",
            expanded ? "gap-2 px-2.5" : "justify-center"
          )}>
            <Loader2 className="size-4 animate-spin shrink-0" />
            {expanded && <span>{t("sidebar.scanning")}</span>}
          </div>
        ) : (
          <>
            {/* Lobster agents */}
            {lobsterAgents.length > 0 && (
              <>
                {expanded ? (
                  <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider px-2.5 pt-2 pb-1">
                    {t("sidebar.categoryLobster")}
                  </div>
                ) : (
                  <div className="border-t border-sidebar-border/40 my-1.5" />
                )}
                {lobsterAgents.map((agent) => (
                  <NavItem
                    key={agent.id}
                    label={agent.display_name}
                    isActive={pathname === `/platform/${agent.id}`}
                    onClick={() => navigate(`/platform/${agent.id}`)}
                    icon={<PlatformIcon agentId={agent.id} className="size-4" />}
                    expanded={expanded}
                    count={skillsByAgent[agent.id]}
                  />
                ))}
              </>
            )}

            {/* Coding agents */}
            {codingAgents.length > 0 && (
              <>
                {expanded ? (
                  <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider px-2.5 pt-2 pb-1">
                    {t("sidebar.categoryCoding")}
                  </div>
                ) : (
                  <div className="border-t border-sidebar-border/40 my-1.5" />
                )}
                {codingAgents.map((agent) => (
                  <NavItem
                    key={agent.id}
                    label={agent.display_name}
                    isActive={pathname === `/platform/${agent.id}`}
                    onClick={() => navigate(`/platform/${agent.id}`)}
                    icon={<PlatformIcon agentId={agent.id} className="size-4" />}
                    expanded={expanded}
                    count={skillsByAgent[agent.id]}
                  />
                ))}
              </>
            )}
          </>
        )}

        {!isLoading && (
          <div className={cn(
            "pt-2",
            expanded ? "px-1" : "flex justify-center"
          )}>
            <button
              onClick={toggleShowAllPlatforms}
              title={showAllPlatforms ? t("sidebar.hideEmptyPlatforms") : t("sidebar.showAllPlatforms")}
              aria-label={showAllPlatforms ? t("sidebar.hideEmptyPlatforms") : t("sidebar.showAllPlatforms")}
              className={cn(
                "cursor-pointer rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary",
                expanded
                  ? "flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-left"
                  : "p-2"
              )}
            >
              {showAllPlatforms ? <EyeOff className="size-4 shrink-0" /> : <Eye className="size-4 shrink-0" />}
              {expanded && (
                <span className="truncate">
                  {showAllPlatforms ? t("sidebar.hideEmptyPlatforms") : t("sidebar.showAllPlatforms")}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

    </nav>
  );
}
