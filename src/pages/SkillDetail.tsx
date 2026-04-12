import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  Check,
  Download,
  Trash2,
  Tag,
  Plus,
  FileText,
  Code,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSkillDetailStore } from "@/stores/skillDetailStore";
import { usePlatformStore } from "@/stores/platformStore";
import { CollectionPickerDialog } from "@/components/collection/CollectionPickerDialog";
import { AgentWithStatus, SkillInstallation } from "@/types";
import { cn } from "@/lib/utils";

// ─── Section Label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80 mb-3">
      {children}
    </div>
  );
}

// ─── MetadataRow ──────────────────────────────────────────────────────────────

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-muted-foreground shrink-0 w-24">{label}</span>
      <span className="font-mono text-xs text-foreground break-all leading-relaxed">
        {value}
      </span>
    </div>
  );
}

// ─── PlatformInstallRow ────────────────────────────────────────────────────────

interface PlatformInstallRowProps {
  agent: AgentWithStatus;
  installation: SkillInstallation | undefined;
  installingAgentId: string | null;
  onInstall: (agentId: string) => void;
  onUninstall: (agentId: string) => void;
}

function PlatformInstallRow({
  agent,
  installation,
  installingAgentId,
  onInstall,
  onUninstall,
}: PlatformInstallRowProps) {
  const { t } = useTranslation();
  const isInstalled = !!installation;
  const isLoading = installingAgentId === agent.id;

  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      {/* Status icon */}
      <div
        className={cn(
          "size-5 rounded-full flex items-center justify-center shrink-0",
          isInstalled
            ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
            : "bg-muted text-muted-foreground/40"
        )}
      >
        {isInstalled ? (
          <Check className="size-3" aria-label={t("detail.installed")} />
        ) : (
          <span className="size-2 rounded-full bg-current opacity-40" />
        )}
      </div>

      {/* Platform name + path + install timestamp */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{agent.display_name}</div>
        {isInstalled && installation?.installed_path && (
          <div className="text-xs text-muted-foreground font-mono truncate mt-0.5">
            {installation.installed_path}
          </div>
        )}
        {isInstalled && installation?.installed_at && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {t("detail.installedOn")}{" "}
            {new Date(installation.installed_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </div>
        )}
        {!isInstalled && (
          <div className="text-xs text-muted-foreground">{agent.global_skills_dir}</div>
        )}
      </div>

      {/* Action button */}
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : isInstalled ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onUninstall(agent.id)}
          aria-label={t("detail.uninstallFrom", { name: agent.display_name })}
          className="text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">{t("detail.uninstallFrom", { name: agent.display_name })}</span>
        </Button>
      ) : (
        <Button
          variant="default"
          size="sm"
          onClick={() => onInstall(agent.id)}
          aria-label={t("detail.installTo", { name: agent.display_name })}
          className="shrink-0 gap-1.5"
        >
          <Download className="size-3.5" />
          <span>{t("common.install")}</span>
        </Button>
      )}
    </div>
  );
}

// ─── Tab Toggle ───────────────────────────────────────────────────────────────

type PreviewTab = "markdown" | "raw";

interface TabToggleProps {
  activeTab: PreviewTab;
  onChange: (tab: PreviewTab) => void;
}

function TabToggle({ activeTab, onChange }: TabToggleProps) {
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
        {t("detail.markdown")}
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
    </div>
  );
}

// ─── SkillDetail ──────────────────────────────────────────────────────────────

