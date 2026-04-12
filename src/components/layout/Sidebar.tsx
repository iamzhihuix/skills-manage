import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Settings,
  Plus,
  Loader2,
  Upload,
  PackageOpen,
  Folder,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PlatformIcon } from "@/components/platform/PlatformIcon";
import { usePlatformStore } from "@/stores/platformStore";
import { useCollectionStore } from "@/stores/collectionStore";
import { CollectionEditor } from "@/components/collection/CollectionEditor";
import { cn } from "@/lib/utils";

// Auto-collapse threshold in pixels
const COLLAPSE_THRESHOLD = 1024;

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({
  count,
  variant = "muted",
}: {
  count: number;
  variant?: "muted" | "primary";
}) {
  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded-full text-xs px-1.5 py-0.5 min-w-[1.25rem] text-center leading-tight font-medium",
        variant === "primary"
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground"
      )}
    >
      {count}
    </span>
  );
}

// ─── Nav Item ─────────────────────────────────────────────────────────────────

function NavItem({
  label,
  badge,
  isActive,
  onClick,
  badgeVariant = "muted",
  icon,
  collapsed = false,
}: {
  label: string;
  badge?: number;
  isActive: boolean;
  onClick: () => void;
  badgeVariant?: "muted" | "primary";
  icon?: React.ReactNode;
  collapsed?: boolean;
}) {
  if (collapsed && icon) {
    return (
      <div className="relative">
        <button
          onClick={onClick}
          title={label}
          aria-label={label}
          className={cn(
            "flex items-center justify-center w-full py-2 rounded-md transition-colors",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          )}
        >
          {icon}
        </button>
        {isActive && (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-sidebar-primary"
            aria-hidden="true"
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={onClick}
        className={cn(
          "flex items-center w-full px-3 py-1.5 text-sm rounded-md mx-1 transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isActive &&
            "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        )}
        style={{ width: "calc(100% - 0.5rem)" }}
      >
        {icon && <span className="mr-2 shrink-0">{icon}</span>}
        <span className="truncate">{label}</span>
        {badge !== undefined && (
          <Badge count={badge} variant={badgeVariant} />
        )}
      </button>
      {isActive && (
        <span
          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-sidebar-primary"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  label,
  action,
  collapsed = false,
}: {
  label: string;
  action?: React.ReactNode;
  collapsed?: boolean;
}) {
  if (collapsed) return null;

  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-widest">
        {label}
      </span>
      {action}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { agents, skillsByAgent, isLoading } = usePlatformStore();

  const collections = useCollectionStore((s) => s.collections);
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const importCollection = useCollectionStore((s) => s.importCollection);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  // Start expanded; auto-collapse is applied after mount via resize listener
  const [collapsed, setCollapsed] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Load collections on mount.
  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  // Auto-collapse when window is narrow.
  useEffect(() => {
    // Initial check after mount
    setCollapsed(window.innerWidth < COLLAPSE_THRESHOLD);

    function handleResize() {
      setCollapsed(window.innerWidth < COLLAPSE_THRESHOLD);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Separate platform agents from the central one.
  const platformAgents = agents.filter(
    (a) => a.id !== "central" && a.is_enabled
  );
  const centralCount = skillsByAgent["central"] ?? 0;

  // Handle JSON file import for collections.
  function handleImportClick() {
    importInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const collection = await importCollection(text);
      navigate(`/collection/${collection.id}`);
    } catch (err) {
      console.error("Import failed:", err);
    } finally {
      // Reset input so the same file can be imported again.
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  // Check if we're on a collection route
  const isCollectionActive = pathname.startsWith("/collection/");

  return (
    <nav
      className={cn(
        "flex flex-col shrink-0 h-full border-r border-border bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-14" : "w-60"
      )}
      aria-label={t("sidebar.mainNav")}
      data-collapsed={collapsed}
    >
      {/* App header */}
      <div
        className={cn(
          "border-b border-border flex items-center",
          collapsed ? "px-2 py-3 justify-center" : "px-4 py-3 justify-between"
        )}
      >
        {!collapsed && (
          <h1 className="text-sm font-bold tracking-tight text-sidebar-primary">{t("app.name")}</h1>
        )}
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
          aria-label={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
          title={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </button>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto py-3 space-y-4">
        {/* ── By Tool ─────────────────────────────────────────── */}
        <section aria-label={t("sidebar.byTool")} className="pb-2 border-b border-sidebar-border/70">
          <SectionHeader label={t("sidebar.byTool")} collapsed={collapsed} />
          {isLoading ? (
            <div className={cn(
              "flex items-center py-2 text-muted-foreground text-sm",
              collapsed ? "justify-center px-1" : "gap-2 px-3"
            )}>
              <Loader2 className="size-3.5 animate-spin" />
              {!collapsed && <span>{t("sidebar.scanning")}</span>}
            </div>
          ) : platformAgents.length === 0 ? (
            !collapsed && (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">
                {t("sidebar.noPlatforms")}
              </p>
            )
          ) : (
            <div className={cn(collapsed ? "px-1 space-y-0.5" : "")}>
              {platformAgents.map((agent) => (
                <NavItem
                  key={agent.id}
                  label={agent.display_name}
                  badge={!collapsed ? (skillsByAgent[agent.id] ?? 0) : undefined}
                  isActive={pathname === `/platform/${agent.id}`}
                  onClick={() => navigate(`/platform/${agent.id}`)}
                  icon={<PlatformIcon agentId={agent.id} className="size-4" />}
                  collapsed={collapsed}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Central Skills ───────────────────────────────────── */}
        <section aria-label={t("sidebar.centralSkills")} className="pb-2 border-b border-sidebar-border/70">
          {collapsed ? (
            <div className="px-1">
              <NavItem
                label={t("sidebar.centralSkills")}
                isActive={pathname === "/central"}
                onClick={() => navigate("/central")}
                icon={<PackageOpen className="size-4" />}
                collapsed={collapsed}
              />
            </div>
          ) : (
            <NavItem
              label={t("sidebar.centralSkills")}
              badge={isLoading ? undefined : centralCount}
              isActive={pathname === "/central"}
              onClick={() => navigate("/central")}
              badgeVariant="primary"
            />
          )}
        </section>

        {/* ── Collections ──────────────────────────────────────── */}
        <section aria-label={t("sidebar.collections")}>
          <SectionHeader
            label={t("sidebar.collections")}
            collapsed={collapsed}
            action={
              !collapsed ? (
                <div className="flex items-center gap-0.5">
                  {/* Import button */}
                  <button
                    className="p-0.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-accent-foreground transition-colors"
                    onClick={handleImportClick}
                    aria-label={t("sidebar.importCollection")}
                    title={t("sidebar.importCollection")}
                  >
                    <Upload className="size-3.5" />
                  </button>
                  {/* Create new collection button */}
                  <button
                    className="p-0.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-accent-foreground transition-colors"
                    onClick={() => setIsEditorOpen(true)}
                    aria-label={t("sidebar.newCollectionLabel")}
                    title={t("sidebar.newCollectionLabel")}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              ) : undefined
            }
          />

          {collapsed ? (
            /* Collapsed: show a single collections icon */
            <div className="px-1">
              <NavItem
                label={t("sidebar.collections")}
                isActive={isCollectionActive}
                onClick={() => {
                  if (collections.length > 0) {
                    navigate(`/collection/${collections[0].id}`);
                  } else {
                    setIsEditorOpen(true);
                  }
                }}
                icon={<Folder className="size-4" />}
                collapsed={collapsed}
              />
            </div>
          ) : (
            /* Expanded: show full collection list */
            <>
              {collections.length === 0 ? (
                <div className="px-3 py-1">
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setIsEditorOpen(true)}
                  >
                    {t("sidebar.newCollection")}
                  </button>
                </div>
              ) : (
                <>
                  {collections.map((col) => (
                    <NavItem
                      key={col.id}
                      label={col.name}
                      isActive={pathname === `/collection/${col.id}`}
                      onClick={() => navigate(`/collection/${col.id}`)}
                    />
                  ))}
                  <div className="px-3 py-1">
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setIsEditorOpen(true)}
                    >
                      {t("sidebar.newCollection")}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* Hidden file input for JSON import */}
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
            aria-label={t("sidebar.importCollectionInput")}
          />
        </section>
      </div>

      {/* Settings pinned at bottom */}
      <div className="border-t border-sidebar-border p-2">
        <div className="relative">
          <button
            onClick={() => navigate("/settings")}
            className={cn(
              "flex items-center w-full rounded-md transition-colors text-sm",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              pathname === "/settings" &&
                "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
              collapsed ? "justify-center py-2" : "gap-2 px-3 py-1.5"
            )}
            title={collapsed ? t("sidebar.settings") : undefined}
            aria-label={t("sidebar.settings")}
          >
            <Settings className="size-4" />
            {!collapsed && <span>{t("sidebar.settings")}</span>}
          </button>
          {pathname === "/settings" && (
            <span
              className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-sidebar-primary"
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {/* Create Collection dialog */}
      <CollectionEditor
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        collection={null}
      />
    </nav>
  );
}
