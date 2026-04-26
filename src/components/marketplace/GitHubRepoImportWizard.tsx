import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileQuestion,
  GitBranch,
  Loader2,
  PartyPopper,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  DuplicateResolution,
  GitHubRepoImportResult,
  GitHubRepoPreview,
  GitHubSkillImportSelection,
  GitHubSkillPreview,
  AgentWithStatus,
  SkillWithLinks,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isTauriRuntime } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { InstallDialog, type InstallMethod } from "@/components/central/InstallDialog";
import { MarkdownPreview } from "@/components/marketplace/MarkdownPreview";
import {
  useMarketplaceStore,
  type GitHubImportAiSummaryEntry,
  type SkillMarkdownEntry,
} from "@/stores/marketplaceStore";

type WizardStep = "input" | "preview" | "confirm" | "result";

const EMPTY_SKILL_MARKDOWN: Record<string, SkillMarkdownEntry> = {};
const EMPTY_AI_SUMMARIES: Record<string, GitHubImportAiSummaryEntry> = {};
const noopFetchGitHubSkillMarkdown = async (
  _sourcePath: string,
  _downloadUrl: string,
) => {};
const noopGenerateGitHubImportAiSummary = async (
  _sourcePath: string,
  _skillName: string,
  _content: string,
  _lang: string,
) => {};

type SelectionState = {
  selected: boolean;
  resolution: DuplicateResolution;
  renamedSkillId: string;
};

type DetailTab = "overview" | "ai";

interface GitHubRepoImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoUrl: string;
  onRepoUrlChange: (value: string) => void;
  preview: GitHubRepoPreview | null;
  previewError: string | null;
  isPreviewLoading: boolean;
  isImporting: boolean;
  importResult: GitHubRepoImportResult | null;
  onPreview: () => Promise<GitHubRepoPreview | null> | GitHubRepoPreview | null;
  onImport: (
    selections: GitHubSkillImportSelection[],
  ) => Promise<GitHubRepoImportResult | void> | GitHubRepoImportResult | void;
  onReset: () => void;
  launcherLabel: string;
  availableAgents?: AgentWithStatus[];
  installableSkills?: SkillWithLinks[];
  onInstallImportedSkill?: (
    skillId: string,
    agentIds: string[],
    method: InstallMethod,
  ) => Promise<void>;
  onAfterImportSuccess?: (
    result: GitHubRepoImportResult,
  ) => Promise<void> | void;
  onOpenCentral?: () => void;
}

function buildInitialSelections(
  preview: GitHubRepoPreview | null,
): Record<string, SelectionState> {
  if (!preview) return {};
  return Object.fromEntries(
    preview.skills.map((skill) => [
      skill.sourcePath,
      {
        selected: true,
        resolution: skill.conflict ? "skip" : "overwrite",
        renamedSkillId: skill.skillId,
      },
    ]),
  );
}

function normalizeMessage(message: string) {
  return message.replace(/^Error:\s*/, "");
}

