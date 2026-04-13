import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Loader2, FolderOpen, Cpu, Info, Database, Globe, Palette, Droplets } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settingsStore";
import { useThemeStore, CatppuccinFlavor, CatppuccinAccent, ACCENT_NAMES } from "@/stores/themeStore";
import { usePlatformStore } from "@/stores/platformStore";
import { AddDirectoryDialog } from "@/components/settings/AddDirectoryDialog";
import { PlatformDialog } from "@/components/settings/PlatformDialog";
import { AgentWithStatus, ScanDirectory } from "@/types";

// ─── App constants ────────────────────────────────────────────────────────────

const APP_VERSION = "0.1.0";
const DB_PATH = "~/.skillsmanage/db.sqlite";

/** Catppuccin Lavender hex per flavor — used for visual preview dots on flavor buttons (default accent). */
const FLAVOR_COLORS: Record<CatppuccinFlavor, string> = {
  mocha: "#b4befe",
  macchiato: "#b7bdf8",
  frappe: "#babbf1",
  latte: "#7287fd",
};

/**
 * Mapping of accent name → CSS custom property name.
 * These are resolved at runtime via getComputedStyle to show the
 * actual color for the current flavor.
 */
const CTP_VAR_MAP: Record<CatppuccinAccent, string> = {
  rosewater: "--ctp-rosewater",
  flamingo: "--ctp-flamingo",
  pink: "--ctp-pink",
  mauve: "--ctp-mauve",
  red: "--ctp-red",
  maroon: "--ctp-maroon",
  peach: "--ctp-peach",
  yellow: "--ctp-yellow",
  green: "--ctp-green",
  teal: "--ctp-teal",
  sky: "--ctp-sky",
  sapphire: "--ctp-sapphire",
  blue: "--ctp-blue",
  lavender: "--ctp-lavender",
};

const FLAVOR_ORDER: CatppuccinFlavor[] = ["mocha", "macchiato", "frappe", "latte"];

// ─── ScanDirectoryRow ─────────────────────────────────────────────────────────

interface ScanDirectoryRowProps {
  dir: ScanDirectory;
  onRemove: () => void;
  onToggle: (active: boolean) => void;
  isRemoving: boolean;
}

