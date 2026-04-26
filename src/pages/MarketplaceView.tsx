import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Store,
  RefreshCw,
  Loader2,
  Download,
  ChevronLeft,
  Folder,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UnifiedSkillCard } from "@/components/skill/UnifiedSkillCard";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { usePlatformStore } from "@/stores/platformStore";
import { useCentralSkillsStore } from "@/stores/centralSkillsStore";
import { useSkillStore } from "@/stores/skillStore";
import {
  OFFICIAL_PUBLISHERS,
  RECOMMENDED_SKILLS,
  ALL_TAGS,
  TAG_LABELS,
  OfficialPublisher,
  SkillTag,
} from "@/data/officialSources";
import { MarketplaceSkillDetailDrawer, type MarketplaceSkillDetail } from "@/components/marketplace/MarketplaceSkillDetailDrawer";
import { GitHubRepoImportWizard } from "@/components/marketplace/GitHubRepoImportWizard";
import { invoke, isTauriRuntime } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { GitHubRepoPreview, SkillsShFileEntry, SkillsShSkill } from "@/types";

type TabId = "recommended" | "official" | "skillssh";

type PreviewStatus =
  | { kind: "idle" }
  | { kind: "browser-fallback"; title: string; detail: string }
  | { kind: "error"; title: string; detail: string };

