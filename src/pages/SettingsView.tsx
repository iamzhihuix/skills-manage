import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Loader2, FolderOpen, Cpu, Info, Database, Globe, Palette, Droplets, Bot, ChevronDown, ChevronRight, KeyRound, Eye, EyeOff, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
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
import { InlineConfirmAction } from "@/components/ui/inline-confirm-action";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settingsStore";
import { useThemeStore, CatppuccinFlavor, CatppuccinAccent, ACCENT_NAMES } from "@/stores/themeStore";
import { usePlatformStore } from "@/stores/platformStore";
import { AddDirectoryDialog } from "@/components/settings/AddDirectoryDialog";
import { PlatformDialog } from "@/components/settings/PlatformDialog";
import { Input } from "@/components/ui/input";
import { AgentWithStatus, ScanDirectory } from "@/types";
import { AI_PROVIDERS, RegionId, ApiProtocol, API_PROTOCOLS } from "@/data/aiProviders";
import { deriveHomeDir, formatPathForDisplay, joinPathForDisplay } from "@/lib/path";

// ─── App constants ────────────────────────────────────────────────────────────

const APP_VERSION = "0.9.1";
const DB_PATH_FALLBACK = "~/.skillsmanage/db.sqlite";

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

/** Expand a raw custom base URL to its full endpoint based on protocol. */
function resolveCustomUrl(rawUrl: string, protocol: ApiProtocol | ""): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || !trimmed.endsWith("/v1")) return trimmed;
  switch (protocol) {
    case "openai":
      return trimmed + "/chat/completions";
    case "anthropic":
      return trimmed + "/messages";
    default:
      return trimmed;
  }
}

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
        <div className="text-sm font-medium truncate">{formatPathForDisplay(dir.path)}</div>
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
          <InlineConfirmAction
            onConfirm={onRemove}
            isLoading={isRemoving}
            idleAriaLabel={t("settings.removeDirLabel", { path: dir.path })}
            idleTitle={t("settings.removeDirLabel", { path: dir.path })}
            confirmLabel={t("common.confirmDelete")}
            icon={<Trash2 className="size-3.5" />}
          />
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
          {formatPathForDisplay(agent.global_skills_dir)}
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
        <InlineConfirmAction
          onConfirm={onRemove}
          isLoading={isRemoving}
          idleAriaLabel={t("settings.removePlatformLabel", { name: agent.display_name })}
          idleTitle={t("settings.removePlatformLabel", { name: agent.display_name })}
          confirmLabel={t("common.confirmDelete")}
          icon={<Trash2 className="size-3.5" />}
        />
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
  const githubPat = useSettingsStore((s) => s.githubPat);
  const isLoadingGitHubPat = useSettingsStore((s) => s.isLoadingGitHubPat);
  const isSavingGitHubPat = useSettingsStore((s) => s.isSavingGitHubPat);
  const loadGitHubPat = useSettingsStore((s) => s.loadGitHubPat);
  const saveGitHubPat = useSettingsStore((s) => s.saveGitHubPat);
  const clearGitHubPat = useSettingsStore((s) => s.clearGitHubPat);

  const agents = usePlatformStore((s) => s.agents);

  const flavor = useThemeStore((s) => s.flavor);
  const setFlavor = useThemeStore((s) => s.setFlavor);
  const accent = useThemeStore((s) => s.accent);
  const setAccent = useThemeStore((s) => s.setAccent);
  const rescan = usePlatformStore((s) => s.rescan);
  const refreshCounts = usePlatformStore((s) => s.refreshCounts);

  // Custom agents are those that are not built-in.
  const customAgents = agents.filter((a) => !a.is_builtin);
  const homeDir = useMemo(() => {
    const candidates = [
      agents.find((agent) => agent.id === "central")?.global_skills_dir,
      ...scanDirectories.map((dir) => dir.path),
      ...agents.map((agent) => agent.global_skills_dir),
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidates
      .map((candidate) => deriveHomeDir(candidate))
      .find((candidate): candidate is string => Boolean(candidate));
  }, [agents, scanDirectories]);
  const dbPathDisplay = useMemo(
    () => (homeDir ? joinPathForDisplay(homeDir, ".skillsmanage/db.sqlite") : DB_PATH_FALLBACK),
    [homeDir]
  );

  // ── Local State ────────────────────────────────────────────────────────────

  // AI Provider state
  const [aiProvider, setAiProvider] = useState("claude");
  const [aiRegion, setAiRegion] = useState<RegionId>("intl");
  const [aiApiKey, setAiApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [aiModel, setAiModel] = useState("");
  const [aiCustomUrl, setAiCustomUrl] = useState("");
  const [aiProtocol, setAiProtocol] = useState<ApiProtocol | "">("");
  const [aiLoaded, setAiLoaded] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [providerLoading, setProviderLoading] = useState(false);

  // Load AI settings on mount
  useEffect(() => {
    (async () => {
      try {
        const provider = await invoke<string | null>("get_setting", { key: "ai_provider" });
        const region = await invoke<string | null>("get_setting", { key: "ai_region" });
        if (provider) setAiProvider(provider);
        if (region) setAiRegion(region as RegionId);
        if (provider) {
          const key = await invoke<string | null>("get_setting", { key: `ai_api_key__${provider}` });
          const model = await invoke<string | null>("get_setting", { key: `ai_model__${provider}` });
          const baseUrl = await invoke<string | null>("get_setting", { key: `ai_custom_base_url__${provider}` });
          const protocol = await invoke<string | null>("get_setting", { key: `ai_protocol__${provider}` });
          if (key) setAiApiKey(key);
          if (model) setAiModel(model);
          else {
            const p = AI_PROVIDERS.find((x) => x.id === provider);
            if (p) setAiModel(p.defaultModel);
          }
          if (baseUrl) setAiCustomUrl(baseUrl);
          if (protocol) setAiProtocol(protocol as ApiProtocol);
        }
      } catch { /* first run, no settings yet */ }
      setAiLoaded(true);
    })();
  }, []);

  // Save AI settings when changed (only after user interaction)
  useEffect(() => {
    if (!aiLoaded || !hasUserInteracted) return;
    const save = async () => {
      try {
        await invoke("set_setting", { key: "ai_provider", value: aiProvider });
        await invoke("set_setting", { key: "ai_region", value: aiRegion });
        await invoke("set_setting", { key: `ai_api_key__${aiProvider}`, value: aiApiKey });
        await invoke("set_setting", { key: `ai_model__${aiProvider}`, value: aiModel });
        const p = AI_PROVIDERS.find((x) => x.id === aiProvider);
        const url = aiProvider === "custom" ? resolveCustomUrl(aiCustomUrl, aiProtocol) : (p?.endpoints[aiRegion] ?? "");
        await invoke("set_setting", { key: `ai_api_url__${aiProvider}`, value: url });
        await invoke("set_setting", { key: `ai_custom_base_url__${aiProvider}`, value: aiCustomUrl });
        await invoke("set_setting", { key: `ai_protocol__${aiProvider}`, value: aiProtocol });
      } catch { /* ignore */ }
    };
    save();
  }, [aiProvider, aiRegion, aiApiKey, aiModel, aiCustomUrl, aiProtocol, aiLoaded, hasUserInteracted]);

  // When provider or region changes, update model to default
  async function handleProviderChange(id: string) {
    if (providerLoading) return;
    setProviderLoading(true);
    setAiLoaded(false);           // block save until new config is loaded
    setAiProvider(id);
    setAiTestResult(null);
    const p = AI_PROVIDERS.find((x) => x.id === id);
    if (p) {
      if (!p.regions.includes(aiRegion)) {
        setAiRegion(p.regions[0]);
      }
    }
    try {
      const key = await invoke<string | null>("get_setting", { key: `ai_api_key__${id}` });
      const model = await invoke<string | null>("get_setting", { key: `ai_model__${id}` });
      const protocol = await invoke<string | null>("get_setting", { key: `ai_protocol__${id}` });
      const baseUrl = await invoke<string | null>("get_setting", { key: `ai_custom_base_url__${id}` });
      setAiApiKey(key ?? "");
      setAiModel(model ?? p?.defaultModel ?? "");
      setAiProtocol(protocol ? (protocol as ApiProtocol) : "");
      setAiCustomUrl(baseUrl ?? "");
    } catch {
      setAiApiKey("");
      setAiModel(p?.defaultModel ?? "");
      setAiCustomUrl("");
      setAiProtocol("");
    } finally {
      setAiLoaded(true);
      setProviderLoading(false);
    }
  }

  const currentProvider = AI_PROVIDERS.find((p) => p.id === aiProvider);
  const resolvedUrl = aiProvider === "custom"
    ? resolveCustomUrl(aiCustomUrl, aiProtocol)
    : (currentProvider?.endpoints[aiRegion] ?? "");

  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; msg: string; details?: string } | null>(null);
  const [showAiTestDetails, setShowAiTestDetails] = useState(false);

  // Clear stale test result when config changes
  useEffect(() => {
    setAiTestResult(null);
  }, [aiApiKey, aiCustomUrl, aiProtocol, aiRegion, aiModel]);

  const [isAddDirOpen, setIsAddDirOpen] = useState(false);
  const [showBuiltinDirs, setShowBuiltinDirs] = useState(false);
  const [isPlatformDialogOpen, setIsPlatformDialogOpen] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<AgentWithStatus | null>(null);
  const [removingDir, setRemovingDir] = useState<string | null>(null);
  const [removingAgent, setRemovingAgent] = useState<string | null>(null);
  const [scanDirError, setScanDirError] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [githubPatInput, setGitHubPatInput] = useState("");
  const [githubPatMessage, setGitHubPatMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ── Load on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadScanDirectories();
    loadGitHubPat();
  }, [loadScanDirectories, loadGitHubPat]);

  useEffect(() => {
    setGitHubPatInput(githubPat);
  }, [githubPat]);

  const isGitHubPatDirty = useMemo(() => githubPatInput.trim() !== githubPat, [githubPatInput, githubPat]);

  // ── Scan Directories Handlers ──────────────────────────────────────────────

  async function handleAddDirectory(path: string) {
    setScanDirError(null);
    try {
      await addScanDirectory(path);
      // Trigger rescan after adding a directory.
      await refreshCounts();
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
      await refreshCounts();
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

  async function handleAddPlatform(displayName: string, globalSkillsDir: string, category?: string) {
    setPlatformError(null);
    try {
      await addCustomAgent({
        display_name: displayName,
        global_skills_dir: globalSkillsDir,
        category: category || "coding",
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

  async function handleEditPlatform(displayName: string, globalSkillsDir: string, category?: string) {
    if (!editingPlatform) return;
    setPlatformError(null);
    try {
      await updateCustomAgent(editingPlatform.id, {
        display_name: displayName,
        global_skills_dir: globalSkillsDir,
        category: category || "coding",
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

  async function handleSaveGitHubPat() {
    setGitHubPatMessage(null);
    try {
      await saveGitHubPat(githubPatInput);
      setGitHubPatMessage({
        type: "success",
        text: t("settings.githubPatSaved"),
      });
      toast.success(t("settings.githubPatSaved"));
    } catch (err) {
      const text = String(err);
      setGitHubPatMessage({ type: "error", text });
      toast.error(text);
    }
  }

  async function handleClearGitHubPat() {
    setGitHubPatMessage(null);
    try {
      await clearGitHubPat();
      setGitHubPatInput("");
      setGitHubPatMessage({
        type: "success",
        text: t("settings.githubPatCleared"),
      });
      toast.success(t("settings.githubPatCleared"));
    } catch (err) {
      const text = String(err);
      setGitHubPatMessage({ type: "error", text });
      toast.error(text);
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
      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* ── Section 1: Custom Platforms ───────────────────────────────────── */}
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

        {/* ── Section 2: GitHub Import Auth ─────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="size-5 text-muted-foreground" />
              <div>
                <CardTitle>{t("settings.githubPatTitle")}</CardTitle>
                <CardDescription className="mt-1">
                  {t("settings.githubPatDesc")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label htmlFor="github-pat" className="mb-1 block text-xs text-muted-foreground">
                  {t("settings.githubPatLabel")}
                </label>
                <Input
                  id="github-pat"
                  type="password"
                  placeholder="github_pat_..."
                  value={githubPatInput}
                  onChange={(event) => setGitHubPatInput(event.target.value)}
                  disabled={isLoadingGitHubPat || isSavingGitHubPat}
                />
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                <p>{t("settings.githubPatDirectOnly")}</p>
                <p className="mt-2">{t("settings.githubPatRateLimitHint")}</p>
              </div>

              {githubPatMessage ? (
                <p
                  className={githubPatMessage.type === "error" ? "text-sm text-destructive" : "text-sm text-emerald-600 dark:text-emerald-400"}
                  role="status"
                >
                  {githubPatMessage.text}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={handleSaveGitHubPat}
                  disabled={isLoadingGitHubPat || isSavingGitHubPat || !isGitHubPatDirty}
                >
                  {isSavingGitHubPat ? <Loader2 className="size-4 animate-spin" /> : null}
                  <span>{t("common.save")}</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={handleClearGitHubPat}
                  disabled={isLoadingGitHubPat || isSavingGitHubPat || !githubPat}
                >
                  <span>{t("settings.githubPatClear")}</span>
                </Button>
                {isLoadingGitHubPat ? (
                  <span className="text-xs text-muted-foreground">{t("settings.loading")}</span>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Section 3: AI Provider ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-muted-foreground" />
              <div>
                <CardTitle>{t("settings.aiProviderTitle")}</CardTitle>
                <CardDescription className="mt-1">
                  {t("settings.aiProviderDesc")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">{t("settings.aiProviderLabel")}</label>
                <div className="flex flex-wrap gap-1.5">
                  {AI_PROVIDERS.map((p) => (
                    <button key={p.id} disabled={providerLoading} onClick={() => { setHasUserInteracted(true); handleProviderChange(p.id); }} className={`px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer border ${aiProvider === p.id ? "bg-primary/15 border-primary text-foreground font-medium" : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-hover-bg/10"} ${providerLoading ? "opacity-50 cursor-not-allowed" : ""}`}>
                      {providerLoading && aiProvider === p.id ? <Loader2 className="size-3 animate-spin inline mr-1" /> : null}
                      {t(`settings.aiProvider.${p.id}`)}
                    </button>
                  ))}
                </div>
              </div>
              {currentProvider && currentProvider.regions.length > 1 && (
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">{t("settings.aiRegionLabel")}</label>
                  <div className="flex gap-1.5">
                    {currentProvider.regions.map((r) => (
                      <button key={r} onClick={() => { setHasUserInteracted(true); setAiRegion(r); }} className={`px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer border ${aiRegion === r ? "bg-primary/15 border-primary text-foreground font-medium" : "border-border bg-background text-muted-foreground hover:border-primary/40"}`}>
                        {t(`settings.aiRegion.${r}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t("settings.aiApiKeyLabel")}</label>
                <div className="relative">
                  <Input type={showKey ? "text" : "password"} placeholder="sk-..." value={aiApiKey} onChange={(e) => { setHasUserInteracted(true); setAiApiKey(e.target.value); }} className="pr-9" />
                  <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t("settings.aiModelLabel")}</label>
                <Input placeholder={t("settings.aiModelPlaceholder")} value={aiModel} onChange={(e) => { setHasUserInteracted(true); setAiModel(e.target.value); }} />
              </div>
              {aiProvider === "custom" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">{t("settings.aiApiFormatLabel")}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {API_PROTOCOLS.map((proto) => (
                      <button key={proto.id} onClick={() => { setHasUserInteracted(true); setAiProtocol(proto.id as ApiProtocol | ""); }} className={`px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer border ${aiProtocol === proto.id ? "bg-primary/15 border-primary text-foreground font-medium" : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-hover-bg/10"}`}>
                        {t(`settings.aiProtocol.${proto.id || "auto"}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {aiProvider === "custom" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t("settings.aiApiUrlLabel")}</label>
                  <Input placeholder="https://..." value={aiCustomUrl} onChange={(e) => { setHasUserInteracted(true); setAiCustomUrl(e.target.value); }} />
                </div>
              )}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  {aiTestResult?.ok ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                      <Check className="size-3.5" />
                      {t("settings.aiTestConnectionVerified")}
                    </span>
                  ) : aiProvider === "custom" && !aiCustomUrl.trim() ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Info className="size-3.5" />
                      {t("settings.aiTestEnterUrl")}
                    </span>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={aiTesting || !aiApiKey || !resolvedUrl}
                  onClick={async () => {
                    setAiTesting(true); setAiTestResult(null); setShowAiTestDetails(false);
                    try {
                      await invoke<string>("test_ai_connection");
                      setAiTestResult({ ok: true, msg: t("settings.aiTestSuccess") });
                    } catch (err) {
                      const raw = String(err);
                      let msg = raw;
                      let details: string | undefined;
                      const prefix = "API 请求失败: ";
                      if (raw.startsWith(prefix)) {
                        const after = raw.slice(prefix.length);
                        const nlIdx = after.indexOf("\n");
                        if (nlIdx > 0) {
                          msg = after.slice(nlIdx + 1);
                          details = after.slice(0, nlIdx);
                        } else {
                          msg = after;
                        }
                      }
                      setAiTestResult({ ok: false, msg, details });
                    } finally { setAiTesting(false); }
                  }}
                  className="shrink-0"
                >
                  {aiTesting ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
                  <span>{aiTesting ? t("settings.aiTestTesting") : t("settings.aiTestButton")}</span>
                </Button>
              </div>
              {aiTestResult && !aiTestResult.ok && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 space-y-1.5 text-destructive text-xs">
                  <p>{aiTestResult.msg}</p>
                  {aiTestResult.details && (
                    <div>
                      <button
                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        onClick={() => setShowAiTestDetails((v) => !v)}
                      >
                        {showAiTestDetails ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        {t("settings.aiTestDetails")}
                      </button>
                      {showAiTestDetails && (
                        <pre className="mt-1 text-[11px] leading-4 font-mono text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 rounded-md p-2 max-h-32 overflow-auto">
                          {aiTestResult.details}
                        </pre>
                      )}
                    </div>
                  )}
                  {currentProvider && currentProvider.regions.length > 1 && (
                    <p className="text-muted-foreground">
                      {t("settings.aiTestRegionTip", { region: t(`settings.aiRegion.${aiRegion}`) })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Section 4: Scan Directories (compact) ─────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("settings.scanDirs")}</CardTitle>
                <CardDescription className="mt-1">{t("settings.scanDirsDesc")}</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsAddDirOpen(true)} aria-label={t("settings.addDirAriaLabel")}>
                <Plus className="size-3.5" />
                <span>{t("settings.addDirectory")}</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {scanDirError && <p className="text-xs text-destructive mb-3" role="alert">{scanDirError}</p>}
            {isLoadingScanDirs ? (
              <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm justify-center">
                <Loader2 className="size-4 animate-spin" />
                <span>{t("settings.loading")}</span>
              </div>
            ) : (() => {
              const customDirs = scanDirectories.filter((d) => !d.is_builtin);
              const builtinDirs = scanDirectories.filter((d) => d.is_builtin);
              return (
                <div className="space-y-3">
                  {/* Custom dirs first */}
                  {customDirs.length > 0 && (
                    <div className="rounded-lg border border-border overflow-hidden">
                      {customDirs.map((dir) => (
                        <ScanDirectoryRow key={dir.id} dir={dir} onRemove={() => handleRemoveDirectory(dir.path)} onToggle={(active) => handleToggleDirectory(dir.path, active)} isRemoving={removingDir === dir.path} />
                      ))}
                    </div>
                  )}
                  {customDirs.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">{t("settings.noDirs")}</p>
                  )}
                  {/* Built-in dirs — collapsible, two-column */}
                  {builtinDirs.length > 0 && (
                    <div>
                      <button
                        onClick={() => setShowBuiltinDirs((v) => !v)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        <span>{showBuiltinDirs ? "▾" : "▸"}</span>
                        <span>{t("settings.builtinDir")} ({builtinDirs.length})</span>
                      </button>
                      {showBuiltinDirs && (
                        <div className="grid grid-cols-2 gap-1.5 mt-2">
                          {builtinDirs.map((dir) => (
                            <div key={dir.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/30 text-xs text-muted-foreground truncate">
                              <FolderOpen className="size-3 shrink-0" />
                              <span className="truncate">{formatPathForDisplay(dir.path)}</span>
                              {dir.label && <span className="shrink-0 opacity-60">· {dir.label}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* ── Section 5: About ────────────────────────────────────────────── */}
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
                  <div className="text-sm font-medium font-mono">{dbPathDisplay}</div>
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
