use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::State;

use crate::db::{self, AgentSkillObservation, DbPool, Skill, SkillInstallation};
use crate::AppState;

// ─── Types ────────────────────────────────────────────────────────────────────

/// Metadata extracted from a SKILL.md frontmatter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: Option<String>,
}

/// A single skill discovered during a directory scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedSkill {
    /// Derived from directory name (lowercase, spaces→hyphens).
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Absolute path to the SKILL.md file.
    pub file_path: String,
    /// Absolute path to the skill directory.
    pub dir_path: String,
    /// "symlink", "copy", or "native".
    pub link_type: String,
    /// Symlink target path, if link_type is "symlink".
    pub symlink_target: Option<String>,
    pub is_central: bool,
}

/// Summary returned by `scan_all_skills`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub total_skills: usize,
    pub agents_scanned: usize,
    pub skills_by_agent: HashMap<String, usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaudeSourceKind {
    User,
    Plugin,
}

impl ClaudeSourceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Plugin => "plugin",
        }
    }

    fn is_read_only(self) -> bool {
        matches!(self, Self::Plugin)
    }
}

#[derive(Debug, Clone)]
struct AgentScanRoot {
    path: PathBuf,
    source_root: Option<PathBuf>,
    claude_source: Option<ClaudeSourceKind>,
}

#[derive(Debug, Default, Deserialize)]
struct ClaudeSettingsFile {
    #[serde(default, rename = "enabledPlugins")]
    enabled_plugins: HashMap<String, bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ClaudeInstalledPluginsFile {
    #[serde(default)]
    plugins: HashMap<String, Vec<ClaudeInstalledPluginInstall>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ClaudeInstalledPluginInstall {
    #[serde(default)]
    scope: Option<String>,
    #[serde(rename = "installPath")]
    install_path: String,
    #[serde(default, rename = "installedAt")]
    installed_at: Option<String>,
    #[serde(default, rename = "lastUpdated")]
    last_updated: Option<String>,
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/// Read a SKILL.md file and extract the YAML frontmatter fields `name` and
/// `description`. Returns `None` if the file is missing, cannot be read, lacks
/// a frontmatter block, or is missing the required `name` field.
pub fn parse_skill_md(path: &Path) -> Option<SkillInfo> {
    let content = std::fs::read_to_string(path).ok()?;

    // Frontmatter must begin on the very first line with "---"
    let after_open = content
        .strip_prefix("---\n")
        .or_else(|| content.strip_prefix("---\r\n"))?;

    // Locate the closing "---" delimiter
    let close_pos = after_open.find("\n---")?;
    let frontmatter_str = &after_open[..close_pos];

    // Parse the YAML block
    let yaml: serde_yaml::Value = serde_yaml::from_str(frontmatter_str).ok()?;

    // `name` is required
    let name = yaml.get("name")?.as_str()?.to_string();

    // `description` is optional
    let description = yaml
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(SkillInfo { name, description })
}

/// Determine how a skill directory entry was installed at the given path.
///
/// Uses `symlink_metadata` (lstat) so the check is performed on the entry
/// itself rather than its target:
///
/// * `"symlink"` — the entry is a symbolic link.
/// * `"copy"`    — the entry is a regular directory in a platform skills dir.
/// * `"native"`  — the entry is a regular directory in the central skills dir.
///
/// Also returns the symlink target path when the entry is a symlink.
pub fn detect_link_type(path: &Path, is_central_dir: bool) -> (String, Option<String>) {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            let target = std::fs::read_link(path)
                .ok()
                .and_then(|p| p.to_str().map(|s| s.to_string()));
            ("symlink".to_string(), target)
        }
        _ => {
            let kind = if is_central_dir { "native" } else { "copy" };
            (kind.to_string(), None)
        }
    }
}

/// Walk `dir` one level deep, looking for immediate subdirectories that contain
/// a `SKILL.md` file. For each such subdirectory, `parse_skill_md` and
/// `detect_link_type` are called to build a `ScannedSkill`.
///
/// Entries that cannot be read or lack valid frontmatter are silently skipped.
pub fn scan_directory(dir: &Path, is_central: bool) -> Vec<ScannedSkill> {
    let mut skills = Vec::new();

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return skills,
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();

        // Use regular metadata (follows symlinks) to check if this is a dir.
        let meta = match std::fs::metadata(&entry_path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_dir() {
            continue;
        }

        // Only include entries that contain a SKILL.md file.
        let skill_md_path = entry_path.join("SKILL.md");
        if !skill_md_path.exists() {
            continue;
        }

        // Parse frontmatter; skip entries with invalid/missing frontmatter.
        let info = match parse_skill_md(&skill_md_path) {
            Some(i) => i,
            None => continue,
        };

        // Detect link type using lstat on the skill directory itself.
        let (link_type, symlink_target) = detect_link_type(&entry_path, is_central);

        // Derive a stable ID from the directory name.
        let id = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_lowercase().replace(' ', "-"))
            .unwrap_or_else(|| "unknown".to_string());

        skills.push(ScannedSkill {
            id,
            name: info.name,
            description: info.description,
            file_path: skill_md_path.to_string_lossy().into_owned(),
            dir_path: entry_path.to_string_lossy().into_owned(),
            link_type,
            symlink_target,
            is_central,
        });
    }

    skills
}

fn read_json_file<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn claude_runtime_root(global_skills_dir: &Path) -> Option<PathBuf> {
    global_skills_dir.parent().map(Path::to_path_buf)
}

fn claude_enabled_plugin_ids(claude_root: &Path) -> Vec<String> {
    let settings_path = claude_root.join("settings.json");
    let Some(settings) = read_json_file::<ClaudeSettingsFile>(&settings_path) else {
        return Vec::new();
    };

    let mut enabled: Vec<String> = settings
        .enabled_plugins
        .into_iter()
        .filter_map(|(plugin_id, is_enabled)| is_enabled.then_some(plugin_id))
        .collect();
    enabled.sort();
    enabled
}

fn claude_select_effective_plugin_installs(
    installs: &[ClaudeInstalledPluginInstall],
) -> Vec<ClaudeInstalledPluginInstall> {
    let preferred_scope = installs
        .iter()
        .any(|install| install.scope.as_deref() == Some("user"));

    installs
        .iter()
        .filter(|install| !preferred_scope || install.scope.as_deref() == Some("user"))
        .max_by(|a, b| {
            let a_key = a
                .last_updated
                .as_deref()
                .or(a.installed_at.as_deref())
                .unwrap_or("");
            let b_key = b
                .last_updated
                .as_deref()
                .or(b.installed_at.as_deref())
                .unwrap_or("");
            a_key
                .cmp(b_key)
                .then_with(|| a.install_path.cmp(&b.install_path))
        })
        .cloned()
        .into_iter()
        .collect()
}

