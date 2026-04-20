import {
  PackagePlus,
  Check,
  Link2,
  FolderOpen,
  Folder,
  Globe,
  ArrowUpRight,
  Plus,
  ChevronRight,
  X,
  Loader2,
} from "lucide-react";
import type { MouseEventHandler, Ref } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { PlatformIcon } from "@/components/platform/PlatformIcon";
import { AgentWithStatus } from "@/types";
import { cn } from "@/lib/utils";

// ─── Platform Toggle Icon (internal) ──────────────────────────────────────────

function PlatformToggleIcon({
  agent,
  skillName,
  isLinked,
  isToggling,
  onToggle,
}: {
  agent: AgentWithStatus;
  skillName: string;
  isLinked: boolean;
  isToggling: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      className={cn(
        "p-1 rounded-md transition-colors cursor-pointer",
        isLinked
          ? "text-primary hover:bg-primary/15"
          : "text-muted-foreground/40 hover:bg-muted/60 hover:text-muted-foreground",
        isToggling && "animate-pulse pointer-events-none"
      )}
      title={agent.display_name}
      aria-label={t("central.toggleInstallLabel", { platform: agent.display_name, skill: skillName })}
      disabled={isToggling}
      onClick={onToggle}
    >
      <PlatformIcon agentId={agent.id} className="size-4 shrink-0" size={16} />
    </button>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UnifiedSkillCardProps {
  /** Core data — always required. */
  name: string;
  description?: string;
  className?: string;

  /** Click the card itself (platform variant navigates to detail). */
  onClick?: () => void;

  // ── discover variant ──
  checkbox?: { checked: boolean; onChange: () => void };
  isCentral?: boolean;
  platformBadge?: { id: string; name: string };
  projectBadge?: string;

  // ── central variant ──
  platformIcons?: {
    agents: AgentWithStatus[];
    linkedAgents: string[];
    skillId: string;
    onToggle: (skillId: string, agentId: string) => void;
    togglingAgentId: string | null;
  };

  // ── platform variant ──
  sourceType?: "symlink" | "copy" | "native";

  // ── marketplace variant ──
  isInstalled?: boolean;
  tags?: { key: string; label: string }[];
  publisher?: string;

  // ── actions (pass only the ones relevant to the context) ──
  onDetail?: MouseEventHandler<HTMLButtonElement>;
  onInstallTo?: () => void;
  onInstallToCentral?: () => void;
  onInstallToPlatform?: () => void;
  onInstall?: () => void;
  onRemove?: () => void;
  isLoading?: boolean;
  detailButtonRef?: Ref<HTMLButtonElement>;
}

// ─── UnifiedSkillCard ─────────────────────────────────────────────────────────

export function UnifiedSkillCard(props: UnifiedSkillCardProps) {
  const { t } = useTranslation();
  const {
    name,
    description,
    className,
    onClick,
    checkbox,
    isCentral,
    platformBadge,
    projectBadge,
    platformIcons,
    sourceType,
    isInstalled,
    tags,
    publisher,
    onDetail,
    onInstallTo,
    onInstallToCentral,
    onInstallToPlatform,
    onInstall,
    onRemove,
    isLoading,
    detailButtonRef,
  } = props;

  // Determine variant features
  const hasCheckbox = !!checkbox;
  const hasPlatformIcons = !!platformIcons;
  const hasActions = !!(onDetail || onInstallTo || onInstallToCentral || onInstallToPlatform || onInstall || onRemove);

  // Split agents by category for platform icons
  const lobsterAgents = platformIcons?.agents.filter((a) => a.id !== "central" && a.category === "lobster") ?? [];
  const codingAgents = platformIcons?.agents.filter((a) => a.id !== "central" && a.category !== "lobster") ?? [];

  // ── Platform variant: clickable card style ──
  if (onClick && !hasActions && !hasCheckbox && !hasPlatformIcons) {
    return (
      <button
        role="button"
        onClick={onClick}
        className={cn(
          "w-full h-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl",
          className
        )}
        aria-label={t("platform.searchSkillLabel", { name })}
      >
        <div className="h-full flex flex-col rounded-xl bg-card ring-1 ring-border shadow-sm p-3 gap-3 transition-all hover:ring-primary/25 hover:bg-accent/30 cursor-pointer">
          <div className="flex flex-1 items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-medium text-sm text-foreground truncate">{name}</div>
              {description && (
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{description}</p>
              )}
              {sourceType && <SourceIndicator sourceType={sourceType} />}
            </div>
            <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-0.5" />
          </div>
        </div>
      </button>
    );
  }

  // ── Default card style (central, discover, marketplace) ──
  return (
    <div
      className={cn(
        "rounded-xl bg-card ring-1 ring-border shadow-sm p-3 flex flex-col transition-colors",
        checkbox?.checked && "ring-primary/40 bg-primary/5",
        isLoading && "opacity-50",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Optional checkbox (discover) */}
        {hasCheckbox && (
          <div className="pt-0.5">
            <Checkbox
              checked={checkbox.checked}
              onCheckedChange={checkbox.onChange}
              aria-label={t("discover.selectSkill")}
            />
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Row 1: Name + icon actions */}
          <div className="flex items-center justify-between gap-2">
            {/* Skill name — clickable if onDetail provided */}
            {onDetail ? (
              <button
                ref={detailButtonRef}
                className="font-medium text-sm text-foreground truncate hover:text-primary hover:underline text-left min-w-0 flex-1"
                onClick={onDetail}
                aria-label={t("central.viewDetailsLabel", { name })}
              >
                {name}
              </button>
            ) : (
              <h3 className="text-sm font-medium truncate min-w-0 flex-1">{name}</h3>
            )}

            {/* Icon action buttons */}
            {hasActions && (
              <div className="flex items-center gap-0.5 shrink-0">
                {/* Install To... (central / platform / collection / marketplace) */}
                {onInstallTo && (
                  <button
                    onClick={onInstallTo}
                    title={t("central.installTo")}
                    aria-label={t("central.installLabel", { name })}
                    className="p-1 rounded-md transition-colors text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  >
                    <PackagePlus className="size-4" />
                  </button>
                )}

                {/* Install to Central (discover) */}
                {onInstallToCentral && !isCentral && (
                  <button
                    onClick={onInstallToCentral}
                    disabled={isLoading}
                    title={t("discover.installToCentral")}
                    aria-label={t("discover.installToCentral")}
                    className="p-1 rounded-md transition-colors text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50 disabled:cursor-default"
                  >
                    {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
                  </button>
                )}

                {/* Install to Platform (discover) */}
                {onInstallToPlatform && (
                  <button
                    onClick={onInstallToPlatform}
                    disabled={isLoading}
                    title={t("discover.installToPlatform")}
                    aria-label={t("discover.installToPlatform")}
                    className="p-1 rounded-md transition-colors text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50 disabled:cursor-default"
                  >
                    {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  </button>
                )}

                {/* Marketplace installed indicator (disabled Check icon) */}
                {onInstall && isInstalled && (
                  <button
                    disabled
                    title={t("marketplace.installed")}
                    aria-label={t("marketplace.installed")}
                    className="p-1 rounded-md text-primary cursor-default"
                  >
                    <Check className="size-4" />
                  </button>
                )}

                {/* Remove (collection) */}
                {onRemove && (
                  <button
                    onClick={onRemove}
                    title={t("collection.removeSkillLabel", { name })}
                    aria-label={t("collection.removeSkillLabel", { name })}
                    className="p-1 rounded-md transition-colors text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Row 2: Description — full width, not compressed by actions */}
          {description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{description}</p>
          )}

          {/* Row 3: Info badges */}
          <div className="flex items-center gap-3 empty:hidden">
            {/* Source indicator (platform) */}
            {sourceType && <SourceIndicator sourceType={sourceType} />}

            {/* "Already in Central" badge */}
            {isCentral && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                <Globe className="size-3" />
                {t("discover.alreadyCentral")}
              </span>
            )}

            {/* Platform badge (discover) */}
            {platformBadge && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <PlatformIcon agentId={platformBadge.id} className="size-3" />
                {platformBadge.name}
              </span>
            )}

            {/* Project badge (discover) */}
            {projectBadge && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Folder className="size-3" />
                {projectBadge}
              </span>
            )}

            {/* Publisher (marketplace recommended) */}
            {publisher && (
              <span className="text-[10px] text-muted-foreground truncate">{publisher}</span>
            )}

            {/* Tags (marketplace recommended) */}
            {tags && tags.length > 0 && (
              <div className="flex items-center gap-1">
                {tags.slice(0, 2).map((tag) => (
                  <span key={tag.key} className="text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded">
                    {tag.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Row 3: Platform toggle icons (central) */}
          {hasPlatformIcons && (lobsterAgents.length > 0 || codingAgents.length > 0) && (
            <div className="space-y-1 mt-auto pt-1">
              {lobsterAgents.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider w-14 shrink-0">
                    {t("sidebar.categoryLobster")}
                  </span>
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {lobsterAgents.map((agent) => (
                      <PlatformToggleIcon
                        key={agent.id}
                        agent={agent}
                        skillName={name}
                        isLinked={platformIcons.linkedAgents.includes(agent.id)}
                        isToggling={platformIcons.togglingAgentId === agent.id}
                        onToggle={() => platformIcons.onToggle(platformIcons.skillId, agent.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {codingAgents.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider w-14 shrink-0">
                    {t("sidebar.categoryCoding")}
                  </span>
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {codingAgents.map((agent) => (
                      <PlatformToggleIcon
                        key={agent.id}
                        agent={agent}
                        skillName={name}
                        isLinked={platformIcons.linkedAgents.includes(agent.id)}
                        isToggling={platformIcons.togglingAgentId === agent.id}
                        onToggle={() => platformIcons.onToggle(platformIcons.skillId, agent.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Source Indicator (internal) ──────────────────────────────────────────────

function SourceIndicator({ sourceType }: { sourceType: string }) {
  const { t } = useTranslation();
  const isSymlink = sourceType === "symlink";
  const primaryLabel = isSymlink ? t("platform.sourceCentral") : t("platform.sourceStandalone");
  const secondaryLabel = isSymlink ? t("platform.sourceSymlinkLabel") : t("platform.sourceCopyLabel");

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isSymlink ? "text-primary/80" : "text-muted-foreground"
      )}
    >
      {isSymlink ? <Link2 className="size-3 shrink-0" /> : <FolderOpen className="size-3 shrink-0" />}
      <div className="inline-flex items-center gap-1">
        <span>{primaryLabel}</span>
        <span aria-hidden="true" className="h-px w-3 shrink-0 rounded-full bg-current opacity-40" />
        <span className="sr-only"> - </span>
        <span>{secondaryLabel}</span>
      </div>
    </div>
  );
}
