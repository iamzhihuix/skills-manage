// ─── Agent Types ─────────────────────────────────────────────────────────────

export interface AgentWithStatus {
  id: string;
  display_name: string;
  category: string;
  global_skills_dir: string;
  project_skills_dir?: string;
  icon_name?: string;
  is_detected: boolean;
  is_builtin: boolean;
  is_enabled: boolean;
}

export interface CustomAgentConfig {
  id?: string;
  display_name: string;
  category?: string;
  global_skills_dir: string;
}

export interface UpdateCustomAgentConfig {
  display_name: string;
  category?: string;
  global_skills_dir: string;
}

// ─── Scan Types ───────────────────────────────────────────────────────────────

export interface ScanResult {
  total_skills: number;
  agents_scanned: number;
  skills_by_agent: Record<string, number>;
}

export type ClaudeSourceKind = "user" | "plugin";

export interface ScannedSkill {
  id: string;
  row_id?: string;
  name: string;
  description?: string;
  file_path: string;
  dir_path: string;
  link_type: string;
  symlink_target?: string;
  is_central: boolean;
  source_kind?: ClaudeSourceKind | null;
  source_root?: string | null;
  is_read_only?: boolean;
  conflict_group?: string | null;
  conflict_count?: number;
}

// ─── Skill Types ──────────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description?: string;
  file_path: string;
  canonical_path?: string;
  is_central: boolean;
  source?: string;
  content?: string;
  scanned_at: string;
}

export interface SkillInstallation {
  skill_id: string;
  agent_id: string;
  installed_path: string;
  link_type: string;
  symlink_target?: string;
  /** ISO 8601 timestamp of when the skill was first installed. */
  installed_at?: string;
}

export interface SkillDetail extends Omit<Skill, "content"> {
  row_id?: string;
  dir_path?: string;
  source_kind?: ClaudeSourceKind | null;
  source_root?: string | null;
  is_read_only?: boolean;
  conflict_group?: string | null;
  conflict_count?: number;
  installations: SkillInstallation[];
  /** Collections this skill currently belongs to. */
  collections?: Collection[];
}

export interface SelectedSkillFile {
  path: string;
  relativePath: string;
}

export interface SkillDirectoryNode {
  name: string;
  path: string;
  relative_path: string;
  is_dir: boolean;
  children: SkillDirectoryNode[];
}

export interface SkillDetailRequest {
  skillId: string;
  agentId?: string;
  rowId?: string;
}

export interface SkillWithLinks {
  id: string;
  name: string;
  description?: string;
  file_path: string;
  canonical_path?: string;
  is_central: boolean;
  source?: string;
  scanned_at: string;
  created_at?: string;
  updated_at?: string;
  /** Agent IDs that currently have this skill installed (symlink or copy). */
  linked_agents: string[];
}

export interface BatchInstallResult {
  succeeded: string[];
  failed: Array<{ agent_id: string; error: string }>;
}

// ─── Collection Types ─────────────────────────────────────────────────────────

export interface Collection {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface CollectionWithSkills extends Collection {
  skill_ids: string[];
}

export interface CollectionDetail extends Collection {
  /** Full skill objects that are members of this collection. */
  skills: Skill[];
}

export interface CollectionBatchInstallResult {
  succeeded: string[];
  failed: Array<{ agent_id: string; error: string }>;
}

// ─── Settings Types ───────────────────────────────────────────────────────────

export interface ScanDirectory {
  id: number;
  path: string;
  label?: string;
  is_active: boolean;
  is_builtin: boolean;
  added_at: string;
}

// ─── Discover Types ───────────────────────────────────────────────────────────

export interface ScanRoot {
  path: string;
  label: string;
  exists: boolean;
  enabled: boolean;
}

export interface DiscoveredSkill {
  id: string;
  name: string;
  description?: string;
  file_path: string;
  dir_path: string;
  platform_id: string;
  platform_name: string;
  project_path: string;
  project_name: string;
  is_already_central: boolean;
}

export interface DiscoveredProject {
  project_path: string;
  project_name: string;
  skills: DiscoveredSkill[];
}

export interface DiscoverResult {
  total_projects: number;
  total_skills: number;
  projects: DiscoveredProject[];
}

export interface DiscoverProgressPayload {
  percent: number;
  current_path: string;
  skills_found: number;
  projects_found: number;
}

export interface DiscoverFoundPayload {
  project: DiscoveredProject;
}

export interface DiscoverCompletePayload {
  total_projects: number;
  total_skills: number;
}

export type ImportTarget =
  | { type: "central" }
  | { type: "platform"; agent_id: string };

export interface DiscoverImportResult {
  skill_id: string;
  target: string;
}

// ─── Marketplace Types ───────────────────────────────────────────────────────

export interface SkillRegistry {
  id: string;
  name: string;
  source_type: "github" | "http_json";
  url: string;
  normalized_url?: string | null;
  is_builtin: boolean;
  is_enabled: boolean;
  last_synced: string | null;
  last_attempted_sync?: string | null;
  last_sync_status?: "never" | "success" | "error";
  last_sync_error?: string | null;
  cache_updated_at?: string | null;
  cache_expires_at?: string | null;
  etag?: string | null;
  last_modified?: string | null;
  created_at: string;
}

export interface MarketplaceSkill {
  id: string;
  registry_id: string;
  name: string;
  description?: string;
  download_url: string;
  is_installed: boolean;
  synced_at: string;
  cache_updated_at?: string | null;
}

export interface SkillsShSkill {
  id: string;
  skill_id: string;
  name: string;
  source: string;
  installs: number;
  stars?: number | null;
}

export interface SkillsShFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  branch: string;
  normalizedUrl: string;
}

export interface GitHubSkillConflict {
  existingSkillId: string;
  existingName: string;
  existingCanonicalPath?: string | null;
  proposedSkillId: string;
  proposedName: string;
}

export interface GitHubSkillPreview {
  sourcePath: string;
  skillId: string;
  skillName: string;
  description?: string | null;
  rootDirectory: string;
  skillDirectoryName: string;
  downloadUrl: string;
  conflict?: GitHubSkillConflict | null;
}

export interface GitHubRepoPreview {
  repo: GitHubRepoRef;
  skills: GitHubSkillPreview[];
}

export type DuplicateResolution = "overwrite" | "skip" | "rename";

export interface GitHubSkillImportSelection {
  sourcePath: string;
  resolution: DuplicateResolution;
  renamedSkillId?: string | null;
}

export interface ImportedGitHubSkillSummary {
  sourcePath: string;
  originalSkillId: string;
  importedSkillId: string;
  skillName: string;
  targetDirectory: string;
  resolution: DuplicateResolution;
}

export interface GitHubRepoImportResult {
  repo: GitHubRepoRef;
  importedSkills: ImportedGitHubSkillSummary[];
  skippedSkills: string[];
}

export type GitHubImportProgressPhase = "preparing" | "writing" | "finalizing";

export interface GitHubImportProgressPayload {
  phase: GitHubImportProgressPhase;
  currentSkill?: string | null;
  currentPath?: string | null;
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes: number;
}
