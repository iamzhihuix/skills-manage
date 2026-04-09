import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw, PackageOpen } from "lucide-react";

import { useCentralSkillsStore } from "@/stores/centralSkillsStore";
import { usePlatformStore } from "@/stores/platformStore";
import { CentralSkillCard } from "@/components/central/CentralSkillCard";
import { InstallDialog } from "@/components/central/InstallDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SkillWithLinks } from "@/types";

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-20 text-muted-foreground">
      <PackageOpen className="size-10 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─── CentralSkillsView ────────────────────────────────────────────────────────

export function CentralSkillsView() {
  const skills = useCentralSkillsStore((state) => state.skills);
  const agents = useCentralSkillsStore((state) => state.agents);
  const isLoading = useCentralSkillsStore((state) => state.isLoading);
  const loadCentralSkills = useCentralSkillsStore(
    (state) => state.loadCentralSkills
  );
  const installSkill = useCentralSkillsStore((state) => state.installSkill);

  // Keep the platform sidebar counts in sync after install.
  const rescan = usePlatformStore((state) => state.rescan);

  const [searchQuery, setSearchQuery] = useState("");
  const [installTargetSkill, setInstallTargetSkill] =
    useState<SkillWithLinks | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Load central skills on mount.
  useEffect(() => {
    loadCentralSkills();
  }, [loadCentralSkills]);

  // Filter skills by search query.
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q)
    );
  }, [skills, searchQuery]);

  function handleInstallClick(skill: SkillWithLinks) {
    setInstallTargetSkill(skill);
    setIsDialogOpen(true);
  }

  async function handleInstall(skillId: string, agentIds: string[], method: string) {
    await installSkill(skillId, agentIds, method);
    // Refresh sidebar counts after install.
    await rescan();
  }

  async function handleRefresh() {
    // Re-scan the filesystem first so new/removed skills are picked up,
    // then reload central skills from the (now-updated) database.
    await rescan();
    await loadCentralSkills();
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Central Skills</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            ~/.agents/skills/
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={isLoading}
          aria-label="Refresh central skills"
        >
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Search bar */}
      <div className="px-6 py-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search central skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
            aria-label="Search central skills"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <EmptyState message="Loading skills..." />
        ) : skills.length === 0 ? (
          <EmptyState message="No skills in Central Skills (~/.agents/skills/)" />
        ) : filteredSkills.length === 0 ? (
          <EmptyState message={`No skills match "${searchQuery}"`} />
        ) : (
          <div className="space-y-3">
            {filteredSkills.map((skill) => (
              <CentralSkillCard
                key={skill.id}
                skill={skill}
                agents={agents}
                onInstallClick={handleInstallClick}
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
        agents={agents}
        onInstall={handleInstall}
      />
    </div>
  );
}
