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
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
  onImport: (selections: GitHubSkillImportSelection[]) => Promise<void> | void;
  onReset: () => void;
  launcherLabel: string;
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
}: GitHubRepoImportWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>("input");
  const [selectionState, setSelectionState] = useState<Record<string, SelectionState>>({});

  useEffect(() => {
    if (!open) {
      setStep("input");
      setSelectionState({});
      return;
    }
    if (importResult) {
      setStep("result");
      return;
    }
    if (preview) {
      setSelectionState(buildInitialSelections(preview));
      setStep("preview");
      return;
    }
    setStep("input");
  }, [open, preview, importResult]);

  const selectedSkills = useMemo(() => {
    if (!preview) return [];
    return preview.skills.filter((skill) => selectionState[skill.sourcePath]?.selected);
  }, [preview, selectionState]);

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

  async function handleConfirmImport() {
    await onImport(selectedImportPayload);
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      onReset();
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-5" />
            <span>{t("marketplace.githubImportTitle")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("marketplace.githubImportDesc", { launcher: launcherLabel })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
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

          <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
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
              {t("marketplace.githubImportNoWriteHint")}
            </p>
            {previewError ? (
              <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{normalizeMessage(previewError)}</span>
                </div>
              </div>
            ) : null}
          </div>

          {preview ? (
            <div className="space-y-4">
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

              <div className="space-y-3">
                {preview.skills.map((skill) => {
                  const state = selectionState[skill.sourcePath];
                  const selected = state?.selected ?? true;
                  const resolution = state?.resolution ?? (skill.conflict ? "skip" : "overwrite");
                  return (
                    <div
                      key={skill.sourcePath}
                      className={cn(
                        "rounded-xl border p-4 transition-colors",
                        selected ? "border-primary/30 bg-primary/5" : "border-border/70 bg-card/40"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          aria-label={t("marketplace.selectSkill")}
                          type="checkbox"
                          className="mt-1"
                          checked={selected}
                          onChange={(event) =>
                            updateSelection(skill, { selected: event.target.checked })
                          }
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold">{skill.skillName}</div>
                            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {skill.skillId}
                            </code>
                            {skill.conflict ? (
                              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                                {t("marketplace.conflictDetected")}
                              </span>
                            ) : (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                                {t("marketplace.readyToImport")}
                              </span>
                            )}
                          </div>
                          {skill.description ? (
                            <p className="text-sm text-muted-foreground">{skill.description}</p>
                          ) : null}
                          <div className="text-xs text-muted-foreground">
                            <span>{skill.sourcePath}</span>
                          </div>
                        </div>
                      </div>

                      {selected && skill.conflict ? (
                        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                          <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
                            {t("marketplace.conflictWithExisting", {
                              name: skill.conflict.existingName,
                            })}
                          </div>
                          <div className="mt-2 grid gap-2 md:grid-cols-3">
                            {(["overwrite", "skip", "rename"] as DuplicateResolution[]).map((option) => (
                              <label
                                key={option}
                                className={cn(
                                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                                  resolution === option
                                    ? "border-primary bg-primary/10"
                                    : "border-border bg-background"
                                )}
                              >
                                <input
                                  type="radio"
                                  name={`resolution-${skill.sourcePath}`}
                                  checked={resolution === option}
                                  onChange={() => updateSelection(skill, { resolution: option })}
                                />
                                <span>{t(`marketplace.duplicateResolution.${option}`)}</span>
                              </label>
                            ))}
                          </div>
                          {resolution === "rename" ? (
                            <div className="mt-3">
                              <Input
                                value={state?.renamedSkillId ?? skill.skillId}
                                onChange={(event) =>
                                  updateSelection(skill, { renamedSkillId: event.target.value })
                                }
                                placeholder={t("marketplace.renameSkillIdPlaceholder")}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

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
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setStep("preview")}>
                      <span>{t("common.close")}</span>
                    </Button>
                    <Button onClick={handleConfirmImport} disabled={!canConfirm || isImporting}>
                      {isImporting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                      <span>{t("common.import")}</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
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
                    <span>{skill.skillName}</span>
                    <code className="rounded bg-background px-2 py-1 text-[11px]">
                      {skill.importedSkillId}
                    </code>
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
      </DialogContent>
    </Dialog>
  );
}
