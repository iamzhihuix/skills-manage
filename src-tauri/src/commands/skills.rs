use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::State;

use crate::db::{self, Collection, DbPool, SkillForAgent};
use crate::AppState;

// ─── Types ────────────────────────────────────────────────────────────────────

/// A Central Skill with a list of agent IDs that currently have this skill
/// installed (via symlink or copy).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillWithLinks {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub canonical_path: Option<String>,
    pub is_central: bool,
    pub source: Option<String>,
    pub scanned_at: String,
    pub created_at: String,
    pub updated_at: String,
    /// Agent IDs that have an installation record for this skill.
    pub linked_agents: Vec<String>,
}

/// An installation record enriched with the `installed_at` timestamp for
/// the skill detail IPC response. This is the frontend-facing version of
/// `db::SkillInstallation` — `created_at` from the DB is exposed as
/// `installed_at` for clarity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInstallationDetail {
    pub skill_id: String,
    pub agent_id: String,
    pub installed_path: String,
    pub link_type: String,
    pub symlink_target: Option<String>,
    /// ISO 8601 timestamp of when the skill was first installed.
    pub installed_at: String,
}

/// A skill with full installation details across all platforms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDetail {
    pub id: String,
    pub row_id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub dir_path: String,
    pub canonical_path: Option<String>,
    pub is_central: bool,
    pub source: Option<String>,
    pub scanned_at: String,
    pub source_kind: Option<String>,
    pub source_root: Option<String>,
    pub is_read_only: bool,
    pub conflict_group: Option<String>,
    pub conflict_count: i64,
    /// All installation records for this skill across agents.
    pub installations: Vec<SkillInstallationDetail>,
    /// Collections this skill currently belongs to.
    pub collections: Vec<Collection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillDirectoryNode {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub children: Vec<SkillDirectoryNode>,
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

fn system_time_to_rfc3339(time: SystemTime) -> String {
    let datetime: DateTime<Utc> = time.into();
    datetime.to_rfc3339()
}

fn skill_filesystem_timestamps(skill: &db::Skill) -> (String, String) {
    let directory_metadata = skill
        .canonical_path
        .as_deref()
        .and_then(|path| std::fs::metadata(path).ok());
    let file_metadata = std::fs::metadata(&skill.file_path).ok();

    let created_at = directory_metadata
        .as_ref()
        .or(file_metadata.as_ref())
        .and_then(|metadata| metadata.created().ok())
        .map(system_time_to_rfc3339)
        .unwrap_or_else(|| skill.scanned_at.clone());

    let updated_at = file_metadata
        .as_ref()
        .or(directory_metadata.as_ref())
        .and_then(|metadata| metadata.modified().ok())
        .map(system_time_to_rfc3339)
        .unwrap_or_else(|| skill.scanned_at.clone());

    (created_at, updated_at)
}

fn skill_dir_path(skill: &db::Skill) -> String {
    skill
        .canonical_path
        .clone()
        .or_else(|| {
            Path::new(&skill.file_path)
                .parent()
                .map(|path| path.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| skill.file_path.clone())
}

fn build_skill_directory_nodes(
    root: &Path,
    current: &Path,
    visited_dirs: &[PathBuf],
) -> Result<Vec<SkillDirectoryNode>, String> {
    let entries = std::fs::read_dir(current)
        .map_err(|e| format!("Failed to read directory '{}': {}", current.display(), e))?;

    let mut nodes = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| {
            format!(
                "Failed to read directory entry in '{}': {}",
                current.display(),
                e
            )
        })?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("Failed to read metadata for '{}': {}", path.display(), e))?;
        let is_dir = std::fs::metadata(&path)
            .map(|target_metadata| target_metadata.file_type().is_dir())
            .unwrap_or_else(|_| metadata.file_type().is_dir());
        let canonical_dir = if is_dir {
            Some(path.canonicalize().map_err(|e| {
                format!(
                    "Failed to resolve directory target '{}': {}",
                    path.display(),
                    e
                )
            })?)
        } else {
            None
        };

        if canonical_dir
            .as_ref()
            .is_some_and(|canonical| visited_dirs.iter().any(|visited| visited == canonical))
        {
            continue;
        }

        let children = if is_dir {
            let mut next_visited = visited_dirs.to_vec();
            if let Some(canonical_dir) = canonical_dir.clone() {
                next_visited.push(canonical_dir);
            }
            build_skill_directory_nodes(root, &path, &next_visited)?
        } else {
            Vec::new()
        };
        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned();

        nodes.push(SkillDirectoryNode {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            relative_path,
            is_dir,
            children,
        });
    }

    nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a
            .name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name)),
    });

    Ok(nodes)
}