function ScanDirectoryRow({ dir, onRemove, onToggle, isRemoving }: ScanDirectoryRowProps) {
  const { t } = useTranslation();
  const action = dir.is_active ? t("settings.enabled") : t("settings.disabled");
  return (
    <div className="flex items-center gap-3 py-2.5 px-4 border-b border-border/50 last:border-0">
      <FolderOpen className="size-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{dir.path}</div>
        {dir.label && (
          <div className="text-xs text-muted-foreground mt-0.5">{dir.label}</div>
        )}
        {dir.is_builtin && (
          <div className="text-xs text-muted-foreground mt-0.5">{t("settings.builtinDir")}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Toggle for non-builtin dirs (built-in dirs are always active) */}
        {!dir.is_builtin && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              {action}
            </span>
            <Switch
              checked={dir.is_active}
              onCheckedChange={onToggle}
              aria-label={t("settings.enableDirLabel", { action, path: dir.path })}
            />
          </div>
        )}
        {/* Remove button for non-builtin dirs */}
        {!dir.is_builtin && (
          <button
            onClick={onRemove}
            disabled={isRemoving}
            aria-label={t("settings.removeDirLabel", { path: dir.path })}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRemoving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── CustomPlatformRow ────────────────────────────────────────────────────────

interface CustomPlatformRowProps {
  agent: AgentWithStatus;
  onEdit: () => void;
  onRemove: () => void;
  isRemoving: boolean;
}

function CustomPlatformRow({ agent, onEdit, onRemove, isRemoving }: CustomPlatformRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 py-2.5 px-4 border-b border-border/50 last:border-0">
      <Cpu className="size-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{agent.display_name}</div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {agent.global_skills_dir}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          aria-label={t("settings.editPlatformLabel", { name: agent.display_name })}
        >
          <Pencil className="size-3.5" />
          <span>{t("common.edit")}</span>
        </Button>
        <button
          onClick={onRemove}
          disabled={isRemoving}
          aria-label={t("settings.removePlatformLabel", { name: agent.display_name })}
          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRemoving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── SettingsView ─────────────────────────────────────────────────────────────

export function SettingsView() {
  const { t } = useTranslation();

  // ── Store State ────────────────────────────────────────────────────────────

  const scanDirectories = useSettingsStore((s) => s.scanDirectories);
  const isLoadingScanDirs = useSettingsStore((s) => s.isLoadingScanDirs);
  const loadScanDirectories = useSettingsStore((s) => s.loadScanDirectories);
  const addScanDirectory = useSettingsStore((s) => s.addScanDirectory);
  const removeScanDirectory = useSettingsStore((s) => s.removeScanDirectory);
  const toggleScanDirectory = useSettingsStore((s) => s.toggleScanDirectory);
  const addCustomAgent = useSettingsStore((s) => s.addCustomAgent);
  const updateCustomAgent = useSettingsStore((s) => s.updateCustomAgent);
  const removeCustomAgent = useSettingsStore((s) => s.removeCustomAgent);

  const agents = usePlatformStore((s) => s.agents);

  const flavor = useThemeStore((s) => s.flavor);
  const setFlavor = useThemeStore((s) => s.setFlavor);
  const accent = useThemeStore((s) => s.accent);
  const setAccent = useThemeStore((s) => s.setAccent);
  const rescan = usePlatformStore((s) => s.rescan);

  // Custom agents are those that are not built-in.
  const customAgents = agents.filter((a) => !a.is_builtin);

  // ── Local State ────────────────────────────────────────────────────────────

  const [isAddDirOpen, setIsAddDirOpen] = useState(false);
  const [isPlatformDialogOpen, setIsPlatformDialogOpen] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<AgentWithStatus | null>(null);
  const [removingDir, setRemovingDir] = useState<string | null>(null);
  const [removingAgent, setRemovingAgent] = useState<string | null>(null);
  const [scanDirError, setScanDirError] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);

  // ── Load on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadScanDirectories();
  }, [loadScanDirectories]);

  // ── Scan Directories Handlers ──────────────────────────────────────────────

  async function handleAddDirectory(path: string) {
    setScanDirError(null);
    try {
      await addScanDirectory(path);
      // Trigger rescan after adding a directory.
      await rescan();
      toast.success(t("addDir.add") + " ✓");
    } catch (err) {
      setScanDirError(String(err));
      toast.error(String(err));
      throw err; // Re-throw so the dialog knows it failed
    }
  }

  async function handleRemoveDirectory(path: string) {
    setRemovingDir(path);
    setScanDirError(null);
    try {
      await removeScanDirectory(path);
      // Trigger rescan after removing a directory.
      await rescan();
      toast.success(t("common.delete") + " ✓");
    } catch (err) {
      setScanDirError(String(err));
      toast.error(String(err));
    } finally {
      setRemovingDir(null);
    }
  }

  /**
   * Toggle the active state of a custom scan directory.
   * Persists the change to the backend via set_scan_directory_active command.
   */
  async function handleToggleDirectory(path: string, active: boolean) {
    setScanDirError(null);
    try {
      await toggleScanDirectory(path, active);
    } catch (err) {
      setScanDirError(String(err));
      toast.error(String(err));
    }
  }

  // ── Custom Platform Handlers ───────────────────────────────────────────────

  function handleOpenAddPlatform() {
    setEditingPlatform(null);
    setPlatformError(null);
    setIsPlatformDialogOpen(true);
  }

  function handleOpenEditPlatform(agent: AgentWithStatus) {
    setEditingPlatform(agent);
    setPlatformError(null);
    setIsPlatformDialogOpen(true);
  }

  async function handleAddPlatform(displayName: string, globalSkillsDir: string) {
    setPlatformError(null);
    try {
      await addCustomAgent({
        display_name: displayName,
        global_skills_dir: globalSkillsDir,
      });
      // Refresh agents + rescan to show new platform in sidebar.
      await rescan();
      toast.success(t("platformDialog.add") + " ✓");
    } catch (err) {
      setPlatformError(String(err));
      toast.error(String(err));
      throw err;
    }
  }

  async function handleEditPlatform(displayName: string, globalSkillsDir: string) {
    if (!editingPlatform) return;
    setPlatformError(null);
    try {
      await updateCustomAgent(editingPlatform.id, {
        display_name: displayName,
        global_skills_dir: globalSkillsDir,
      });
      // Refresh agents + rescan.
      await rescan();
      toast.success(t("platformDialog.save") + " ✓");
    } catch (err) {
      setPlatformError(String(err));
      toast.error(String(err));
      throw err;
    }
  }

  async function handleRemovePlatform(agentId: string) {
    setRemovingAgent(agentId);
    setPlatformError(null);
    try {
      await removeCustomAgent(agentId);
      // Refresh agents.
      await rescan();
      toast.success(t("common.delete") + " ✓");
    } catch (err) {
      setPlatformError(String(err));
      toast.error(String(err));
    } finally {
      setRemovingAgent(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6 max-w-3xl">

        {/* ── Section 1: Scan Directories ──────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("settings.scanDirs")}</CardTitle>
                <CardDescription className="mt-1">
                  {t("settings.scanDirsDesc")}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddDirOpen(true)}
                aria-label={t("settings.addDirAriaLabel")}
              >
                <Plus className="size-3.5" />
                <span>{t("settings.addDirectory")}</span>
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {scanDirError && (
              <p className="text-xs text-destructive mb-3" role="alert">
                {scanDirError}
              </p>
            )}

            {isLoadingScanDirs ? (
              <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm justify-center">
                <Loader2 className="size-4 animate-spin" />
                <span>{t("settings.loading")}</span>
              </div>
            ) : scanDirectories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("settings.noDirs")}
              </p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                {scanDirectories.map((dir) => (
                  <ScanDirectoryRow
                    key={dir.id}
                    dir={dir}
                    onRemove={() => handleRemoveDirectory(dir.path)}
                    onToggle={(active) => handleToggleDirectory(dir.path, active)}
                    isRemoving={removingDir === dir.path}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Section 2: Custom Platforms ───────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("settings.customPlatforms")}</CardTitle>
                <CardDescription className="mt-1">
                  {t("settings.customPlatformsDesc")}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenAddPlatform}
                aria-label={t("settings.addPlatformAriaLabel")}
              >
                <Plus className="size-3.5" />
                <span>{t("settings.addPlatform")}</span>
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {platformError && (
              <p className="text-xs text-destructive mb-3" role="alert">
                {platformError}
              </p>
            )}

            {customAgents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("settings.noPlatforms")}
              </p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                {customAgents.map((agent) => (
                  <CustomPlatformRow
                    key={agent.id}
                    agent={agent}
                    onEdit={() => handleOpenEditPlatform(agent)}
                    onRemove={() => handleRemovePlatform(agent.id)}
                    isRemoving={removingAgent === agent.id}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Section 3: About ────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.about")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Info className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground">{t("settings.appVersion")}</div>
                  <div className="text-sm font-medium">skills-manage v{APP_VERSION}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Database className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground">{t("settings.dbPath")}</div>
                  <div className="text-sm font-medium font-mono">{DB_PATH}</div>
                </div>
              </div>
              {/* ── Flavor Switcher ──────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <Palette className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1.5">{t("settings.flavor")}</div>
                  <div className="flex gap-2">
                    {FLAVOR_ORDER.map((f) => (
                      <Button
                        key={f}
                        variant={flavor === f ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFlavor(f)}
                        aria-pressed={flavor === f}
                      >
                        <span
                          className="inline-block size-2 rounded-full mr-1.5 shrink-0"
                          style={{ backgroundColor: FLAVOR_COLORS[f] }}
                        />
                        {t(`settings.${f}`)}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              {/* ── Accent Color Picker ─────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <Droplets className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1.5">{t("settings.accentColor")}</div>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("settings.accentColor")}>
                    {ACCENT_NAMES.map((name) => {
                      const ctpVar = CTP_VAR_MAP[name];
                      const isActive = accent === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          aria-label={t(`settings.accent.${name}`)}
                          title={t(`settings.accent.${name}`)}
                          onClick={() => setAccent(name)}
                          className={`relative size-6 rounded-full transition-all cursor-pointer
                            ${isActive
                              ? "ring-2 ring-ring ring-offset-2 ring-offset-background scale-110"
                              : "ring-1 ring-border hover:scale-105 hover:ring-2 hover:ring-ring/50"
                            }`}
                          style={{ backgroundColor: `var(${ctpVar})` }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
              {/* ── Language Switcher ──────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <Globe className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1.5">{t("settings.language")}</div>
                  <div className="flex gap-2">
                    <Button
                      variant={i18n.language === "zh" ? "default" : "outline"}
                      size="sm"
                      onClick={() => i18n.changeLanguage("zh")}
                      aria-pressed={i18n.language === "zh"}
                    >
                      {t("settings.chinese")}
                    </Button>
                    <Button
                      variant={i18n.language === "en" ? "default" : "outline"}
                      size="sm"
                      onClick={() => i18n.changeLanguage("en")}
                      aria-pressed={i18n.language === "en"}
                    >
                      {t("settings.english")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}
      <AddDirectoryDialog
        open={isAddDirOpen}
        onOpenChange={setIsAddDirOpen}
        onAdd={handleAddDirectory}
      />

      <PlatformDialog
        open={isPlatformDialogOpen}
        onOpenChange={setIsPlatformDialogOpen}
        platform={editingPlatform}
        onAdd={handleAddPlatform}
        onEdit={handleEditPlatform}
      />
    </div>
  );
}
