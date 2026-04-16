import { useState, useEffect, useCallback } from "react";
import { Loader2, Download, Bot, FileText, Code } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
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
import { cn } from "@/lib/utils";

interface SkillPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillName: string;
  downloadUrl: string;
  publisher?: string;
  onInstall: () => void;
  isInstalling: boolean;
}

export function SkillPreviewDialog({
  open,
  onOpenChange,
  skillName,
  downloadUrl,
  publisher,
  onInstall,
  isInstalling,
}: SkillPreviewDialogProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [viewMode, setViewMode] = useState<"markdown" | "raw">("markdown");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);

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
      setViewMode("markdown");
      fetchContent();
    }
  }, [open, downloadUrl, fetchContent]);

  async function handleExplain() {
    if (!content) return;
    setIsExplaining(true);
    setExplanation(null);
    try {
      const result = await invoke<string>("explain_skill", { content });
      setExplanation(result);
    } catch (err) {
      setExplanation(`Error: ${String(err)}`);
    } finally {
      setIsExplaining(false);
    }
  }

  // Strip YAML frontmatter for markdown display
  const displayContent = (() => {
    if (!content) return "";
    const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/);
    return match ? match[1].trim() : content;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[85vw] !max-w-4xl">
        <DialogHeader>
          <div>
            <DialogTitle>{skillName}</DialogTitle>
            {publisher && (
              <p className="text-xs text-muted-foreground mt-0.5">{publisher}</p>
            )}
          </div>
          <DialogClose />
        </DialogHeader>

        <DialogBody className="!max-h-[70vh] space-y-4">
          {/* Tab bar + actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("markdown")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors cursor-pointer",
                viewMode === "markdown"
                  ? "bg-primary/15 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/40"
              )}
            >
              <FileText className="size-3" />
              Markdown
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors cursor-pointer",
                viewMode === "raw"
                  ? "bg-primary/15 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/40"
              )}
            >
              <Code className="size-3" />
              Raw
            </button>

            <div className="flex-1" />

            <Button
              variant="outline"
              size="sm"
              onClick={handleExplain}
              disabled={isExplaining || !content || isLoadingContent}
              className="h-7 text-xs"
            >
              {isExplaining ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Bot className="size-3" />
              )}
              <span>{isExplaining ? "AI 解释中..." : "AI 解释"}</span>
            </Button>
          </div>

          {/* Content */}
          {isLoadingContent ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : viewMode === "markdown" ? (
            <div className="prose prose-sm dark:prose-invert max-w-none markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className="text-xs bg-muted/30 rounded-md p-4 overflow-auto whitespace-pre-wrap">
              {content}
            </pre>
          )}

          {/* AI Explanation */}
          {(explanation || isExplaining) && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary mb-2">
                <Bot className="size-3.5" />
                AI 解释
              </div>
              {isExplaining ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  正在分析这个 Skill 的用途...
                </div>
              ) : (
                <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {explanation}
                </div>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button onClick={onInstall} disabled={isInstalling}>
            {isInstalling ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            <span>{t("marketplace.install")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