fn claude_conflict_group(agent_id: &str, skill_id: &str) -> String {
    format!("{agent_id}::{skill_id}")
}

fn claude_conflict_counts(observations: &[db::AgentSkillObservation]) -> HashMap<String, i64> {
    let mut counts = HashMap::new();
    for observation in observations {
        *counts.entry(observation.skill_id.clone()).or_insert(0) += 1;
    }
    counts
}

fn claude_conflict_metadata(
    agent_id: &str,
    skill_id: &str,
    counts: &HashMap<String, i64>,
) -> (Option<String>, i64) {
    let count = counts.get(skill_id).copied().unwrap_or(0);
    if count > 1 {
        (Some(claude_conflict_group(agent_id, skill_id)), count)
    } else {
        (None, 0)
    }
}

fn installation_details(installations: Vec<db::SkillInstallation>) -> Vec<SkillInstallationDetail> {
    installations
        .into_iter()
        .map(|i| SkillInstallationDetail {
            skill_id: i.skill_id,
            agent_id: i.agent_id,
            installed_path: i.installed_path,
            link_type: i.link_type,
            symlink_target: i.symlink_target,
            installed_at: i.created_at,
        })
        .collect()
}

async fn get_claude_observation_detail(
    pool: &DbPool,
    skill_id: &str,
    agent_id: &str,
    row_id: Option<&str>,
) -> Result<Option<SkillDetail>, String> {
    if agent_id != "claude-code" {
        return Ok(None);
    }

    let observations = db::get_agent_skill_observations(pool, agent_id).await?;
    if observations.is_empty() {
        return Ok(None);
    }

    let conflict_counts = claude_conflict_counts(&observations);
    let matches: Vec<db::AgentSkillObservation> = observations
        .into_iter()
        .filter(|observation| observation.skill_id == skill_id)
        .collect();

    if matches.is_empty() {
        return Ok(None);
    }

    let observation = match row_id {
        Some(row_id) => matches
            .into_iter()
            .find(|observation| observation.row_id == row_id)
            .ok_or_else(|| format!("Claude row '{}' not found for skill '{}'", row_id, skill_id))?,
        None if matches.len() == 1 => matches.into_iter().next().expect("single match"),
        None => {
            return Err(format!(
                "Multiple Claude rows found for skill '{}'; row_id is required",
                skill_id
            ))
        }
    };

    let manageable_skill = db::get_skill_by_id(pool, &observation.skill_id).await?;
    let installations = if observation.is_read_only {
        Vec::new()
    } else {
        installation_details(db::get_skill_installations(pool, &observation.skill_id).await?)
    };
    let collections = if observation.is_read_only {
        Vec::new()
    } else {
        db::get_skill_collections(pool, &observation.skill_id).await?
    };
    let (conflict_group, conflict_count) =
        claude_conflict_metadata(agent_id, &observation.skill_id, &conflict_counts);

    Ok(Some(SkillDetail {
        row_id: observation.row_id,
        id: observation.skill_id.clone(),
        name: observation.name,
        description: observation.description.or_else(|| {
            manageable_skill
                .as_ref()
                .and_then(|skill| skill.description.clone())
        }),
        file_path: observation.file_path,
        dir_path: observation.dir_path,
        canonical_path: if observation.is_read_only {
            None
        } else {
            manageable_skill
                .as_ref()
                .and_then(|skill| skill.canonical_path.clone())
        },
        is_central: manageable_skill
            .as_ref()
            .map(|skill| skill.is_central)
            .unwrap_or(false),
        source: manageable_skill
            .as_ref()
            .and_then(|skill| skill.source.clone())
            .or_else(|| Some(observation.link_type.clone())),
        scanned_at: observation.scanned_at,
        source_kind: Some(observation.source_kind),
        source_root: Some(observation.source_root),
        is_read_only: observation.is_read_only,
        conflict_group,
        conflict_count,
        installations,
        collections,
    }))
}

