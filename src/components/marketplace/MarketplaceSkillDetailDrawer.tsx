import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { SkillDetailDrawer } from "@/components/skill/SkillDetailDrawer";
import { SkillFrontmatterCard } from "@/components/skill/SkillFrontmatterCard";
import { Button } from "@/components/ui/button";
import { parseFrontmatter } from "@/lib/frontmatter";
import { setupExplanationStreamListeners } from "@/lib/explanationStream";
import { invoke, isTauriRuntime } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { FileTreeNode } from "@/components/skill/FileTreeNode";
import { buildSkillDirectoryTree } from "@/lib/fileTree";
import type { SelectedSkillFile, SkillsShFileEntry } from "@/types";

export interface MarketplaceSkillDetail {
  id: string;
  name: string;
  downloadUrl: string;
  description?: string;
  publisher?: string;
  sourceLabel?: string;
  sourceUrl?: string | null;
  installed?: boolean;
  files?: SkillsShFileEntry[];
}

interface MarketplaceSkillDetailDrawerProps {
  open: boolean;
  skill: MarketplaceSkillDetail | null;
  onOpenChange: (open: boolean) => void;
  onInstall: () => void;
  isInstalling: boolean;
  onAfterCloseFocus?: () => void;
}

type ViewMode = "markdown" | "raw";