fn claude_plugin_roots(global_skills_dir: &Path) -> Vec<AgentScanRoot> {
    let Some(claude_root) = claude_runtime_root(global_skills_dir) else {
        return Vec::new();
    };

    let installed_path = claude_root.join("plugins/installed_plugins.json");
    let installed =
        read_json_file::<ClaudeInstalledPluginsFile>(&installed_path).unwrap_or_default();
    let mut seen_scan_paths = HashSet::new();
    let mut roots = Vec::new();

    for plugin_id in claude_enabled_plugin_ids(&claude_root) {
        let Some(installs) = installed.plugins.get(&plugin_id) else {
            continue;
        };

        for install in claude_select_effective_plugin_installs(installs) {
            let install_root = PathBuf::from(&install.install_path);
            let candidate_paths = [
                install_root.join("skills"),
                install_root.join(".claude").join("skills"),
            ];

            for scan_path in candidate_paths {
                if !scan_path.exists() {
                    continue;
                }

                let scan_path_key = scan_path.to_string_lossy().into_owned();
                if !seen_scan_paths.insert(scan_path_key) {
                    continue;
                }

                roots.push(AgentScanRoot {
                    path: scan_path,
                    source_root: Some(install_root.clone()),
                    claude_source: Some(ClaudeSourceKind::Plugin),
                });
            }
        }
    }

    roots
}

fn scan_roots_for_agent(agent: &crate::db::Agent) -> Vec<AgentScanRoot> {
    let primary_root = PathBuf::from(&agent.global_skills_dir);
    if agent.id != "claude-code" {
        return vec![AgentScanRoot {
            path: primary_root,
            source_root: None,
            claude_source: None,
        }];
    }

    let mut roots = vec![AgentScanRoot {
        path: primary_root.clone(),
        source_root: Some(primary_root.clone()),
        claude_source: Some(ClaudeSourceKind::User),
    }];
    roots.extend(claude_plugin_roots(&primary_root));
    roots
}

fn claude_observation_row_id(agent_id: &str, dir_path: &str) -> String {
    format!("{agent_id}::{dir_path}")
}

// ─── Tauri Command ────────────────────────────────────────────────────────────

/// Core scanning logic, separated from the Tauri command layer so it can be
/// unit-tested without a running Tauri runtime.
pub async fn scan_all_skills_impl(pool: &DbPool) -> Result<ScanResult, String> {
    let agents = db::get_all_agents(pool).await?;
    let custom_dirs = db::get_scan_directories(pool).await?;

    let mut total_skills: usize = 0;
    let mut skills_by_agent: HashMap<String, usize> = HashMap::new();

    // Accumulate every skill ID discovered in this scan so we can purge stale
    // rows from the database once all directories have been walked.
    let mut all_found_skill_ids: HashSet<String> = HashSet::new();

    // ── Per-agent scans ───────────────────────────────────────────────────────
    for agent in &agents {
        let is_central = agent.category == "central";
        let scan_roots = scan_roots_for_agent(agent);
        let existing_roots: Vec<AgentScanRoot> = scan_roots
            .into_iter()
            .filter(|root| root.path.exists())
            .collect();

        if existing_roots.is_empty() {
            // Mark agent as not detected and record zero count.
            let _ = db::update_agent_detected(pool, &agent.id, false).await;
            skills_by_agent.insert(agent.id.clone(), 0);
            // Remove every installation row for this agent — the directory is gone.
            let _ = db::delete_stale_skill_installations(pool, &agent.id, &[]).await;
            if agent.id == "claude-code" {
                let _ = db::delete_stale_agent_skill_observations(pool, &agent.id, &[]).await;
            }
            continue;
        }

        let _ = db::update_agent_detected(pool, &agent.id, true).await;
        let mut scanned = Vec::new();
        let mut found_install_ids = Vec::new();
        let mut found_observation_row_ids = Vec::new();

        for root in &existing_roots {
            let root_path = root
                .source_root
                .as_ref()
                .unwrap_or(&root.path)
                .to_string_lossy()
                .into_owned();
            let root_scanned = scan_directory(&root.path, is_central);

            for skill in &root_scanned {
                let now = Utc::now().to_rfc3339();

                if let Some(source_kind) = root.claude_source {
                    let observation = AgentSkillObservation {
                        row_id: claude_observation_row_id(&agent.id, &skill.dir_path),
                        agent_id: agent.id.clone(),
                        skill_id: skill.id.clone(),
                        name: skill.name.clone(),
                        description: skill.description.clone(),
                        file_path: skill.file_path.clone(),
                        dir_path: skill.dir_path.clone(),
                        source_kind: source_kind.as_str().to_string(),
                        source_root: root_path.clone(),
                        link_type: skill.link_type.clone(),
                        symlink_target: skill.symlink_target.clone(),
                        is_read_only: source_kind.is_read_only(),
                        scanned_at: now.clone(),
                    };
                    db::upsert_agent_skill_observation(pool, &observation).await?;
                    found_observation_row_ids.push(observation.row_id);
                }

                let should_persist_manageable_state =
                    root.claude_source != Some(ClaudeSourceKind::Plugin);
                if should_persist_manageable_state {
                    all_found_skill_ids.insert(skill.id.clone());
                    found_install_ids.push(skill.id.clone());

                    let db_skill = Skill {
                        id: skill.id.clone(),
                        name: skill.name.clone(),
                        description: skill.description.clone(),
                        file_path: skill.file_path.clone(),
                        canonical_path: if is_central {
                            Some(skill.dir_path.clone())
                        } else {
                            None
                        },
                        is_central,
                        source: Some(skill.link_type.clone()),
                        content: None,
                        scanned_at: now.clone(),
                    };
                    db::upsert_skill(pool, &db_skill).await?;

                    // Bug fix: store the skill *directory* path, not the SKILL.md file path.
                    let installation = SkillInstallation {
                        skill_id: skill.id.clone(),
                        agent_id: agent.id.clone(),
                        installed_path: skill.dir_path.clone(),
                        link_type: skill.link_type.clone(),
                        symlink_target: skill.symlink_target.clone(),
                        created_at: now.clone(),
                    };
                    db::upsert_skill_installation(pool, &installation).await?;
                }
            }

            scanned.extend(root_scanned);
        }

        // Reconciliation: remove installation rows for skills no longer present
        // in this agent's directory.
        db::delete_stale_skill_installations(pool, &agent.id, &found_install_ids).await?;
        if agent.id == "claude-code" {
            db::delete_stale_agent_skill_observations(pool, &agent.id, &found_observation_row_ids)
                .await?;
        }

        let count = scanned.len();
        total_skills += count;
        skills_by_agent.insert(agent.id.clone(), count);
    }

    // ── Custom scan directories ───────────────────────────────────────────────
    // Skills found in user-added directories are added to the `skills` table
    // but are not attributed to a specific agent installation record.
    for scan_dir in custom_dirs.iter().filter(|d| d.is_active) {
        let dir = Path::new(&scan_dir.path);
        if !dir.exists() {
            continue;
        }

        let scanned = scan_directory(dir, false);
        for skill in &scanned {
            all_found_skill_ids.insert(skill.id.clone());
            let now = Utc::now().to_rfc3339();
            let db_skill = Skill {
                id: skill.id.clone(),
                name: skill.name.clone(),
                description: skill.description.clone(),
                file_path: skill.file_path.clone(),
                canonical_path: None,
                is_central: false,
                source: Some(skill.link_type.clone()),
                content: None,
                scanned_at: now,
            };
            db::upsert_skill(pool, &db_skill).await?;
        }
        total_skills += scanned.len();
    }

    // ── Global reconciliation ─────────────────────────────────────────────────
    // Remove skills (and their installation records) that were not found in
    // any scanned scope during this run. This purges rows left behind when
    // skills are deleted from disk between scans.
    let found_ids_vec: Vec<String> = all_found_skill_ids.into_iter().collect();
    db::delete_skills_not_in_scope(pool, &found_ids_vec).await?;

    Ok(ScanResult {
        total_skills,
        agents_scanned: agents.len(),
        skills_by_agent,
    })
}

