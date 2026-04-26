import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Tag,
  Plus,
  FileText,
  Code,
  Bot,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Monitor,
  FolderOpen,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "@/components/platform/PlatformIcon";
import { SkillFrontmatterCard } from "@/components/skill/SkillFrontmatterCard";
import { parseFrontmatter } from "@/lib/frontmatter";
import { useSkillDetailStore } from "@/stores/skillDetailStore";
import { usePlatformStore } from "@/stores/platformStore";
import { CollectionPickerDialog } from "@/components/collection/CollectionPickerDialog";
import {
  AgentWithStatus,
  ClaudeSourceKind,
  SelectedSkillFile,
  SkillDetailRequest,
  SkillDirectoryNode,
  SkillInstallation,
} from "@/types";
import { cn } from "@/lib/utils";
import { findFileNodeByPath } from "@/lib/fileTree";
import { FileTreeNode } from "@/components/skill/FileTreeNode";
import { invoke, isTauriRuntime } from "@/lib/tauri";

// ─── Section Label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-2">
      {children}
    </div>
  );
}

// ─── MetadataRow (compact) ───────────────────────────────────────────────────

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{label}</div>
      <div className="font-mono text-xs text-foreground break-all leading-relaxed">
        {value}
      </div>
    </div>
  );
}

function SourceOriginBadge({ originKind }: { originKind: ClaudeSourceKind }) {
  const { t, i18n } = useTranslation();
  const isPlugin = originKind === "plugin";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
        isPlugin
          ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300"
          : "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300"
      )}
    >
      {isPlugin
        ? t("platform.originPlugin", {
            defaultValue: i18n.language.startsWith("zh") ? "插件来源" : "Plugin source",
          })
        : t("platform.originUser", {
            defaultValue: i18n.language.startsWith("zh") ? "用户来源" : "User source",
          })}
    </span>
  );
}

function ReadOnlySourceBadge() {
  const { t, i18n } = useTranslation();

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border/70">
      <Lock className="size-3 shrink-0" />
      {t("detail.readOnlySource", {
        defaultValue: i18n.language.startsWith("zh") ? "只读来源" : "Read-only source",
      })}
    </span>
  );
}

// ─── Platform Toggle Icon (compact install/uninstall) ─────────────────────────

interface PlatformToggleIconProps {
  agent: AgentWithStatus;
  skillName: string;
  isInstalled: boolean;
  isLoading: boolean;
  onToggle: () => void;
}

function PlatformToggleIcon({ agent, skillName, isInstalled, isLoading, onToggle }: PlatformToggleIconProps) {
  const { t } = useTranslation();
  return (
    <button
      className={cn(
        "p-1.5 rounded-md transition-colors cursor-pointer",
        isInstalled
          ? "text-primary hover:bg-primary/15"
          : "text-muted-foreground/40 hover:bg-muted/60 hover:text-muted-foreground",
        isLoading && "animate-pulse pointer-events-none"
      )}
      title={`${agent.display_name}${isInstalled ? ` — ${t("central.linked")}` : ""}`}
      aria-label={t("central.toggleInstallLabel", { platform: agent.display_name, skill: skillName })}
      disabled={isLoading}
      onClick={onToggle}
    >
      <PlatformIcon agentId={agent.id} className="size-4 shrink-0" size={16} />
    </button>
  );
}

// ─── Tab Toggle ───────────────────────────────────────────────────────────────

type PreviewTab = "markdown" | "raw" | "explanation";

interface TabToggleProps {
  activeTab: PreviewTab;
  onChange: (tab: PreviewTab) => void;
  previewLabel: string;
}