async fn get_skill_detail_with_row_impl(
    pool: &DbPool,
    skill_id: &str,
    agent_id: Option<&str>,
    row_id: Option<&str>,
) -> Result<SkillDetail, String> {
    if let Some(agent_id) = agent_id {
        if let Some(detail) =
            get_claude_observation_detail(pool, skill_id, agent_id, row_id).await?
        {
            return Ok(detail);
        }
    }

    let skill = db::get_skill_by_id(pool, skill_id)
        .await?
        .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;

    let row_id = skill.id.clone();
    let dir_path = skill_dir_path(&skill);
    let installations = installation_details(db::get_skill_installations(pool, skill_id).await?);
    let collections = db::get_skill_collections(pool, skill_id).await?;

    Ok(SkillDetail {
        row_id,
        id: skill.id,
        name: skill.name,
        description: skill.description,
        file_path: skill.file_path,
        dir_path,
        canonical_path: skill.canonical_path,
        is_central: skill.is_central,
        source: skill.source,
        scanned_at: skill.scanned_at,
        source_kind: None,
        source_root: None,
        is_read_only: false,
        conflict_group: None,
        conflict_count: 0,
        installations,
        collections,
    })
}

/// Testable core implementation of `get_skills_by_agent`.
///
/// Returns skills for the given agent enriched with installation metadata
/// (`dir_path`, `link_type`, `symlink_target`) so the frontend `SkillCard`
/// can display the correct source indicator.
pub async fn get_skills_by_agent_impl(
    pool: &DbPool,
    agent_id: &str,
) -> Result<Vec<SkillForAgent>, String> {
    db::get_skills_for_agent(pool, agent_id).await
}