function looksLikeGitHubAuthGuidance(message: string) {
  return /github|rate limit|personal access token|pat|settings/i.test(message);
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function GitHubRepoImportWizard({
  open,
  onOpenChange,
  repoUrl,
  onRepoUrlChange,
  preview,
  previewError,
  isPreviewLoading,
  isImporting,
  importResult,
  onPreview,
  onImport,
  onReset,
  launcherLabel,
  availableAgents = [],
  installableSkills = [],
  onInstallImportedSkill,
  onAfterImportSuccess,
  onOpenCentral,
}: GitHubRepoImportWizardProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>(() =>
    importResult ? "result" : preview ? "preview" : "input",
  );
  const [selectionState, setSelectionState] = useState<
    Record<string, SelectionState>
  >(() => buildInitialSelections(preview));
  const [postImportTargetSkillId, setPostImportTargetSkillId] = useState<
    string | null
  >(null);
  const [selectedSkillPath, setSelectedSkillPath] = useState<string | null>(() =>
    preview?.skills[0]?.sourcePath ?? null,
  );
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [isRenameEditing, setIsRenameEditing] = useState(false);
  const detailScrollRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const browserMode = !isTauriRuntime();
  const skillMarkdown = useMarketplaceStore(
    (state) => state.githubImport.skillMarkdown,
  ) ?? EMPTY_SKILL_MARKDOWN;
  const aiSummaries = useMarketplaceStore(
    (state) => state.githubImport.aiSummaries,
  ) ?? EMPTY_AI_SUMMARIES;
  const fetchGitHubSkillMarkdown = useMarketplaceStore(
    (state) => state.fetchGitHubSkillMarkdown,
  ) ?? noopFetchGitHubSkillMarkdown;
  const generateGitHubImportAiSummary = useMarketplaceStore(
    (state) => state.generateGitHubImportAiSummary,
  ) ?? noopGenerateGitHubImportAiSummary;
  const importProgress = useMarketplaceStore(
    (state) => state.githubImport.importProgress,
  ) ?? null;
  const importStartedAt = useMarketplaceStore(
    (state) => state.githubImport.importStartedAt,
  ) ?? null;
  const [progressNow, setProgressNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) {
      setStep("input");
      setSelectionState({});
      setPostImportTargetSkillId(null);
      setSelectedSkillPath(null);
      setDetailTab("overview");
      return;
    }
    if (importResult) {
      setStep("result");
      return;
    }
    if (preview) {
      setSelectionState(buildInitialSelections(preview));
      setSelectedSkillPath((current) =>
        current && preview.skills.some((skill) => skill.sourcePath === current)
          ? current
          : (preview.skills[0]?.sourcePath ?? null),
      );
      setStep("preview");
      return;
    }
    setSelectedSkillPath(null);
    setStep("input");
  }, [open, preview, importResult]);

  const postImportSkill = useMemo(() => {
    if (!postImportTargetSkillId) return null;
    return (
      installableSkills.find((skill) => skill.id === postImportTargetSkillId) ??
      null
    );
  }, [installableSkills, postImportTargetSkillId]);

  const selectedSkills = useMemo(() => {
    if (!preview) return [];
    return preview.skills.filter(
      (skill) => selectionState[skill.sourcePath]?.selected,
    );
  }, [preview, selectionState]);

  const selectedPreviewSkill = useMemo(() => {
    if (!preview) return null;
    if (selectedSkillPath) {
      return (
        preview.skills.find(
          (skill) => skill.sourcePath === selectedSkillPath,
        ) ?? null
      );
    }
    return preview.skills[0] ?? null;
  }, [preview, selectedSkillPath]);
  const previewToolbarRepoHref = useMemo(() => {
    if (!preview) return null;
    return `https://github.com/${preview.repo.owner}/${preview.repo.repo}`;
  }, [preview]);

  const blockingConflict = useMemo(() => {
    return selectedSkills.find((skill) => {
      if (!skill.conflict) return false;
      const state = selectionState[skill.sourcePath];
      if (!state) return true;
      if (state.resolution === "skip") return false;
      if (state.resolution === "rename") {
        return !state.renamedSkillId.trim();
      }
      return false;
    });
  }, [selectedSkills, selectionState]);

  const isInputStep = step === "input" && !preview && !importResult;
  const showRepoToolbar =
    Boolean(preview) && (step === "preview" || step === "confirm");
  const showSharedShellBody = Boolean(preview || importResult);
  const footerMode =
    step === "result" ? "result" : step === "confirm" ? "confirm" : "preview";
  const dialogContentClassName = cn(
    "flex flex-col overflow-hidden p-0 transition-[width,max-width,height] duration-200 ease-out",
    isInputStep
      ? "h-auto max-h-[min(92vh,32rem)] !w-[min(92vw,48rem)] !max-w-[min(92vw,48rem)]"
      : "h-[min(90vh,760px)] !w-[min(94vw,1180px)] !max-w-[min(94vw,1180px)] xl:!w-[min(95vw,1280px)] xl:!max-w-[min(95vw,1280px)]",
  );
  const importProgressPercent = useMemo(() => {
    if (!importProgress) return 0;
    if (importProgress.totalBytes > 0) {
      return clampPercent(
        (importProgress.completedBytes / importProgress.totalBytes) * 100,
      );
    }
    if (importProgress.totalFiles > 0) {
      return clampPercent(
        (importProgress.completedFiles / importProgress.totalFiles) * 100,
      );
    }
    return importProgress.phase === "finalizing" ? 100 : 0;
  }, [importProgress]);
  const importEtaSeconds = useMemo(() => {
    if (
      !isImporting ||
      !importProgress ||
      !importStartedAt ||
      importProgressPercent <= 0 ||
      importProgressPercent >= 100
    ) {
      return null;
    }

    const elapsedMs = Math.max(0, progressNow - importStartedAt);
    if (elapsedMs < 1000) return null;

    const remainingRatio = (100 - importProgressPercent) / importProgressPercent;
    const etaSeconds = Math.ceil((elapsedMs * remainingRatio) / 1000);
    return Number.isFinite(etaSeconds) && etaSeconds > 0 ? etaSeconds : null;
  }, [
    importProgress,
    importProgressPercent,
    importStartedAt,
    isImporting,
    progressNow,
  ]);

  useEffect(() => {
    if (step === "preview") {
      detailScrollRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
    }
  }, [selectedSkillPath, step]);

  useEffect(() => {
    if (step === "preview") {
      setDetailTab("overview");
    }
  }, [selectedSkillPath, step]);

  useEffect(() => {
    if (!isImporting || !importProgress || !importStartedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setProgressNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [importProgress, importStartedAt, isImporting]);

  useEffect(() => {
    if (!selectedPreviewSkill) {
      setIsRenameEditing(false);
      return;
    }

    const currentSelection = selectionState[selectedPreviewSkill.sourcePath];
    const currentResolution =
      currentSelection?.resolution ??
      (selectedPreviewSkill.conflict ? "skip" : "overwrite");

    if (currentResolution !== "rename") {
      setIsRenameEditing(false);
    }
  }, [selectedPreviewSkill, selectionState]);

  useEffect(() => {
    if (!isRenameEditing) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [isRenameEditing]);

  useEffect(() => {
    if (step !== "preview") return;
    if (detailTab !== "overview") return;
    if (browserMode) return;
    if (!selectedPreviewSkill) return;
    fetchGitHubSkillMarkdown(
      selectedPreviewSkill.sourcePath,
      selectedPreviewSkill.downloadUrl,
    );
  }, [
    step,
    detailTab,
    browserMode,
    selectedPreviewSkill,
    fetchGitHubSkillMarkdown,
  ]);

  useEffect(() => {
    if (step !== "preview") return;
    if (detailTab !== "ai") return;
    if (!selectedPreviewSkill) return;

    const markdownEntry = skillMarkdown[selectedPreviewSkill.sourcePath];
    const content =
      markdownEntry?.status === "ready" && markdownEntry.content?.trim()
        ? markdownEntry.content
        : selectedPreviewSkill.description?.trim();

    if (!content) return;

    void generateGitHubImportAiSummary(
      selectedPreviewSkill.sourcePath,
      selectedPreviewSkill.skillName,
      content,
      i18n.language,
    );
  }, [
    step,
    detailTab,
    selectedPreviewSkill,
    skillMarkdown,
    generateGitHubImportAiSummary,
    i18n.language,
  ]);

  const selectedImportPayload = useMemo<GitHubSkillImportSelection[]>(() => {
    return selectedSkills.map((skill) => {
      const state = selectionState[skill.sourcePath];
      return {
        sourcePath: skill.sourcePath,
        resolution:
          state?.resolution ?? (skill.conflict ? "skip" : "overwrite"),
        renamedSkillId:
          state?.resolution === "rename"
            ? state.renamedSkillId.trim() || null
            : null,
      };
    });
  }, [selectedSkills, selectionState]);

  const skippedPreviewSkills = useMemo(
    () =>
      preview
        ? preview.skills.filter(
            (skill) => !selectionState[skill.sourcePath]?.selected,
          )
        : [],
    [preview, selectionState],
  );

  const decisionCounts = useMemo(() => {
    const counts = { write: 0, overwrite: 0, rename: 0, skip: 0 };

    selectedSkills.forEach((skill) => {
      const state = selectionState[skill.sourcePath];
      const resolution =
        state?.resolution ?? (skill.conflict ? "skip" : "overwrite");
      if (!skill.conflict) {
        counts.write += 1;
        return;
      }
      if (resolution === "overwrite") {
        counts.overwrite += 1;
        counts.write += 1;
      } else if (resolution === "rename") {
        counts.rename += 1;
        counts.write += 1;
      } else {
        counts.skip += 1;
      }
    });

    return counts;
  }, [selectedSkills, selectionState]);

  const canReview = selectedSkills.length > 0 && !blockingConflict;
  const canConfirm = canReview && decisionCounts.write > 0;

  const renamedSelections = useMemo(
    () =>
      selectedSkills.filter(
        (skill) => selectionState[skill.sourcePath]?.resolution === "rename",
      ),
    [selectedSkills, selectionState],
  );

  const overwriteSelections = useMemo(
    () =>
      selectedSkills.filter(
        (skill) =>
          skill.conflict &&
          selectionState[skill.sourcePath]?.resolution === "overwrite",
      ),
    [selectedSkills, selectionState],
  );

  const skippedConflictSelections = useMemo(
    () =>
      selectedSkills.filter(
        (skill) =>
          skill.conflict &&
          selectionState[skill.sourcePath]?.resolution === "skip",
      ),
    [selectedSkills, selectionState],
  );

  function updateSelection(
    skill: GitHubSkillPreview,
    next: Partial<SelectionState>,
  ) {
    setSelectionState((current) => ({
      ...current,
      [skill.sourcePath]: {
        ...current[skill.sourcePath],
        ...next,
      },
    }));
  }

  function startRenameEditing(skill: GitHubSkillPreview) {
    updateSelection(skill, {
      resolution: "rename",
      renamedSkillId:
        selectionState[skill.sourcePath]?.renamedSkillId || skill.skillId,
    });
    setIsRenameEditing(true);
  }

  function cancelRenameEditing(skill: GitHubSkillPreview) {
    const currentResolution =
      selectionState[skill.sourcePath]?.resolution ??
      (skill.conflict ? "skip" : "overwrite");

    if (currentResolution === "rename") {
      updateSelection(skill, { resolution: "skip" });
    }
    setIsRenameEditing(false);
  }

  function confirmRenameEditing(skill: GitHubSkillPreview) {
    const nextId =
      selectionState[skill.sourcePath]?.renamedSkillId?.trim() || skill.skillId;
    updateSelection(skill, {
      resolution: "rename",
      renamedSkillId: nextId,
    });
    setIsRenameEditing(false);
  }

  async function handlePreviewSubmit() {
    const nextSelectedSkillPath = selectedSkillPath;
    try {
      const nextPreview = await onPreview();
      if (nextPreview) {
        if (!preview) {
          setSelectedSkillPath(nextSelectedSkillPath);
        }
        setStep("preview");
        return;
      }
    } catch {
      // keep input step; recoverable error is rendered below the URL input
    }
    setStep("input");
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setPostImportTargetSkillId(null);
      onReset();
    }
    onOpenChange(nextOpen);
  }

  async function handleImportConfirmClick() {
    const result = await onImport(selectedImportPayload);
    if (result) {
      await onAfterImportSuccess?.(result);
    } else if (importResult) {
      await onAfterImportSuccess?.(importResult);
    }
  }

  function handleInstallImported(skillId: string) {
    setPostImportTargetSkillId(skillId);
  }

  async function handleInstallDialogConfirm(
    skillId: string,
    agentIds: string[],
    method: InstallMethod,
  ) {
    if (!onInstallImportedSkill) return;
    await onInstallImportedSkill(skillId, agentIds, method);
    setPostImportTargetSkillId(null);
  }

  function handleStartAnotherImport() {
    setSelectionState({});
    setPostImportTargetSkillId(null);
    setSelectedSkillPath(null);
    onReset();
    setStep("input");
  }

  function handleOpenCentralClick() {
    onOpenCentral?.();
    handleClose(false);
    navigate("/central");
  }

  function renderUrlInputBlock() {
    return (
      <div className="mt-4 rounded-xl border border-border/70 bg-muted/10 p-4">
        <label
          className="mb-2 block text-sm font-medium"
          htmlFor="github-repo-url"
        >
          {t("marketplace.githubRepoUrl")}
        </label>
        <div className="flex gap-2">
          <Input
            id="github-repo-url"
            value={repoUrl}
            onChange={(event) => onRepoUrlChange(event.target.value)}
            placeholder="https://github.com/owner/repo"
            className="flex-1"
          />
          <Button
            onClick={handlePreviewSubmit}
            disabled={isPreviewLoading || !repoUrl.trim()}
          >
            {isPreviewLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            <span>{t("marketplace.previewImport")}</span>
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {browserMode
            ? t("marketplace.githubImportDesktopOnlyHint")
            : t("marketplace.githubImportNoWriteHint")}
        </p>
        {browserMode ? (
          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{t("marketplace.githubImportDesktopOnlyState")}</span>
            </div>
          </div>
        ) : null}
        {previewError ? (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-2">
                <span className="block">{normalizeMessage(previewError)}</span>
                {looksLikeGitHubAuthGuidance(previewError) ? (
                  <span className="block text-xs text-destructive/90">
                    {t("marketplace.githubPatSettingsHint")}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderPreviewToolbar(currentPreview: GitHubRepoPreview) {
    return (
      <div
        className="mt-2 rounded-xl border border-border/60 bg-muted/10 px-4 py-2.5"
        data-testid="github-import-repo-toolbar"
      >
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                {t("marketplace.githubImportToolbarLabel")}
              </span>
              <span className="truncate text-sm font-semibold">
                {currentPreview.repo.owner}/{currentPreview.repo.repo}
              </span>
              {currentPreview.repo.branch ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {currentPreview.repo.branch}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                {t("marketplace.githubImportFoundSkills", {
                  count: currentPreview.skills.length,
                })}
              </span>
              <span>
                {t("marketplace.githubImportToolbarSelected", {
                  count: selectedSkills.length,
                })}
              </span>
              <span className="truncate text-muted-foreground/90">
                {currentPreview.repo.normalizedUrl}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 lg:justify-end">
            <a
              href={previewToolbarRepoHref ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
              <span>{t("marketplace.previewOpenSource")}</span>
            </a>
            <Button
              variant="outline"
              className="h-7"
              onClick={handlePreviewSubmit}
              disabled={isPreviewLoading || !repoUrl.trim()}
            >
              {isPreviewLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              <span>{t("marketplace.githubImportRepreview")}</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderImportProgressPanel() {
    if (!isImporting || !importProgress) return null;

    const progressLabel =
      importProgress.phase === "preparing"
        ? t("marketplace.githubImportProgressPhasePreparing")
        : importProgress.phase === "finalizing"
          ? t("marketplace.githubImportProgressPhaseFinalizing")
          : t("marketplace.githubImportProgressPhaseWriting");

    return (
      <div
        className="mb-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3"
        data-testid="github-import-progress-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">
            {t("marketplace.githubImportProgressTitle")}
          </div>
          <div className="text-xs text-muted-foreground">{progressLabel}</div>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary/10">
          {importProgressPercent > 0 ? (
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${importProgressPercent}%` }}
            />
          ) : (
            <div className="h-full w-1/3 rounded-full bg-primary/70 animate-pulse" />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {importProgress.totalFiles > 0 ? (
            <span>
              {t("marketplace.githubImportProgressFiles", {
                completed: importProgress.completedFiles,
                total: importProgress.totalFiles,
              })}
            </span>
          ) : null}
          <span>
            {t("marketplace.githubImportProgressPercent", {
              percent: Math.round(importProgressPercent),
            })}
          </span>
          {importEtaSeconds ? (
            <span>
              {t("marketplace.githubImportProgressEta", {
                seconds: importEtaSeconds,
              })}
            </span>
          ) : null}
        </div>

        {importProgress.currentSkill || importProgress.currentPath ? (
          <div className="mt-2 text-xs text-muted-foreground">
            {importProgress.currentSkill ? (
              <div>
                {t("marketplace.githubImportProgressSkill", {
                  skill: importProgress.currentSkill,
                })}
              </div>
            ) : null}
            {importProgress.currentPath ? (
              <div>
                {t("marketplace.githubImportProgressCurrentFile", {
                  path: importProgress.currentPath,
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderImportResultHub(currentImportResult: GitHubRepoImportResult) {
    return (
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden"
        data-testid="github-import-result-hub"
      >
        <div className="min-h-0 flex-1 overflow-y-auto space-y-5 pr-1">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300">
                <PartyPopper className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-emerald-700 dark:text-emerald-300">
                  <div className="text-base font-semibold">
                    {t("marketplace.githubImportSuccessTitle")}
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium">
                    {currentImportResult.repo.owner}/{currentImportResult.repo.repo}
                  </span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {t("marketplace.githubImportSuccessDesc", {
                    count: currentImportResult.importedSkills.length,
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border/70 bg-card/80 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("marketplace.githubImportDecision.import")}
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {currentImportResult.importedSkills.length}
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-card/80 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("marketplace.githubImportDecision.skip")}
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {currentImportResult.skippedSkills.length}
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-card/80 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("marketplace.githubImportResultInstalledReady")}
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {currentImportResult.importedSkills.length}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.95fr)]">
            <div className="rounded-xl border border-border/70 bg-card/80 p-4">
              <div className="text-sm font-semibold">
                {t("marketplace.githubImportResultImportedTitle")}
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {currentImportResult.importedSkills.map((skill) => (
                  <li
                    key={`${skill.sourcePath}-${skill.importedSkillId}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{skill.skillName}</div>
                      <code className="mt-1 inline-flex rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                        {skill.importedSkillId}
                      </code>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {t(`marketplace.duplicateResolution.${skill.resolution}`)}
                      </span>
                      {onInstallImportedSkill ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleInstallImported(skill.importedSkillId)}
                        >
                          <span>
                            {t("marketplace.githubImportInstallImportedSkill")}
                          </span>
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                <div className="text-sm font-semibold">
                  {t("marketplace.githubImportResultNextTitle")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("marketplace.githubImportResultNextDesc")}
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  {currentImportResult.importedSkills.length > 0 &&
                  onInstallImportedSkill ? (
                    <Button
                      className="justify-between"
                      onClick={() =>
                        handleInstallImported(
                          currentImportResult.importedSkills[0].importedSkillId,
                        )
                      }
                    >
                      <span>
                        {t("marketplace.githubImportResultActionInstall")}
                      </span>
                      <ArrowRight className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    className="justify-between"
                    onClick={handleOpenCentralClick}
                  >
                    <span>{t("marketplace.githubImportResultActionCentral")}</span>
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="justify-between"
                    onClick={handleStartAnotherImport}
                  >
                    <span>{t("marketplace.githubImportResultActionRestart")}</span>
                    <RefreshCw className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                <div className="text-sm font-semibold">
                  {t("marketplace.githubImportResultSkippedTitle")}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {currentImportResult.skippedSkills.length > 0
                    ? currentImportResult.skippedSkills.join(", ")
                    : t("marketplace.githubImportResultSkippedNone")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={dialogContentClassName}>
        <div
          className="shrink-0 border-b border-border/70 px-6 pb-2.5 pt-4"
          data-testid="github-import-compact-header"
        >
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pr-10">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                <DialogTitle className="flex items-center gap-2 text-[1.05rem]">
                  <GitBranch className="size-5" />
                  <span>{t("marketplace.githubImportTitle")}</span>
                </DialogTitle>
                <DialogDescription className="text-xs leading-5 text-muted-foreground">
                  {t("marketplace.githubImportDesc", {
                    launcher: launcherLabel,
                  })}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-full border border-border/70 bg-muted/20 px-2.5 py-1 font-medium">
                  {t("marketplace.githubImportHeaderLauncher", {
                    launcher: launcherLabel,
                  })}
                </span>
              </div>
            </div>
          </DialogHeader>

          <div
            className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] text-muted-foreground"
            data-testid="github-import-flat-stepper"
          >
            {(["input", "preview", "confirm", "result"] as WizardStep[]).map(
              (item, index) => {
                const isActive =
                  step === item || (item === "preview" && step === "confirm");
                const isComplete =
                  (
                    ["input", "preview", "confirm", "result"] as WizardStep[]
                  ).indexOf(step) > index;

                return (
                  <Fragment key={item}>
                    <div
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 shadow-sm",
                        isActive
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : isComplete
                            ? "border-primary/20 bg-primary/5 text-primary/80"
                            : "border-border/70 bg-muted/20 text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
                          isActive || isComplete
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground",
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="font-medium">
                        {t(`marketplace.githubImportStep.${item}`)}
                      </span>
                    </div>
                    {index < 3 ? (
                      <div
                        className={cn(
                          "h-px min-w-4 flex-1",
                          isComplete ? "bg-primary/40" : "bg-border/80",
                        )}
                      />
                    ) : null}
                  </Fragment>
                );
              },
            )}
          </div>

          {showRepoToolbar && preview
            ? renderPreviewToolbar(preview)
            : step === "input"
              ? renderUrlInputBlock()
              : null}
        </div>

        <div
          className={cn(
            "px-6 py-4",
            showSharedShellBody
              ? "min-h-0 flex-1 overflow-hidden"
              : "overflow-visible",
          )}
        >
          {preview ? (
            step === "confirm" ? (
              <div
                className="flex h-full min-h-0 flex-col overflow-hidden"
                data-testid="github-import-confirm-summary"
              >
                <div className="min-h-0 flex-1 overflow-y-auto space-y-5 pr-1">
                  <div className="rounded-xl border border-border/70 bg-card/80 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold">
                          {t("marketplace.confirmImportTitle")}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {t("marketplace.confirmImportDesc", {
                            count: selectedSkills.length,
                          })}
                        </div>
                      </div>
                    </div>

                    <div
                      className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4"
                      data-testid="github-import-confirm-stats"
                    >
                      {(
                        [
                          [
                            "write",
                            t("marketplace.githubImportDecision.write"),
                            decisionCounts.write,
                          ],
                          [
                            "overwrite",
                            t("marketplace.githubImportDecision.overwrite"),
                            decisionCounts.overwrite,
                          ],
                          [
                            "rename",
                            t("marketplace.githubImportDecision.rename"),
                            decisionCounts.rename,
                          ],
                          [
                            "skip",
                            t("marketplace.githubImportDecision.skip"),
                            decisionCounts.skip,
                          ],
                        ] as const
                      ).map(([key, label, value]) => (
                        <div
                          key={key}
                          className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5"
                        >
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {label}
                          </div>
                          <div className="mt-1 text-2xl font-semibold leading-tight">
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>
                    {skippedPreviewSkills.length > 0 ? (
                      <div className="mt-3 text-xs text-muted-foreground">
                        {t("marketplace.githubImportDecisionHintUnselected", {
                          count: skippedPreviewSkills.length,
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
                    <div className="space-y-4">
                      <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                        <div className="text-sm font-semibold">
                          {t("marketplace.githubImportReadyListTitle")}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t("marketplace.githubImportReadyListDesc")}
                        </div>
                        <ul className="mt-4 space-y-2 text-sm">
                          {selectedSkills.map((skill) => {
                            const state = selectionState[skill.sourcePath];
                            const resolution = state?.resolution ?? "overwrite";
                            return (
                              <li
                                key={skill.sourcePath}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="font-medium">
                                    {skill.skillName}
                                  </div>
                                  <div className="mt-1 text-[11px] text-muted-foreground">
                                    {skill.sourcePath}
                                  </div>
                                </div>
                                <div className="text-right text-xs text-muted-foreground">
                                  <div>
                                    {t(
                                      `marketplace.duplicateResolution.${resolution}`,
                                    )}
                                  </div>
                                  {resolution === "rename" &&
                                  state?.renamedSkillId ? (
                                    <div className="mt-1 font-medium text-foreground">
                                      → {state.renamedSkillId}
                                    </div>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                        <div className="text-sm font-semibold">
                          {t("marketplace.githubImportConflictSummaryTitle")}
                        </div>
                        <div className="mt-3 space-y-3 text-sm">
                          <div>
                            <div className="font-medium">
                              {t("marketplace.githubImportDecision.overwrite")}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {overwriteSelections.length > 0
                                ? overwriteSelections
                                    .map((skill) => skill.skillName)
                                    .join(", ")
                                : t("marketplace.githubImportDecisionNone")}
                            </div>
                          </div>
                          <div>
                            <div className="font-medium">
                              {t("marketplace.githubImportDecision.rename")}
                            </div>
                            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                              {renamedSelections.length > 0 ? (
                                renamedSelections.map((skill) => {
                                  const renamedSkillId =
                                    selectionState[skill.sourcePath]
                                      ?.renamedSkillId;
                                  return (
                                    <div key={skill.sourcePath}>
                                      {skill.skillName} → {renamedSkillId}
                                    </div>
                                  );
                                })
                              ) : (
                                <div>
                                  {t("marketplace.githubImportDecisionNone")}
                                </div>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="font-medium">
                              {t("marketplace.githubImportDecision.skip")}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {skippedConflictSelections.length > 0 ||
                              skippedPreviewSkills.length > 0
                                ? [
                                    ...skippedConflictSelections.map(
                                      (skill) => skill.skillName,
                                    ),
                                    ...skippedPreviewSkills.map(
                                      (skill) => skill.skillName,
                                    ),
                                  ].join(", ")
                                : t("marketplace.githubImportDecisionNone")}
                            </div>
                          </div>
                        </div>
                      </div>

                      {blockingConflict ? (
                        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                          {t("marketplace.resolveConflictsBeforeImport")}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
                          {t("marketplace.githubImportConfirmCalmHint")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : step === "result" && importResult ? renderImportResultHub(importResult) : (
              <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
                <div
                  className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.45fr)] xl:grid-cols-[minmax(360px,0.88fr)_minmax(0,1.52fr)]"
                  data-testid="github-import-preview-workspace"
                >
                  <div className="flex min-h-[22rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/70 shadow-sm">
                    <div className="border-b border-border/60 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">
                          {t("marketplace.githubImportSelectionTitle")}
                        </div>
                        <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {preview.skills.length}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("marketplace.githubImportSelectionDesc", {
                          count: preview.skills.length,
                        })}
                      </div>
                    </div>

                    <div
                      className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
                      data-testid="github-import-summary-list"
                    >
                      {preview.skills.map((skill) => {
                        const state = selectionState[skill.sourcePath];
                        const selected = state?.selected ?? true;
                        const isActive =
                          selectedPreviewSkill?.sourcePath === skill.sourcePath;

                        return (
                          <button
                            key={skill.sourcePath}
                            type="button"
                            onClick={() =>
                              setSelectedSkillPath(skill.sourcePath)
                            }
                            className={cn(
                              "w-full rounded-xl border p-3 text-left transition-colors",
                              isActive
                                ? "border-primary/40 bg-primary/10 shadow-sm"
                                : "border-border/70 bg-background hover:border-primary/20 hover:bg-muted/30",
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                aria-label={t("marketplace.selectSkill")}
                                type="checkbox"
                                className="mt-1"
                                checked={selected}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  updateSelection(skill, {
                                    selected: event.target.checked,
                                  });
                                }}
                                onClick={(event) => event.stopPropagation()}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate text-sm font-semibold">
                                    {skill.skillName}
                                  </div>
                                </div>
                                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {skill.description ||
                                    t("marketplace.githubImportNoDescription")}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div
                    className="flex min-h-[22rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-sm"
                    data-testid="github-import-detail-pane"
                  >
                    {selectedPreviewSkill
                      ? (() => {
                          const currentSelection =
                            selectionState[selectedPreviewSkill.sourcePath];
                          const currentResolution =
                            currentSelection?.resolution ??
                            (selectedPreviewSkill.conflict
                              ? "skip"
                              : "overwrite");
                          const skillGithubHref = preview
                            ? `https://github.com/${preview.repo.owner}/${preview.repo.repo}/blob/${preview.repo.branch}/${selectedPreviewSkill.sourcePath}`
                            : null;
                          const resolvedRenameId =
                            currentSelection?.renamedSkillId?.trim() ||
                            selectedPreviewSkill.skillId;
                          const statusBadgeClassName =
                            !selectedPreviewSkill.conflict
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : currentResolution === "overwrite"
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : currentResolution === "rename"
                                  ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
                          return (
                            <>
                              <div className="border-b border-border/60 bg-background/50 px-5 pt-4 pb-3">
                                <div className="flex items-start gap-3">
                                  <div className="min-w-0 flex-1">
                                    {!isRenameEditing ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="min-w-0 truncate text-base font-semibold">
                                          {selectedPreviewSkill.skillName}
                                        </div>
                                        <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                                          {selectedPreviewSkill.skillId}
                                        </code>
                                        <span
                                          className={cn(
                                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                            statusBadgeClassName,
                                          )}
                                        >
                                          {!selectedPreviewSkill.conflict
                                            ? t(
                                                "marketplace.githubImportStatusReady",
                                              )
                                            : currentResolution === "overwrite"
                                              ? t(
                                                  "marketplace.githubImportStatusWillOverwrite",
                                                  {
                                                    name: selectedPreviewSkill
                                                      .conflict.existingName,
                                                  },
                                                )
                                              : currentResolution === "rename"
                                                ? t(
                                                    "marketplace.githubImportStatusWillRename",
                                                    {
                                                      id: resolvedRenameId,
                                                    },
                                                  )
                                                : t(
                                                    "marketplace.githubImportStatusWillSkip",
                                                    {
                                                      name: selectedPreviewSkill
                                                        .conflict.existingName,
                                                    },
                                                  )}
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                          {t("marketplace.githubImportIdLabel")}
                                        </span>
                                        <Input
                                          ref={renameInputRef}
                                          value={
                                            currentSelection?.renamedSkillId ??
                                            selectedPreviewSkill.skillId
                                          }
                                          onChange={(event) =>
                                            updateSelection(
                                              selectedPreviewSkill,
                                              {
                                                renamedSkillId:
                                                  event.target.value,
                                              },
                                            )
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.preventDefault();
                                              confirmRenameEditing(
                                                selectedPreviewSkill,
                                              );
                                            } else if (event.key === "Escape") {
                                              event.preventDefault();
                                              cancelRenameEditing(
                                                selectedPreviewSkill,
                                              );
                                            }
                                          }}
                                          placeholder={t(
                                            "marketplace.renameSkillIdPlaceholder",
                                          )}
                                          className="h-8 w-[min(24rem,100%)] font-mono text-sm"
                                        />
                                        <Button
                                          type="button"
                                          size="sm"
                                          onClick={() =>
                                            confirmRenameEditing(
                                              selectedPreviewSkill,
                                            )
                                          }
                                        >
                                          {t("common.confirm")}
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          onClick={() =>
                                            cancelRenameEditing(
                                              selectedPreviewSkill,
                                            )
                                          }
                                        >
                                          {t("common.cancel")}
                                        </Button>
                                      </div>
                                    )}
                                    <div className="mt-1 break-all text-[11px] text-muted-foreground">
                                      {!isRenameEditing ? (
                                        <>
                                          {selectedPreviewSkill.sourcePath}
                                          {selectedPreviewSkill.rootDirectory
                                            ? ` · ${t("marketplace.githubImportRootDirectory")}: ${selectedPreviewSkill.rootDirectory}`
                                            : ""}
                                        </>
                                      ) : (
                                        <>
                                          {selectedPreviewSkill.skillName}
                                          {" · "}
                                          {selectedPreviewSkill.sourcePath}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                                    {!isRenameEditing &&
                                    selectedPreviewSkill.conflict ? (
                                      currentResolution === "overwrite" ? (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          onClick={() =>
                                            updateSelection(
                                              selectedPreviewSkill,
                                              {
                                                resolution: "skip",
                                              },
                                            )
                                          }
                                        >
                                          {t(
                                            "marketplace.githubImportStatusResetDefault",
                                          )}
                                        </Button>
                                      ) : currentResolution === "rename" ? (
                                        <>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                              startRenameEditing(
                                                selectedPreviewSkill,
                                              )
                                            }
                                          >
                                            {t(
                                              "marketplace.githubImportStatusChangeToRename",
                                            )}
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                              updateSelection(
                                                selectedPreviewSkill,
                                                {
                                                  resolution: "skip",
                                                },
                                              )
                                            }
                                          >
                                            {t(
                                              "marketplace.githubImportStatusResetDefault",
                                            )}
                                          </Button>
                                        </>
                                      ) : (
                                        <>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                              updateSelection(
                                                selectedPreviewSkill,
                                                {
                                                  resolution: "overwrite",
                                                },
                                              )
                                            }
                                          >
                                            {t(
                                              "marketplace.githubImportStatusChangeToOverwrite",
                                            )}
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                              startRenameEditing(
                                                selectedPreviewSkill,
                                              )
                                            }
                                          >
                                            {t(
                                              "marketplace.githubImportStatusChangeToRename",
                                            )}
                                          </Button>
                                        </>
                                      )
                                    ) : null}
                                    {skillGithubHref && !isRenameEditing ? (
                                      <a
                                        href={skillGithubHref}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                        aria-label={t(
                                          "marketplace.githubImportOpenOnGithub",
                                        )}
                                        title={t(
                                          "marketplace.githubImportOpenOnGithub",
                                        )}
                                      >
                                        <ExternalLink className="size-3.5" />
                                      </a>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <div
                                className="border-b border-border/60 px-5"
                                data-testid="github-import-detail-tabs"
                              >
                                <div className="flex gap-5">
                                  {(
                                    [
                                      [
                                        "overview",
                                        t(
                                          "marketplace.githubImportDetailTabs.overview",
                                        ),
                                      ],
                                      [
                                        "ai",
                                        t(
                                          "marketplace.githubImportDetailTabs.ai",
                                        ),
                                      ],
                                    ] as const
                                  ).map(([tabId, label]) => {
                                    const isActive = detailTab === tabId;
                                    return (
                                      <button
                                        key={tabId}
                                        type="button"
                                        onClick={() => setDetailTab(tabId)}
                                        aria-selected={isActive}
                                        className={cn(
                                          "relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-0.5 py-2.5 text-xs font-medium transition-colors",
                                          isActive
                                            ? "border-primary text-foreground"
                                            : "border-transparent text-muted-foreground hover:text-foreground",
                                        )}
                                        data-testid={`github-import-detail-tab-${tabId}`}
                                      >
                                        <span>{label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div
                                ref={detailScrollRef}
                                className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
                                data-testid="github-import-detail-scroll"
                              >
                                {detailTab === "overview" ? (
                                  <div data-testid="github-import-detail-panel-overview">
                                    {browserMode ? (
                                      <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                                        <FileQuestion className="size-6 text-muted-foreground/70" />
                                        <span>
                                          {t(
                                            "marketplace.githubImportMarkdownBrowserFallback",
                                          )}
                                        </span>
                                      </div>
                                    ) : !skillMarkdown[
                                        selectedPreviewSkill.sourcePath
                                      ] ||
                                      skillMarkdown[
                                        selectedPreviewSkill.sourcePath
                                      ].status === "loading" ? (
                                      <div className="space-y-3 py-2">
                                        <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
                                        <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                                        <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                                        <div className="mt-5 h-3 w-2/3 animate-pulse rounded bg-muted" />
                                        <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
                                      </div>
                                    ) : skillMarkdown[
                                        selectedPreviewSkill.sourcePath
                                      ].status === "error" ? (
                                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                                        <AlertCircle className="size-6 text-destructive" />
                                        <div className="text-sm text-muted-foreground">
                                          {t(
                                            "marketplace.githubImportMarkdownError",
                                          )}
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() =>
                                            fetchGitHubSkillMarkdown(
                                              selectedPreviewSkill.sourcePath,
                                              selectedPreviewSkill.downloadUrl,
                                            )
                                          }
                                        >
                                          <RefreshCw className="size-3.5" />
                                          <span>
                                            {t(
                                              "marketplace.githubImportMarkdownRetry",
                                            )}
                                          </span>
                                        </Button>
                                      </div>
                                    ) : !skillMarkdown[
                                        selectedPreviewSkill.sourcePath
                                      ].content?.trim() ? (
                                      <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                                        <FileQuestion className="size-6 text-muted-foreground/70" />
                                        <span>
                                          {t(
                                            "marketplace.githubImportMarkdownEmpty",
                                          )}
                                        </span>
                                      </div>
                                    ) : (
                                      <MarkdownPreview
                                        content={
                                          skillMarkdown[
                                            selectedPreviewSkill.sourcePath
                                          ].content ?? ""
                                        }
                                      />
                                    )}
                                  </div>
                                ) : null}

                                {detailTab === "ai" ? (
                                  <div
                                    className="space-y-4"
                                    data-testid="github-import-detail-panel-ai"
                                  >
                                    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <div className="flex items-center gap-2 text-sm font-medium">
                                            <Sparkles className="size-4 text-primary" />
                                            <span>
                                              {t(
                                                "marketplace.githubImportAiSummaryTitle",
                                              )}
                                            </span>
                                          </div>
                                          <p className="mt-1 text-xs text-muted-foreground">
                                            {t(
                                              "marketplace.githubImportAiSummaryDesc",
                                            )}
                                          </p>
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => {
                                            const markdownEntry =
                                              skillMarkdown[
                                                selectedPreviewSkill.sourcePath
                                              ];
                                            const content =
                                              markdownEntry?.status ===
                                                "ready" &&
                                              markdownEntry.content?.trim()
                                                ? markdownEntry.content
                                                : (selectedPreviewSkill.description?.trim() ??
                                                  "");
                                            if (!content) return;
                                            void generateGitHubImportAiSummary(
                                              selectedPreviewSkill.sourcePath,
                                              selectedPreviewSkill.skillName,
                                              content,
                                              i18n.language,
                                              true,
                                            );
                                          }}
                                          disabled={
                                            aiSummaries[
                                              selectedPreviewSkill.sourcePath
                                            ]?.isLoading
                                          }
                                        >
                                          <RefreshCw className="size-3.5" />
                                          <span>
                                            {t("detail.regenerateExplanation")}
                                          </span>
                                        </Button>
                                      </div>
                                      {aiSummaries[
                                        selectedPreviewSkill.sourcePath
                                      ]?.isLoading || aiSummaries[
                                        selectedPreviewSkill.sourcePath
                                      ]?.isStreaming ? (
                                        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                                          <RefreshCw className="size-4 animate-spin" />
                                          {aiSummaries[
                                            selectedPreviewSkill.sourcePath
                                          ]?.summary
                                            ? t("detail.explanationStreaming")
                                            : t("detail.explanationLoading")}
                                        </div>
                                      ) : null}
                                      {aiSummaries[
                                        selectedPreviewSkill.sourcePath
                                      ]?.summary ? (
                                        <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                                          {
                                            aiSummaries[
                                              selectedPreviewSkill.sourcePath
                                            ]?.summary
                                          }
                                        </div>
                                      ) : aiSummaries[
                                          selectedPreviewSkill.sourcePath
                                        ]?.error ? (
                                        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                                          {
                                            aiSummaries[
                                              selectedPreviewSkill.sourcePath
                                            ]?.error
                                          }
                                        </div>
                                      ) : selectedPreviewSkill.description ? (
                                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                          {t(
                                            "marketplace.githubImportAiSummaryBody",
                                            {
                                              name: selectedPreviewSkill.skillName,
                                              description:
                                                selectedPreviewSkill.description,
                                            },
                                          )}
                                        </p>
                                      ) : (
                                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                          {t(
                                            "marketplace.githubImportAiSummaryFallback",
                                            {
                                              name: selectedPreviewSkill.skillName,
                                            },
                                          )}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </>
                          );
                        })()
                      : null}
                  </div>
                </div>
              </div>
            )
          ) : step === "result" && importResult ? (
            renderImportResultHub(importResult)
          ) : null}
        </div>

        {showSharedShellBody ? (
          <div
            className="shrink-0 border-t border-border/70 px-6 py-4"
            data-testid="github-import-shell-footer"
            data-footer-mode={footerMode}
          >
            {step === "confirm" ? renderImportProgressPanel() : null}
            {step === "result" ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleStartAnotherImport}>
                  <RefreshCw className="size-4" />
                  <span>
                    {t("marketplace.githubImportResultActionRestart")}
                  </span>
                </Button>
                <Button onClick={handleClose.bind(null, false)}>
                  <span>{t("common.close")}</span>
                </Button>
              </div>
            ) : step !== "confirm" ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep("input")}>
                  <RefreshCw className="size-4" />
                  <span>{t("common.retry")}</span>
                </Button>
                <Button
                  onClick={() => setStep("confirm")}
                  disabled={!canReview}
                >
                  <span>{t("marketplace.reviewImportSelection")}</span>
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep("preview")}>
                  <span>{t("marketplace.githubImportBackToPreview")}</span>
                </Button>
                <Button
                  onClick={handleImportConfirmClick}
                  disabled={!canConfirm || isImporting}
                >
                  {isImporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  <span>{t("common.import")}</span>
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>

      <InstallDialog
        open={Boolean(postImportSkill)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPostImportTargetSkillId(null);
          }
        }}
        skill={postImportSkill}
        agents={availableAgents}
        onInstall={handleInstallDialogConfirm}
      />
    </Dialog>
  );
}
