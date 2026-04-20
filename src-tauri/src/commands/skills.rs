use serde::{Deserialize, Serialize};
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
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub canonical_path: Option<String>,
    pub is_central: bool,
    pub source: Option<String>,
    pub scanned_at: String,
    /// All installation records for this skill across agents.
    pub installations: Vec<SkillInstallationDetail>,
    /// Collections this skill currently belongs to.
    pub collections: Vec<Collection>,
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

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

        result.push(SkillWithLinks {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            file_path: skill.file_path,
            canonical_path: skill.canonical_path,
            is_central: skill.is_central,
            source: skill.source,
            scanned_at: skill.scanned_at,
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
) -> Result<SkillDetail, String> {
    let skill = db::get_skill_by_id(&state.db, &skill_id)
        .await?
        .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;

    let installations = db::get_skill_installations(&state.db, &skill_id).await?;
    let installations: Vec<SkillInstallationDetail> = installations
        .into_iter()
        .map(|i| SkillInstallationDetail {
            skill_id: i.skill_id,
            agent_id: i.agent_id,
            installed_path: i.installed_path,
            link_type: i.link_type,
            symlink_target: i.symlink_target,
            installed_at: i.created_at,
        })
        .collect();
    let collections = db::get_skill_collections(&state.db, &skill_id).await?;

    Ok(SkillDetail {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        file_path: skill.file_path,
        canonical_path: skill.canonical_path,
        is_central: skill.is_central,
        source: skill.source,
        scanned_at: skill.scanned_at,
        installations,
        collections,
    })
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
    use crate::db::{self, Skill, SkillInstallation};
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
        assert!(detail.collections.is_empty(), "skill should have no collections by default");
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
        let collection_names: Vec<&str> = detail.collections.iter().map(|c| c.name.as_str()).collect();

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
            result.push(SkillWithLinks {
                id: skill.id,
                name: skill.name,
                description: skill.description,
                file_path: skill.file_path,
                canonical_path: skill.canonical_path,
                is_central: skill.is_central,
                source: skill.source,
                scanned_at: skill.scanned_at,
                linked_agents,
            });
        }
        Ok(result)
    }

    async fn get_skill_detail_impl(
        pool: &SqlitePool,
        skill_id: &str,
    ) -> Result<SkillDetail, String> {
        let skill = db::get_skill_by_id(pool, skill_id)
            .await?
            .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;
        let installations = db::get_skill_installations(pool, skill_id).await?;
        let installations: Vec<SkillInstallationDetail> = installations
            .into_iter()
            .map(|i| SkillInstallationDetail {
                skill_id: i.skill_id,
                agent_id: i.agent_id,
                installed_path: i.installed_path,
                link_type: i.link_type,
                symlink_target: i.symlink_target,
                installed_at: i.created_at,
            })
            .collect();
        let collections = db::get_skill_collections(pool, skill_id).await?;
        Ok(SkillDetail {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            file_path: skill.file_path,
            canonical_path: skill.canonical_path,
            is_central: skill.is_central,
            source: skill.source,
            scanned_at: skill.scanned_at,
            installations,
            collections,
        })
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

    // ── open_in_file_manager ───────────────────────────────────────────────────

    #[tokio::test]
    async fn test_open_in_file_manager_nonexistent_path() {
        let result =
            open_in_file_manager("/nonexistent/path/that/does/not/exist".to_string()).await;
        assert!(result.is_err());
    }
}
