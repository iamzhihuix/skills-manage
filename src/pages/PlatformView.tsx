import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Search, Blocks } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { usePlatformStore } from "@/stores/platformStore";
import { useSkillStore } from "@/stores/skillStore";
import { useCentralSkillsStore } from "@/stores/centralSkillsStore";
import { Input } from "@/components/ui/input";
import { UnifiedSkillCard } from "@/components/skill/UnifiedSkillCard";
import { SkillDetailDrawer } from "@/components/skill/SkillDetailDrawer";
import { PlatformIcon } from "@/components/platform/PlatformIcon";
import { InstallDialog } from "@/components/central/InstallDialog";
import { ScannedSkill, SkillWithLinks } from "@/types";

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
      <div className="p-4 rounded-full bg-muted/60">
        <Blocks className="size-12 text-muted-foreground opacity-60" />
      </div>
      <p className="text-sm text-muted-foreground font-medium">{message}</p>
    </div>
  );
}

// ─── PlatformView ─────────────────────────────────────────────────────────────

export function PlatformView() {
  const { agentId } = useParams<{ agentId: string }>();
  const { t } = useTranslation();
  const agents = usePlatformStore((state) => state.agents);

  const skillsByAgent = useSkillStore((state) => state.skillsByAgent);
  const loadingByAgent = useSkillStore((state) => state.loadingByAgent);
  const getSkillsByAgent = useSkillStore((state) => state.getSkillsByAgent);

  const centralSkills = useCentralSkillsStore((state) => state.skills);
  const centralAgents = useCentralSkillsStore((state) => state.agents);
  const loadCentralSkills = useCentralSkillsStore((state) => state.loadCentralSkills);
  const installSkill = useCentralSkillsStore((state) => state.installSkill);
  const refreshCounts = usePlatformStore((state) => state.refreshCounts);

  const [searchQuery, setSearchQuery] = useState("");
  const [installTargetSkill, setInstallTargetSkill] = useState<SkillWithLinks | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [drawerSkill, setDrawerSkill] = useState<ScannedSkill | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const detailButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Load skills for this agent when agentId changes
  useEffect(() => {
    if (agentId) {
      getSkillsByAgent(agentId);
    }
  }, [agentId, getSkillsByAgent]);

  useEffect(() => {
    if (!contentRef.current) return;
    contentRef.current.scrollTop = 0;
  }, [agentId]);

  // Ensure central skills are loaded so we can resolve SkillWithLinks for InstallDialog.
  useEffect(() => {
    if (centralSkills.length === 0) {
      loadCentralSkills();
    }
  }, [centralSkills.length, loadCentralSkills]);

  function handleInstallClick(skillId: string) {
    const target = centralSkills.find((s) => s.id === skillId);
    if (!target) {
      toast.error(t("central.installError", { error: t("platform.notFound") }));
      return;
    }
    setInstallTargetSkill(target);
    setIsDialogOpen(true);
  }

  async function handleInstall(skillId: string, agentIds: string[], method: string) {
    try {
      const result = await installSkill(skillId, agentIds, method);
      await refreshCounts();
      if (agentId) {
        await getSkillsByAgent(agentId);
      }
      if (result.failed.length > 0) {
        const failedNames = result.failed.map((f) => f.agent_id).join(", ");
        toast.error(t("central.installPartialFail", { platforms: failedNames }));
      }
    } catch (err) {
      toast.error(t("central.installError", { error: String(err) }));
    }
  }

  const agent = agents.find((a) => a.id === agentId);
  const isLoading = agentId ? (loadingByAgent[agentId] ?? false) : false;

  // Memoize skills to avoid changing dependency reference on every render
  const skills = useMemo(
    () => (agentId ? (skillsByAgent[agentId] ?? []) : []),
    [agentId, skillsByAgent]
  );

  // Filter skills by search query using useMemo
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q)
    );
  }, [skills, searchQuery]);

  function getSkillRowKey(skill: ScannedSkill) {
    return skill.row_id ?? skill.id;
  }

  function setDetailButtonRef(rowKey: string, node: HTMLButtonElement | null) {
    detailButtonRefs.current[rowKey] = node;
  }

  function handleOpenDrawer(skill: ScannedSkill) {
    setDrawerSkill(skill);
    setIsDrawerOpen(true);
  }

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {t("platform.notFound")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2.5">
          <PlatformIcon agentId={agent.id} className="size-6 text-primary/70" size={24} />
          <h1 className="text-xl font-semibold">{agent.display_name}</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          {agent.global_skills_dir}
        </p>
      </div>

      {/* Search bar */}
      <div className="px-6 py-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t("platform.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 bg-muted/40"
          />
        </div>
      </div>

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <EmptyState message={t("platform.loading")} />
        ) : skills.length === 0 ? (
          <EmptyState
            message={t("platform.noSkills", { name: agent.display_name })}
          />
        ) : filteredSkills.length === 0 ? (
          <EmptyState
            message={t("platform.noMatch", { query: searchQuery })}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredSkills.map((skill) => (
              <UnifiedSkillCard
                key={getSkillRowKey(skill)}
                name={skill.name}
                description={skill.description}
                sourceType={skill.link_type as "symlink" | "copy" | "native"}
                onDetail={() => handleOpenDrawer(skill)}
                onInstallTo={() => handleInstallClick(skill.id)}
                detailButtonRef={(node) => setDetailButtonRef(getSkillRowKey(skill), node)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Install Dialog */}
      <InstallDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        skill={installTargetSkill}
        agents={centralAgents}
        onInstall={handleInstall}
      />

      <SkillDetailDrawer
        open={isDrawerOpen}
        skillId={drawerSkill?.id ?? null}
        agentId={agentId ?? null}
        rowId={drawerSkill?.row_id ?? null}
        onOpenChange={(open) => {
          setIsDrawerOpen(open);
          if (!open) {
            setDrawerSkill(null);
          }
        }}
        returnFocusRef={
          drawerSkill
            ? {
                current: detailButtonRefs.current[getSkillRowKey(drawerSkill)] ?? null,
              }
            : undefined
        }
      />
    </div>
  );
}
