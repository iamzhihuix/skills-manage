import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isTauriRuntime } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { InstallDialog } from "@/components/central/InstallDialog";

type WizardStep = "input" | "preview" | "confirm" | "result";

type SelectionState = {
  selected: boolean;
  resolution: DuplicateResolution;
  renamedSkillId: string;
};

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
  onPreview: () => Promise<void> | void;
  onImport: (
    selections: GitHubSkillImportSelection[]
  ) => Promise<GitHubRepoImportResult | void> | GitHubRepoImportResult | void;
  onReset: () => void;
  launcherLabel: string;
  availableAgents?: AgentWithStatus[];
  installableSkills?: SkillWithLinks[];
  onInstallImportedSkill?: (
    skillId: string,
    agentIds: string[],
    method: "symlink" | "copy"
  ) => Promise<void>;
  onAfterImportSuccess?: (result: GitHubRepoImportResult) => Promise<void> | void;
}

function buildInitialSelections(preview: GitHubRepoPreview | null): Record<string, SelectionState> {
  if (!preview) return {};
  return Object.fromEntries(
    preview.skills.map((skill) => [
      skill.sourcePath,
      {
        selected: true,
        resolution: skill.conflict ? "skip" : "overwrite",
        renamedSkillId: skill.skillId,
      },
    ])
  );
}

