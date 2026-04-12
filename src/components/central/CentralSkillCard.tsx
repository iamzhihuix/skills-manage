import { Check, X, PackagePlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AgentWithStatus, SkillWithLinks } from "@/types";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/platform/PlatformIcon";

// ─── Platform Link Badge ──────────────────────────────────────────────────────

interface PlatformBadgeProps {
  agent: AgentWithStatus;
  isLinked: boolean;
}

function PlatformBadge({ agent, isLinked }: PlatformBadgeProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex items-center gap-1 text-xs",
        isLinked ? "text-green-600 dark:text-green-400" : "text-muted-foreground/60"
      )}
      title={`${agent.display_name}: ${isLinked ? t("central.linked") : t("central.notLinked")}`}
    >
      <PlatformIcon agentId={agent.id} className="size-3 shrink-0" size={12} />
      {isLinked ? (
        <Check className="size-3 shrink-0" aria-label={t("central.linked")} />
      ) : (
        <X className="size-3 shrink-0" aria-label={t("central.notLinked")} />
      )}
      <span className="truncate max-w-[5rem]">{agent.display_name}</span>
    </div>
  );
}

// ─── CentralSkillCard ─────────────────────────────────────────────────────────

interface CentralSkillCardProps {
  skill: SkillWithLinks;
  /** All agents except the 'central' agent itself. */
  agents: AgentWithStatus[];
  onInstallClick: (skill: SkillWithLinks) => void;
  className?: string;
}

export function CentralSkillCard({
  skill,
  agents,
  onInstallClick,
  className,
}: CentralSkillCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Only show non-central agents for link status.
  const targetAgents = agents.filter((a) => a.id !== "central");

  return (
    <Card size="sm" className={cn("flex flex-col", className)}>
      <CardContent className="flex flex-col flex-1 space-y-3">
        {/* Header row: name + action buttons */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            {/* Clickable skill name navigates to detail page */}
            <button
              className="font-medium text-sm text-foreground truncate hover:text-primary hover:underline text-left w-full"
              onClick={() => navigate(`/skill/${skill.id}`)}
              aria-label={t("central.viewDetailsLabel", { name: skill.name })}
            >
              {skill.name}
            </button>
            {skill.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {skill.description}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Detail [详情] button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/skill/${skill.id}`)}
              className="text-xs text-muted-foreground"
              aria-label={t("central.viewDetailsLabel", { name: skill.name })}
            >
              {t("central.viewDetails")}
            </Button>

            {/* Install to... button */}
            <Button
              variant="default"
              size="sm"
              onClick={() => onInstallClick(skill)}
              aria-label={t("central.installLabel", { name: skill.name })}
            >
              <PackagePlus className="size-3.5" />
              <span>{t("central.installTo")}</span>
            </Button>
          </div>
        </div>

        {/* Per-platform link status — pushed to bottom so cards align in grid */}
        {targetAgents.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-auto">
            {targetAgents.map((agent) => (
              <PlatformBadge
                key={agent.id}
                agent={agent}
                isLinked={skill.linked_agents.includes(agent.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
