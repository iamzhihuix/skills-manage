import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { AgentWithStatus, SkillWithLinks } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type InstallMethod = "auto" | "symlink" | "copy";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: SkillWithLinks | null;
  /** All agents (the 'central' agent will be filtered out). */
  agents: AgentWithStatus[];
  onInstall: (skillId: string, agentIds: string[], method: InstallMethod) => Promise<void>;
}

// ─── InstallDialog ────────────────────────────────────────────────────────────

export function InstallDialog({
  open,
  onOpenChange,
  skill,
  agents,
  onInstall,
}: InstallDialogProps) {
  const { t } = useTranslation();
  // Only show non-central agents in the install dialog.
  const targetAgents = agents.filter((a) => a.id !== "central");

  // Track which agents are selected for installation.
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set()
  );
  const [installMethod, setInstallMethod] = useState<InstallMethod>("auto");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the dialog opens for a skill, pre-select currently unlinked agents.
  // Agents that already have this skill are checked by default too so the
  // user can see the full picture, but they can deselect any.
  useEffect(() => {
    if (open && skill) {
      // Default: check agents that are already linked (show current state).
      const initialSelection = new Set<string>(
        targetAgents
          .filter((a) => skill.linked_agents.includes(a.id))
          .map((a) => a.id)
      );
      setSelectedAgentIds(initialSelection);
      setInstallMethod("auto");
      setError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, skill?.id]);

  function handleCheckboxChange(agentId: string, checked: boolean) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(agentId);
      } else {
        next.delete(agentId);
      }
      return next;
    });
  }

  async function handleConfirm() {
    if (!skill) return;

    const agentIds = Array.from(selectedAgentIds);
    if (agentIds.length === 0) {
      setError(t("installDialog.selectPlatform"));
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await onInstall(skill.id, agentIds, installMethod);
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }

  if (!skill) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("installDialog.title", { name: skill.name })}</DialogTitle>
          <DialogClose />
        </DialogHeader>

        <DialogBody className="space-y-5">
          <DialogDescription>
            {t("installDialog.choosePlatforms")}
          </DialogDescription>

          {/* Platform checkboxes */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2" role="group" aria-label={t("installDialog.selectPlatforms")}>
            {targetAgents.length === 0 ? (
              <p className="col-span-2 text-sm text-muted-foreground">
                {t("installDialog.noPlatforms")}
              </p>
            ) : (
              targetAgents.map((agent) => {
                const isLinked = skill.linked_agents.includes(agent.id);
                const isChecked = selectedAgentIds.has(agent.id);

                return (
                  <div
                    key={agent.id}
                    className="flex items-center gap-2"
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) =>
                        handleCheckboxChange(agent.id, !!checked)
                      }
                      aria-label={agent.display_name}
                    />
                    <span
                      className="text-sm text-foreground flex-1 cursor-pointer select-none truncate"
                      onClick={() =>
                        handleCheckboxChange(agent.id, !isChecked)
                      }
                    >
                      {agent.display_name}
                    </span>
                    {isLinked && (
                      <span className="text-xs text-primary shrink-0">
                        {t("installDialog.alreadyLinked")}
                      </span>
                    )}
                    {!agent.is_detected && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {t("installDialog.notDetected")}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Install method selector */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("installDialog.installMethod")}
            </p>
            <RadioGroup
              value={installMethod}
              onValueChange={(v) => setInstallMethod(v as InstallMethod)}
            >
              <label className="flex items-center gap-2.5 cursor-pointer">
                <RadioItem value="auto" />
                <span className="text-sm">{t("installDialog.auto")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("installDialog.autoDesc")}
                </span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <RadioItem value="symlink" />
                <span className="text-sm">{t("installDialog.symlink")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("installDialog.symlinkDesc")}
                </span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <RadioItem value="copy" />
                <span className="text-sm">{t("installDialog.copy")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("installDialog.copyDesc")}
                </span>
              </label>
            </RadioGroup>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {t("installDialog.cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || selectedAgentIds.size === 0}
          >
            {isLoading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t("installDialog.installing")}
              </>
            ) : (
              t("installDialog.confirmInstall", { count: selectedAgentIds.size })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
