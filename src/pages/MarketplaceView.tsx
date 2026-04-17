import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Store,
  RefreshCw,
  Loader2,
  Download,
  Check,
  ChevronLeft,
  Folder,
  FileText,
  AlertCircle,
  Clock3,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UnifiedSkillCard } from "@/components/skill/UnifiedSkillCard";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { usePlatformStore } from "@/stores/platformStore";
import { SkillRegistry } from "@/types";
import {
  OFFICIAL_PUBLISHERS,
  RECOMMENDED_SKILLS,
  ALL_TAGS,
  TAG_LABELS,
  OfficialPublisher,
  SkillTag,
  RecommendedSkill,
} from "@/data/officialSources";
import { MarketplaceSkillDetailDrawer, type MarketplaceSkillDetail } from "@/components/marketplace/MarketplaceSkillDetailDrawer";
import { GitHubRepoImportWizard } from "@/components/marketplace/GitHubRepoImportWizard";
import { isTauriRuntime } from "@/lib/tauri";
import { cn } from "@/lib/utils";

type TabId = "recommended" | "official" | "my-sources";

type DuplicateRegistryDetails = {
  id: string;
  name: string;
  url: string;
  isBuiltin: boolean;
};

type PreviewStatus =
  | { kind: "idle" }
  | { kind: "browser-fallback"; title: string; detail: string }
  | { kind: "error"; title: string; detail: string };

function parseDuplicateRegistryError(error: unknown): DuplicateRegistryDetails | null {
  const message = String(error);
  if (!message.startsWith("Error: DUPLICATE_REGISTRY:") && !message.startsWith("DUPLICATE_REGISTRY:")) {
    return null;
  }

  const payload = message.replace(/^Error:\s*/, "").replace("DUPLICATE_REGISTRY:", "");
  try {
    return JSON.parse(payload) as DuplicateRegistryDetails;
  } catch {
    return null;
  }
}

function formatRelativeTime(value: string | null | undefined, lang: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const diffMs = parsed.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(lang === "zh" ? "zh-CN" : "en", {
    numeric: "auto",
  });

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];

  for (const [unit, unitMs] of units) {
    if (Math.abs(diffMs) >= unitMs || unit === "minute") {
      return rtf.format(Math.round(diffMs / unitMs), unit);
    }
  }

  return null;
}

function formatTimestamp(value: string | null | undefined, lang: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function getRegistryStatusCopy(registry: SkillRegistry | null, lang: string) {
  if (!registry) return null;

  const status = registry.last_sync_status ?? "never";
  if (status === "error") {
    return {
      tone: "error" as const,
      label: lang === "zh" ? "刷新失败，正在显示缓存" : "Refresh failed, showing cached data",
      detail:
        registry.last_sync_error ??
        (lang === "zh" ? "可以稍后再次尝试强制刷新。" : "You can retry with force refresh."),
    };
  }

  if (registry.cache_updated_at || registry.last_synced) {
    const relative = formatRelativeTime(registry.cache_updated_at ?? registry.last_synced, lang);
    return {
      tone: "default" as const,
      label:
        lang === "zh"
          ? `缓存可用${relative ? ` · ${relative}` : ""}`
          : `Cached${relative ? ` · ${relative}` : ""}`,
      detail:
        registry.cache_updated_at || registry.last_synced
          ? formatTimestamp(registry.cache_updated_at ?? registry.last_synced, lang)
          : null,
    };
  }

  return {
    tone: "default" as const,
    label: lang === "zh" ? "尚未同步" : "Not synced yet",
    detail: lang === "zh" ? "首次浏览时会拉取并缓存技能列表。" : "The first browse will fetch and cache the skill list.",
  };
}

// ─── Registry Chip ───────────────────────────────────────────────────────────

function RegistryChip({
  registry,
  isActive,
  onClick,
}: {
  registry: SkillRegistry;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-md border transition-colors cursor-pointer shrink-0",
        isActive
          ? "bg-primary/15 border-primary text-foreground font-medium"
          : "border-border hover:border-primary/40 hover:bg-hover-bg/10 text-muted-foreground"
      )}
    >
      <Store className={cn("size-4", isActive ? "text-primary" : "text-muted-foreground")} />
      <span className="text-sm truncate max-w-[140px]">{registry.name}</span>
    </button>
  );
}