function TabToggle({ activeTab, onChange, previewLabel }: TabToggleProps) {
  const { t } = useTranslation();
  return (
    <div className="flex border border-border rounded-lg p-0.5 gap-0.5 bg-muted/40">
      <button
        role="tab"
        aria-selected={activeTab === "markdown"}
        onClick={() => onChange("markdown")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
          activeTab === "markdown"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <FileText className="size-3.5" />
        {previewLabel}
      </button>
      <button
        role="tab"
        aria-selected={activeTab === "raw"}
        onClick={() => onChange("raw")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
          activeTab === "raw"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Code className="size-3.5" />
        {t("detail.rawSource")}
      </button>
      <button
        role="tab"
        aria-selected={activeTab === "explanation"}
        onClick={() => onChange("explanation")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
          activeTab === "explanation"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Bot className="size-3.5" />
        {t("detail.aiExplanation")}
      </button>
    </div>
  );
}

const detailTypographyClassName = cn(
  "text-[13px] leading-6 text-foreground/90",
  "[&_p]:text-[13px] [&_p]:leading-6",
  "[&_li]:text-[13px] [&_li]:leading-6",
  "[&_blockquote]:text-[13px] [&_blockquote]:leading-6",
  "[&_h1]:text-lg [&_h1]:leading-7 [&_h1]:font-semibold",
  "[&_h2]:text-base [&_h2]:leading-6 [&_h2]:font-semibold",
  "[&_h3]:text-sm [&_h3]:leading-6 [&_h3]:font-semibold",
  "[&_h4]:text-[13px] [&_h4]:leading-6 [&_h4]:font-semibold",
  "[&_th]:text-xs [&_th]:leading-5",
  "[&_td]:text-xs [&_td]:leading-5",
  "[&_code]:text-[12px]",
  "[&_pre]:text-[12px] [&_pre]:leading-5",
  "[&_pre_code]:text-[12px] [&_pre_code]:leading-5"
);

function deriveDirPathFromFilePath(path: string): string {
  const match = path.match(/^(.*)[/\\][^/\\]+$/);
  return match?.[1] ?? path;
}

// ─── SkillDetailView ──────────────────────────────────────────────────────────

/**
 * Shared presentation component for skill detail. Rendered by both the
 * full-page route wrapper (`SkillDetailPage`) and the list-entry drawer
 * (`SkillDetailDrawer`). This component owns:
 *   - ViewHeader (title/description/TabToggle + optional leading slot)
 *   - TwoColumnLayout (LeftPreview tab panel + RightSidebar metadata/install/collections)
 *   - CollectionPicker portal
 *
 * It does NOT render a back button, breadcrumb, or close button. Those belong
 * to the outer shell. It also does NOT call `useNavigate` / `useParams`; all
 * route/shell concerns are handled outside.
 */
export interface DiscoverMetadata {
  name: string;
  description?: string;
  platformName: string;
  projectName: string;
  filePath: string;
  dirPath: string;
  isAlreadyCentral: boolean;
}

export interface SkillDetailViewProps {
  /** The skill id to load from DB. Required for central skills. */
  skillId?: string;
  /** Optional platform context for source-aware detail loading. */
  agentId?: string;
  /** Optional stable row identity for duplicate platform rows. */
  rowId?: string;
  /** Direct file path to load content from. Used for discover non-central skills. */
  filePath?: string;
  /** Metadata for discover non-central skills (shown in sidebar). */
  discoverMetadata?: DiscoverMetadata;
  /** Affects local styling only, never behavior. */
  variant: "page" | "drawer";
  /** ViewHeader leftmost slot; currently null from both shells. */
  leading?: ReactNode;
  /** Drawer-only: used so the view can request its shell to close (e.g. on Esc). */
  onRequestClose?: () => void;
  /** Optional: exposes the left-preview scroll container to the outer shell. */
  scrollContainerRef?: Ref<HTMLDivElement>;
  /** Optional id applied to the ViewHeader h1 for shell-level aria-labelledby. */
  titleId?: string;
}

export function SkillDetailView({
  skillId,
  agentId,
  rowId,
  filePath,
  discoverMetadata,
  variant,
  leading = null,
  onRequestClose: _onRequestClose,
  scrollContainerRef,
  titleId,
}: SkillDetailViewProps) {
  const { t, i18n } = useTranslation();
  const isFileMode = !skillId && !!filePath;

  // Store data (used in skillId mode)
  const detail = useSkillDetailStore((s) => s.detail);
  const storeContent = useSkillDetailStore((s) => s.content);
  const storeIsLoading = useSkillDetailStore((s) => s.isLoading);
  const installingAgentId = useSkillDetailStore((s) => s.installingAgentId);
  const error = useSkillDetailStore((s) => s.error);
  const loadDetail = useSkillDetailStore((s) => s.loadDetail);
  const installSkill = useSkillDetailStore((s) => s.installSkill);
  const uninstallSkill = useSkillDetailStore((s) => s.uninstallSkill);
  const refreshInstallations = useSkillDetailStore((s) => s.refreshInstallations);
  const storeExplanation = useSkillDetailStore((s) => s.explanation);
  const storeIsExplanationLoading = useSkillDetailStore((s) => s.isExplanationLoading);
  const isExplanationStreaming = useSkillDetailStore((s) => s.isExplanationStreaming);
  const explanationError = useSkillDetailStore((s) => s.explanationError);
  const explanationErrorInfo = useSkillDetailStore((s) => s.explanationErrorInfo);
  const loadCachedExplanation = useSkillDetailStore((s) => s.loadCachedExplanation);
  const generateExplanation = useSkillDetailStore((s) => s.generateExplanation);
  const refreshExplanation = useSkillDetailStore((s) => s.refreshExplanation);
  const reset = useSkillDetailStore((s) => s.reset);

  // Platform agents (loaded at app init)
  const agents = usePlatformStore((s) => s.agents);
  const refreshCounts = usePlatformStore((s) => s.refreshCounts);

  // Local state for filePath mode
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileIsLoading, setFileIsLoading] = useState(false);
  const [fileExplanation, setFileExplanation] = useState<string | null>(null);
  const [fileIsExplaining, setFileIsExplaining] = useState(false);
  const [directoryTree, setDirectoryTree] = useState<SkillDirectoryNode[]>([]);
  const [isDirectoryTreeLoading, setIsDirectoryTreeLoading] = useState(false);
  const [directoryTreeError, setDirectoryTreeError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedSkillFile | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
  const [isSelectedFileLoading, setIsSelectedFileLoading] = useState(false);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const detailRequest = useMemo<SkillDetailRequest | null>(
    () => (skillId ? { skillId, agentId, rowId } : null),
    [skillId, agentId, rowId]
  );
  const explanationRequestKey = useMemo(() => {
    if (!skillId) {
      return null;
    }
    return detail?.row_id ?? rowId ?? skillId;
  }, [detail?.row_id, rowId, skillId]);

  // Unified accessors
  const skillContent = isFileMode ? fileContent : storeContent;
  const isLoading = isFileMode ? fileIsLoading : storeIsLoading;
  const explanation = isFileMode ? fileExplanation : storeExplanation;
  const isExplanationLoading = isFileMode ? fileIsExplaining : storeIsExplanationLoading;

  // Local UI state
  const [activeTab, setActiveTab] = useState<PreviewTab>("markdown");
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const addToCollectionButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectedFilePath = selectedFile?.path ?? null;
  const selectedRelativePath = selectedFile?.relativePath ?? null;
  const currentDirectoryPath = useMemo(() => {
    if (isFileMode) {
      return discoverMetadata?.dirPath ?? (filePath ? deriveDirPathFromFilePath(filePath) : null);
    }
    return detail?.dir_path ?? null;
  }, [detail?.dir_path, discoverMetadata?.dirPath, filePath, isFileMode]);
  const skillFilePath = isFileMode ? filePath ?? null : detail?.file_path ?? null;

  useEffect(() => {
    if (detail?.is_read_only && isCollectionPickerOpen) {
      setIsCollectionPickerOpen(false);
    }
  }, [detail?.is_read_only, isCollectionPickerOpen]);

  const fetchDirectoryTree = useCallback(async (dirPath: string) => {
    if (!isTauriRuntime()) {
      setDirectoryTree([]);
      setDirectoryTreeError(null);
      setIsDirectoryTreeLoading(false);
      return;
    }

    setIsDirectoryTreeLoading(true);
    setDirectoryTreeError(null);
    try {
      const tree = await invoke<SkillDirectoryNode[]>("list_skill_directory", { dirPath });
      setDirectoryTree(tree);
    } catch (err) {
      setDirectoryTree([]);
      setDirectoryTreeError(String(err));
    } finally {
      setIsDirectoryTreeLoading(false);
    }
  }, []);

  // ── File mode: load content from path ─────────────────────────────────
  const fetchFileContent = useCallback(async () => {
    if (!filePath) return;
    setFileIsLoading(true);
    try {
      const text = await invoke<string>("read_file_by_path", { path: filePath });
      setFileContent(text);
    } catch {
      setFileContent(null);
    } finally {
      setFileIsLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    if (isFileMode) {
      setFileContent(null);
      setFileExplanation(null);
      setSelectedFile(null);
      setSelectedFileContent(null);
      setExpandedDirectories(new Set());
      setActiveTab("markdown");
      void fetchFileContent();
    }
  }, [isFileMode, fetchFileContent]);

  // ── Store mode: load detail by skillId ────────────────────────────────
  useEffect(() => {
    if (detailRequest) {
      loadDetail(detailRequest);
    }
    return () => {
      reset();
    };
  }, [detailRequest, loadDetail, reset]);

  useLayoutEffect(() => {
    if (explanationRequestKey && storeContent) {
      loadCachedExplanation(explanationRequestKey, i18n.language);
    }
  }, [explanationRequestKey, storeContent, i18n.language, loadCachedExplanation]);

  useEffect(() => {
    if (!currentDirectoryPath) {
      setDirectoryTree([]);
      setDirectoryTreeError(null);
      return;
    }

    setSelectedFile(null);
    setSelectedFileContent(null);
    setExpandedDirectories(new Set());
    void fetchDirectoryTree(currentDirectoryPath);
  }, [currentDirectoryPath, fetchDirectoryTree]);

  useEffect(() => {
    if (!skillFilePath || directoryTree.length === 0) {
      return;
    }

    if (selectedFilePath && findFileNodeByPath(directoryTree, selectedFilePath)) {
      return;
    }

    const defaultNode = findFileNodeByPath(directoryTree, skillFilePath);
    setSelectedFile({
      path: skillFilePath,
      relativePath: defaultNode?.relative_path ?? "SKILL.md",
    });
  }, [directoryTree, selectedFilePath, skillFilePath]);

  useEffect(() => {
    if (!selectedFilePath || !skillFilePath || selectedFilePath === skillFilePath) {
      setSelectedFileContent(null);
      setIsSelectedFileLoading(false);
      return;
    }
    if (!isTauriRuntime()) {
      setSelectedFileContent(null);
      setIsSelectedFileLoading(false);
      return;
    }

    let cancelled = false;
    setIsSelectedFileLoading(true);
    invoke<string>("read_file_by_path", { path: selectedFilePath })
      .then((text) => {
        if (!cancelled) {
          setSelectedFileContent(text);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedFileContent(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSelectedFileLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFilePath, skillFilePath]);

  // ── Derived values ───────────────────────────────────────────────────────

  const targetAgents = agents.filter((a) => a.id !== "central");
  const lobsterAgents = targetAgents.filter((a) => a.category === "lobster");
  const codingAgents = targetAgents.filter((a) => a.category !== "lobster");

  const installationMap = new Map<string, SkillInstallation>(
    (detail?.installations ?? []).map((inst) => [inst.agent_id, inst])
  );
  const skillCollections = detail?.collections ?? [];

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleToggle(agentId: string) {
    if (!skillId || detail?.is_read_only) return;
    const isInstalled = installationMap.has(agentId);
    try {
      if (isInstalled) {
        await uninstallSkill(skillId, agentId);
      } else {
        await installSkill(skillId, agentId);
      }
      await Promise.all([
        refreshCounts(),
        refreshInstallations(skillId),
      ]);
    } catch (err) {
      toast.error(
        isInstalled
          ? t("detail.uninstallError", { error: String(err) })
          : t("detail.installError", { error: String(err) })
      );
    }
  }

  function handleCollectionAdded() {
    if (detailRequest) {
      loadDetail(detailRequest);
    }
  }

  function handleCollectionPickerOpenChange(open: boolean) {
    setIsCollectionPickerOpen(open);
    if (!open) {
      queueMicrotask(() => {
        addToCollectionButtonRef.current?.focus();
      });
    }
  }

  function handleGenerateExplanation() {
    if (isFileMode && skillContent) {
      setFileIsExplaining(true);
      setFileExplanation(null);
      invoke<string>("explain_skill", { content: skillContent })
        .then(setFileExplanation)
        .catch((err) => setFileExplanation(`Error: ${String(err)}`))
        .finally(() => setFileIsExplaining(false));
      return;
    }
    if (explanationRequestKey && skillContent) {
      generateExplanation(explanationRequestKey, skillContent, i18n.language);
    }
  }

  function handleRefreshExplanation() {
    if (isFileMode && skillContent) {
      handleGenerateExplanation();
      return;
    }
    if (explanationRequestKey && skillContent) {
      refreshExplanation(explanationRequestKey, skillContent, i18n.language);
    }
  }

  function handleSelectFile(file: SelectedSkillFile) {
    setSelectedFile(file);
    if (activeTab === "explanation") {
      setActiveTab(file.path.toLowerCase().endsWith(".md") ? "markdown" : "raw");
    }
  }

  function handleToggleDirectory(path: string) {
    setExpandedDirectories((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  const handleOpenDiscoverPath = useCallback(async () => {
    if (!discoverMetadata) return;
    try {
      await invoke("open_in_file_manager", { path: discoverMetadata.dirPath });
    } catch {
      // silently ignore
    }
  }, [discoverMetadata]);

  const previewContent = selectedFilePath && skillFilePath && selectedFilePath !== skillFilePath
    ? selectedFileContent
    : skillContent;
  const selectedPreviewPath = selectedFilePath ?? skillFilePath;
  const isSelectedMarkdownFile = (selectedPreviewPath ?? "").toLowerCase().endsWith(".md");
  const previewLabel = isSelectedMarkdownFile ? t("detail.markdown") : t("detail.preview");
  const { frontmatterRaw, frontmatterData, body: markdownContent } = previewContent && isSelectedMarkdownFile
    ? parseFrontmatter(previewContent)
    : { frontmatterRaw: "", frontmatterData: {}, body: previewContent ?? "" };
  const isBrowserFallback = !isTauriRuntime() && !isLoading && !detail && !error && !isFileMode;
  const effectiveName = isFileMode
    ? (discoverMetadata?.name ?? "")
    : (detail?.name ?? detailRequest?.skillId ?? "");
  const effectiveDescription = isFileMode
    ? discoverMetadata?.description
    : detail?.description;
  const hasData = isFileMode ? skillContent !== null : !!detail;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={cn("flex flex-col h-full", variant === "drawer" && "min-h-0")}>
      {/* ── ViewHeader: leading slot + title/description + TabToggle ─────── */}
      <div className="border-b border-border px-6 py-3 flex items-center gap-3 shrink-0">
        {leading}
        <div className="min-w-0 flex-1">
          <h1 id={titleId} className="text-lg font-semibold truncate">
            {isLoading ? (skillId ?? discoverMetadata?.name ?? "") : effectiveName}
          </h1>
          {effectiveDescription && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {effectiveDescription}
            </p>
          )}
        </div>
        <TabToggle activeTab={activeTab} onChange={setActiveTab} previewLabel={previewLabel} />
      </div>

      {/* ── ContentArea ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-sm">{t("detail.loading")}</span>
          </div>
        )}

        {/* Error state */}
        {!isLoading && error && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => detailRequest && loadDetail(detailRequest)}
              >
                {t("detail.retry")}
              </Button>
            </div>
          </div>
        )}

        {!isLoading && !error && isBrowserFallback && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3 max-w-md px-6">
              <Bot className="size-8 mx-auto text-muted-foreground/60" />
              <div className="space-y-1">
                <p className="text-sm font-medium">{t("detail.browserFallbackTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("detail.browserFallbackDesc")}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── TwoColumnLayout: LeftPreview + RightSidebar ────────────────── */}
        {!isLoading && !error && hasData && (
          <div
            className="flex h-full flex-col md:flex-row"
            data-testid="skill-detail-two-column-layout"
          >
            {/* ── Left: SKILL.md Preview ─────────────────────────────── */}
            <div
              ref={scrollContainerRef}
              className="flex-1 min-w-0 overflow-auto"
            >
              {activeTab === "markdown" ? (
                <div
                  className="p-6 space-y-4"
                  role="tabpanel"
                  aria-label={previewLabel}
                >
                  {selectedRelativePath && (
                    <div className="text-xs font-mono text-muted-foreground break-all">
                      {selectedRelativePath}
                    </div>
                  )}
                  {isSelectedFileLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      {t("common.loading")}
                    </div>
                  ) : previewContent ? (
                    isSelectedMarkdownFile ? (
                      <>
                        <SkillFrontmatterCard data={frontmatterData} raw={frontmatterRaw} />
                        <div className={cn("markdown-body", detailTypographyClassName)}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {markdownContent}
                          </ReactMarkdown>
                        </div>
                      </>
                    ) : (
                      <pre className="rounded-lg border border-border bg-card p-4 text-[12px] leading-5 font-mono whitespace-pre-wrap break-words text-foreground/80">
                        {previewContent}
                      </pre>
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      {t("detail.noContent")}
                    </p>
                  )}
                </div>
              ) : activeTab === "raw" ? (
                <pre
                  className="p-6 text-[12px] leading-5 font-mono whitespace-pre-wrap break-words text-foreground/80"
                  role="tabpanel"
                  aria-label={t("detail.rawSource")}
                >
                  {selectedRelativePath ? `${selectedRelativePath}\n\n` : ""}
                  {isSelectedFileLoading ? t("common.loading") : (previewContent ?? t("detail.noContent"))}
                </pre>
              ) : (
                <div
                  className="p-6 space-y-4"
                  role="tabpanel"
                  aria-label={t("detail.aiExplanation")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold flex items-center gap-2">
                        <Bot className="size-4 text-primary" />
                        {t("detail.aiExplanation")}
                      </h2>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("detail.aiExplanationDesc")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={explanation ? handleRefreshExplanation : handleGenerateExplanation}
                      disabled={!skillContent || isExplanationLoading || isExplanationStreaming}
                      className="gap-1.5"
                    >
                      {isExplanationLoading || isExplanationStreaming ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : explanation ? (
                        <RefreshCw className="size-3.5" />
                      ) : (
                        <Bot className="size-3.5" />
                      )}
                      {explanation ? t("detail.regenerateExplanation") : t("detail.generateExplanation")}
                    </Button>
                  </div>

                  {explanationError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                      <p className="text-sm text-destructive">
                        {explanationErrorInfo?.message || explanationError}
                      </p>
                      {(explanationErrorInfo?.details || explanationError !== explanationErrorInfo?.message) && (
                        <div>
                          <button
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            onClick={() => setShowErrorDetails((v) => !v)}
                          >
                            {showErrorDetails ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            {t("detail.showDetails")}
                          </button>
                          {showErrorDetails && (
                            <pre className="mt-1.5 text-[11px] leading-4 font-mono text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 rounded-md p-2 max-h-40 overflow-auto">
                              {explanationErrorInfo?.details || explanationError}
                            </pre>
                          )}
                        </div>
                      )}
                      {explanationErrorInfo?.fallbackTried && (
                        <p className="text-xs text-muted-foreground">
                          {t("detail.fallbackTried")}
                        </p>
                      )}
                    </div>
                  )}

                  {isExplanationLoading && !explanation ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      {t("detail.explanationLoading")}
                    </div>
                  ) : explanation ? (
                    <div className={cn("markdown-body rounded-lg border border-border bg-card p-4", detailTypographyClassName)}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {explanation}
                      </ReactMarkdown>
                      {isExplanationStreaming && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          {t("detail.explanationStreaming")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-8 text-center space-y-3">
                      <Bot className="size-8 mx-auto text-muted-foreground/60" />
                      <div>
                        <p className="text-sm font-medium">{t("detail.noExplanationTitle")}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("detail.noExplanationDesc")}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleGenerateExplanation}
                        disabled={!skillContent || isExplanationLoading || isExplanationStreaming}
                        className="gap-1.5"
                      >
                        <Bot className="size-3.5" />
                        {t("detail.generateExplanation")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Right: Sidebar ─────────────────────────────────────── */}
            <aside
              data-testid="skill-detail-right-sidebar"
              className="w-full shrink-0 border-t border-border overflow-y-auto p-4 space-y-5 md:w-64 md:border-t-0 md:border-l"
            >
              {isFileMode && discoverMetadata ? (
                <>
                  <section aria-label={t("detail.filesRegion")}>
                    <SectionLabel>{t("detail.files")}</SectionLabel>
                    {isDirectoryTreeLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        {t("common.loading")}
                      </div>
                    ) : directoryTreeError ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {directoryTreeError}
                      </p>
                    ) : directoryTree.length > 0 ? (
                      <div className="space-y-1">
                        {directoryTree.map((node) => (
                          <FileTreeNode
                            key={node.path}
                            node={node}
                            level={0}
                            selectedPath={selectedPreviewPath}
                            expandedDirectories={expandedDirectories}
                            onToggleDirectory={handleToggleDirectory}
                            onSelectFile={handleSelectFile}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("detail.noFiles")}</p>
                    )}
                  </section>

                  {/* Discover metadata */}
                  <section aria-label={t("detail.metadataRegion")}>
                    <SectionLabel>{t("detail.metadata")}</SectionLabel>
                    <div className="space-y-2.5">
                      <div className="space-y-0.5">
                        <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                          {t("discover.platform")}
                        </div>
                        <div className="font-mono text-xs text-foreground break-all leading-relaxed inline-flex items-center gap-1">
                          <Monitor className="size-3.5" />
                          <span>{discoverMetadata.platformName}</span>
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                          {t("discover.project")}
                        </div>
                        <div className="font-mono text-xs text-foreground break-all leading-relaxed inline-flex items-center gap-1">
                          <FolderOpen className="size-3.5" />
                          <span>{discoverMetadata.projectName}</span>
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                          {t("discover.filePath")}
                        </div>
                        <button
                          type="button"
                          onClick={handleOpenDiscoverPath}
                          className="font-mono text-xs text-foreground break-all leading-relaxed hover:text-primary hover:underline cursor-pointer text-left"
                        >
                          {discoverMetadata.filePath}
                        </button>
                      </div>
                    </div>
                  </section>
                </>
              ) : detail ? (
                <>
                  <section aria-label={t("detail.filesRegion")}>
                    <SectionLabel>{t("detail.files")}</SectionLabel>
                    {isDirectoryTreeLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        {t("common.loading")}
                      </div>
                    ) : directoryTreeError ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {directoryTreeError}
                      </p>
                    ) : directoryTree.length > 0 ? (
                      <div className="space-y-1">
                        {directoryTree.map((node) => (
                          <FileTreeNode
                            key={node.path}
                            node={node}
                            level={0}
                            selectedPath={selectedPreviewPath}
                            expandedDirectories={expandedDirectories}
                            onToggleDirectory={handleToggleDirectory}
                            onSelectFile={handleSelectFile}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("detail.noFiles")}</p>
                    )}
                  </section>

                  {(detail.source_kind || detail.is_read_only) && (
                    <section
                      aria-label={t("detail.sourceStatusRegion", {
                        defaultValue: i18n.language.startsWith("zh") ? "来源状态" : "Source status",
                      })}
                    >
                      <SectionLabel>
                        {t("detail.sourceStatus", {
                          defaultValue: i18n.language.startsWith("zh") ? "来源状态" : "Source status",
                        })}
                      </SectionLabel>
                      <div className="rounded-lg border border-border/70 bg-muted/30 p-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {detail.source_kind && (
                            <SourceOriginBadge originKind={detail.source_kind} />
                          )}
                          {detail.is_read_only && <ReadOnlySourceBadge />}
                        </div>
                        {detail.is_read_only ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {t("detail.readOnlyDesc", {
                              defaultValue: i18n.language.startsWith("zh")
                                ? "插件安装的副本仅供查看，不能在这里安装、卸载或调整技能集。"
                                : "Plugin-installed copies are display-only here, so install, uninstall, and collection changes are unavailable.",
                            })}
                          </p>
                        ) : detail.source_kind === "user" ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {t("detail.userManagedDesc", {
                              defaultValue: i18n.language.startsWith("zh")
                                ? "此 Claude 用户副本会保留正常的安装状态与技能集管理能力。"
                                : "This Claude user copy keeps the normal install-state and collection-management controls.",
                            })}
                          </p>
                        ) : null}
                      </div>
                    </section>
                  )}

                  {/* Metadata */}
                  <section aria-label={t("detail.metadataRegion")}>
                    <SectionLabel>{t("detail.metadata")}</SectionLabel>
                    <div className="space-y-2.5">
                      <MetadataRow label={t("detail.filePath")} value={detail.file_path} />
                      {detail.dir_path && (
                        <MetadataRow
                          label={t("detail.directoryPath", {
                            defaultValue: i18n.language.startsWith("zh") ? "目录路径" : "Directory path",
                          })}
                          value={detail.dir_path}
                        />
                      )}
                      {detail.canonical_path && (
                        <MetadataRow label={t("detail.canonical")} value={detail.canonical_path} />
                      )}
                      {detail.source_root && (
                        <MetadataRow
                          label={t("detail.sourceRoot", {
                            defaultValue: i18n.language.startsWith("zh") ? "来源根目录" : "Source root",
                          })}
                          value={detail.source_root}
                        />
                      )}
                      {!detail.source_kind && detail.source && (
                        <MetadataRow label={t("detail.source")} value={detail.source} />
                      )}
                      <MetadataRow
                        label={t("detail.scannedAt")}
                        value={new Date(detail.scanned_at).toLocaleString()}
                      />
                    </div>
                  </section>

                  {/* Install Status — compact icon grid */}
                  <section aria-label={t("detail.installStatusRegion")}>
                    <SectionLabel>{t("detail.installStatus")}</SectionLabel>
                    <div className="space-y-1.5">
                      {detail.is_read_only ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {t("detail.readOnlyInstallBlocked", {
                            defaultValue: i18n.language.startsWith("zh")
                              ? "插件来源的只读副本不可安装或卸载。"
                              : "Install and uninstall are unavailable for read-only plugin copies.",
                          })}
                        </p>
                      ) : targetAgents.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {t("detail.noPlatforms")}
                        </p>
                      ) : (
                        <>
                          {lobsterAgents.length > 0 && (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider w-12 shrink-0">
                                {t("sidebar.categoryLobster")}
                              </span>
                              <div className="flex items-center gap-0.5 flex-wrap">
                                {lobsterAgents.map((agent) => (
                                  <PlatformToggleIcon
                                    key={agent.id}
                                    agent={agent}
                                    skillName={detail.name}
                                    isInstalled={installationMap.has(agent.id)}
                                    isLoading={installingAgentId === agent.id}
                                    onToggle={() => handleToggle(agent.id)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                          {codingAgents.length > 0 && (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider w-12 shrink-0">
                                {t("sidebar.categoryCoding")}
                              </span>
                              <div className="flex items-center gap-0.5 flex-wrap">
                                {codingAgents.map((agent) => (
                                  <PlatformToggleIcon
                                    key={agent.id}
                                    agent={agent}
                                    skillName={detail.name}
                                    isInstalled={installationMap.has(agent.id)}
                                    isLoading={installingAgentId === agent.id}
                                    onToggle={() => handleToggle(agent.id)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </section>

                  {/* Collections */}
                  <section aria-label={t("detail.collections")}>
                    <SectionLabel>{t("detail.collections")}</SectionLabel>
                    {detail.is_read_only ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("detail.readOnlyCollectionsBlocked", {
                          defaultValue: i18n.language.startsWith("zh")
                            ? "插件来源的只读副本不可调整技能集。"
                            : "Collection management is unavailable for read-only plugin copies.",
                        })}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {skillCollections.map((collection) => (
                          <span
                            key={collection.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary ring-1 ring-primary/20"
                            title={collection.description ?? collection.name}
                          >
                            <Tag className="size-2.5" />
                            {collection.name}
                          </span>
                        ))}
                        <Button
                          ref={addToCollectionButtonRef}
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
                          aria-label={t("detail.addToCollection")}
                          onClick={() => setIsCollectionPickerOpen(true)}
                        >
                          <Plus className="size-3" />
                          {t("detail.addToCollection")}
                        </Button>
                      </div>
                    )}
                  </section>
                </>
              ) : null}
            </aside>
          </div>
        )}
      </div>

      {/* Collection Picker Dialog */}
      {skillId && !detail?.is_read_only && (
        <CollectionPickerDialog
          open={isCollectionPickerOpen}
          onOpenChange={handleCollectionPickerOpenChange}
          skillId={skillId}
          currentCollectionIds={skillCollections.map((collection) => collection.id)}
          onAdded={handleCollectionAdded}
        />
      )}
    </div>
  );
}
