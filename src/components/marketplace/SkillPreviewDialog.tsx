import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  Download,
  Bot,
  FileText,
  Code,
  ExternalLink,
  Store,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { parseFrontmatter } from "@/lib/frontmatter";
import { setupExplanationStreamListeners } from "@/lib/explanationStream";
import { invoke, isTauriRuntime } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";

interface SkillPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillName: string;
  downloadUrl: string;
  description?: string;
  publisher?: string;
  sourceLabel?: string;
  sourceUrl?: string | null;
  installed?: boolean;
  onInstall: () => void;
  isInstalling: boolean;
  onAfterCloseFocus?: () => void;
}

export function SkillPreviewDialog({
  open,
  onOpenChange,
  skillName,
  downloadUrl,
  description,
  publisher,
  sourceLabel,
  sourceUrl,
  installed = false,
  onInstall,
  isInstalling,
  onAfterCloseFocus,
}: SkillPreviewDialogProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [viewMode, setViewMode] = useState<"markdown" | "raw">("markdown");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const explanationRequestRef = useRef(0);
  const explanationUnlistenRef = useRef<(() => void) | null>(null);
  const browserMode = !isTauriRuntime();

  const cleanupExplanation = useCallback(() => {
    explanationUnlistenRef.current?.();
    explanationUnlistenRef.current = null;
  }, []);

  const fetchContent = useCallback(async () => {
    setIsLoadingContent(true);
    try {
      const resp = await fetch(downloadUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setContent(await resp.text());
    } catch {
      setContent("Failed to load SKILL.md content.");
    } finally {
      setIsLoadingContent(false);
    }
  }, [downloadUrl]);

  useEffect(() => {
    if (open && downloadUrl) {
      setContent("");
      setExplanation(null);
      setExplanationError(null);
      setViewMode("markdown");
      fetchContent();
    }
  }, [open, downloadUrl, fetchContent]);

  useEffect(() => {
    if (!open) {
      cleanupExplanation();
      onAfterCloseFocus?.();
    }
  }, [open, onAfterCloseFocus, cleanupExplanation]);

  useEffect(() => cleanupExplanation, [cleanupExplanation]);

  async function handleExplain() {
    if (!content || browserMode) return;
    explanationRequestRef.current += 1;
    const requestId = explanationRequestRef.current;
    const skillId = `skill-preview:${downloadUrl}`;
    cleanupExplanation();
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

  const displayContent = content ? parseFrontmatter(content).body : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!right-0 !left-auto !top-0 !h-screen !w-[min(42rem,100vw)] !max-w-none !translate-x-0 !translate-y-0 rounded-none border-l border-border/80 bg-popover/95 p-0 shadow-2xl supports-backdrop-filter:backdrop-blur">
        <DialogHeader className="gap-0 border-b border-border/70 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>{skillName}</DialogTitle>
                {installed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <CheckCircle2 className="size-3.5" />
                    {t("marketplace.installed")}
                  </span>
                ) : null}
              </div>
              {description ? (
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {sourceLabel ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-1">
                    <Store className="size-3.5" />
                    {sourceLabel}
                  </span>
                ) : null}
                {publisher ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-1">
                    <Sparkles className="size-3.5" />
                    {publisher}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-1">
                  <ShieldCheck className="size-3.5" />
                  {browserMode
                    ? t("marketplace.previewModeBrowser")
                    : t("marketplace.previewModeDesktop")}
                </span>
              </div>
            </div>
            <DialogClose />
          </div>
        </DialogHeader>

        <DialogBody className="!max-h-none h-[calc(100vh-10rem)] space-y-5 px-6 py-5">
          <section className="grid gap-3 rounded-xl border border-border/70 bg-muted/15 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {t("marketplace.previewSourceLabel")}
              </div>
              <div className="text-sm font-medium text-foreground">
                {sourceLabel ?? publisher ?? t("marketplace.previewUnknownSource")}
              </div>
              <div className="break-all text-xs text-muted-foreground">{downloadUrl}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs transition-[color,box-shadow] hover:bg-accent hover:text-accent-foreground"
                >
                  <ExternalLink className="size-3.5" />
                  <span>{t("marketplace.previewOpenSource")}</span>
                </a>
              ) : null}
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs transition-[color,box-shadow] hover:bg-accent hover:text-accent-foreground"
              >
                <FileText className="size-3.5" />
                <span>{t("marketplace.previewOpenSkillMd")}</span>
              </a>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setViewMode("markdown")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors cursor-pointer",
                viewMode === "markdown"
                  ? "bg-primary/15 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/40"
              )}
            >
              <FileText className="size-3" />
              {t("detail.markdown")}
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors cursor-pointer",
                viewMode === "raw"
                  ? "bg-primary/15 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/40"
              )}
            >
              <Code className="size-3" />
              {t("detail.rawSource")}
            </button>

            <div className="flex-1" />

            <Button
              variant="outline"
              size="sm"
              onClick={handleExplain}
              disabled={isExplaining || !content || isLoadingContent || browserMode}
              className="h-8 text-xs"
            >
              {isExplaining ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Bot className="size-3" />
              )}
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

          {/* Content */}
          {isLoadingContent ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : viewMode === "markdown" ? (
            <div className="prose prose-sm dark:prose-invert max-w-none rounded-xl border border-border/70 bg-background/60 p-4 markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className="overflow-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-muted/30 p-4 text-xs">
              {content}
            </pre>
          )}

          {/* AI Explanation */}
          {(explanation || isExplaining || explanationError) && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-2">
                <Bot className="size-3.5" />
                {t("detail.aiExplanation")}
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
                <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {explanation}
                </div>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter className="px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button onClick={onInstall} disabled={isInstalling || installed}>
            {isInstalling ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : installed ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <Download className="size-3.5" />
            )}
            <span>{installed ? t("marketplace.installed") : t("marketplace.install")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