export function SkillDetail() {
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Store data
  const detail = useSkillDetailStore((s) => s.detail);
  const content = useSkillDetailStore((s) => s.content);
  const isLoading = useSkillDetailStore((s) => s.isLoading);
  const installingAgentId = useSkillDetailStore((s) => s.installingAgentId);
  const error = useSkillDetailStore((s) => s.error);
  const loadDetail = useSkillDetailStore((s) => s.loadDetail);
  const installSkill = useSkillDetailStore((s) => s.installSkill);
  const uninstallSkill = useSkillDetailStore((s) => s.uninstallSkill);
  const reset = useSkillDetailStore((s) => s.reset);

  // Platform agents (loaded at app init)
  const agents = usePlatformStore((s) => s.agents);
  const rescan = usePlatformStore((s) => s.rescan);

  // Local UI state
  const [activeTab, setActiveTab] = useState<PreviewTab>("markdown");
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);

  // Load detail on mount / skillId change, reset on unmount
  useEffect(() => {
    if (skillId) {
      loadDetail(skillId);
    }
    return () => {
      reset();
    };
  }, [skillId, loadDetail, reset]);

  // ── Derived values ───────────────────────────────────────────────────────

  // Exclude the "central" agent from the install status list
  const targetAgents = agents.filter((a) => a.id !== "central");

  // Build a map of agentId → installation record for quick lookup
  const installationMap = new Map<string, SkillInstallation>(
    (detail?.installations ?? []).map((inst) => [inst.agent_id, inst])
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleInstall(agentId: string) {
    if (!skillId) return;
    try {
      await installSkill(skillId, agentId);
      // Refresh sidebar counts in background
      rescan();
    } catch (err) {
      toast.error(t("detail.installError", { error: String(err) }));
    }
  }

  async function handleUninstall(agentId: string) {
    if (!skillId) return;
    try {
      await uninstallSkill(skillId, agentId);
      // Refresh sidebar counts in background
      rescan();
    } catch (err) {
      toast.error(t("detail.uninstallError", { error: String(err) }));
    }
  }

  function handleCollectionAdded() {
    // Reload the skill detail to reflect updated collection membership.
    if (skillId) {
      loadDetail(skillId);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          aria-label={t("detail.goBack")}
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold truncate">
            {isLoading ? (skillId ?? "") : (detail?.name ?? skillId ?? "")}
          </h1>
          {detail?.description && (
            <p className="text-sm text-muted-foreground truncate mt-0.5">
              {detail.description}
            </p>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
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
                onClick={() => skillId && loadDetail(skillId)}
              >
                {t("detail.retry")}
              </Button>
            </div>
          </div>
        )}

        {/* Main content */}
        {!isLoading && !error && detail && (
          <div className="p-6 space-y-8 max-w-3xl">
            {/* ── Metadata ──────────────────────────────────────────────── */}
            <section aria-label={t("detail.metadataRegion")}>
              <SectionLabel>{t("detail.metadata")}</SectionLabel>
              <div className="space-y-2">
                <MetadataRow label={t("detail.filePath")} value={detail.file_path} />
                {detail.canonical_path && (
                  <MetadataRow label={t("detail.canonical")} value={detail.canonical_path} />
                )}
                {detail.source && (
                  <MetadataRow label={t("detail.source")} value={detail.source} />
                )}
                <MetadataRow
                  label={t("detail.scannedAt")}
                  value={new Date(detail.scanned_at).toLocaleString()}
                />
              </div>
            </section>

            {/* ── Installation Status ────────────────────────────────────── */}
            <section aria-label={t("detail.installStatusRegion")}>
              <SectionLabel>{t("detail.installStatus")}</SectionLabel>
              <div className="rounded-xl ring-1 ring-foreground/10 bg-card overflow-hidden px-4 py-1">
                {targetAgents.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-3">
                    {t("detail.noPlatforms")}
                  </p>
                ) : (
                  targetAgents.map((agent: AgentWithStatus) => (
                    <PlatformInstallRow
                      key={agent.id}
                      agent={agent}
                      installation={installationMap.get(agent.id)}
                      installingAgentId={installingAgentId}
                      onInstall={handleInstall}
                      onUninstall={handleUninstall}
                    />
                  ))
                )}
              </div>
            </section>

            {/* ── Collections ────────────────────────────────────────────── */}
            <section aria-label={t("detail.collections")}>
              <SectionLabel>{t("detail.collections")}</SectionLabel>
              <div className="flex flex-wrap gap-2 items-center">
                {(detail.collections ?? []).map((collectionId) => (
                  <span
                    key={collectionId}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary ring-1 ring-primary/20"
                  >
                    <Tag className="size-3" />
                    {collectionId}
                  </span>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                  aria-label={t("detail.addToCollection")}
                  onClick={() => setIsCollectionPickerOpen(true)}
                >
                  <Plus className="size-3.5" />
                  {t("detail.addToCollection")}
                </Button>
              </div>
            </section>

            {/* ── SKILL.md Preview ───────────────────────────────────────── */}
            <section aria-label={t("detail.preview")}>
              <div className="flex items-center justify-between mb-3">
                <SectionLabel>{t("detail.preview")}</SectionLabel>
                <TabToggle activeTab={activeTab} onChange={setActiveTab} />
              </div>

              <div className="rounded-xl ring-1 ring-foreground/10 bg-card overflow-hidden">
                {activeTab === "markdown" ? (
                  <div
                    className="markdown-body p-4 overflow-auto max-h-[60vh]"
                    role="tabpanel"
                    aria-label={t("detail.markdown")}
                  >
                    {content ? (
                      <ReactMarkdown>{content}</ReactMarkdown>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        {t("detail.noContent")}
                      </p>
                    )}
                  </div>
                ) : (
                  <pre
                    className="p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap break-words text-foreground/80"
                    role="tabpanel"
                    aria-label={t("detail.rawSource")}
                  >
                    {content ?? t("detail.noContent")}
                  </pre>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Collection Picker Dialog */}
      {skillId && (
        <CollectionPickerDialog
          open={isCollectionPickerOpen}
          onOpenChange={setIsCollectionPickerOpen}
          skillId={skillId}
          currentCollectionIds={detail?.collections ?? []}
          onAdded={handleCollectionAdded}
        />
      )}
    </div>
  );
}