function normalizeMessage(message: string) {
  return message.replace(/^Error:\s*/, "");
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
}: GitHubRepoImportWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>("input");
  const [selectionState, setSelectionState] = useState<Record<string, SelectionState>>({});
  const [postImportTargetSkillId, setPostImportTargetSkillId] = useState<string | null>(null);
  const [selectedSkillPath, setSelectedSkillPath] = useState<string | null>(null);
  const browserMode = !isTauriRuntime();

  useEffect(() => {
    if (!open) {
      setStep("input");
      setSelectionState({});
      setPostImportTargetSkillId(null);
      setSelectedSkillPath(null);
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
          : preview.skills[0]?.sourcePath ?? null
      );
      setStep("preview");
      return;
    }
    setSelectedSkillPath(null);
    setStep("input");
  }, [open, preview, importResult]);

  const postImportSkill = useMemo(() => {
    if (!postImportTargetSkillId) return null;
    return installableSkills.find((skill) => skill.id === postImportTargetSkillId) ?? null;
  }, [installableSkills, postImportTargetSkillId]);

  const selectedSkills = useMemo(() => {
    if (!preview) return [];
    return preview.skills.filter((skill) => selectionState[skill.sourcePath]?.selected);
  }, [preview, selectionState]);

  const selectedPreviewSkill = useMemo(() => {
    if (!preview) return null;
    if (selectedSkillPath) {
      return preview.skills.find((skill) => skill.sourcePath === selectedSkillPath) ?? null;
    }
    return preview.skills[0] ?? null;
  }, [preview, selectedSkillPath]);

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

  const canConfirm = selectedSkills.length > 0 && !blockingConflict;

  const selectedImportPayload = useMemo<GitHubSkillImportSelection[]>(() => {
    return selectedSkills.map((skill) => {
      const state = selectionState[skill.sourcePath];
      return {
        sourcePath: skill.sourcePath,
        resolution: state?.resolution ?? (skill.conflict ? "skip" : "overwrite"),
        renamedSkillId:
          state?.resolution === "rename" ? state.renamedSkillId.trim() || null : null,
      };
    });
  }, [selectedSkills, selectionState]);

  function updateSelection(skill: GitHubSkillPreview, next: Partial<SelectionState>) {
    setSelectionState((current) => ({
      ...current,
      [skill.sourcePath]: {
        ...current[skill.sourcePath],
        ...next,
      },
    }));
  }

  async function handlePreviewSubmit() {
    await onPreview();
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
    method: "symlink" | "copy"
  ) {
    if (!onInstallImportedSkill) return;
    await onInstallImportedSkill(skillId, agentIds, method);
    setPostImportTargetSkillId(null);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex h-[min(92vh,860px)] w-[min(98vw,1520px)] max-w-[min(98vw,1520px)] flex-col overflow-hidden p-0 xl:w-[min(99vw,1680px)] xl:max-w-[min(99vw,1680px)]">
        <div className="shrink-0 border-b border-border/70 px-6 pb-4 pt-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="size-5" />
              <span>{t("marketplace.githubImportTitle")}</span>
            </DialogTitle>
            <DialogDescription>
              {t("marketplace.githubImportDesc", { launcher: launcherLabel })}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {(["input", "preview", "confirm", "result"] as WizardStep[]).map((item, index) => (
              <div key={item} className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border text-[11px] font-medium",
                    step === item || (item === "preview" && step === "confirm")
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground"
                  )}
                >
                  {index + 1}
                </div>
                <span>{t(`marketplace.githubImportStep.${item}`)}</span>
                {index < 3 ? <span>→</span> : null}
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-border/70 bg-muted/10 p-4">
            <label className="mb-2 block text-sm font-medium" htmlFor="github-repo-url">
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
              <Button onClick={handlePreviewSubmit} disabled={isPreviewLoading || !repoUrl.trim()}>
                {isPreviewLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
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
                  <span>{normalizeMessage(previewError)}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {preview ? (
            step === "confirm" ? (
              <div className="space-y-3 rounded-xl border border-border/70 bg-card/80 p-4">
                <div className="text-sm font-semibold">{t("marketplace.confirmImportTitle")}</div>
                <div className="text-sm text-muted-foreground">
                  {t("marketplace.confirmImportDesc", { count: selectedSkills.length })}
                </div>
                <ul className="space-y-2 text-sm">
                  {selectedSkills.map((skill) => {
                    const state = selectionState[skill.sourcePath];
                    return (
                      <li key={skill.sourcePath} className="flex items-center justify-between gap-3">
                        <span>{skill.skillName}</span>
                        <span className="text-xs text-muted-foreground">
                          {t(`marketplace.duplicateResolution.${state?.resolution ?? "overwrite"}`)}
                          {state?.resolution === "rename" && state.renamedSkillId
                            ? ` → ${state.renamedSkillId}`
                            : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {blockingConflict ? (
                  <div className="text-sm text-destructive">
                    {t("marketplace.resolveConflictsBeforeImport")}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-full flex-col gap-4">
                <div className="rounded-xl border border-border/70 bg-card/80 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {preview.repo.owner}/{preview.repo.repo}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("marketplace.githubImportFoundSkills", { count: preview.skills.length })}
                      </div>
                    </div>
                    <a
                      href={`https://github.com/${preview.repo.owner}/${preview.repo.repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="size-3.5" />
                      <span>{t("marketplace.previewOpenSource")}</span>
                    </a>
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.65fr)] xl:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.8fr)]">
                  <div className="flex min-h-[22rem] flex-col overflow-hidden rounded-xl border border-border/70 bg-card/70">
                    <div className="border-b border-border/60 px-4 py-3">
                      <div className="text-sm font-semibold">
                        {t("marketplace.githubImportSelectionTitle")}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("marketplace.githubImportSelectionDesc", { count: preview.skills.length })}
                      </div>
                    </div>

                    <div
                      className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
                      data-testid="github-import-summary-list"
                    >
                      {preview.skills.map((skill) => {
                        const state = selectionState[skill.sourcePath];
                        const selected = state?.selected ?? true;
                        const resolution =
                          state?.resolution ?? (skill.conflict ? "skip" : "overwrite");
                        const isActive = selectedPreviewSkill?.sourcePath === skill.sourcePath;

                        return (
                          <button
                            key={skill.sourcePath}
                            type="button"
                            onClick={() => setSelectedSkillPath(skill.sourcePath)}
                            className={cn(
                              "w-full rounded-xl border p-3 text-left transition-colors",
                              isActive
                                ? "border-primary/40 bg-primary/10 shadow-sm"
                                : "border-border/70 bg-background hover:border-primary/20 hover:bg-muted/30"
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
                                  updateSelection(skill, { selected: event.target.checked });
                                }}
                                onClick={(event) => event.stopPropagation()}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate text-sm font-semibold">
                                    {skill.skillName}
                                  </div>
                                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                    {skill.skillId}
                                  </code>
                                </div>
                                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {skill.description || t("marketplace.githubImportNoDescription")}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  {skill.conflict ? (
                                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                                      {t("marketplace.conflictDetected")}
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                                      {t("marketplace.readyToImport")}
                                    </span>
                                  )}
                                  {selected && skill.conflict ? (
                                    <span className="text-[11px] text-muted-foreground">
                                      {t(`marketplace.duplicateResolution.${resolution}`)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div
                    className="flex min-h-[22rem] flex-col overflow-hidden rounded-xl border border-border/70 bg-card/80"
                    data-testid="github-import-detail-pane"
                  >
                    {selectedPreviewSkill ? (
                      <>
                        <div className="border-b border-border/60 px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-base font-semibold">
                              {selectedPreviewSkill.skillName}
                            </div>
                            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {selectedPreviewSkill.skillId}
                            </code>
                            {selectedPreviewSkill.conflict ? (
                              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                                {t("marketplace.conflictDetected")}
                              </span>
                            ) : (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                                {t("marketplace.readyToImport")}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 break-all text-xs text-muted-foreground">
                            {selectedPreviewSkill.sourcePath}
                          </div>
                        </div>

                        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                          <div className="space-y-2">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t("marketplace.githubImportSkillDescription")}
                            </div>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                              {selectedPreviewSkill.description ||
                                t("marketplace.githubImportNoDescription")}
                            </p>
                          </div>

                          <div className="grid gap-3 text-sm sm:grid-cols-2">
                            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {t("marketplace.githubImportSkillFolder")}
                              </div>
                              <div className="mt-2 break-all text-sm">
                                {selectedPreviewSkill.skillDirectoryName}
                              </div>
                            </div>
                            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {t("marketplace.githubImportRootDirectory")}
                              </div>
                              <div className="mt-2 break-all text-sm">
                                {selectedPreviewSkill.rootDirectory}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t("marketplace.githubImportSelectionToggle")}
                            </div>
                            <label className="mt-3 flex items-center gap-3 text-sm">
                              <input
                                aria-label={t("marketplace.selectSkill")}
                                type="checkbox"
                                checked={
                                  selectionState[selectedPreviewSkill.sourcePath]?.selected ?? true
                                }
                                onChange={(event) =>
                                  updateSelection(selectedPreviewSkill, {
                                    selected: event.target.checked,
                                  })
                                }
                              />
                              <span>
                                {t("marketplace.githubImportSelectCurrentSkill")}
                              </span>
                            </label>
                          </div>

                          {(selectionState[selectedPreviewSkill.sourcePath]?.selected ?? true) &&
                          selectedPreviewSkill.conflict ? (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                              <div className="text-sm font-medium text-amber-700 dark:text-amber-300">
                                {t("marketplace.conflictWithExisting", {
                                  name: selectedPreviewSkill.conflict.existingName,
                                })}
                              </div>
                              <div className="mt-3 grid gap-2 md:grid-cols-3">
                                {(["overwrite", "skip", "rename"] as DuplicateResolution[]).map(
                                  (option) => (
                                    <label
                                      key={option}
                                      className={cn(
                                        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                                        (selectionState[selectedPreviewSkill.sourcePath]?.resolution ??
                                          "skip") === option
                                          ? "border-primary bg-primary/10"
                                          : "border-border bg-background"
                                      )}
                                    >
                                      <input
                                        type="radio"
                                        name={`resolution-${selectedPreviewSkill.sourcePath}`}
                                        checked={
                                          (selectionState[selectedPreviewSkill.sourcePath]
                                            ?.resolution ?? "skip") === option
                                        }
                                        onChange={() =>
                                          updateSelection(selectedPreviewSkill, {
                                            resolution: option,
                                          })
                                        }
                                      />
                                      <span>
                                        {t(`marketplace.duplicateResolution.${option}`)}
                                      </span>
                                    </label>
                                  )
                                )}
                              </div>
                              {(selectionState[selectedPreviewSkill.sourcePath]?.resolution ??
                                "skip") === "rename" ? (
                                <div className="mt-3">
                                  <Input
                                    value={
                                      selectionState[selectedPreviewSkill.sourcePath]
                                        ?.renamedSkillId ?? selectedPreviewSkill.skillId
                                    }
                                    onChange={(event) =>
                                      updateSelection(selectedPreviewSkill, {
                                        renamedSkillId: event.target.value,
                                      })
                                    }
                                    placeholder={t("marketplace.renameSkillIdPlaceholder")}
                                  />
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          ) : null}

          {importResult ? (
            <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-5" />
                <div className="text-sm font-semibold">{t("marketplace.githubImportSuccessTitle")}</div>
              </div>
              <div className="text-sm text-muted-foreground">
                {t("marketplace.githubImportSuccessDesc", {
                  count: importResult.importedSkills.length,
                })}
              </div>
              <ul className="space-y-2 text-sm">
                {importResult.importedSkills.map((skill) => (
                  <li key={`${skill.sourcePath}-${skill.importedSkillId}`} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div>{skill.skillName}</div>
                      <code className="mt-1 inline-flex rounded bg-background px-2 py-1 text-[11px]">
                        {skill.importedSkillId}
                      </code>
                    </div>
                    {onInstallImportedSkill ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleInstallImported(skill.importedSkillId)}
                      >
                        <span>{t("marketplace.githubImportInstallImportedSkill")}</span>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {importResult.skippedSkills.length > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {t("marketplace.githubImportSkipped", {
                    count: importResult.skippedSkills.length,
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {preview ? (
          <div className="shrink-0 border-t border-border/70 px-6 py-4">
            {step !== "confirm" ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep("input")}>
                  <RefreshCw className="size-4" />
                  <span>{t("common.retry")}</span>
                </Button>
                <Button onClick={() => setStep("confirm")} disabled={!canConfirm}>
                  <span>{t("marketplace.reviewImportSelection")}</span>
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep("preview")}>
                  <span>{t("common.close")}</span>
                </Button>
                <Button onClick={handleImportConfirmClick} disabled={!canConfirm || isImporting}>
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