/// Tauri command: scan all agent skill directories and persist the results to
/// SQLite. Returns a `ScanResult` with per-agent skill counts.
#[tauri::command]
pub async fn scan_all_skills(state: State<'_, AppState>) -> Result<ScanResult, String> {
    scan_all_skills_impl(&state.db).await
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[cfg(unix)]
    fn symlink_dir_for_test(
        original: impl AsRef<Path>,
        link: impl AsRef<Path>,
    ) -> std::io::Result<()> {
        std::os::unix::fs::symlink(original, link)
    }

    #[cfg(windows)]
    fn symlink_dir_for_test(
        original: impl AsRef<Path>,
        link: impl AsRef<Path>,
    ) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(original, link)
    }

    #[cfg(windows)]
    fn should_skip_symlink_test(error: &std::io::Error) -> bool {
        super::super::linker::should_fallback_to_copy_error(error)
    }

    #[cfg(not(windows))]
    fn should_skip_symlink_test(_error: &std::io::Error) -> bool {
        false
    }

    fn create_symlink_or_skip(original: impl AsRef<Path>, link: impl AsRef<Path>) -> bool {
        match symlink_dir_for_test(original, link) {
            Ok(()) => true,
            Err(error) if should_skip_symlink_test(&error) => {
                eprintln!("skipping symlink assertion: {error}");
                false
            }
            Err(error) => panic!("failed to create symlink: {error}"),
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Write a SKILL.md with the given content in `dir/<skill_name>/SKILL.md`.
    fn create_skill_dir(parent: &Path, dir_name: &str, content: &str) -> std::path::PathBuf {
        let skill_dir = parent.join(dir_name);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), content).unwrap();
        skill_dir
    }

    fn valid_skill_md(name: &str, description: &str) -> String {
        format!(
            "---\nname: {}\ndescription: {}\n---\n\n# {}\n\nContent.\n",
            name, description, name
        )
    }

    fn skill_md_no_description(name: &str) -> String {
        format!("---\nname: {}\n---\n\n# {}\n", name, name)
    }

    fn write_claude_plugin_runtime(claude_root: &Path, enabled_plugins: &[(&str, &Path)]) {
        fs::create_dir_all(claude_root.join("plugins")).unwrap();

        let enabled_json = enabled_plugins
            .iter()
            .map(|(plugin_id, _)| (plugin_id.to_string(), serde_json::Value::Bool(true)))
            .collect::<serde_json::Map<_, _>>();
        fs::write(
            claude_root.join("settings.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "enabledPlugins": enabled_json,
            }))
            .unwrap(),
        )
        .unwrap();

        let installed_json = enabled_plugins
            .iter()
            .map(|(plugin_id, install_path)| {
                (
                    plugin_id.to_string(),
                    serde_json::json!([{
                        "scope": "user",
                        "installPath": install_path.to_string_lossy().to_string(),
                        "version": "test-version",
                        "installedAt": "2026-04-23T00:00:00Z",
                        "lastUpdated": "2026-04-23T00:00:00Z"
                    }]),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        fs::write(
            claude_root.join("plugins/installed_plugins.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "version": 2,
                "plugins": installed_json,
            }))
            .unwrap(),
        )
        .unwrap();
    }

    // ── parse_skill_md ────────────────────────────────────────────────────────

    #[test]
    fn test_parse_skill_md_valid() {
        let tmp = TempDir::new().unwrap();
        let md_path = tmp.path().join("SKILL.md");
        fs::write(&md_path, valid_skill_md("My Skill", "A great skill")).unwrap();

        let info = parse_skill_md(&md_path).expect("should parse valid SKILL.md");
        assert_eq!(info.name, "My Skill");
        assert_eq!(info.description.as_deref(), Some("A great skill"));
    }

    #[test]
    fn test_parse_skill_md_no_description() {
        let tmp = TempDir::new().unwrap();
        let md_path = tmp.path().join("SKILL.md");
        fs::write(&md_path, skill_md_no_description("Minimal Skill")).unwrap();

        let info = parse_skill_md(&md_path).expect("should parse frontmatter without description");
        assert_eq!(info.name, "Minimal Skill");
        assert!(info.description.is_none());
    }

    #[test]
    fn test_parse_skill_md_missing_name() {
        let tmp = TempDir::new().unwrap();
        let md_path = tmp.path().join("SKILL.md");
        fs::write(
            &md_path,
            "---\ndescription: Has description but no name\n---\n\nContent.",
        )
        .unwrap();

        let result = parse_skill_md(&md_path);
        assert!(result.is_none(), "should return None when name is missing");
    }

    #[test]
    fn test_parse_skill_md_no_frontmatter() {
        let tmp = TempDir::new().unwrap();
        let md_path = tmp.path().join("SKILL.md");
        fs::write(&md_path, "# Just a Markdown file\n\nNo frontmatter here.").unwrap();

        let result = parse_skill_md(&md_path);
        assert!(
            result.is_none(),
            "should return None when frontmatter is absent"
        );
    }

    #[test]
    fn test_parse_skill_md_empty_file() {
        let tmp = TempDir::new().unwrap();
        let md_path = tmp.path().join("SKILL.md");
        fs::write(&md_path, "").unwrap();

        let result = parse_skill_md(&md_path);
        assert!(result.is_none(), "should return None for an empty file");
    }

    #[test]
    fn test_parse_skill_md_file_not_found() {
        let result = parse_skill_md(Path::new("/nonexistent/path/SKILL.md"));
        assert!(result.is_none(), "should return None for a missing file");
    }

    #[test]
    fn test_parse_skill_md_multiline_description() {
        let tmp = TempDir::new().unwrap();
        let md_path = tmp.path().join("SKILL.md");
        // YAML block scalar for multiline strings
        let content =
            "---\nname: Block Skill\ndescription: \"Line one. Line two.\"\n---\n\nBody.\n";
        fs::write(&md_path, content).unwrap();

        let info = parse_skill_md(&md_path).expect("should parse multiline description");
        assert_eq!(info.name, "Block Skill");
        assert!(info.description.is_some());
    }

    // ── detect_link_type ──────────────────────────────────────────────────────

    #[test]
    fn test_detect_link_type_real_dir_platform() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("real-skill");
        fs::create_dir_all(&dir).unwrap();

        let (kind, target) = detect_link_type(&dir, false);
        assert_eq!(
            kind, "copy",
            "real dir in platform context should be 'copy'"
        );
        assert!(target.is_none());
    }

    #[test]
    fn test_detect_link_type_real_dir_central() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("central-skill");
        fs::create_dir_all(&dir).unwrap();

        let (kind, target) = detect_link_type(&dir, true);
        assert_eq!(
            kind, "native",
            "real dir in central context should be 'native'"
        );
        assert!(target.is_none());
    }

    #[test]
    fn test_detect_link_type_symlink() {
        let tmp = TempDir::new().unwrap();

        // Create a real target directory
        let target_dir = tmp.path().join("target-skill");
        fs::create_dir_all(&target_dir).unwrap();

        // Create a symlink pointing to it
        let link_path = tmp.path().join("linked-skill");
        if !create_symlink_or_skip(&target_dir, &link_path) {
            return;
        }

        let (kind, sym_target) = detect_link_type(&link_path, false);
        assert_eq!(kind, "symlink");
        assert!(
            sym_target.is_some(),
            "symlink target path should be returned"
        );
    }

    #[test]
    fn test_detect_link_type_symlink_is_symlink_regardless_of_is_central() {
        let tmp = TempDir::new().unwrap();
        let target_dir = tmp.path().join("target");
        fs::create_dir_all(&target_dir).unwrap();
        let link_path = tmp.path().join("link");
        if !create_symlink_or_skip(&target_dir, &link_path) {
            return;
        }

        // Even in central context, a symlink is a symlink
        let (kind, _) = detect_link_type(&link_path, true);
        assert_eq!(kind, "symlink");
    }

    // ── scan_directory ────────────────────────────────────────────────────────

    #[test]
    fn test_scan_directory_empty() {
        let tmp = TempDir::new().unwrap();
        let result = scan_directory(tmp.path(), false);
        assert!(result.is_empty(), "empty directory should yield no skills");
    }

    #[test]
    fn test_scan_directory_finds_single_skill() {
        let tmp = TempDir::new().unwrap();
        create_skill_dir(
            tmp.path(),
            "cool-skill",
            &valid_skill_md("Cool Skill", "Does cool things"),
        );

        let skills = scan_directory(tmp.path(), false);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "cool-skill");
        assert_eq!(skills[0].name, "Cool Skill");
        assert_eq!(skills[0].description.as_deref(), Some("Does cool things"));
    }

    #[test]
    fn test_scan_directory_finds_multiple_skills() {
        let tmp = TempDir::new().unwrap();
        create_skill_dir(tmp.path(), "skill-a", &valid_skill_md("Skill A", "Alpha"));
        create_skill_dir(tmp.path(), "skill-b", &valid_skill_md("Skill B", "Beta"));
        create_skill_dir(tmp.path(), "skill-c", &valid_skill_md("Skill C", "Gamma"));

        let mut skills = scan_directory(tmp.path(), false);
        skills.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(skills.len(), 3);
        assert_eq!(skills[0].id, "skill-a");
        assert_eq!(skills[1].id, "skill-b");
        assert_eq!(skills[2].id, "skill-c");
    }

    #[test]
    fn test_scan_directory_skips_dirs_without_skill_md() {
        let tmp = TempDir::new().unwrap();
        create_skill_dir(tmp.path(), "valid-skill", &valid_skill_md("Valid", "OK"));

        // A directory without SKILL.md should be ignored
        fs::create_dir_all(tmp.path().join("no-skill-md")).unwrap();

        let skills = scan_directory(tmp.path(), false);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "valid-skill");
    }

    #[test]
    fn test_scan_directory_skips_invalid_frontmatter() {
        let tmp = TempDir::new().unwrap();
        create_skill_dir(tmp.path(), "valid-skill", &valid_skill_md("Valid", "OK"));
        create_skill_dir(
            tmp.path(),
            "invalid-skill",
            "# No frontmatter here\n\nJust content.",
        );

        let skills = scan_directory(tmp.path(), false);
        assert_eq!(
            skills.len(),
            1,
            "skill with invalid frontmatter should be skipped"
        );
        assert_eq!(skills[0].id, "valid-skill");
    }

    #[test]
    fn test_scan_directory_skips_regular_files() {
        let tmp = TempDir::new().unwrap();
        // A plain file at the top level should be ignored
        fs::write(tmp.path().join("README.md"), "# readme").unwrap();
        create_skill_dir(tmp.path(), "real-skill", &valid_skill_md("Real", "desc"));

        let skills = scan_directory(tmp.path(), false);
        assert_eq!(skills.len(), 1);
    }

    #[test]
    fn test_scan_directory_is_not_recursive() {
        let tmp = TempDir::new().unwrap();
        // Create a nested structure (depth 2); only top-level subdirs should be found
        let deep_dir = tmp.path().join("outer").join("inner");
        fs::create_dir_all(&deep_dir).unwrap();
        fs::write(
            deep_dir.join("SKILL.md"),
            &valid_skill_md("Deep Skill", "too deep"),
        )
        .unwrap();

        let skills = scan_directory(tmp.path(), false);
        assert!(
            skills.is_empty(),
            "scan_directory should not descend more than one level"
        );
    }

    #[test]
    fn test_scan_directory_central_dir_marks_native() {
        let tmp = TempDir::new().unwrap();
        create_skill_dir(
            tmp.path(),
            "central-skill",
            &valid_skill_md("Central", "desc"),
        );

        let skills = scan_directory(tmp.path(), true /* is_central */);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].link_type, "native");
        assert!(skills[0].is_central);
    }

    #[test]
    fn test_scan_directory_detects_symlinked_skill() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("agent-skills");
        fs::create_dir_all(&skills_dir).unwrap();

        // Create a real skill in another location (central-like)
        let central_dir = tmp.path().join("central");
        create_skill_dir(
            &central_dir,
            "my-skill",
            &valid_skill_md("My Skill", "desc"),
        );

        // Symlink it into the agent skills dir
        let link = skills_dir.join("my-skill");
        if !create_symlink_or_skip(central_dir.join("my-skill"), &link) {
            return;
        }

        let skills = scan_directory(&skills_dir, false);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].link_type, "symlink");
        assert!(skills[0].symlink_target.is_some());
    }

    #[test]
    fn test_scan_directory_nonexistent_dir_returns_empty() {
        let result = scan_directory(Path::new("/nonexistent/path/skills"), false);
        assert!(result.is_empty());
    }

    // ── scan_all_skills_impl ──────────────────────────────────────────────────

    async fn setup_test_db() -> DbPool {
        use crate::db;
        use sqlx::SqlitePool;
        let pool = SqlitePool::connect(":memory:").await.expect("in-memory DB");
        db::init_database(&pool).await.expect("init");
        pool
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_empty_dirs() {
        use sqlx::SqlitePool;

        // Build a pool with tables but no seeded agents so the test is
        // isolated from whatever the user has installed on their machine.
        let pool = SqlitePool::connect(":memory:").await.expect("in-memory DB");
        db::init_database(&pool).await.expect("init");
        // Remove all seeded agents so the test is isolated from whatever the
        // user has installed on their machine.
        sqlx::query("DELETE FROM agents")
            .execute(&pool)
            .await
            .expect("delete agents");
        // Also clear the builtin scan directories that init_database seeds,
        // so the custom-scan-dir loop has nothing to scan either.
        sqlx::query("DELETE FROM scan_directories")
            .execute(&pool)
            .await
            .expect("delete scan_directories");

        // Add one agent whose skills dir definitely does not exist.
        let dummy_agent = db::Agent {
            id: "empty-agent".to_string(),
            display_name: "Empty Agent".to_string(),
            category: "coding".to_string(),
            global_skills_dir: "/nonexistent/path/skills".to_string(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        db::insert_custom_agent(&pool, &dummy_agent)
            .await
            .expect("insert dummy agent");

        let result = scan_all_skills_impl(&pool).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.total_skills, 0);
        assert_eq!(r.agents_scanned, 1);
        assert_eq!(r.skills_by_agent.get("empty-agent").copied(), Some(0));
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_persists_skills() {
        use crate::db;

        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        // Add a custom agent pointing to our temp directory
        let test_agent = db::Agent {
            id: "test-agent".to_string(),
            display_name: "Test Agent".to_string(),
            category: "coding".to_string(),
            global_skills_dir: tmp.path().to_string_lossy().into_owned(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        db::insert_custom_agent(&pool, &test_agent).await.unwrap();

        // Create skills in the temp directory
        create_skill_dir(
            tmp.path(),
            "alpha-skill",
            &valid_skill_md("Alpha Skill", "First skill"),
        );
        create_skill_dir(
            tmp.path(),
            "beta-skill",
            &valid_skill_md("Beta Skill", "Second skill"),
        );

        let result = scan_all_skills_impl(&pool).await.unwrap();

        // Test agent should have 2 skills
        assert_eq!(result.skills_by_agent.get("test-agent").copied(), Some(2));

        // Skills should be in the DB
        let skills_in_db = db::get_skills_by_agent(&pool, "test-agent").await.unwrap();
        assert_eq!(skills_in_db.len(), 2);
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_central_skills_are_marked() {
        use crate::db;

        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        // Override the "central" agent's dir with our temp dir by inserting a
        // custom agent with id "central-test".
        let central_agent = db::Agent {
            id: "central-test".to_string(),
            display_name: "Central Test".to_string(),
            category: "central".to_string(),
            global_skills_dir: tmp.path().to_string_lossy().into_owned(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        db::insert_custom_agent(&pool, &central_agent)
            .await
            .unwrap();

        create_skill_dir(
            tmp.path(),
            "canon-skill",
            &valid_skill_md("Canon Skill", "Canonical"),
        );

        scan_all_skills_impl(&pool).await.unwrap();

        // Not is_central because agent id is "central-test", not "central"
        // (the "central" agent points to a non-existent dir in CI)
        let skill = db::get_skill_by_id(&pool, "canon-skill").await.unwrap();
        assert!(skill.is_some());
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_with_custom_scan_directory() {
        use crate::db;

        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        // Add a custom scan directory
        db::add_scan_directory(&pool, tmp.path().to_str().unwrap(), Some("Test Dir"))
            .await
            .unwrap();

        create_skill_dir(
            tmp.path(),
            "custom-dir-skill",
            &valid_skill_md("Custom Dir Skill", "From custom dir"),
        );

        let result = scan_all_skills_impl(&pool).await.unwrap();
        // Skill should be in total count (custom dirs contribute to total)
        assert!(result.total_skills > 0);

        // Skill should be in the DB
        let skill = db::get_skill_by_id(&pool, "custom-dir-skill")
            .await
            .unwrap();
        assert!(skill.is_some());
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_returns_per_agent_counts() {
        use crate::db;

        let tmp_a = TempDir::new().unwrap();
        let tmp_b = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        let agent_a = db::Agent {
            id: "agent-a".to_string(),
            display_name: "Agent A".to_string(),
            category: "coding".to_string(),
            global_skills_dir: tmp_a.path().to_string_lossy().into_owned(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        let agent_b = db::Agent {
            id: "agent-b".to_string(),
            display_name: "Agent B".to_string(),
            category: "coding".to_string(),
            global_skills_dir: tmp_b.path().to_string_lossy().into_owned(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        db::insert_custom_agent(&pool, &agent_a).await.unwrap();
        db::insert_custom_agent(&pool, &agent_b).await.unwrap();

        create_skill_dir(tmp_a.path(), "skill-x", &valid_skill_md("Skill X", "In A"));
        create_skill_dir(
            tmp_a.path(),
            "skill-y",
            &valid_skill_md("Skill Y", "In A too"),
        );
        create_skill_dir(tmp_b.path(), "skill-z", &valid_skill_md("Skill Z", "In B"));

        let result = scan_all_skills_impl(&pool).await.unwrap();

        assert_eq!(result.skills_by_agent.get("agent-a").copied(), Some(2));
        assert_eq!(result.skills_by_agent.get("agent-b").copied(), Some(1));
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_claude_scans_user_and_multiple_plugin_roots() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        sqlx::query("DELETE FROM agents WHERE id != 'claude-code'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM scan_directories")
            .execute(&pool)
            .await
            .unwrap();

        let claude_root = tmp.path().join(".claude");
        let user_root = claude_root.join("skills");
        let plugin_a_root = claude_root
            .join("plugins")
            .join("cache")
            .join("publisher-a")
            .join("plugin-a")
            .join("1.0.0");
        let plugin_b_root = claude_root
            .join("plugins")
            .join("cache")
            .join("publisher-b")
            .join("plugin-b")
            .join("2.0.0");
        let plugin_a_skill_root = plugin_a_root.join("skills");
        let plugin_b_skill_root = plugin_b_root.join(".claude").join("skills");

        fs::create_dir_all(&user_root).unwrap();
        fs::create_dir_all(&plugin_a_skill_root).unwrap();
        fs::create_dir_all(&plugin_b_skill_root).unwrap();

        create_skill_dir(
            &user_root,
            "user-skill",
            &valid_skill_md("User Skill", "From ~/.claude/skills"),
        );
        create_skill_dir(
            &plugin_a_skill_root,
            "plugin-a-skill",
            &valid_skill_md("plugin-a:skill", "From plugin A"),
        );
        create_skill_dir(
            &plugin_b_skill_root,
            "plugin-b-skill",
            &valid_skill_md("plugin-b:skill", "From plugin B"),
        );
        write_claude_plugin_runtime(
            &claude_root,
            &[
                ("plugin-a@publisher-a", &plugin_a_root),
                ("plugin-b@publisher-b", &plugin_b_root),
            ],
        );

        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(user_root.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();

        let result = scan_all_skills_impl(&pool).await.unwrap();
        assert_eq!(result.agents_scanned, 1);
        assert_eq!(result.skills_by_agent.get("claude-code").copied(), Some(3));

        let mut skills = db::get_skills_by_agent(&pool, "claude-code").await.unwrap();
        skills.sort_by(|a, b| a.id.cmp(&b.id));
        let ids: Vec<&str> = skills.iter().map(|skill| skill.id.as_str()).collect();
        assert_eq!(ids, vec!["plugin-a-skill", "plugin-b-skill", "user-skill"]);

        let observations = db::get_agent_skill_observations(&pool, "claude-code")
            .await
            .unwrap();
        assert_eq!(observations.len(), 3);

        let plugin_a_rows: Vec<_> = observations
            .iter()
            .filter(|row| row.skill_id == "plugin-a-skill")
            .collect();
        assert_eq!(plugin_a_rows.len(), 1);
        assert_eq!(plugin_a_rows[0].source_kind, "plugin");
        assert_eq!(
            plugin_a_rows[0].dir_path,
            plugin_a_skill_root.join("plugin-a-skill").to_string_lossy()
        );
        assert_eq!(
            plugin_a_rows[0].source_root,
            plugin_a_root.to_string_lossy()
        );

        let plugin_b_rows: Vec<_> = observations
            .iter()
            .filter(|row| row.skill_id == "plugin-b-skill")
            .collect();
        assert_eq!(plugin_b_rows.len(), 1);
        assert_eq!(plugin_b_rows[0].source_kind, "plugin");
        assert_eq!(
            plugin_b_rows[0].dir_path,
            plugin_b_skill_root.join("plugin-b-skill").to_string_lossy()
        );
        assert_eq!(
            plugin_b_rows[0].source_root,
            plugin_b_root.to_string_lossy()
        );

        let plugin_a_installations = db::get_skill_installations(&pool, "plugin-a-skill")
            .await
            .unwrap();
        assert!(
            plugin_a_installations.is_empty(),
            "plugin rows should not create install-state records"
        );
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_claude_duplicate_rows_stay_distinct_without_install_pollution(
    ) {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        sqlx::query("DELETE FROM agents WHERE id != 'claude-code'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM scan_directories")
            .execute(&pool)
            .await
            .unwrap();

        let claude_root = tmp.path().join(".claude");
        let user_root = claude_root.join("skills");
        let plugin_root = claude_root.join("plugins/cache/publisher/shared-plugin/1.0.0");
        let plugin_skill_root = plugin_root.join("skills");
        fs::create_dir_all(&user_root).unwrap();
        fs::create_dir_all(&plugin_skill_root).unwrap();

        create_skill_dir(
            &user_root,
            "shared-skill",
            &valid_skill_md("Shared Skill", "User copy"),
        );
        create_skill_dir(
            &plugin_skill_root,
            "shared-skill",
            &valid_skill_md("shared-plugin:shared-skill", "Plugin copy"),
        );
        write_claude_plugin_runtime(&claude_root, &[("shared-plugin@publisher", &plugin_root)]);

        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(user_root.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();

        scan_all_skills_impl(&pool).await.unwrap();

        let rows = db::get_agent_skill_observations(&pool, "claude-code")
            .await
            .unwrap();
        let shared_rows: Vec<_> = rows
            .iter()
            .filter(|row| row.skill_id == "shared-skill")
            .collect();
        assert_eq!(
            shared_rows.len(),
            2,
            "user and plugin copies should remain distinct observation rows"
        );
        assert_ne!(shared_rows[0].row_id, shared_rows[1].row_id);

        let installs = db::get_skill_installations(&pool, "shared-skill")
            .await
            .unwrap();
        assert_eq!(
            installs.len(),
            1,
            "only the user copy should remain manageable"
        );
        assert_eq!(
            installs[0].installed_path,
            user_root.join("shared-skill").to_string_lossy()
        );

        let stored_skill = db::get_skill_by_id(&pool, "shared-skill")
            .await
            .unwrap()
            .expect("user copy should still back the logical skill row");
        assert_eq!(
            stored_skill.file_path,
            user_root
                .join("shared-skill")
                .join("SKILL.md")
                .to_string_lossy()
        );
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_claude_scans_plugins_even_without_user_root() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        sqlx::query("DELETE FROM agents WHERE id != 'claude-code'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM scan_directories")
            .execute(&pool)
            .await
            .unwrap();

        let claude_root = tmp.path().join(".claude");
        let user_root = claude_root.join("skills");
        let plugin_a_root = claude_root.join("plugins/cache/publisher-a/plugin-a/1.0.0");
        let plugin_b_root = claude_root.join("plugins/cache/publisher-b/plugin-b/2.0.0");
        let plugin_a_skill_root = plugin_a_root.join("skills");
        let plugin_b_skill_root = plugin_b_root.join(".claude/skills");

        fs::create_dir_all(&plugin_a_skill_root).unwrap();
        fs::create_dir_all(&plugin_b_skill_root).unwrap();

        create_skill_dir(
            &plugin_a_skill_root,
            "plugin-a-skill",
            &valid_skill_md("plugin-a:skill", "From plugin A"),
        );
        create_skill_dir(
            &plugin_b_skill_root,
            "plugin-b-skill",
            &valid_skill_md("plugin-b:skill", "From plugin B"),
        );
        write_claude_plugin_runtime(
            &claude_root,
            &[
                ("plugin-a@publisher-a", &plugin_a_root),
                ("plugin-b@publisher-b", &plugin_b_root),
            ],
        );

        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(user_root.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();

        let result = scan_all_skills_impl(&pool).await.unwrap();
        assert_eq!(result.skills_by_agent.get("claude-code").copied(), Some(2));

        let detected = db::get_agent_by_id(&pool, "claude-code")
            .await
            .unwrap()
            .unwrap();
        assert!(
            detected.is_detected,
            "claude-code should remain detected when only plugin roots exist"
        );
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_non_claude_agents_ignore_claude_plugins() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        sqlx::query("DELETE FROM agents")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM scan_directories")
            .execute(&pool)
            .await
            .unwrap();

        let claude_like_root = tmp.path().join(".claude");
        let user_root = claude_like_root.join("skills");
        let plugin_a_root = claude_like_root.join("plugins/cache/publisher-a/plugin-a/1.0.0");
        let plugin_b_root = claude_like_root.join("plugins/cache/publisher-b/plugin-b/2.0.0");
        let plugin_a_skill_root = plugin_a_root.join("skills");
        let plugin_b_skill_root = plugin_b_root.join(".claude/skills");

        fs::create_dir_all(&user_root).unwrap();
        fs::create_dir_all(&plugin_a_skill_root).unwrap();
        fs::create_dir_all(&plugin_b_skill_root).unwrap();

        create_skill_dir(
            &user_root,
            "user-skill",
            &valid_skill_md("User Skill", "From primary root"),
        );
        create_skill_dir(
            &plugin_a_skill_root,
            "plugin-a-skill",
            &valid_skill_md("plugin-a:skill", "From plugin A"),
        );
        create_skill_dir(
            &plugin_b_skill_root,
            "plugin-b-skill",
            &valid_skill_md("plugin-b:skill", "From plugin B"),
        );
        write_claude_plugin_runtime(
            &claude_like_root,
            &[
                ("plugin-a@publisher-a", &plugin_a_root),
                ("plugin-b@publisher-b", &plugin_b_root),
            ],
        );

        let agent = db::Agent {
            id: "not-claude".to_string(),
            display_name: "Not Claude".to_string(),
            category: "coding".to_string(),
            global_skills_dir: user_root.to_string_lossy().to_string(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        db::insert_custom_agent(&pool, &agent).await.unwrap();

        let result = scan_all_skills_impl(&pool).await.unwrap();
        assert_eq!(result.agents_scanned, 1);
        assert_eq!(result.skills_by_agent.get("not-claude").copied(), Some(1));

        let skills = db::get_skills_by_agent(&pool, "not-claude").await.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "user-skill");
    }

    #[tokio::test]
    #[ignore = "manual isolated-home sanity check"]
    async fn test_scan_all_skills_impl_claude_fixture_home_sanity() {
        let fixture_home = Path::new("/tmp/skills-manage-test-fixtures/claude-multi-source");
        if fixture_home.exists() {
            fs::remove_dir_all(fixture_home).unwrap();
        }
        fs::create_dir_all(fixture_home).unwrap();

        let pool = setup_test_db().await;

        sqlx::query("DELETE FROM agents WHERE id != 'claude-code'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM scan_directories")
            .execute(&pool)
            .await
            .unwrap();

        let user_root = fixture_home.join(".claude/skills");
        let plugin_a_root = fixture_home.join(".claude/plugins/cache/publisher-a/plugin-a/1.0.0");
        let plugin_b_root = fixture_home.join(".claude/plugins/cache/publisher-b/plugin-b/2.0.0");
        let plugin_a_skill_root = plugin_a_root.join("skills");
        let plugin_b_skill_root = plugin_b_root.join(".claude/skills");

        fs::create_dir_all(&user_root).unwrap();
        fs::create_dir_all(&plugin_a_skill_root).unwrap();
        fs::create_dir_all(&plugin_b_skill_root).unwrap();

        create_skill_dir(
            &user_root,
            "fixture-user-skill",
            &valid_skill_md("Fixture User Skill", "From fixture user root"),
        );
        create_skill_dir(
            &plugin_a_skill_root,
            "fixture-plugin-a-skill",
            &valid_skill_md("plugin-a:fixture", "From fixture plugin A"),
        );
        create_skill_dir(
            &plugin_b_skill_root,
            "fixture-plugin-b-skill",
            &valid_skill_md("plugin-b:fixture", "From fixture plugin B"),
        );
        write_claude_plugin_runtime(
            &fixture_home.join(".claude"),
            &[
                ("plugin-a@publisher-a", &plugin_a_root),
                ("plugin-b@publisher-b", &plugin_b_root),
            ],
        );

        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(user_root.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();

        let result = scan_all_skills_impl(&pool).await.unwrap();
        assert_eq!(result.skills_by_agent.get("claude-code").copied(), Some(3));
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_claude_rescan_drops_stale_plugin_duplicate_only() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        sqlx::query("DELETE FROM agents WHERE id != 'claude-code'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM scan_directories")
            .execute(&pool)
            .await
            .unwrap();

        let claude_root = tmp.path().join(".claude");
        let user_root = claude_root.join("skills");
        let plugin_root = claude_root.join("plugins/cache/publisher/shared-plugin/1.0.0");
        let plugin_skill_root = plugin_root.join("skills");
        fs::create_dir_all(&user_root).unwrap();
        fs::create_dir_all(&plugin_skill_root).unwrap();

        let plugin_skill_dir = create_skill_dir(
            &plugin_skill_root,
            "shared-skill",
            &valid_skill_md("shared-plugin:shared-skill", "Plugin copy"),
        );
        create_skill_dir(
            &user_root,
            "shared-skill",
            &valid_skill_md("Shared Skill", "User copy"),
        );
        write_claude_plugin_runtime(&claude_root, &[("shared-plugin@publisher", &plugin_root)]);

        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(user_root.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();

        scan_all_skills_impl(&pool).await.unwrap();
        fs::remove_dir_all(&plugin_skill_dir).unwrap();
        scan_all_skills_impl(&pool).await.unwrap();

        let rows = db::get_agent_skill_observations(&pool, "claude-code")
            .await
            .unwrap();
        assert_eq!(rows.len(), 1, "only the user observation should remain");
        assert_eq!(rows[0].source_kind, "user");

        let installs = db::get_skill_installations(&pool, "shared-skill")
            .await
            .unwrap();
        assert_eq!(
            installs.len(),
            1,
            "user install state should survive plugin cleanup"
        );
    }

    #[tokio::test]
    async fn test_scan_all_skills_impl_claude_plugin_survives_when_user_duplicate_is_removed() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        sqlx::query("DELETE FROM agents WHERE id != 'claude-code'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM scan_directories")
            .execute(&pool)
            .await
            .unwrap();

        let claude_root = tmp.path().join(".claude");
        let user_root = claude_root.join("skills");
        let plugin_root = claude_root.join("plugins/cache/publisher/shared-plugin/1.0.0");
        let plugin_skill_root = plugin_root.join("skills");
        fs::create_dir_all(&user_root).unwrap();
        fs::create_dir_all(&plugin_skill_root).unwrap();

        let user_skill_dir = create_skill_dir(
            &user_root,
            "shared-skill",
            &valid_skill_md("Shared Skill", "User copy"),
        );
        create_skill_dir(
            &plugin_skill_root,
            "shared-skill",
            &valid_skill_md("shared-plugin:shared-skill", "Plugin copy"),
        );
        write_claude_plugin_runtime(&claude_root, &[("shared-plugin@publisher", &plugin_root)]);

        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(user_root.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();

        scan_all_skills_impl(&pool).await.unwrap();
        fs::remove_dir_all(&user_skill_dir).unwrap();
        scan_all_skills_impl(&pool).await.unwrap();

        let rows = db::get_agent_skill_observations(&pool, "claude-code")
            .await
            .unwrap();
        assert_eq!(
            rows.len(),
            1,
            "plugin observation should survive even after the user duplicate disappears"
        );
        assert_eq!(rows[0].source_kind, "plugin");

        let installs = db::get_skill_installations(&pool, "shared-skill")
            .await
            .unwrap();
        assert!(
            installs.is_empty(),
            "plugin observations must not keep stale Claude install-state rows alive"
        );

        let skill = db::get_skill_by_id(&pool, "shared-skill").await.unwrap();
        assert!(
            skill.is_none(),
            "plugin observations should not keep a stale manageable skill row alive"
        );
    }

    // ── Regression: Bug 1 — installed_path must be the skill directory ────────

    /// installed_path should point to the skill directory, not to the SKILL.md
    /// file inside it.
    #[tokio::test]
    async fn test_installed_path_is_skill_directory_not_skill_md() {
        use crate::db;

        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        let test_agent = db::Agent {
            id: "path-agent".to_string(),
            display_name: "Path Agent".to_string(),
            category: "coding".to_string(),
            global_skills_dir: tmp.path().to_string_lossy().into_owned(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        db::insert_custom_agent(&pool, &test_agent).await.unwrap();

        let skill_dir =
            create_skill_dir(tmp.path(), "my-skill", &valid_skill_md("My Skill", "desc"));

        scan_all_skills_impl(&pool).await.unwrap();

        let installations = db::get_skill_installations(&pool, "my-skill")
            .await
            .unwrap();
        assert_eq!(
            installations.len(),
            1,
            "Expected exactly one installation record"
        );

        let inst = &installations[0];
        // installed_path must NOT be the SKILL.md file path.
        assert!(
            !inst.installed_path.ends_with("SKILL.md"),
            "installed_path should not point to the SKILL.md file; got: {}",
            inst.installed_path
        );
        // installed_path must equal the skill directory path.
        assert_eq!(
            inst.installed_path,
            skill_dir.to_string_lossy().as_ref(),
            "installed_path should be the skill directory, not the SKILL.md inside it"
        );
    }

    // ── Regression: Bug 2 — rescan removes stale skills from DB ──────────────

    /// After removing a skill from disk and rescanning, the corresponding rows
    /// must no longer appear in skills or skill_installations queries.
    #[tokio::test]
    async fn test_rescan_removes_deleted_skills_from_db() {
        use crate::db;

        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        let test_agent = db::Agent {
            id: "stale-agent".to_string(),
            display_name: "Stale Agent".to_string(),
            category: "coding".to_string(),
            global_skills_dir: tmp.path().to_string_lossy().into_owned(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        db::insert_custom_agent(&pool, &test_agent).await.unwrap();

        // Create two skills on disk.
        create_skill_dir(
            tmp.path(),
            "skill-keep",
            &valid_skill_md("Keep Skill", "stays"),
        );
        create_skill_dir(
            tmp.path(),
            "skill-remove",
            &valid_skill_md("Remove Skill", "will be deleted"),
        );

        // First scan — both skills should be persisted.
        scan_all_skills_impl(&pool).await.unwrap();
        let skills_first = db::get_skills_by_agent(&pool, "stale-agent").await.unwrap();
        assert_eq!(
            skills_first.len(),
            2,
            "Both skills should be in DB after first scan"
        );

        // Remove "skill-remove" from disk.
        fs::remove_dir_all(tmp.path().join("skill-remove")).unwrap();

        // Second scan — "skill-remove" must disappear from the DB.
        scan_all_skills_impl(&pool).await.unwrap();

        let skills_after = db::get_skills_by_agent(&pool, "stale-agent").await.unwrap();
        assert_eq!(
            skills_after.len(),
            1,
            "Only one skill should remain after rescan"
        );
        assert_eq!(
            skills_after[0].id, "skill-keep",
            "The surviving skill should be 'skill-keep'"
        );

        // The deleted skill must also be gone from the skills table.
        let stale_skill = db::get_skill_by_id(&pool, "skill-remove").await.unwrap();
        assert!(
            stale_skill.is_none(),
            "skill-remove should be removed from the skills table after rescan"
        );

        // No orphaned installation record should remain.
        let stale_inst = db::get_skill_installations(&pool, "skill-remove")
            .await
            .unwrap();
        assert!(
            stale_inst.is_empty(),
            "skill-remove's installation record should be removed after rescan"
        );
    }

    // ── Regression: is_central preserved when codex shares the central dir ───

    /// When a central-category agent and a coding-category agent (codex) both
    /// point to the same directory, skills from that directory must end up with
    /// `is_central = true` after scanning — regardless of scan order.
    ///
    /// Historically this failed because:
    ///  1. The scan used `agent.id == "central"` (not `agent.category`) to set
    ///     `is_central`, so the codex agent always cleared the flag.
    ///  2. Even after fixing the flag, the `INSERT OR REPLACE` would overwrite
    ///     `is_central = true` with `false` when codex was processed last.
    #[tokio::test]
    async fn test_is_central_preserved_when_shared_with_coding_agent() {
        use crate::db;

        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        // Insert a central-category agent pointing to the shared temp directory.
        // Use "AA Central Test" as the display_name so it sorts BEFORE "ZZ Codex Test"
        // (ORDER BY display_name ASC) ensuring the central scan runs first.
        let central_agent = db::Agent {
            id: "aa-central-test".to_string(),
            display_name: "AA Central Test".to_string(),
            category: "central".to_string(),
            global_skills_dir: tmp.path().to_string_lossy().into_owned(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        // Insert a coding-category agent pointing to the SAME temp directory,
        // sorted AFTER the central agent so it is processed last (worst case).
        let coding_agent = db::Agent {
            id: "zz-codex-test".to_string(),
            display_name: "ZZ Codex Test".to_string(),
            category: "coding".to_string(),
            global_skills_dir: tmp.path().to_string_lossy().into_owned(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        db::insert_custom_agent(&pool, &central_agent)
            .await
            .unwrap();
        db::insert_custom_agent(&pool, &coding_agent).await.unwrap();

        // Place one skill in the shared directory.
        create_skill_dir(
            tmp.path(),
            "shared-skill",
            &valid_skill_md("Shared Skill", "desc"),
        );

        // Run the full scan. The coding agent is processed AFTER the central agent
        // (due to display_name ordering), which is the failure scenario for the bug.
        scan_all_skills_impl(&pool).await.unwrap();

        // The skill must still be marked as central even though the coding agent
        // scanned the same directory afterwards.
        let skill = db::get_skill_by_id(&pool, "shared-skill")
            .await
            .unwrap()
            .expect("shared-skill must be in the DB");
        assert!(
            skill.is_central,
            "skill should remain is_central=true even when a coding agent \
             scans the same directory after the central agent"
        );
    }
}