export function MarketplaceSkillDetailDrawer({
  open,
  skill,
  onOpenChange,
  onInstall,
  isInstalling,
  onAfterCloseFocus,
}: MarketplaceSkillDetailDrawerProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("markdown");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const explanationRequestRef = useRef(0);
  const explanationUnlistenRef = useRef<(() => void) | null>(null);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const browserMode = !isTauriRuntime();

  const directoryTree = useMemo(() => {
    if (!skill?.files) return [];
    return buildSkillDirectoryTree(skill.files);
  }, [skill?.files]);

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

  const cleanupExplanation = useCallback(() => {
    explanationUnlistenRef.current?.();
    explanationUnlistenRef.current = null;
  }, []);

  /** Derive a raw.githubusercontent.com URL for an individual file
   *  from the SKILL.md downloadUrl and the file's repo-relative path. */
  const getFileDownloadUrl = useCallback(
    (filePath: string): string => {
      if (!skill?.downloadUrl) return "";
      const rawBase = "https://raw.githubusercontent.com/";
      if (!skill.downloadUrl.startsWith(rawBase)) return "";
      const base = skill.downloadUrl.replace(/\/SKILL\.md(#|\?|$).*$/, "");
      const rest = base.slice(rawBase.length);
      const parts = rest.split("/");
      if (parts.length < 3) return "";
      return rawBase + parts[0] + "/" + parts[1] + "/" + parts[2] + "/" + filePath;
    },
    [skill?.downloadUrl]
  );

  const isMarkdownFile = useCallback((filePath: string): boolean => {
    return /\.md$/i.test(filePath);
  }, []);

  const fetchFileContent = useCallback(async (filePath: string) => {
    const url = getFileDownloadUrl(filePath);
    if (!url) return;
    setIsLoadingContent(true);
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      setContent(await resp.text());
    } catch {
      setContent("Failed to load file content.");
    } finally {
      setIsLoadingContent(false);
    }
  }, [getFileDownloadUrl]);

  /** Loads the initial content when the drawer opens. */
  const loadInitialContent = useCallback(async () => {
    if (!open || !skill) return;
    setContent("");
    setExplanation(null);
    setExplanationError(null);
    setShowExplanation(false);

    if (skill.files && skill.files.length > 0) {
      // skills.sh mode: default-select SKILL.md
      const skillMd = skill.files.find(
        (f) => !f.is_dir && f.name === "SKILL.md"
      );
      if (skillMd) {
        setSelectedFilePath(skillMd.path);
        setViewMode("markdown");
        await fetchFileContent(skillMd.path);
        return;
      }
      // No SKILL.md found; clear selection
      setSelectedFilePath(null);
      setViewMode("raw");
      return;
    }

    // Legacy mode: fetch downloadUrl directly
    if (skill.downloadUrl) {
      setSelectedFilePath(null);
      setViewMode("markdown");
      setIsLoadingContent(true);
      try {
        const resp = await fetch(skill.downloadUrl);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        setContent(await resp.text());
      } catch {
        setContent("Failed to load SKILL.md content.");
      } finally {
        setIsLoadingContent(false);
      }
    }
  }, [open, skill, fetchFileContent]);

  useEffect(() => {
    if (open && skill) {
      void loadInitialContent();
    }
  }, [open, skill, loadInitialContent]);

  function handleSelectFile(file: SelectedSkillFile) {
    setSelectedFilePath(file.path);
    setViewMode(isMarkdownFile(file.path) ? "markdown" : "raw");
    void fetchFileContent(file.path);
  }

  useEffect(() => {
    if (!open) {
      cleanupExplanation();
      onAfterCloseFocus?.();
    }
  }, [open, onAfterCloseFocus, cleanupExplanation]);

  useEffect(() => cleanupExplanation, [cleanupExplanation]);

  const displayContent = useMemo(() => {
    if (!content) return { frontmatterRaw: "", frontmatterData: {}, body: "" };
    return parseFrontmatter(content);
  }, [content]);

  async function handleExplain() {
    if (!content || browserMode || !skill) return;
    explanationRequestRef.current += 1;
    const requestId = explanationRequestRef.current;
    const skillId = `marketplace-preview:${skill.id}`;
    cleanupExplanation();
    setShowExplanation(true);
    setIsExplaining(true);
    setExplanation(null);
    setExplanationError(null);
    try {
      explanationUnlistenRef.current = await setupExplanationStreamListeners(skillId, {
        onChunk: (chunkText) => {
          if (requestId !== explanationRequestRef.current) return;
          setIsExplaining(false);
          setExplanation((prev) => `${prev ?? ""}${chunkText}`);
        },
        onComplete: (payload) => {
          if (requestId !== explanationRequestRef.current) return;
          cleanupExplanation();
          const nextExplanation = payload.explanation ?? "";
          if (nextExplanation.trim()) {
            setExplanation((prev) => payload.explanation ?? prev);
            setExplanationError(null);
          } else {
            setExplanation(null);
            setExplanationError("AI explanation returned no content.");
          }
          setIsExplaining(false);
        },
        onError: (payload) => {
          if (requestId !== explanationRequestRef.current) return;
          cleanupExplanation();
          setExplanation(null);
          setExplanationError(payload.error ?? "Unknown explanation error");
          setIsExplaining(false);
        },
      });
      await invoke("refresh_skill_explanation", {
        skillId,
        content,
        lang: i18n.language,
      });
    } catch (err) {
      cleanupExplanation();
      setExplanation(null);
      setExplanationError(String(err));
      setIsExplaining(false);
    }
  }

  return (
    <SkillDetailDrawer
      open={open}
      skillId={null}
      onOpenChange={onOpenChange}
    >
      {skill ? (
        <div className="flex h-full flex-col">
          <div className="border-b border-border px-6 py-3 flex items-center gap-3 shrink-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold truncate">{skill.name}</h1>
                {skill.installed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <CheckCircle2 className="size-3.5" />
                    {t("marketplace.installed")}
                  </span>
                ) : null}
              </div>
              {skill.description ? (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {skill.description}
                </p>
              ) : null}
            </div>
            <div className="flex border border-border rounded-lg p-0.5 gap-0.5 bg-muted/40">
              <button
                type="button"
                onClick={() => setViewMode("markdown")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  viewMode === "markdown"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FileText className="size-3.5" />
                {t("detail.markdown")}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("raw")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  viewMode === "raw"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FileText className="size-3.5" />
                {t("detail.rawSource")}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="flex h-full flex-col md:flex-row" data-testid="skill-detail-two-column-layout">
              <div className="flex-1 min-w-0 overflow-auto p-6 space-y-4">
                <section className="grid gap-3 rounded-xl border border-border/70 bg-muted/15 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="space-y-1">
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {t("marketplace.previewSourceLabel")}
                    </div>
                    <div className="text-sm font-medium text-foreground">
                      {skill.sourceLabel ?? skill.publisher ?? t("marketplace.previewUnknownSource")}
                    </div>
                    <div className="break-all text-xs text-muted-foreground">{skill.downloadUrl}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {skill.sourceUrl ? (
                      <a
                        href={skill.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs transition-[color,box-shadow] hover:bg-accent hover:text-accent-foreground"
                      >
                        <ExternalLink className="size-3.5" />
                        <span>{t("marketplace.previewOpenSource")}</span>
                      </a>
                    ) : null}
                    <a
                      href={skill.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs transition-[color,box-shadow] hover:bg-accent hover:text-accent-foreground"
                    >
                      <FileText className="size-3.5" />
                      <span>{t("marketplace.previewOpenSkillMd")}</span>
                    </a>
                  </div>
                </section>

                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (explanation && !showExplanation) {
                        setShowExplanation(true);
                      } else {
                        void handleExplain();
                      }
                    }}
                    disabled={isExplaining || !content || isLoadingContent || browserMode}
                    className="h-8 text-xs"
                  >
                    {isExplaining ? <Loader2 className="size-3 animate-spin" /> : <Bot className="size-3" />}
                    <span>{isExplaining ? t("detail.explanationStreaming") : t("detail.aiExplanation")}</span>
                  </Button>
                </div>

                {browserMode && (
                  <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                    {t(
                      "marketplace.previewBrowserFallback",
                      "Preview actions that need the Tauri bridge are unavailable in browser mode."
                    )}
                  </div>
                )}

                {showExplanation && (explanation || isExplaining || explanationError) ? (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-center justify-between gap-1.5 mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                        <Bot className="size-3.5" />
                        {t("detail.aiExplanation")}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowExplanation(false)}
                        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    {isExplaining ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        {t("detail.explanationStreaming")}
                      </div>
                    ) : explanationError ? (
                      <div className="text-sm text-destructive whitespace-pre-wrap leading-relaxed">
                        {explanationError}
                      </div>
                    ) : (
                      <div className="text-sm text-foreground leading-relaxed markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {explanation ?? ""}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                ) : null}

                {isLoadingContent ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                    <Loader2 className="size-4 animate-spin" />
                    {t("common.loading")}
                  </div>
                ) : viewMode === "markdown" && (!selectedFilePath || isMarkdownFile(selectedFilePath)) ? (
                  <div className="space-y-4">
                    {(!selectedFilePath || selectedFilePath.endsWith("/SKILL.md")) ? (
                      <SkillFrontmatterCard
                        data={displayContent.frontmatterData}
                        raw={displayContent.frontmatterRaw}
                      />
                    ) : null}
                    <div className="prose prose-sm dark:prose-invert max-w-none rounded-xl border border-border/70 bg-background/60 p-4 markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {displayContent.body}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <pre className="overflow-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-muted/30 p-4 text-xs">
                    {content}
                  </pre>
                )}
              </div>

              <aside
                data-testid="skill-detail-right-sidebar"
                className="w-full shrink-0 border-t border-border overflow-y-auto p-4 space-y-5 md:w-64 md:border-t-0 md:border-l"
              >
                {skill.files ? (
                  <section>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-2">
                      Files ({skill.files.length})
                    </div>
                    <div className="space-y-1">
                      {directoryTree.map((node) => (
                        <FileTreeNode
                          key={node.path}
                          node={node}
                          level={0}
                          selectedPath={selectedFilePath}
                          expandedDirectories={expandedDirectories}
                          onToggleDirectory={handleToggleDirectory}
                          onSelectFile={handleSelectFile}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
                <section>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-2">
                    {t("detail.metadata")}
                  </div>
                  <div className="space-y-2.5">
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                        {t("marketplace.previewSourceLabel")}
                      </div>
                      <div className="font-mono text-xs text-foreground break-all leading-relaxed inline-flex items-center gap-1">
                        <Store className="size-3.5" />
                        <span>{skill.sourceLabel ?? skill.publisher ?? t("marketplace.previewUnknownSource")}</span>
                      </div>
                    </div>
                    {skill.publisher ? (
                      <div className="space-y-0.5">
                        <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                          Publisher
                        </div>
                        <div className="font-mono text-xs text-foreground break-all leading-relaxed inline-flex items-center gap-1">
                          <Sparkles className="size-3.5" />
                          <span>{skill.publisher}</span>
                        </div>
                      </div>
                    ) : null}
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                        Runtime
                      </div>
                      <div className="font-mono text-xs text-foreground break-all leading-relaxed inline-flex items-center gap-1">
                        <ShieldCheck className="size-3.5" />
                        <span>{browserMode ? t("marketplace.previewModeBrowser") : t("marketplace.previewModeDesktop")}</span>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-2">
                    {t("detail.installStatus")}
                  </div>
                  <Button onClick={onInstall} disabled={isInstalling || skill.installed} className="w-full">
                    {isInstalling ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : skill.installed ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <FileText className="size-3.5" />
                    )}
                    <span>{skill.installed ? t("marketplace.installed") : t("marketplace.install")}</span>
                  </Button>
                </section>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </SkillDetailDrawer>
  );
}