type PreviewSkill = {
  id: string;
  name: string;
  description?: string;
  downloadUrl: string;
};

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
  const installingIds = useMarketplaceStore((s) => s.installingIds);
  const loadRegistries = useMarketplaceStore((s) => s.loadRegistries);
  const loadPreviewSkills = useMarketplaceStore((s) => s.loadPreviewSkills);
  const installSkill = useMarketplaceStore((s) => s.installSkill);
  const getNormalizedRegistryIdentity = useMarketplaceStore((s) => s.getNormalizedRegistryIdentity);
  const githubImport = useMarketplaceStore((s) => s.githubImport);
  const previewGitHubRepoImport = useMarketplaceStore((s) => s.previewGitHubRepoImport);
  const importGitHubRepoSkills = useMarketplaceStore((s) => s.importGitHubRepoSkills);
  const resetGitHubImport = useMarketplaceStore((s) => s.resetGitHubImport);
  const skillsShResults = useMarketplaceStore((s) => s.skillsShResults);
  const isSkillsShLoading = useMarketplaceStore((s) => s.isSkillsShLoading);
  const searchSkillsSh = useMarketplaceStore((s) => s.searchSkillsSh);
  const installFromSkillsSh = useMarketplaceStore((s) => s.installFromSkillsSh);

  const rescan = usePlatformStore((s) => s.rescan);
  const platformAgents = usePlatformStore((s) => s.agents);
  const centralSkills = useCentralSkillsStore((s) => s.skills);
  const centralAgents = useCentralSkillsStore((s) => s.agents);
  const loadCentralSkills = useCentralSkillsStore((s) => s.loadCentralSkills);
  const installCentralSkill = useCentralSkillsStore((s) => s.installSkill);
  const skillsByAgent = useSkillStore((s) => s.skillsByAgent);
  const getSkillsByAgent = useSkillStore((s) => s.getSkillsByAgent);

  // Local state
  const [activeTab, setActiveTab] = useState<TabId>("recommended");
  const [selectedTag, setSelectedTag] = useState<SkillTag | null>(null);
  const [recommendedSearch, setRecommendedSearch] = useState("");
  const [selectedPublisher, setSelectedPublisher] = useState<OfficialPublisher | null>(null);
  const [publisherSearch, setPublisherSearch] = useState("");
  const [skillsShSearch, setSkillsShSearch] = useState("");

  // Preview state — inline skills preview in Official Directory
  const [previewRepo, setPreviewRepo] = useState<string | null>(null); // repo fullName
  const [previewSkills, setPreviewSkills] = useState<PreviewSkill[]>([]);
  const [previewCache, setPreviewCache] = useState<Record<string, PreviewSkill[]>>({});
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewInstallingIds, setPreviewInstallingIds] = useState<Set<string>>(new Set());
  const [detailSkill, setDetailSkill] = useState<MarketplaceSkillDetail | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>({ kind: "idle" });
  const [isGitHubImportOpen, setIsGitHubImportOpen] = useState(false);
  const [githubRepoUrl, setGitHubRepoUrl] = useState("");
  const [resolvingSkillsShUrls, setResolvingSkillsShUrls] = useState<Set<string>>(new Set());
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    loadRegistries();
  }, [loadRegistries]);

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

  // ── Handlers ───────────────────────────────────────────────────────────


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

  async function handleInstallSkillsSh(source: string, skillId: string) {
    try {
      await installFromSkillsSh(source, skillId);
      await rescan();
      setDetailSkill((current) =>
        current && current.id === `skillssh:${source}:${skillId}`
          ? { ...current, installed: true }
          : current
      );
      toast.success(t("marketplace.installSuccess"));
    } catch (err) {
      toast.error(String(err));
    }
  }


  async function handlePreviewRepo(
    repoFullName: string,
    repoUrl: string,
    options?: { forceRefresh?: boolean }
  ) {
    const forceRefresh = options?.forceRefresh ?? false;

    if (previewRepo === repoFullName && !forceRefresh) {
      setPreviewRepo(null); // toggle off
      setPreviewStatus({ kind: "idle" });
      return;
    }

    if (!forceRefresh && Object.prototype.hasOwnProperty.call(previewCache, repoUrl)) {
      setPreviewRepo(repoFullName);
      setPreviewSkills(previewCache[repoUrl] ?? []);
      setPreviewStatus({ kind: "idle" });
      setIsPreviewLoading(false);
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

      const normalizedRepoIdentity = getNormalizedRegistryIdentity(repoUrl);
      const registryId = normalizedRepoIdentity
        ? registries.find((registry) => {
            const registryIdentity =
              registry.normalized_url ?? getNormalizedRegistryIdentity(registry.url);
            return registryIdentity === normalizedRepoIdentity;
          })?.id
        : null;

      if (registryId) {
        const skills = await loadPreviewSkills(registryId);
        if (skills.length > 0) {
          const nextPreviewSkills = skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description ?? undefined,
            downloadUrl: skill.download_url,
          }));
          setPreviewSkills(nextPreviewSkills);
          setPreviewCache((current) => ({ ...current, [repoUrl]: nextPreviewSkills }));
          return;
        }
      }

      const preview = await invoke<GitHubRepoPreview>("preview_github_repo_import", {
        repoUrl,
      });
      const nextPreviewSkills = preview.skills.map((skill) => ({
        id: skill.skillId,
        name: skill.skillName,
        description: skill.description ?? undefined,
        downloadUrl: skill.downloadUrl,
      }));
      setPreviewSkills(nextPreviewSkills);
      setPreviewCache((current) => ({ ...current, [repoUrl]: nextPreviewSkills }));
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



  async function handleGitHubPreview() {
    try {
      return await previewGitHubRepoImport(githubRepoUrl);
    } catch {
      return null;
    }
  }

  async function handleGitHubImport(selections: Parameters<typeof importGitHubRepoSkills>[1]) {
    try {
      const result = await importGitHubRepoSkills(githubRepoUrl, selections);
      await Promise.all([rescan(), loadRegistries(), loadCentralSkills()]);
      toast.success(
        lang === "zh" ? "GitHub 仓库技能已导入中央技能库" : "GitHub repo skills imported to Central"
      );
      return result;
    } catch (err) {
      toast.error(String(err));
      throw err;
    }
  }

  const installableImportedSkills = useMemo(() => {
    if (!githubImport.importResult) return [];
    const importedIds = new Set(
      githubImport.importResult.importedSkills.map((skill) => skill.importedSkillId)
    );
    return centralSkills.filter((skill) => importedIds.has(skill.id));
  }, [centralSkills, githubImport.importResult]);

  const availableInstallAgents = useMemo(
    () => (centralAgents.length > 0 ? centralAgents : platformAgents),
    [centralAgents, platformAgents]
  );

  async function handleInstallImportedSkill(
    skillId: string,
    agentIds: string[],
    method: "symlink" | "copy"
  ) {
    await installCentralSkill(skillId, agentIds, method);
    await Promise.all([rescan(), loadCentralSkills(), ...agentIds.map((agentId) => getSkillsByAgent(agentId))]);
  }

  async function handleAfterImportSuccess() {
    const agentIds = Object.keys(skillsByAgent);
    if (agentIds.length === 0) return;
    await Promise.all(agentIds.map((agentId) => getSkillsByAgent(agentId)));
  }

  // ── Tabs ───────────────────────────────────────────────────────────────

  const tabs: { id: TabId; label: string }[] = [
    { id: "recommended", label: lang === "zh" ? "推荐" : "Recommended" },
    { id: "official", label: lang === "zh" ? "官方源目录" : "Official Directory" },
    { id: "skillssh", label: "skills.sh" },
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
                              void handlePreviewRepo(repo.fullName, repo.url, { forceRefresh: true });
                            }}
                            disabled={isPreviewLoading}
                            aria-label={lang === "zh" ? "刷新预览" : "Refresh preview"}
                            className="h-6 text-xs px-2"
                          >
                            <RefreshCw className={cn("size-3", isPreviewLoading && "animate-spin")} />
                          </Button>
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
                                    <span>{t("common.detail")}</span>
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

        {/* ── Tab: skills.sh ────────────────────────────────────────────── */}
        {activeTab === "skillssh" && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={lang === "zh" ? "搜索 skills.sh..." : "Search skills.sh..."}
                  value={skillsShSearch}
                  onChange={(e) => setSkillsShSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && skillsShSearch.trim()) {
                      void searchSkillsSh(skillsShSearch.trim());
                    }
                  }}
                  className="pl-8 h-8 text-sm bg-muted/40"
                />
              </div>
              <Button
                size="sm"
                onClick={() => {
                  if (skillsShSearch.trim()) {
                    void searchSkillsSh(skillsShSearch.trim());
                  }
                }}
                disabled={isSkillsShLoading || !skillsShSearch.trim()}
              >
                {isSkillsShLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                <span>{lang === "zh" ? "搜索" : "Search"}</span>
              </Button>
            </div>

            {skillsShResults.length === 0 && !isSkillsShLoading && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {lang === "zh" ? "输入关键词搜索 skills.sh" : "Enter keywords to search skills.sh"}
              </div>
            )}

            {isSkillsShLoading && skillsShResults.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin" />
                {lang === "zh" ? "搜索中..." : "Searching..."}
              </div>
            )}

            <div className="space-y-2">
              {skillsShResults.map((skill: SkillsShSkill) => {
                const isInstalling = installingIds.has(skill.skill_id);
                const starCount = skill.stars ?? skill.installs;
                const starText =
                  starCount >= 1_000_000
                    ? `${(starCount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
                    : starCount >= 1_000
                      ? `${(starCount / 1_000).toFixed(1).replace(/\.0$/, "")}K`
                      : `${starCount}`;
                return (
                  <div
                    key={skill.id}
                    className="flex items-center gap-3 p-3 rounded-md border border-border hover:border-primary/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{skill.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        ★ {starText} · {skill.source}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={resolvingSkillsShUrls.has(skill.skill_id)}
                        onClick={async () => {
                          setResolvingSkillsShUrls((prev) => new Set(prev).add(skill.skill_id));
                          try {
                            const [downloadUrl, files] = await Promise.all([
                              invoke<string>("resolve_skills_sh_url", {
                                source: skill.source,
                                skillId: skill.skill_id,
                              }),
                              invoke<SkillsShFileEntry[]>("browse_skills_sh_directory", {
                                source: skill.source,
                                skillId: skill.skill_id,
                              }).catch(() => undefined),
                            ]);
                            openDetailSkill({
                              id: `skillssh:${skill.source}:${skill.skill_id}`,
                              name: skill.name,
                              downloadUrl,
                              publisher: skill.source,
                              sourceLabel: "skills.sh",
                              sourceUrl: `https://github.com/${skill.source}`,
                              installed: false,
                              files,
                            });
                          } catch (err) {
                            toast.error(String(err));
                          } finally {
                            setResolvingSkillsShUrls((prev) => {
                              const next = new Set(prev);
                              next.delete(skill.skill_id);
                              return next;
                            });
                          }
                        }}
                        className="h-7 text-xs px-2"
                      >
                        {resolvingSkillsShUrls.has(skill.skill_id) ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <FileText className="size-3" />
                        )}
                        <span>{t("common.detail")}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleInstallSkillsSh(skill.source, skill.skill_id)}
                        disabled={isInstalling}
                      >
                        {isInstalling ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Download className="size-4" />
                        )}
                        <span>{t("marketplace.install")}</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
            } else if (detailSkill.id.startsWith("skillssh:")) {
              const parts = detailSkill.id.split(":");
              void handleInstallSkillsSh(parts[1], parts.slice(2).join(":"));
            } else {
              handleInstallPreviewSkill({ id: detailSkill.id, name: detailSkill.name, downloadUrl: detailSkill.downloadUrl });
            }
          }}
          isInstalling={(() => {
            if (detailSkill.id.startsWith("skillssh:")) {
              const parts = detailSkill.id.split(":");
              const rawId = parts.slice(2).join(":");
              return installingIds.has(rawId) || previewInstallingIds.has(detailSkill.name);
            }
            return installingIds.has(detailSkill.id) || previewInstallingIds.has(detailSkill.name);
          })()}
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
        availableAgents={availableInstallAgents}
        installableSkills={installableImportedSkills}
        onInstallImportedSkill={handleInstallImportedSkill}
        onAfterImportSuccess={handleAfterImportSuccess}
        onReset={() => {
          resetGitHubImport();
          setGitHubRepoUrl("");
        }}
        launcherLabel={t("marketplace.title")}
      />
    </div>
  );
}