/// Tauri command: return all skills installed for a given agent, including
/// installation metadata needed by the platform-view skill cards.
#[tauri::command]
pub async fn get_skills_by_agent(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<Vec<SkillForAgent>, String> {
    get_skills_by_agent_impl(&state.db, &agent_id).await
}

/// Tauri command: return all Central Skills with per-platform link status.
///
/// For each skill in the central skills directory, the response includes a
/// `linked_agents` array listing every agent that has an installation record
/// for that skill (regardless of whether the link type is symlink or copy).
#[tauri::command]
pub async fn get_central_skills(state: State<'_, AppState>) -> Result<Vec<SkillWithLinks>, String> {
    let skills = db::get_central_skills(&state.db).await?;

    let mut result = Vec::with_capacity(skills.len());
    for skill in skills {
        let installations = db::get_skill_installations(&state.db, &skill.id).await?;
        let linked_agents: Vec<String> = installations.into_iter().map(|i| i.agent_id).collect();
        let (created_at, updated_at) = skill_filesystem_timestamps(&skill);

        result.push(SkillWithLinks {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            file_path: skill.file_path,
            canonical_path: skill.canonical_path,
            is_central: skill.is_central,
            source: skill.source,
            scanned_at: skill.scanned_at,
            created_at,
            updated_at,
            linked_agents,
        });
    }

    Ok(result)
}

/// Tauri command: return detailed information about a skill, including all
/// installation records across agents. Each installation includes `installed_at`
/// (the `created_at` timestamp from the DB, renamed for frontend clarity).
#[tauri::command]
pub async fn get_skill_detail(
    state: State<'_, AppState>,
    skill_id: String,
    agent_id: Option<String>,
    row_id: Option<String>,
) -> Result<SkillDetail, String> {
    get_skill_detail_with_row_impl(&state.db, &skill_id, agent_id.as_deref(), row_id.as_deref())
        .await
}

/// Tauri command: read and return the raw content of a skill's `SKILL.md` file.
#[tauri::command]
pub async fn read_skill_content(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<String, String> {
    let skill = db::get_skill_by_id(&state.db, &skill_id)
        .await?
        .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;

    std::fs::read_to_string(&skill.file_path)
        .map_err(|e| format!("Failed to read '{}': {}", skill.file_path, e))
}

#[tauri::command]
pub async fn read_file_by_path(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read '{}': {}", path, e))
}

#[tauri::command]
pub async fn list_skill_directory(dir_path: String) -> Result<Vec<SkillDirectoryNode>, String> {
    let root = Path::new(&dir_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", dir_path));
    }
    if !root.is_dir() {
        return Err(format!("Path is not a directory: {}", dir_path));
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve directory '{}': {}", dir_path, e))?;

    build_skill_directory_nodes(root, root, &[canonical_root])
}

#[tauri::command]
pub async fn open_in_file_manager(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    open_in_file_manager_impl(&path)
}

fn open_in_file_manager_impl(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, AgentSkillObservation, Skill, SkillInstallation};
    use chrono::Utc;
    use sqlx::SqlitePool;
    use std::fs;
    use tempfile::TempDir;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();
        pool
    }

    fn make_skill(id: &str, name: &str, is_central: bool) -> Skill {
        Skill {
            id: id.to_string(),
            name: name.to_string(),
            description: Some(format!("Desc for {}", name)),
            file_path: format!("/tmp/{}/SKILL.md", id),
            canonical_path: if is_central {
                Some(format!("/tmp/central/{}", id))
            } else {
                None
            },
            is_central,
            source: if is_central {
                Some("native".to_string())
            } else {
                Some("copy".to_string())
            },
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        }
    }

    fn make_observation(
        row_id: &str,
        skill_id: &str,
        name: &str,
        dir_path: &str,
        source_kind: &str,
        read_only: bool,
    ) -> AgentSkillObservation {
        AgentSkillObservation {
            row_id: row_id.to_string(),
            agent_id: "claude-code".to_string(),
            skill_id: skill_id.to_string(),
            name: name.to_string(),
            description: Some(format!("{source_kind} copy")),
            file_path: format!("{dir_path}/SKILL.md"),
            dir_path: dir_path.to_string(),
            source_kind: source_kind.to_string(),
            source_root: if source_kind == "user" {
                "/tmp/.claude/skills".to_string()
            } else {
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0".to_string()
            },
            link_type: "copy".to_string(),
            symlink_target: None,
            is_read_only: read_only,
            scanned_at: Utc::now().to_rfc3339(),
        }
    }

    // ── get_skills_by_agent ───────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_skills_by_agent_returns_correct_skills() {
        let pool = setup_test_db().await;

        let skill_a = make_skill("skill-a", "Skill A", false);
        let skill_b = make_skill("skill-b", "Skill B", false);
        db::upsert_skill(&pool, &skill_a).await.unwrap();
        db::upsert_skill(&pool, &skill_b).await.unwrap();

        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "skill-a".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/claude/skill-a/SKILL.md".to_string(),
                link_type: "symlink".to_string(),
                symlink_target: Some("/tmp/central/skill-a".to_string()),
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let skills = db::get_skills_by_agent(&pool, "claude-code").await.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "skill-a");
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_empty_for_unknown_agent() {
        let pool = setup_test_db().await;
        let skills = db::get_skills_by_agent(&pool, "nonexistent-agent")
            .await
            .unwrap();
        assert!(skills.is_empty());
    }

    // ── get_central_skills ────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_central_skills_includes_linked_agents() {
        let pool = setup_test_db().await;

        let central_skill = make_skill("central-a", "Central A", true);
        db::upsert_skill(&pool, &central_skill).await.unwrap();

        // Install to claude-code and cursor.
        for agent_id in &["claude-code", "cursor"] {
            db::upsert_skill_installation(
                &pool,
                &SkillInstallation {
                    skill_id: "central-a".to_string(),
                    agent_id: agent_id.to_string(),
                    installed_path: format!("/tmp/{}/central-a/SKILL.md", agent_id),
                    link_type: "symlink".to_string(),
                    symlink_target: Some("/tmp/central/central-a".to_string()),
                    created_at: Utc::now().to_rfc3339(),
                },
            )
            .await
            .unwrap();
        }

        let skills_with_links = get_central_skills_impl(&pool).await.unwrap();
        assert_eq!(skills_with_links.len(), 1);

        let mut linked = skills_with_links[0].linked_agents.clone();
        linked.sort();
        assert_eq!(linked, vec!["claude-code", "cursor"]);
    }

    #[tokio::test]
    async fn test_get_central_skills_no_links() {
        let pool = setup_test_db().await;

        let central_skill = make_skill("central-solo", "Solo Central", true);
        db::upsert_skill(&pool, &central_skill).await.unwrap();

        let skills_with_links = get_central_skills_impl(&pool).await.unwrap();
        assert_eq!(skills_with_links.len(), 1);
        assert!(
            skills_with_links[0].linked_agents.is_empty(),
            "no links when no installations"
        );
    }

    #[tokio::test]
    async fn test_get_central_skills_ignores_claude_plugin_observations() {
        let pool = setup_test_db().await;

        let central_skill = make_skill("shared-skill", "Shared Skill", true);
        db::upsert_skill(&pool, &central_skill).await.unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let skills_with_links = get_central_skills_impl(&pool).await.unwrap();
        assert_eq!(skills_with_links.len(), 1);
        assert!(
            skills_with_links[0].linked_agents.is_empty(),
            "plugin observations must not pollute linked_agents state"
        );
    }

    #[tokio::test]
    async fn test_get_central_skills_excludes_non_central() {
        let pool = setup_test_db().await;

        let central = make_skill("c-skill", "Central", true);
        let non_central = make_skill("nc-skill", "Non-Central", false);
        db::upsert_skill(&pool, &central).await.unwrap();
        db::upsert_skill(&pool, &non_central).await.unwrap();

        let skills_with_links = get_central_skills_impl(&pool).await.unwrap();
        assert_eq!(
            skills_with_links.len(),
            1,
            "only central skills should be returned"
        );
        assert_eq!(skills_with_links[0].id, "c-skill");
    }

    // ── get_skill_detail ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_skill_detail_returns_installations() {
        let pool = setup_test_db().await;

        let skill = make_skill("detail-skill", "Detail Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();

        let now = Utc::now().to_rfc3339();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "detail-skill".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/claude/detail-skill/SKILL.md".to_string(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: now.clone(),
            },
        )
        .await
        .unwrap();

        let detail = get_skill_detail_impl(&pool, "detail-skill").await.unwrap();
        assert_eq!(detail.id, "detail-skill");
        assert_eq!(detail.installations.len(), 1);
        assert_eq!(detail.installations[0].agent_id, "claude-code");
        // installed_at should be populated from created_at
        assert!(
            !detail.installations[0].installed_at.is_empty(),
            "installed_at must be set"
        );
        assert!(
            detail.collections.is_empty(),
            "skill should have no collections by default"
        );
    }

    #[tokio::test]
    async fn test_get_skill_detail_returns_collections() {
        let pool = setup_test_db().await;

        let skill = make_skill("detail-skill", "Detail Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();

        let alpha = db::create_collection(&pool, "Alpha", Some("First collection"))
            .await
            .unwrap();
        let beta = db::create_collection(&pool, "Beta", None).await.unwrap();

        db::add_skill_to_collection(&pool, &alpha.id, "detail-skill")
            .await
            .unwrap();
        db::add_skill_to_collection(&pool, &beta.id, "detail-skill")
            .await
            .unwrap();

        let detail = get_skill_detail_impl(&pool, "detail-skill").await.unwrap();
        let collection_names: Vec<&str> =
            detail.collections.iter().map(|c| c.name.as_str()).collect();

        assert_eq!(collection_names, vec!["Alpha", "Beta"]);
    }

    #[tokio::test]
    async fn test_get_skill_detail_not_found() {
        let pool = setup_test_db().await;
        let result = get_skill_detail_impl(&pool, "nonexistent").await;
        assert!(result.is_err(), "should error for unknown skill_id");
    }

    // ── read_skill_content ────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_read_skill_content_returns_file_content() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        let skill_dir = tmp.path().join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        let skill_md_path = skill_dir.join("SKILL.md");
        let expected_content = "---\nname: My Skill\n---\n\n# My Skill\n\nContent here.";
        fs::write(&skill_md_path, expected_content).unwrap();

        let skill = Skill {
            id: "my-skill".to_string(),
            name: "My Skill".to_string(),
            description: None,
            file_path: skill_md_path.to_string_lossy().into_owned(),
            canonical_path: None,
            is_central: false,
            source: None,
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        };
        db::upsert_skill(&pool, &skill).await.unwrap();

        let content = read_skill_content_impl(&pool, "my-skill").await.unwrap();
        assert_eq!(content, expected_content);
    }

    #[tokio::test]
    async fn test_read_skill_content_file_not_found() {
        let pool = setup_test_db().await;

        let skill = Skill {
            id: "missing-file-skill".to_string(),
            name: "Missing File".to_string(),
            description: None,
            file_path: "/nonexistent/SKILL.md".to_string(),
            canonical_path: None,
            is_central: false,
            source: None,
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        };
        db::upsert_skill(&pool, &skill).await.unwrap();

        let result = read_skill_content_impl(&pool, "missing-file-skill").await;
        assert!(result.is_err(), "should error when file does not exist");
    }

    // ── Testable core implementations (without Tauri State) ───────────────────

    async fn get_central_skills_impl(pool: &SqlitePool) -> Result<Vec<SkillWithLinks>, String> {
        let skills = db::get_central_skills(pool).await?;
        let mut result = Vec::with_capacity(skills.len());
        for skill in skills {
            let installations = db::get_skill_installations(pool, &skill.id).await?;
            let linked_agents: Vec<String> =
                installations.into_iter().map(|i| i.agent_id).collect();
            let (created_at, updated_at) = skill_filesystem_timestamps(&skill);
            result.push(SkillWithLinks {
                id: skill.id,
                name: skill.name,
                description: skill.description,
                file_path: skill.file_path,
                canonical_path: skill.canonical_path,
                is_central: skill.is_central,
                source: skill.source,
                scanned_at: skill.scanned_at,
                created_at,
                updated_at,
                linked_agents,
            });
        }
        Ok(result)
    }

    async fn get_skill_detail_impl(
        pool: &SqlitePool,
        skill_id: &str,
    ) -> Result<SkillDetail, String> {
        super::get_skill_detail_with_row_impl(pool, skill_id, None, None).await
    }

    async fn read_skill_content_impl(pool: &SqlitePool, skill_id: &str) -> Result<String, String> {
        let skill = db::get_skill_by_id(pool, skill_id)
            .await?
            .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;
        std::fs::read_to_string(&skill.file_path)
            .map_err(|e| format!("Failed to read '{}': {}", skill.file_path, e))
    }

    // ── Regression: get_skills_by_agent_impl returns installation metadata ─────

    /// `get_skills_by_agent_impl` must return `SkillForAgent` objects that
    /// include `link_type`, `dir_path`, and `symlink_target` from the
    /// installation record so the frontend `SkillCard` can show the correct
    /// source indicator.
    #[tokio::test]
    async fn test_get_skills_by_agent_impl_includes_installation_metadata() {
        let pool = setup_test_db().await;

        let skill = make_skill("meta-skill", "Meta Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();

        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "meta-skill".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/claude/meta-skill".to_string(),
                link_type: "symlink".to_string(),
                symlink_target: Some("/tmp/central/meta-skill".to_string()),
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let skills = get_skills_by_agent_impl(&pool, "claude-code")
            .await
            .unwrap();
        assert_eq!(skills.len(), 1, "should find one skill for claude-code");

        let s = &skills[0];
        assert_eq!(s.id, "meta-skill");
        assert_eq!(
            s.link_type, "symlink",
            "link_type must come from installation record"
        );
        assert_eq!(
            s.dir_path, "/tmp/claude/meta-skill",
            "dir_path must be installed_path from installation record"
        );
        assert_eq!(
            s.symlink_target.as_deref(),
            Some("/tmp/central/meta-skill"),
            "symlink_target must be forwarded from installation record"
        );
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_empty_for_unknown_agent() {
        let pool = setup_test_db().await;
        let skills = get_skills_by_agent_impl(&pool, "nobody").await.unwrap();
        assert!(
            skills.is_empty(),
            "no skills for an agent with no installations"
        );
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_claude_uses_observations_for_duplicate_rows() {
        let pool = setup_test_db().await;

        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/skills/shared-skill",
                "user",
                false,
            ),
        )
        .await
        .unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let mut skills = get_skills_by_agent_impl(&pool, "claude-code")
            .await
            .unwrap();
        skills.sort_by(|a, b| a.dir_path.cmp(&b.dir_path));

        assert_eq!(
            skills.len(),
            2,
            "Claude queries should surface duplicate logical skills from different sources"
        );
        assert_eq!(skills[0].id, "shared-skill");
        assert_eq!(skills[1].id, "shared-skill");
        assert_ne!(skills[0].dir_path, skills[1].dir_path);
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_claude_includes_source_identity_and_conflict_grouping() {
        let pool = setup_test_db().await;

        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/skills/shared-skill",
                "user",
                false,
            ),
        )
        .await
        .unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let mut skills = get_skills_by_agent_impl(&pool, "claude-code")
            .await
            .unwrap();
        skills.sort_by(|a, b| a.dir_path.cmp(&b.dir_path));

        assert_eq!(skills.len(), 2);
        assert_eq!(
            skills[0].row_id,
            "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill"
        );
        assert_eq!(
            skills[1].row_id,
            "claude-code::/tmp/.claude/skills/shared-skill"
        );
        assert_eq!(skills[0].source_kind.as_deref(), Some("plugin"));
        assert_eq!(skills[1].source_kind.as_deref(), Some("user"));
        assert_eq!(
            skills[0].source_root.as_deref(),
            Some("/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0")
        );
        assert_eq!(
            skills[1].source_root.as_deref(),
            Some("/tmp/.claude/skills")
        );
        assert!(skills[0].is_read_only);
        assert!(!skills[1].is_read_only);
        assert_eq!(
            skills[0].conflict_group.as_deref(),
            Some("claude-code::shared-skill")
        );
        assert_eq!(
            skills[1].conflict_group.as_deref(),
            Some("claude-code::shared-skill")
        );
        assert_eq!(skills[0].conflict_count, 2);
        assert_eq!(skills[1].conflict_count, 2);
    }

    #[tokio::test]
    async fn test_get_skill_detail_with_row_impl_claude_plugin_row_uses_selected_observation() {
        let pool = setup_test_db().await;

        let skill = make_skill("shared-skill", "Shared Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "shared-skill".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/.claude/skills/shared-skill".to_string(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let collection = db::create_collection(&pool, "Alpha", None).await.unwrap();
        db::add_skill_to_collection(&pool, &collection.id, "shared-skill")
            .await
            .unwrap();

        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/skills/shared-skill",
                "user",
                false,
            ),
        )
        .await
        .unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let detail = get_skill_detail_with_row_impl(
            &pool,
            "shared-skill",
            Some("claude-code"),
            Some("claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill"),
        )
        .await
        .unwrap();

        assert_eq!(
            detail.row_id,
            "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill"
        );
        assert_eq!(
            detail.dir_path,
            "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill"
        );
        assert_eq!(
            detail.file_path,
            "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill/SKILL.md"
        );
        assert_eq!(detail.source_kind.as_deref(), Some("plugin"));
        assert_eq!(
            detail.source_root.as_deref(),
            Some("/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0")
        );
        assert!(detail.is_read_only);
        assert_eq!(detail.conflict_count, 2);
        assert_eq!(
            detail.conflict_group.as_deref(),
            Some("claude-code::shared-skill")
        );
        assert!(
            detail.installations.is_empty(),
            "plugin detail should not expose manageable installations"
        );
        assert!(
            detail.collections.is_empty(),
            "plugin detail should not expose collection management state"
        );
    }

    #[tokio::test]
    async fn test_get_skill_detail_with_row_impl_claude_user_row_keeps_manageable_state() {
        let pool = setup_test_db().await;

        let skill = make_skill("shared-skill", "Shared Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "shared-skill".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/.claude/skills/shared-skill".to_string(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let collection = db::create_collection(&pool, "Alpha", None).await.unwrap();
        db::add_skill_to_collection(&pool, &collection.id, "shared-skill")
            .await
            .unwrap();

        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/skills/shared-skill",
                "user",
                false,
            ),
        )
        .await
        .unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let detail = get_skill_detail_with_row_impl(
            &pool,
            "shared-skill",
            Some("claude-code"),
            Some("claude-code::/tmp/.claude/skills/shared-skill"),
        )
        .await
        .unwrap();

        assert_eq!(
            detail.row_id,
            "claude-code::/tmp/.claude/skills/shared-skill"
        );
        assert_eq!(detail.dir_path, "/tmp/.claude/skills/shared-skill");
        assert_eq!(detail.source_kind.as_deref(), Some("user"));
        assert!(!detail.is_read_only);
        assert_eq!(detail.conflict_count, 2);
        assert_eq!(detail.installations.len(), 1);
        assert_eq!(detail.collections.len(), 1);
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_copy_link_type() {
        let pool = setup_test_db().await;

        let skill = make_skill("copy-skill", "Copy Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();

        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "copy-skill".to_string(),
                agent_id: "cursor".to_string(),
                installed_path: "/tmp/cursor/copy-skill".to_string(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let skills = get_skills_by_agent_impl(&pool, "cursor").await.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].link_type, "copy");
        assert!(
            skills[0].symlink_target.is_none(),
            "copy skills have no symlink target"
        );
    }

    // ── read_file_by_path ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_read_file_by_path_success() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test-skill.md");
        let content = "---\nname: Test\n---\n\n# Test Skill";
        fs::write(&file_path, content).unwrap();

        let result = read_file_by_path(file_path.to_string_lossy().into_owned()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), content);
    }

    #[tokio::test]
    async fn test_read_file_by_path_not_found() {
        let result = read_file_by_path("/nonexistent/file.md".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_list_skill_directory_returns_nested_sorted_tree() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("frontend-design");
        let docs_dir = root.join("docs");
        let nested_dir = docs_dir.join("guides");

        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(root.join("SKILL.md"), "# Skill").unwrap();
        fs::write(root.join("notes.txt"), "notes").unwrap();
        fs::write(docs_dir.join("README.md"), "# Docs").unwrap();
        fs::write(nested_dir.join("tips.md"), "# Tips").unwrap();

        let nodes = list_skill_directory(root.to_string_lossy().into_owned())
            .await
            .unwrap();

        assert_eq!(nodes.len(), 3);
        assert_eq!(nodes[0].name, "docs");
        assert!(nodes[0].is_dir);
        assert_eq!(nodes[0].relative_path, "docs");
        assert_eq!(nodes[0].children.len(), 2);
        assert_eq!(nodes[0].children[0].name, "guides");
        assert!(nodes[0].children[0].is_dir);
        assert_eq!(
            nodes[0].children[0].children[0].relative_path,
            "docs/guides/tips.md"
        );
        assert_eq!(nodes[1].name, "notes.txt");
        assert!(!nodes[1].is_dir);
        assert_eq!(nodes[2].name, "SKILL.md");
        assert!(!nodes[2].is_dir);
    }

    #[tokio::test]
    async fn test_list_skill_directory_rejects_missing_path() {
        let result = list_skill_directory("/nonexistent/directory".to_string()).await;
        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_list_skill_directory_skips_recursive_directory_symlink() {
        use std::os::unix::fs::symlink;

        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("planning-with-files-zh");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("SKILL.md"), "# Skill").unwrap();
        symlink(&root, root.join("planning-with-files-zh")).unwrap();

        let nodes = list_skill_directory(root.to_string_lossy().into_owned())
            .await
            .unwrap();

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "SKILL.md");
    }

    // ── open_in_file_manager ───────────────────────────────────────────────────

    #[tokio::test]
    async fn test_open_in_file_manager_nonexistent_path() {
        let result =
            open_in_file_manager("/nonexistent/path/that/does/not/exist".to_string()).await;
        assert!(result.is_err());
    }
}