// ─── Publisher Card ──────────────────────────────────────────────────────────

function PublisherCard({
  publisher,
  onClick,
}: {
  publisher: OfficialPublisher;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full p-3 rounded-md border border-border hover:border-primary/40 hover:bg-hover-bg/10 transition-colors cursor-pointer text-left"
    >
      <div className="p-2 rounded-md bg-muted/60 shrink-0">
        <Store className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{publisher.name}</div>
        <div className="text-xs text-muted-foreground">{publisher.totalSkills} skills · {publisher.repos.length} repo{publisher.repos.length > 1 ? "s" : ""}</div>
      </div>
      <ChevronLeft className="size-4 text-muted-foreground rotate-180 shrink-0" />
    </button>
  );
}

// ─── MarketplaceView ─────────────────────────────────────────────────────────

export function MarketplaceView() {
  const { t } = useTranslation();
  const lang = i18n.language;

  // Store
  const registries = useMarketplaceStore((s) => s.registries);
  const skills = useMarketplaceStore((s) => s.skills);
  const selectedRegistryId = useMarketplaceStore((s) => s.selectedRegistryId);
  const searchQuery = useMarketplaceStore((s) => s.searchQuery);
  const isLoading = useMarketplaceStore((s) => s.isLoading);
  const isSyncing = useMarketplaceStore((s) => s.isSyncing);
  const installingIds = useMarketplaceStore((s) => s.installingIds);
  const loadRegistries = useMarketplaceStore((s) => s.loadRegistries);
  const selectRegistry = useMarketplaceStore((s) => s.selectRegistry);
  const setSearchQuery = useMarketplaceStore((s) => s.setSearchQuery);
  const syncRegistry = useMarketplaceStore((s) => s.syncRegistry);
  const loadPreviewSkills = useMarketplaceStore((s) => s.loadPreviewSkills);
  const installSkill = useMarketplaceStore((s) => s.installSkill);
  const addRegistry = useMarketplaceStore((s) => s.addRegistry);
  const removeRegistry = useMarketplaceStore((s) => s.removeRegistry);
  const findDuplicateRegistry = useMarketplaceStore((s) => s.findDuplicateRegistry);
  const marketplaceError = useMarketplaceStore((s) => s.error);
  const githubImport = useMarketplaceStore((s) => s.githubImport);
  const previewGitHubRepoImport = useMarketplaceStore((s) => s.previewGitHubRepoImport);
  const importGitHubRepoSkills = useMarketplaceStore((s) => s.importGitHubRepoSkills);
  const resetGitHubImport = useMarketplaceStore((s) => s.resetGitHubImport);

  const rescan = usePlatformStore((s) => s.rescan);

  // Local state
  const [activeTab, setActiveTab] = useState<TabId>("recommended");
  const [selectedTag, setSelectedTag] = useState<SkillTag | null>(null);
  const [recommendedSearch, setRecommendedSearch] = useState("");
  const [selectedPublisher, setSelectedPublisher] = useState<OfficialPublisher | null>(null);
  const [publisherSearch, setPublisherSearch] = useState("");
  const [recommendedInstallingIds, setRecommendedInstallingIds] = useState<Set<string>>(new Set());
  const [addingRepos, setAddingRepos] = useState<Set<string>>(new Set());
  const [removingRegistryIds, setRemovingRegistryIds] = useState<Set<string>>(new Set());

  // Preview state — inline skills preview in Official Directory
  interface PreviewSkill { id: string; name: string; description?: string; downloadUrl: string }
  const [previewRepo, setPreviewRepo] = useState<string | null>(null); // repo fullName
  const [previewSkills, setPreviewSkills] = useState<PreviewSkill[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewInstallingIds, setPreviewInstallingIds] = useState<Set<string>>(new Set());
  const [detailSkill, setDetailSkill] = useState<MarketplaceSkillDetail | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>({ kind: "idle" });
  const [isGitHubImportOpen, setIsGitHubImportOpen] = useState(false);
  const [githubRepoUrl, setGitHubRepoUrl] = useState("");
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    loadRegistries();
  }, [loadRegistries]);

  useEffect(() => {
    if (activeTab === "my-sources" && !selectedRegistryId && registries.length > 0) {
      selectRegistry(registries[0].id);
    }
  }, [activeTab, selectedRegistryId, registries, selectRegistry]);

  const selectedRegistryObj = useMemo(
    () => registries.find((r) => r.id === selectedRegistryId) ?? null,
    [registries, selectedRegistryId]
  );

  const selectedRegistryStatus = useMemo(
    () => getRegistryStatusCopy(selectedRegistryObj, lang),
    [selectedRegistryObj, lang]
  );

  // Recommended skills filtered by tag and search
  const filteredRecommended = useMemo(() => {
    let list = RECOMMENDED_SKILLS;
    if (selectedTag) {
      list = list.filter((s) => s.tags.includes(selectedTag));
    }
    if (recommendedSearch.trim()) {
      const q = recommendedSearch.toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.publisher.toLowerCase().includes(q)
      );
    }
    return list;
  }, [selectedTag, recommendedSearch]);

  // Publishers filtered by search
  const filteredPublishers = useMemo(() => {
    if (!publisherSearch.trim()) return OFFICIAL_PUBLISHERS;
    const q = publisherSearch.toLowerCase();
    return OFFICIAL_PUBLISHERS.filter((p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
  }, [publisherSearch]);

  // Check if a repo is already added as a registry
  const addedRepoUrls = useMemo(() => {
    return new Set(registries.map((r) => r.url));
  }, [registries]);

  const mySourceRows = useMemo(
    () =>
      registries.map((registry) => {
        const duplicateOfficial = OFFICIAL_PUBLISHERS.some((publisher) =>
          publisher.repos.some(
            (repo) => findDuplicateRegistry(repo.url)?.id === registry.id && repo.url !== registry.url
          )
        );

        return {
          registry,
          duplicateOfficial,
        };
      }),
    [findDuplicateRegistry, registries]
  );

  // ── Handlers ───────────────────────────────────────────────────────────

  async function handleInstallRecommended(skill: RecommendedSkill) {
    // Check if the source repo is already added
    const repoUrl = `https://github.com/${skill.repoFullName}`;
    if (!addedRepoUrls.has(repoUrl)) {
      // Add the source first, then switch to My Sources tab
      setRecommendedInstallingIds((prev) => new Set(prev).add(skill.name));
      try {
        const name = skill.repoFullName.split("/").pop() ?? skill.repoFullName;
        const reg = await addRegistry(name, "github", repoUrl);
        await syncRegistry(reg.id);
        selectRegistry(reg.id);
        setActiveTab("my-sources");
        toast.success(lang === "zh" ? `已添加源 ${skill.repoFullName}，请在技能列表中安装` : `Source ${skill.repoFullName} added. Install from the skill list.`);
      } catch (err) {
        toast.error(String(err));
      } finally {
        setRecommendedInstallingIds((prev) => {
          const next = new Set(prev);
          next.delete(skill.name);
          return next;
        });
      }
      return;
    }
    // Source already added — find the registry and switch to it
    const reg = registries.find((r) => r.url === repoUrl);
    if (reg) {
      selectRegistry(reg.id);
      setActiveTab("my-sources");
    }
  }

  async function handleInstallFromSource(skillId: string) {
    try {
      await installSkill(skillId);
      await rescan();
      setDetailSkill((current) =>
        current && current.id === skillId ? { ...current, installed: true } : current
      );
      toast.success(t("marketplace.installSuccess"));
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function handleSync(forceRefresh = false) {
    if (!selectedRegistryId) return;
    try {
      await syncRegistry(selectedRegistryId, forceRefresh);
      if (forceRefresh) {
        toast.success(
          lang === "zh"
            ? "已更新缓存内容"
            : "Marketplace cache updated"
        );
      }
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function handlePreviewRepo(repoFullName: string, repoUrl: string) {
    if (previewRepo === repoFullName) {
      setPreviewRepo(null); // toggle off
      setPreviewStatus({ kind: "idle" });
      return;
    }
    setPreviewRepo(repoFullName);
    setPreviewSkills([]);
    setPreviewStatus({ kind: "idle" });
    setIsPreviewLoading(true);
    try {
      if (!isTauriRuntime()) {
        setPreviewStatus({
          kind: "browser-fallback",
          title:
            lang === "zh"
              ? "浏览器模式下暂不支持预览"
              : "Preview unavailable in browser mode",
          detail:
            lang === "zh"
              ? "请在桌面应用中打开此流程，以浏览并安装仓库里的技能。"
              : "Open this flow in the desktop app to browse and install repository skills.",
        });
        return;
      }

      let registryId = registries.find((registry) => registry.url === repoUrl)?.id;

      if (!registryId) {
        const repoName = repoFullName.split("/").pop() ?? repoFullName;
        const addedRegistry = await addRegistry(repoName, "github", repoUrl);
        registryId = addedRegistry.id;
        await loadRegistries();
      }

      await syncRegistry(registryId);
      const skills = await loadPreviewSkills(registryId);
      setPreviewSkills(
        skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description ?? undefined,
          downloadUrl: skill.download_url,
        }))
      );
    } catch (err) {
      setPreviewStatus({
        kind: "error",
        title: lang === "zh" ? "预览加载失败" : "Failed to load preview",
        detail: String(err),
      });
      toast.error(String(err));
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function handleInstallPreviewSkill(skill: PreviewSkill) {
    setPreviewInstallingIds((prev) => new Set(prev).add(skill.name));
    try {
      // Download SKILL.md and write to central dir via Tauri FS plugin
      const resp = await fetch(skill.downloadUrl);
      if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
      const content = await resp.text();

      // Write via the Tauri FS plugin
      const { writeTextFile, mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      const skillDir = `.agents/skills/${skill.name}`;
      await mkdir(skillDir, { baseDir: BaseDirectory.Home, recursive: true });
      await writeTextFile(`${skillDir}/SKILL.md`, content, { baseDir: BaseDirectory.Home });

      await rescan();
      toast.success(t("marketplace.installSuccess"));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setPreviewInstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(skill.name);
        return next;
      });
    }
  }

  function openDetailSkill(skill: MarketplaceSkillDetail, trigger?: EventTarget | null) {
    if (trigger instanceof HTMLElement) {
      detailTriggerRef.current = trigger;
    }
    setDetailSkill(skill);
  }

  async function handleAddRepoToSources(repoFullName: string, url: string) {
    setAddingRepos((prev) => new Set(prev).add(repoFullName));
    try {
      const name = repoFullName.split("/").pop() ?? repoFullName;
      await addRegistry(name, "github", url);
      toast.success(lang === "zh" ? `已添加 ${repoFullName}` : `Added ${repoFullName}`);
    } catch (err) {
      const duplicate = parseDuplicateRegistryError(err);
      if (duplicate) {
        toast.error(
          duplicate.isBuiltin
            ? lang === "zh"
              ? `该仓库已存在于官方源目录：${duplicate.name}`
              : `This repo already exists in Official Directory: ${duplicate.name}`
            : lang === "zh"
              ? `该源已存在：${duplicate.name}`
              : `This source already exists: ${duplicate.name}`
        );
      } else {
        toast.error(String(err));
      }
    } finally {
      setAddingRepos((prev) => {
        const next = new Set(prev);
        next.delete(repoFullName);
        return next;
      });
    }
  }

  async function handleDeleteRegistry(registryId: string) {
    setRemovingRegistryIds((prev) => new Set(prev).add(registryId));
    try {
      await removeRegistry(registryId);
      toast.success(lang === "zh" ? "已删除该源" : "Source deleted");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setRemovingRegistryIds((prev) => {
        const next = new Set(prev);
        next.delete(registryId);
        return next;
      });
    }
  }

  async function handleGitHubPreview() {
    try {
      await previewGitHubRepoImport(githubRepoUrl);
    } catch {
      // store keeps recoverable error state
    }
  }

  async function handleGitHubImport(selections: Parameters<typeof importGitHubRepoSkills>[1]) {
    try {
      await importGitHubRepoSkills(githubRepoUrl, selections);
      await Promise.all([rescan(), loadRegistries()]);
      toast.success(
        lang === "zh" ? "GitHub 仓库技能已导入中央技能库" : "GitHub repo skills imported to Central"
      );
    } catch (err) {
      toast.error(String(err));
    }
  }

  // ── Tabs ───────────────────────────────────────────────────────────────

  const tabs: { id: TabId; label: string }[] = [
    { id: "recommended", label: lang === "zh" ? "推荐" : "Recommended" },
    { id: "official", label: lang === "zh" ? "官方源目录" : "Official Directory" },
    { id: "my-sources", label: lang === "zh" ? "我的源" : "My Sources" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{t("marketplace.title")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("marketplace.desc")}</p>
          </div>
          <Button onClick={() => setIsGitHubImportOpen(true)}>
            <Download className="size-4" />
            <span>{t("marketplace.githubImportCta")}</span>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedPublisher(null); }}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
              activeTab === tab.id
                ? "bg-primary/15 text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/40"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">

        {/* ── Tab: Recommended ──────────────────────────────────────────── */}
        {activeTab === "recommended" && (
          <div className="p-6 space-y-4">
            {/* Tags */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setSelectedTag(null)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs transition-colors cursor-pointer",
                  !selectedTag ? "bg-primary/15 text-foreground font-medium" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
                )}
              >
                All
              </button>
              {ALL_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs transition-colors cursor-pointer",
                    selectedTag === tag ? "bg-primary/15 text-foreground font-medium" : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {lang === "zh" ? TAG_LABELS[tag].zh : TAG_LABELS[tag].en}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t("marketplace.searchPlaceholder")}
                value={recommendedSearch}
                onChange={(e) => setRecommendedSearch(e.target.value)}
                className="pl-8 h-8 text-sm bg-muted/40"
              />
            </div>

            {/* Skills grid */}
            {filteredRecommended.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {lang === "zh" ? "没有匹配的推荐技能" : "No matching recommended skills"}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredRecommended.map((skill) => {
                  const downloadUrl = `https://raw.githubusercontent.com/${skill.repoFullName}/main/${skill.name}/SKILL.md`;
                  return (
                    <UnifiedSkillCard
                      key={skill.name}
                      name={skill.name}
                      description={skill.description}
                      publisher={skill.publisher}
                      tags={skill.tags.slice(0, 2).map((tag) => ({
                        key: tag,
                        label: lang === "zh" ? TAG_LABELS[tag].zh : TAG_LABELS[tag].en,
                      }))}
                      onDetail={(event) =>
                        openDetailSkill(
                          {
                            id: skill.name,
                            name: skill.name,
                            description: skill.description,
                            downloadUrl,
                            publisher: skill.publisher,
                            sourceLabel: skill.publisher,
                            sourceUrl: `https://github.com/${skill.repoFullName}`,
                            installed: false,
                          },
                          event?.currentTarget ?? null
                        )
                      }
                      onInstall={() => handleInstallRecommended(skill)}
                      isLoading={recommendedInstallingIds.has(skill.name)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Official Directory ───────────────────────────────────── */}
        {activeTab === "official" && !selectedPublisher && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={lang === "zh" ? "搜索发布者..." : "Search publishers..."}
                  value={publisherSearch}
                  onChange={(e) => setPublisherSearch(e.target.value)}
                  className="pl-8 h-8 text-sm bg-muted/40"
                />
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {OFFICIAL_PUBLISHERS.length} {lang === "zh" ? "个官方发布者" : "publishers"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {filteredPublishers.map((pub) => (
                <PublisherCard
                  key={pub.slug}
                  publisher={pub}
                  onClick={() => setSelectedPublisher(pub)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Tab: Official Directory → Publisher Detail ────────────────── */}
        {activeTab === "official" && selectedPublisher && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedPublisher(null)}
                className="p-1.5 rounded-md hover:bg-muted/60 transition-colors cursor-pointer text-muted-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
              <div>
                <h2 className="text-sm font-semibold">{selectedPublisher.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {selectedPublisher.totalSkills} skills · {selectedPublisher.repos.length} repo{selectedPublisher.repos.length > 1 ? "s" : ""}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {selectedPublisher.repos.map((repo) => {
                const isAdded = addedRepoUrls.has(repo.url);
                const isAdding = addingRepos.has(repo.fullName);
                const isPreviewing = previewRepo === repo.fullName;
                return (
                  <div key={repo.fullName} className="rounded-md border border-border overflow-hidden">
                    {/* Repo header — clickable to toggle preview */}
                    <button
                      onClick={() => handlePreviewRepo(repo.fullName, repo.url)}
                      className={cn(
                        "flex items-center gap-3 w-full p-4 transition-colors cursor-pointer text-left",
                        isPreviewing ? "bg-primary/10" : "hover:bg-hover-bg/10"
                      )}
                    >
                      <Folder className={cn("size-4 shrink-0", isPreviewing ? "text-primary" : "text-muted-foreground")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{repo.fullName}</span>
                          <a
                            href={repo.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] text-primary hover:underline shrink-0"
                          >{repo.url}</a>
                        </div>
                        <div className="text-xs text-muted-foreground">{repo.skillCount} skills</div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {isPreviewing ? "▾" : "▸"} {lang === "zh" ? "浏览 Skills" : "Browse Skills"}
                      </span>
                    </button>

                    {/* Expanded preview — inline skills list */}
                    {isPreviewing && (
                      <div className="border-t border-border bg-muted/10">
                        {/* Actions bar */}
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
                          <span className="text-xs text-muted-foreground flex-1">
                            {isPreviewLoading
                              ? (lang === "zh" ? "正在获取..." : "Fetching...")
                              : `${previewSkills.length} skills`}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewRepo(null);
                              setTimeout(() => handlePreviewRepo(repo.fullName, repo.url), 50);
                            }}
                            disabled={isPreviewLoading}
                            className="h-6 text-xs px-2"
                          >
                            <RefreshCw className={cn("size-3", isPreviewLoading && "animate-spin")} />
                          </Button>
                          {!isAdded && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleAddRepoToSources(repo.fullName, repo.url); }}
                              disabled={isAdding}
                              className="h-6 text-xs px-2"
                            >
                              {isAdding ? <Loader2 className="size-3 animate-spin" /> : null}
                              <span>{lang === "zh" ? "+ 添加到我的源" : "+ Add to My Sources"}</span>
                            </Button>
                          )}
                          {isAdded && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                              <Check className="size-3" />
                              {lang === "zh" ? "已添加" : "Added"}
                            </span>
                          )}
                        </div>

                        {/* Skills */}
                        {isPreviewLoading ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                            <Loader2 className="size-4 animate-spin" />
                            <span>{lang === "zh" ? "正在从 GitHub 获取 Skills..." : "Fetching skills from GitHub..."}</span>
                          </div>
                        ) : previewStatus.kind === "browser-fallback" || previewStatus.kind === "error" ? (
                          <div className="px-4 py-6 text-center">
                            <div className="text-sm font-medium text-foreground">{previewStatus.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{previewStatus.detail}</div>
                          </div>
                        ) : previewSkills.length === 0 ? (
                          <div className="text-center py-6 text-xs text-muted-foreground">
                            {lang === "zh" ? "未找到 Skills" : "No skills found"}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2 p-3 max-h-80 overflow-y-auto">
                            {previewSkills.map((skill) => (
                              <div
                                key={skill.name}
                                className="flex items-start gap-2 p-2.5 rounded-md border border-border/50 bg-background"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium truncate">{skill.name}</div>
                                  {skill.description && (
                                    <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{skill.description}</div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openDetailSkill(
                                        {
                                          id: skill.id,
                                          name: skill.name,
                                          description: skill.description,
                                          downloadUrl: skill.downloadUrl,
                                          publisher: repo.fullName,
                                          sourceLabel: selectedPublisher.name,
                                          sourceUrl: repo.url,
                                          installed: false,
                                        },
                                        e.currentTarget
                                      );
                                    }}
                                    className="h-6 text-[10px] px-2"
                                  >
                                    <FileText className="size-3" />
                                    <span>Detail</span>
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); handleInstallPreviewSkill(skill); }}
                                    disabled={previewInstallingIds.has(skill.name)}
                                    className="h-6 text-[10px] px-2"
                                  >
                                    {previewInstallingIds.has(skill.name)
                                      ? <Loader2 className="size-3 animate-spin" />
                                      : <Download className="size-3" />}
                                    <span>{t("marketplace.install")}</span>
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Tab: My Sources ───────────────────────────────────────────── */}
        {activeTab === "my-sources" && (
          <>
            {/* Registry chips */}
            <div className="flex items-center gap-2 px-6 py-4 border-b border-border overflow-x-auto">
              {registries.map((reg) => (
                <RegistryChip
                  key={reg.id}
                  registry={reg}
                  isActive={selectedRegistryId === reg.id}
                  onClick={() => selectRegistry(reg.id)}
                />
              ))}
              {registries.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  {lang === "zh" ? "暂无源。从「官方源目录」中添加。" : "No sources. Add from Official Directory."}
                </span>
              )}
            </div>

            {selectedRegistryObj && (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="px-6 pt-4">
                  <div className="rounded-lg border border-border/70 bg-card/70 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">
                          {lang === "zh" ? "我的源" : "My Sources"}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {lang === "zh"
                            ? "源信息会持久化保存，并在重新打开应用时继续复用缓存元数据。"
                            : "Source identity and sync metadata persist and are reused when you reopen the app."}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {registries.length} {lang === "zh" ? "个源" : "sources"}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {mySourceRows.map(({ registry, duplicateOfficial }) => (
                        <div
                          key={registry.id}
                          className="flex items-start gap-3 rounded-md border border-border/70 bg-background/70 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{registry.name}</span>
                              {registry.is_builtin ? (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                  {lang === "zh" ? "官方" : "Official"}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{registry.url}</div>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                              <span>
                                {lang === "zh" ? "缓存更新：" : "Cache updated:"}{" "}
                                {formatTimestamp(registry.cache_updated_at ?? registry.last_synced, lang) ??
                                  (lang === "zh" ? "尚未同步" : "Not synced")}
                              </span>
                              <span>
                                {lang === "zh" ? "最后尝试：" : "Last attempted:"}{" "}
                                {formatTimestamp(registry.last_attempted_sync, lang) ??
                                  (lang === "zh" ? "暂无" : "None")}
                              </span>
                            </div>
                            {duplicateOfficial ? (
                              <div className="mt-2 text-[11px] text-amber-600">
                                {lang === "zh"
                                  ? "该源与官方目录中的仓库身份重复，已按规范化仓库地址去重。"
                                  : "This source overlaps with an Official Directory repo and is deduplicated by normalized repo identity."}
                              </div>
                            ) : null}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteRegistry(registry.id)}
                            disabled={registry.is_builtin || removingRegistryIds.has(registry.id)}
                            className="h-8 shrink-0 text-destructive hover:text-destructive"
                          >
                            {removingRegistryIds.has(registry.id) ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : null}
                            <span>{t("common.delete")}</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Source header */}
                <div className="flex items-center gap-3 px-6 py-3 border-b border-border">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">{selectedRegistryObj.name}</h2>
                    <a
                      href={selectedRegistryObj.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline truncate block"
                    >{selectedRegistryObj.url}</a>
                  </div>
                  <div className="relative w-48 shrink-0">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder={t("marketplace.searchPlaceholder")}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-7 h-7 text-xs bg-muted/40"
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleSync()} disabled={isSyncing}>
                    {isSyncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    <span>{lang === "zh" ? "使用缓存更新" : "Update"}</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleSync(true)} disabled={isSyncing}>
                    {isSyncing ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldAlert className="size-3.5" />}
                    <span>{lang === "zh" ? "强制刷新" : "Force Refresh"}</span>
                  </Button>
                </div>

                {/* Skills */}
                <div className="flex-1 overflow-auto p-6">
                  <div className="mb-4 rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "mt-0.5 rounded-full p-1.5",
                          selectedRegistryStatus?.tone === "error"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        {selectedRegistryStatus?.tone === "error" ? (
                          <AlertCircle className="size-3.5" />
                        ) : (
                          <Clock3 className="size-3.5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {selectedRegistryStatus?.label ??
                            (lang === "zh" ? "缓存状态未知" : "Cache status unavailable")}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {selectedRegistryStatus?.detail ??
                            (lang === "zh"
                              ? "重新打开该源时会优先显示后端缓存。"
                              : "Reopening this source reuses backend cache by default.")}
                        </div>
                        {selectedRegistryObj?.last_attempted_sync && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {lang === "zh" ? "最近尝试：" : "Last attempted:"}{" "}
                            {formatTimestamp(selectedRegistryObj.last_attempted_sync, lang)}
                          </div>
                        )}
                        {selectedRegistryObj?.cache_expires_at && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {lang === "zh" ? "缓存有效期至：" : "Cache valid until:"}{" "}
                            {formatTimestamp(selectedRegistryObj.cache_expires_at, lang)}
                          </div>
                        )}
                        {marketplaceError && selectedRegistryStatus?.tone !== "error" && (
                          <div className="mt-1 text-[11px] text-destructive">{marketplaceError}</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {isLoading || isSyncing ? (
                    <div className="flex items-center justify-center h-full gap-3 text-muted-foreground">
                      <Loader2 className="size-5 animate-spin" />
                      <span className="text-sm">{isSyncing ? t("marketplace.syncing") : t("common.loading")}</span>
                    </div>
                  ) : skills.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
                      <div className="p-4 rounded-full bg-muted/60">
                        <Store className="size-12 text-muted-foreground opacity-60" />
                      </div>
                      <p className="text-sm text-muted-foreground font-medium">{t("marketplace.noSkills")}</p>
                      <p className="text-xs text-muted-foreground">{t("marketplace.noSkillsDesc")}</p>
                      <Button variant="default" size="sm" onClick={() => handleSync()}>
                        <RefreshCw className="size-3.5" />
                        {t("marketplace.syncNow")}
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {skills.map((skill) => (
                        <UnifiedSkillCard
                          key={skill.id}
                          name={skill.name}
                          description={skill.description}
                          onDetail={(event) =>
                            openDetailSkill(
                              {
                                id: skill.id,
                                name: skill.name,
                                description: skill.description,
                                downloadUrl: skill.download_url,
                                sourceLabel: selectedRegistryObj.name,
                                sourceUrl: selectedRegistryObj.url,
                                installed: skill.is_installed,
                              },
                              event?.currentTarget ?? null
                            )
                          }
                          onInstall={() => handleInstallFromSource(skill.id)}
                          isLoading={installingIds.has(skill.id)}
                          isInstalled={skill.is_installed}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Skill Detail Drawer */}
      {detailSkill && (
        <MarketplaceSkillDetailDrawer
          open={!!detailSkill}
          onOpenChange={(open) => { if (!open) setDetailSkill(null); }}
          skill={detailSkill}
          onInstall={() => {
            if (detailSkill.id.startsWith("skill-")) {
              void handleInstallFromSource(detailSkill.id);
              return;
            }
            handleInstallPreviewSkill({ id: detailSkill.id, name: detailSkill.name, downloadUrl: detailSkill.downloadUrl });
          }}
          isInstalling={installingIds.has(detailSkill.id) || previewInstallingIds.has(detailSkill.name)}
          onAfterCloseFocus={() => {
            detailTriggerRef.current?.focus();
            detailTriggerRef.current = null;
          }}
        />
      )}

      <GitHubRepoImportWizard
        open={isGitHubImportOpen}
        onOpenChange={setIsGitHubImportOpen}
        repoUrl={githubRepoUrl}
        onRepoUrlChange={setGitHubRepoUrl}
        preview={githubImport.preview}
        previewError={githubImport.error}
        isPreviewLoading={githubImport.isPreviewLoading}
        isImporting={githubImport.isImporting}
        importResult={githubImport.importResult}
        onPreview={handleGitHubPreview}
        onImport={handleGitHubImport}
        onReset={() => {
          resetGitHubImport();
          setGitHubRepoUrl("");
        }}
        launcherLabel={t("marketplace.title")}
      />
    </div>
  );
}
