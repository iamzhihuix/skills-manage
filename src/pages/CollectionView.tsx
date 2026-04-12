import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Pencil,
  Trash2,
  Download,
  PackagePlus,
  X,
  Plus,
  Loader2,
  BookOpen,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCollectionStore } from "@/stores/collectionStore";
import { usePlatformStore } from "@/stores/platformStore";
import { CollectionEditor } from "@/components/collection/CollectionEditor";
import { SkillPickerDialog } from "@/components/collection/SkillPickerDialog";
import { CollectionInstallDialog } from "@/components/collection/CollectionInstallDialog";
import { Skill } from "@/types";

// ─── SkillRow ─────────────────────────────────────────────────────────────────

interface SkillRowProps {
  skill: Skill;
  collectionId: string;
  onRemove: () => void;
}

function SkillRow({ skill, onRemove }: SkillRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 py-2.5 px-4 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors group">
      <BookOpen className="size-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{skill.name}</div>
        {skill.description && (
          <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
            {skill.description}
          </div>
        )}
      </div>
      <button
        onClick={onRemove}
        aria-label={t("collection.removeSkillLabel", { name: skill.name })}
        className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ─── CollectionView ───────────────────────────────────────────────────────────

export function CollectionView() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const currentDetail = useCollectionStore((s) => s.currentDetail);
  const isLoadingDetail = useCollectionStore((s) => s.isLoadingDetail);
  const error = useCollectionStore((s) => s.error);
  const loadCollectionDetail = useCollectionStore((s) => s.loadCollectionDetail);
  const removeSkillFromCollection = useCollectionStore((s) => s.removeSkillFromCollection);
  const deleteCollection = useCollectionStore((s) => s.deleteCollection);
  const batchInstallCollection = useCollectionStore((s) => s.batchInstallCollection);
  const exportCollection = useCollectionStore((s) => s.exportCollection);
  const addSkillToCollection = useCollectionStore((s) => s.addSkillToCollection);

  const agents = usePlatformStore((s) => s.agents);

  // Dialog open states.
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Load collection detail on mount and when collectionId changes.
  useEffect(() => {
    if (collectionId) {
      loadCollectionDetail(collectionId);
    }
  }, [collectionId, loadCollectionDetail]);

  async function handleRemoveSkill(skillId: string) {
    if (!collectionId) return;
    try {
      await removeSkillFromCollection(collectionId, skillId);
    } catch (err) {
      toast.error(t("collection.removeSkillError", { error: String(err) }));
    }
  }

  async function handleDelete() {
    if (!collectionId || !currentDetail) return;
    if (!window.confirm(t("collection.deleteConfirm", { name: currentDetail.name }))) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteCollection(collectionId);
      navigate("/central");
    } catch (err) {
      setDeleteError(String(err));
      toast.error(t("collection.deleteError", { error: String(err) }));
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleExport() {
    if (!collectionId || !currentDetail) return;
    try {
      const json = await exportCollection(collectionId);
      // Trigger browser download.
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentDetail.name.replace(/\s+/g, "-").toLowerCase()}-collection.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(t("collection.exportError", { error: String(err) }));
    }
  }

  async function handleAddSkills(skillIds: string[]) {
    if (!collectionId) return;
    try {
      // Add skills sequentially.
      for (const skillId of skillIds) {
        await addSkillToCollection(collectionId, skillId);
      }
    } catch (err) {
      toast.error(t("collection.addSkillError", { error: String(err) }));
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (isLoadingDetail) {
    return (
      <div className="flex items-center justify-center h-full gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">{t("collection.loading")}</span>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (error && !currentDetail) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          {t("collection.goBack")}
        </Button>
      </div>
    );
  }

  if (!currentDetail) {
    return null;
  }

  // ── Main View ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold truncate">{currentDetail.name}</h1>
            {currentDetail.description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {currentDetail.description}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditorOpen(true)}
              aria-label={t("collection.editLabel")}
            >
              <Pencil className="size-3.5" />
              <span>{t("collection.edit")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              aria-label={t("collection.exportLabel")}
            >
              <Download className="size-3.5" />
              <span>{t("collection.export")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
              aria-label={t("collection.deleteLabel")}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            >
              {isDeleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              <span>{t("collection.delete")}</span>
            </Button>
          </div>
        </div>

        {deleteError && (
          <p className="text-xs text-destructive mt-2" role="alert">
            {deleteError}
          </p>
        )}
      </div>

      {/* Skills section header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <span className="text-sm font-medium text-muted-foreground">
          {t("collection.skills", { count: currentDetail.skills.length })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsInstallOpen(true)}
            disabled={currentDetail.skills.length === 0}
            aria-label={t("collection.batchInstallLabel")}
          >
            <PackagePlus className="size-3.5" />
            <span>{t("collection.batchInstall")}</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setIsPickerOpen(true)}
            aria-label={t("collection.addSkillLabel")}
          >
            <Plus className="size-3.5" />
            <span>{t("collection.addSkill")}</span>
          </Button>
        </div>
      </div>

      {/* Skills list */}
      <div className="flex-1 overflow-auto">
        {currentDetail.skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
            <div className="p-4 rounded-full bg-muted/60">
              <BookOpen className="size-12 text-muted-foreground opacity-60" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-muted-foreground">{t("collection.noSkillsTitle")}</p>
              <p className="text-xs text-muted-foreground/70">{t("collection.noSkillsDesc")}</p>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsPickerOpen(true)}
            >
              <Plus className="size-3.5" />
              {t("collection.addFirstSkill")}
            </Button>
          </div>
        ) : (
          <div className="mx-6 my-3 rounded-lg border border-border overflow-hidden">
            {currentDetail.skills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                collectionId={currentDetail.id}
                onRemove={() => handleRemoveSkill(skill.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CollectionEditor
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        collection={{
          id: currentDetail.id,
          name: currentDetail.name,
          description: currentDetail.description,
          created_at: currentDetail.created_at,
          updated_at: currentDetail.updated_at,
        }}
      />

      <SkillPickerDialog
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        existingSkillIds={currentDetail.skills.map((s) => s.id)}
        onAdd={handleAddSkills}
      />

      <CollectionInstallDialog
        open={isInstallOpen}
        onOpenChange={setIsInstallOpen}
        collectionName={currentDetail.name}
        skillCount={currentDetail.skills.length}
        agents={agents}
        onInstall={(agentIds) => batchInstallCollection(currentDetail.id, agentIds)}
      />
    </div>
  );
}
