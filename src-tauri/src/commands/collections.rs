use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{self, Collection, DbPool, Skill};
use crate::AppState;

use super::linker::{install_skill_to_agent_auto_impl, BatchInstallResult, FailedInstall};

// ─── Types ────────────────────────────────────────────────────────────────────

/// A Collection with its member skills included.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionDetail {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// All skills that are members of this collection.
    pub skills: Vec<Skill>,
}

/// Export format for a collection, matching the spec in docs/desktop-design.md.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionExport {
    pub version: u32,
    pub name: String,
    pub description: Option<String>,
    /// Skill IDs (the skill names/identifiers, not UUIDs).
    pub skills: Vec<String>,
    pub created_at: String,
    pub exported_from: String,
}

// ─── Core Implementations (testable without Tauri State) ─────────────────────

/// Create a new collection and return it.
pub async fn create_collection_impl(
    pool: &DbPool,
    name: &str,
    description: Option<&str>,
) -> Result<Collection, String> {
    if name.trim().is_empty() {
        return Err("Collection name cannot be empty".to_string());
    }
    db::create_collection(pool, name, description).await
}

/// Return all collections.
pub async fn get_collections_impl(pool: &DbPool) -> Result<Vec<Collection>, String> {
    db::get_all_collections(pool).await
}

/// Return a collection with its member skills.
pub async fn get_collection_detail_impl(
    pool: &DbPool,
    collection_id: &str,
) -> Result<CollectionDetail, String> {
    let collection = db::get_collection_by_id(pool, collection_id)
        .await?
        .ok_or_else(|| format!("Collection '{}' not found", collection_id))?;

    let skills = db::get_collection_skills(pool, collection_id).await?;

    Ok(CollectionDetail {
        id: collection.id,
        name: collection.name,
        description: collection.description,
        created_at: collection.created_at,
        updated_at: collection.updated_at,
        skills,
    })
}

/// Add a skill to a collection (idempotent).
pub async fn add_skill_to_collection_impl(
    pool: &DbPool,
    collection_id: &str,
    skill_id: &str,
) -> Result<(), String> {
    // Verify the collection exists.
    db::get_collection_by_id(pool, collection_id)
        .await?
        .ok_or_else(|| format!("Collection '{}' not found", collection_id))?;

    db::add_skill_to_collection(pool, collection_id, skill_id).await
}

/// Remove a skill from a collection.
pub async fn remove_skill_from_collection_impl(
    pool: &DbPool,
    collection_id: &str,
    skill_id: &str,
) -> Result<(), String> {
    // Verify the collection exists.
    db::get_collection_by_id(pool, collection_id)
        .await?
        .ok_or_else(|| format!("Collection '{}' not found", collection_id))?;

    db::remove_skill_from_collection(pool, collection_id, skill_id).await
}

/// Delete a collection and all its skill memberships.
pub async fn delete_collection_impl(pool: &DbPool, collection_id: &str) -> Result<(), String> {
    // Verify the collection exists before trying to delete it.
    db::get_collection_by_id(pool, collection_id)
        .await?
        .ok_or_else(|| format!("Collection '{}' not found", collection_id))?;

    db::delete_collection(pool, collection_id).await
}

/// Update a collection's name and optional description.
pub async fn update_collection_impl(
    pool: &DbPool,
    collection_id: &str,
    name: &str,
    description: Option<&str>,
) -> Result<Collection, String> {
    if name.trim().is_empty() {
        return Err("Collection name cannot be empty".to_string());
    }

    // Verify the collection exists.
    db::get_collection_by_id(pool, collection_id)
        .await?
        .ok_or_else(|| format!("Collection '{}' not found", collection_id))?;

    db::update_collection(pool, collection_id, name, description).await?;

    db::get_collection_by_id(pool, collection_id)
        .await?
        .ok_or_else(|| format!("Collection '{}' not found after update", collection_id))
}

/// Install all skills in a collection to the given agents.
///
/// Each (skill, agent) pair is attempted independently. Failures are collected
/// in the `failed` list rather than aborting the whole batch.
pub async fn batch_install_collection_impl(
    pool: &DbPool,
    collection_id: &str,
    agent_ids: &[String],
) -> Result<BatchInstallResult, String> {
    // Verify the collection exists.
    db::get_collection_by_id(pool, collection_id)
        .await?
        .ok_or_else(|| format!("Collection '{}' not found", collection_id))?;

    let skills = db::get_collection_skills(pool, collection_id).await?;

    let mut succeeded = Vec::new();
    let mut failed = Vec::new();

    for skill in &skills {
        for agent_id in agent_ids {
            match install_skill_to_agent_auto_impl(pool, &skill.id, agent_id).await {
                Ok(_) => succeeded.push(format!("{}:{}", skill.id, agent_id)),
                Err(e) => failed.push(FailedInstall {
                    agent_id: format!("{}:{}", skill.id, agent_id),
                    error: e,
                }),
            }
        }
    }

    Ok(BatchInstallResult { succeeded, failed })
}

/// Export a collection to a JSON string matching the spec in docs/desktop-design.md.
pub async fn export_collection_impl(pool: &DbPool, collection_id: &str) -> Result<String, String> {
    let collection = db::get_collection_by_id(pool, collection_id)
        .await?
        .ok_or_else(|| format!("Collection '{}' not found", collection_id))?;

    let skills = db::get_collection_skills(pool, collection_id).await?;
    let skill_ids: Vec<String> = skills.into_iter().map(|s| s.id).collect();

    let export = CollectionExport {
        version: 1,
        name: collection.name,
        description: collection.description,
        skills: skill_ids,
        created_at: collection.created_at,
        exported_from: "skills-manage".to_string(),
    };

    serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
}

/// Import a collection from a JSON string.
///
/// Creates a new collection with the given name/description and links any
/// skills whose IDs exist in the database. Skills that are not found are
/// silently skipped (they may not yet be scanned on this machine).
///
/// Returns the newly created collection.
pub async fn import_collection_impl(pool: &DbPool, json: &str) -> Result<Collection, String> {
    let export: CollectionExport =
        serde_json::from_str(json).map_err(|e| format!("Invalid collection JSON: {}", e))?;

    if export.name.trim().is_empty() {
        return Err("Imported collection name cannot be empty".to_string());
    }

    // Create the collection.
    let collection =
        db::create_collection(pool, &export.name, export.description.as_deref()).await?;

    // Link skills that exist in the local database.
    for skill_id in &export.skills {
        // Only add the skill if it exists in the local DB; silently skip otherwise.
        if let Ok(Some(_)) = db::get_skill_by_id(pool, skill_id).await {
            db::add_skill_to_collection(pool, &collection.id, skill_id).await?;
        }
    }

    Ok(collection)
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Tauri command: create a new collection.
#[tauri::command]
pub async fn create_collection(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
) -> Result<Collection, String> {
    create_collection_impl(&state.db, &name, description.as_deref()).await
}

/// Tauri command: return all collections.
#[tauri::command]
pub async fn get_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    get_collections_impl(&state.db).await
}

/// Tauri command: return a collection with its member skills.
#[tauri::command]
pub async fn get_collection_detail(
    state: State<'_, AppState>,
    collection_id: String,
) -> Result<CollectionDetail, String> {
    get_collection_detail_impl(&state.db, &collection_id).await
}

/// Tauri command: add a skill to a collection.
#[tauri::command]
pub async fn add_skill_to_collection(
    state: State<'_, AppState>,
    collection_id: String,
    skill_id: String,
) -> Result<(), String> {
    add_skill_to_collection_impl(&state.db, &collection_id, &skill_id).await
}

/// Tauri command: remove a skill from a collection.
#[tauri::command]
pub async fn remove_skill_from_collection(
    state: State<'_, AppState>,
    collection_id: String,
    skill_id: String,
) -> Result<(), String> {
    remove_skill_from_collection_impl(&state.db, &collection_id, &skill_id).await
}

/// Tauri command: delete a collection.
#[tauri::command]
pub async fn delete_collection(
    state: State<'_, AppState>,
    collection_id: String,
) -> Result<(), String> {
    delete_collection_impl(&state.db, &collection_id).await
}

/// Tauri command: update a collection's name and description.
#[tauri::command]
pub async fn update_collection(
    state: State<'_, AppState>,
    collection_id: String,
    name: String,
    description: Option<String>,
) -> Result<Collection, String> {
    update_collection_impl(&state.db, &collection_id, &name, description.as_deref()).await
}

/// Tauri command: install all skills in a collection to the given agents.
#[tauri::command]
pub async fn batch_install_collection(
    state: State<'_, AppState>,
    collection_id: String,
    agent_ids: Vec<String>,
) -> Result<BatchInstallResult, String> {
    batch_install_collection_impl(&state.db, &collection_id, &agent_ids).await
}

/// Tauri command: export a collection to a JSON string.
#[tauri::command]
pub async fn export_collection(
    state: State<'_, AppState>,
    collection_id: String,
) -> Result<String, String> {
    export_collection_impl(&state.db, &collection_id).await
}

/// Tauri command: import a collection from a JSON string.
#[tauri::command]
pub async fn import_collection(
    state: State<'_, AppState>,
    json: String,
) -> Result<Collection, String> {
    import_collection_impl(&state.db, &json).await
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, Skill};
    use chrono::Utc;
    use sqlx::SqlitePool;
    use std::fs;
    use tempfile::TempDir;

    // ── Helpers ───────────────────────────────────────────────────────────────

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();
        pool
    }

    fn make_skill(id: &str) -> Skill {
        Skill {
            id: id.to_string(),
            name: format!("Skill {}", id),
            description: Some(format!("Description for {}", id)),
            file_path: format!("/tmp/central/{}/SKILL.md", id),
            canonical_path: Some(format!("/tmp/central/{}", id)),
            is_central: true,
            source: Some("native".to_string()),
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        }
    }

    // ── create_collection ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_create_collection_returns_collection() {
        let pool = setup_test_db().await;
        let col = create_collection_impl(&pool, "My Collection", Some("A test"))
            .await
            .unwrap();

        assert_eq!(col.name, "My Collection");
        assert_eq!(col.description.as_deref(), Some("A test"));
        assert!(!col.id.is_empty(), "id should be a UUID");
        assert!(!col.created_at.is_empty());
        assert!(!col.updated_at.is_empty());
    }

    #[tokio::test]
    async fn test_create_collection_without_description() {
        let pool = setup_test_db().await;
        let col = create_collection_impl(&pool, "No Desc", None)
            .await
            .unwrap();
        assert_eq!(col.name, "No Desc");
        assert!(col.description.is_none());
    }

    #[tokio::test]
    async fn test_create_collection_rejects_empty_name() {
        let pool = setup_test_db().await;
        let result = create_collection_impl(&pool, "", None).await;
        assert!(result.is_err(), "empty name should be rejected");

        let result = create_collection_impl(&pool, "   ", None).await;
        assert!(result.is_err(), "whitespace-only name should be rejected");
    }

    // ── get_collections ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_collections_returns_all() {
        let pool = setup_test_db().await;
        create_collection_impl(&pool, "Col A", None).await.unwrap();
        create_collection_impl(&pool, "Col B", Some("Desc"))
            .await
            .unwrap();

        let all = get_collections_impl(&pool).await.unwrap();
        assert_eq!(all.len(), 2, "should return both collections");
        let names: Vec<&str> = all.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"Col A"));
        assert!(names.contains(&"Col B"));
    }

    #[tokio::test]
    async fn test_get_collections_empty_when_none() {
        let pool = setup_test_db().await;
        let all = get_collections_impl(&pool).await.unwrap();
        assert!(all.is_empty(), "should be empty when no collections exist");
    }

    // ── get_collection_detail ─────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_collection_detail_includes_skills() {
        let pool = setup_test_db().await;

        let skill_a = make_skill("skill-a");
        let skill_b = make_skill("skill-b");
        db::upsert_skill(&pool, &skill_a).await.unwrap();
        db::upsert_skill(&pool, &skill_b).await.unwrap();

        let col = create_collection_impl(&pool, "Detail Col", None)
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "skill-a")
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "skill-b")
            .await
            .unwrap();

        let detail = get_collection_detail_impl(&pool, &col.id).await.unwrap();
        assert_eq!(detail.id, col.id);
        assert_eq!(detail.name, "Detail Col");
        assert_eq!(detail.skills.len(), 2);
        let skill_ids: Vec<&str> = detail.skills.iter().map(|s| s.id.as_str()).collect();
        assert!(skill_ids.contains(&"skill-a"));
        assert!(skill_ids.contains(&"skill-b"));
    }

    #[tokio::test]
    async fn test_get_collection_detail_empty_skills() {
        let pool = setup_test_db().await;
        let col = create_collection_impl(&pool, "Empty Col", None)
            .await
            .unwrap();
        let detail = get_collection_detail_impl(&pool, &col.id).await.unwrap();
        assert!(detail.skills.is_empty());
    }

    #[tokio::test]
    async fn test_get_collection_detail_not_found() {
        let pool = setup_test_db().await;
        let result = get_collection_detail_impl(&pool, "nonexistent-id").await;
        assert!(result.is_err(), "should error for unknown collection_id");
    }

    // ── add_skill_to_collection ───────────────────────────────────────────────

    #[tokio::test]
    async fn test_add_skill_to_collection_success() {
        let pool = setup_test_db().await;

        let skill = make_skill("add-skill");
        db::upsert_skill(&pool, &skill).await.unwrap();

        let col = create_collection_impl(&pool, "Add Test", None)
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "add-skill")
            .await
            .unwrap();

        let detail = get_collection_detail_impl(&pool, &col.id).await.unwrap();
        assert_eq!(detail.skills.len(), 1);
        assert_eq!(detail.skills[0].id, "add-skill");
    }

    #[tokio::test]
    async fn test_add_skill_to_collection_is_idempotent() {
        let pool = setup_test_db().await;

        let skill = make_skill("idem-skill");
        db::upsert_skill(&pool, &skill).await.unwrap();

        let col = create_collection_impl(&pool, "Idem Col", None)
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "idem-skill")
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "idem-skill")
            .await
            .unwrap();

        let detail = get_collection_detail_impl(&pool, &col.id).await.unwrap();
        assert_eq!(
            detail.skills.len(),
            1,
            "duplicate add should not create duplicate entry"
        );
    }

    #[tokio::test]
    async fn test_add_skill_to_nonexistent_collection_fails() {
        let pool = setup_test_db().await;
        let result = add_skill_to_collection_impl(&pool, "bad-id", "some-skill").await;
        assert!(result.is_err());
    }

    // ── remove_skill_from_collection ──────────────────────────────────────────

    #[tokio::test]
    async fn test_remove_skill_from_collection_success() {
        let pool = setup_test_db().await;

        let skill = make_skill("remove-skill");
        db::upsert_skill(&pool, &skill).await.unwrap();

        let col = create_collection_impl(&pool, "Remove Test", None)
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "remove-skill")
            .await
            .unwrap();

        remove_skill_from_collection_impl(&pool, &col.id, "remove-skill")
            .await
            .unwrap();

        let detail = get_collection_detail_impl(&pool, &col.id).await.unwrap();
        assert!(detail.skills.is_empty(), "skill should be removed");
    }

    #[tokio::test]
    async fn test_remove_skill_from_nonexistent_collection_fails() {
        let pool = setup_test_db().await;
        let result = remove_skill_from_collection_impl(&pool, "bad-id", "some-skill").await;
        assert!(result.is_err());
    }

    // ── delete_collection ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_delete_collection_removes_it() {
        let pool = setup_test_db().await;
        let col = create_collection_impl(&pool, "To Delete", None)
            .await
            .unwrap();

        delete_collection_impl(&pool, &col.id).await.unwrap();

        let all = get_collections_impl(&pool).await.unwrap();
        assert!(all.is_empty(), "collection should be gone");
    }

    #[tokio::test]
    async fn test_delete_collection_also_removes_skills_memberships() {
        let pool = setup_test_db().await;

        let skill = make_skill("cascade-skill");
        db::upsert_skill(&pool, &skill).await.unwrap();

        let col = create_collection_impl(&pool, "Cascade Col", None)
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "cascade-skill")
            .await
            .unwrap();

        delete_collection_impl(&pool, &col.id).await.unwrap();

        // The collection_skills rows should also be gone.
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM collection_skills WHERE collection_id = ?")
                .bind(&col.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            count, 0,
            "collection_skills should be removed on cascade delete"
        );
    }

    #[tokio::test]
    async fn test_delete_nonexistent_collection_fails() {
        let pool = setup_test_db().await;
        let result = delete_collection_impl(&pool, "no-such-id").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_delete_collection_does_not_delete_skills() {
        let pool = setup_test_db().await;

        let skill = make_skill("safe-skill");
        db::upsert_skill(&pool, &skill).await.unwrap();

        let col = create_collection_impl(&pool, "Safe Delete", None)
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "safe-skill")
            .await
            .unwrap();

        delete_collection_impl(&pool, &col.id).await.unwrap();

        // The skill itself should still exist.
        let found = db::get_skill_by_id(&pool, "safe-skill").await.unwrap();
        assert!(found.is_some(), "underlying skill must NOT be deleted");
    }

    // ── update_collection ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_update_collection_name_and_description() {
        let pool = setup_test_db().await;
        let col = create_collection_impl(&pool, "Old Name", None)
            .await
            .unwrap();

        let updated = update_collection_impl(&pool, &col.id, "New Name", Some("New Desc"))
            .await
            .unwrap();
        assert_eq!(updated.name, "New Name");
        assert_eq!(updated.description.as_deref(), Some("New Desc"));
    }

    #[tokio::test]
    async fn test_update_collection_rejects_empty_name() {
        let pool = setup_test_db().await;
        let col = create_collection_impl(&pool, "Valid Name", None)
            .await
            .unwrap();

        let result = update_collection_impl(&pool, &col.id, "", None).await;
        assert!(result.is_err(), "empty name should be rejected on update");
    }

    #[tokio::test]
    async fn test_update_nonexistent_collection_fails() {
        let pool = setup_test_db().await;
        let result = update_collection_impl(&pool, "no-such-id", "Name", None).await;
        assert!(result.is_err());
    }

    // ── export_collection ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_export_collection_produces_valid_json() {
        let pool = setup_test_db().await;

        let skill_a = make_skill("export-skill-a");
        let skill_b = make_skill("export-skill-b");
        db::upsert_skill(&pool, &skill_a).await.unwrap();
        db::upsert_skill(&pool, &skill_b).await.unwrap();

        let col = create_collection_impl(&pool, "Export Col", Some("Export desc"))
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "export-skill-a")
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "export-skill-b")
            .await
            .unwrap();

        let json_str = export_collection_impl(&pool, &col.id).await.unwrap();
        let parsed: CollectionExport = serde_json::from_str(&json_str).unwrap();

        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.name, "Export Col");
        assert_eq!(parsed.description.as_deref(), Some("Export desc"));
        assert_eq!(parsed.exported_from, "skills-manage");

        let mut skills = parsed.skills.clone();
        skills.sort();
        assert_eq!(skills, vec!["export-skill-a", "export-skill-b"]);
    }

    #[tokio::test]
    async fn test_export_collection_empty_skills() {
        let pool = setup_test_db().await;
        let col = create_collection_impl(&pool, "Empty Export", None)
            .await
            .unwrap();

        let json_str = export_collection_impl(&pool, &col.id).await.unwrap();
        let parsed: CollectionExport = serde_json::from_str(&json_str).unwrap();

        assert_eq!(parsed.skills.len(), 0);
    }

    #[tokio::test]
    async fn test_export_collection_json_has_required_fields() {
        let pool = setup_test_db().await;
        let col = create_collection_impl(&pool, "Field Check", None)
            .await
            .unwrap();

        let json_str = export_collection_impl(&pool, &col.id).await.unwrap();
        let json_value: serde_json::Value = serde_json::from_str(&json_str).unwrap();

        assert!(json_value.get("version").is_some());
        assert!(json_value.get("name").is_some());
        assert!(json_value.get("skills").is_some());
        assert!(json_value.get("createdAt").is_some());
        assert!(json_value.get("exportedFrom").is_some());
    }

    #[tokio::test]
    async fn test_export_nonexistent_collection_fails() {
        let pool = setup_test_db().await;
        let result = export_collection_impl(&pool, "no-such-id").await;
        assert!(result.is_err());
    }

    // ── import_collection ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_import_collection_creates_collection() {
        let pool = setup_test_db().await;

        let skill = make_skill("import-skill");
        db::upsert_skill(&pool, &skill).await.unwrap();

        let json = serde_json::to_string(&CollectionExport {
            version: 1,
            name: "Imported Col".to_string(),
            description: Some("Imported desc".to_string()),
            skills: vec!["import-skill".to_string()],
            created_at: Utc::now().to_rfc3339(),
            exported_from: "skills-manage".to_string(),
        })
        .unwrap();

        let col = import_collection_impl(&pool, &json).await.unwrap();
        assert_eq!(col.name, "Imported Col");
        assert_eq!(col.description.as_deref(), Some("Imported desc"));

        let detail = get_collection_detail_impl(&pool, &col.id).await.unwrap();
        assert_eq!(detail.skills.len(), 1);
        assert_eq!(detail.skills[0].id, "import-skill");
    }

    #[tokio::test]
    async fn test_import_collection_skips_unknown_skills() {
        let pool = setup_test_db().await;

        // Only insert skill-a, not skill-b.
        let skill_a = make_skill("known-skill");
        db::upsert_skill(&pool, &skill_a).await.unwrap();

        let json = serde_json::to_string(&CollectionExport {
            version: 1,
            name: "Partial Import".to_string(),
            description: None,
            skills: vec!["known-skill".to_string(), "unknown-skill".to_string()],
            created_at: Utc::now().to_rfc3339(),
            exported_from: "skills-manage".to_string(),
        })
        .unwrap();

        let col = import_collection_impl(&pool, &json).await.unwrap();
        let detail = get_collection_detail_impl(&pool, &col.id).await.unwrap();

        // Only known-skill should be linked.
        assert_eq!(detail.skills.len(), 1);
        assert_eq!(detail.skills[0].id, "known-skill");
    }

    #[tokio::test]
    async fn test_import_collection_rejects_invalid_json() {
        let pool = setup_test_db().await;
        let result = import_collection_impl(&pool, "not valid json").await;
        assert!(result.is_err(), "invalid JSON should be rejected");
    }

    #[tokio::test]
    async fn test_import_collection_rejects_empty_name() {
        let pool = setup_test_db().await;

        let json = serde_json::to_string(&CollectionExport {
            version: 1,
            name: "".to_string(),
            description: None,
            skills: vec![],
            created_at: Utc::now().to_rfc3339(),
            exported_from: "skills-manage".to_string(),
        })
        .unwrap();

        let result = import_collection_impl(&pool, &json).await;
        assert!(
            result.is_err(),
            "empty name in import JSON should be rejected"
        );
    }

    #[tokio::test]
    async fn test_import_then_export_roundtrip() {
        let pool = setup_test_db().await;

        let skill = make_skill("roundtrip-skill");
        db::upsert_skill(&pool, &skill).await.unwrap();

        // Export from original collection.
        let original = create_collection_impl(&pool, "Roundtrip", Some("desc"))
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &original.id, "roundtrip-skill")
            .await
            .unwrap();

        let json = export_collection_impl(&pool, &original.id).await.unwrap();

        // Import from that JSON.
        let imported = import_collection_impl(&pool, &json).await.unwrap();
        let detail = get_collection_detail_impl(&pool, &imported.id)
            .await
            .unwrap();

        assert_eq!(detail.name, "Roundtrip");
        assert_eq!(detail.skills.len(), 1);
        assert_eq!(detail.skills[0].id, "roundtrip-skill");
    }

    // ── batch_install_collection ──────────────────────────────────────────────

    #[tokio::test]
    async fn test_batch_install_collection_creates_symlinks() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        let agent_dir = tmp.path().join("claude");
        fs::create_dir_all(&central_dir).unwrap();

        let pool = setup_test_db().await;

        // Override central and claude-code agent dirs.
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'central'")
            .bind(central_dir.to_str().unwrap())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(agent_dir.to_str().unwrap())
            .execute(&pool)
            .await
            .unwrap();

        // Create two central skills on disk.
        for skill_id in &["batch-col-skill-1", "batch-col-skill-2"] {
            let skill_dir = central_dir.join(skill_id);
            fs::create_dir_all(&skill_dir).unwrap();
            fs::write(
                skill_dir.join("SKILL.md"),
                format!("---\nname: {}\ndescription: Test\n---\n", skill_id),
            )
            .unwrap();

            // Insert the skill into DB.
            let skill = Skill {
                id: skill_id.to_string(),
                name: skill_id.to_string(),
                description: None,
                file_path: skill_dir.join("SKILL.md").to_string_lossy().into_owned(),
                canonical_path: Some(skill_dir.to_string_lossy().into_owned()),
                is_central: true,
                source: Some("native".to_string()),
                content: None,
                scanned_at: Utc::now().to_rfc3339(),
            };
            db::upsert_skill(&pool, &skill).await.unwrap();
        }

        // Create a collection with both skills.
        let col = create_collection_impl(&pool, "Batch Install Col", None)
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "batch-col-skill-1")
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "batch-col-skill-2")
            .await
            .unwrap();

        let result = batch_install_collection_impl(&pool, &col.id, &["claude-code".to_string()])
            .await
            .unwrap();

        assert_eq!(result.succeeded.len(), 2, "both skills should succeed");
        assert!(result.failed.is_empty(), "no failures expected");

        // Verify symlinks were created.
        assert!(
            fs::symlink_metadata(agent_dir.join("batch-col-skill-1")).is_ok(),
            "symlink for skill-1 should exist"
        );
        assert!(
            fs::symlink_metadata(agent_dir.join("batch-col-skill-2")).is_ok(),
            "symlink for skill-2 should exist"
        );
    }

    #[tokio::test]
    async fn test_batch_install_collection_partial_failure() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        let agent_dir = tmp.path().join("claude");
        fs::create_dir_all(&central_dir).unwrap();

        let pool = setup_test_db().await;

        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'central'")
            .bind(central_dir.to_str().unwrap())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(agent_dir.to_str().unwrap())
            .execute(&pool)
            .await
            .unwrap();

        // Create one valid skill, but leave the other missing from disk.
        let good_dir = central_dir.join("good-skill");
        fs::create_dir_all(&good_dir).unwrap();
        fs::write(
            good_dir.join("SKILL.md"),
            "---\nname: good-skill\ndescription: Test\n---\n",
        )
        .unwrap();

        for skill_id in &["good-skill", "missing-on-disk"] {
            let skill = Skill {
                id: skill_id.to_string(),
                name: skill_id.to_string(),
                description: None,
                file_path: central_dir
                    .join(skill_id)
                    .join("SKILL.md")
                    .to_string_lossy()
                    .into_owned(),
                canonical_path: Some(central_dir.join(skill_id).to_string_lossy().into_owned()),
                is_central: true,
                source: None,
                content: None,
                scanned_at: Utc::now().to_rfc3339(),
            };
            db::upsert_skill(&pool, &skill).await.unwrap();
        }

        let col = create_collection_impl(&pool, "Partial Batch", None)
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "good-skill")
            .await
            .unwrap();
        add_skill_to_collection_impl(&pool, &col.id, "missing-on-disk")
            .await
            .unwrap();

        let result = batch_install_collection_impl(&pool, &col.id, &["claude-code".to_string()])
            .await
            .unwrap();

        assert_eq!(result.succeeded.len(), 1, "good skill should succeed");
        assert_eq!(result.failed.len(), 1, "missing skill should fail");
    }

    #[tokio::test]
    async fn test_batch_install_nonexistent_collection_fails() {
        let pool = setup_test_db().await;
        let result = batch_install_collection_impl(
            &pool,
            "no-such-collection",
            &["claude-code".to_string()],
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_batch_install_empty_collection_succeeds() {
        let pool = setup_test_db().await;
        let col = create_collection_impl(&pool, "Empty Batch", None)
            .await
            .unwrap();

        let result = batch_install_collection_impl(&pool, &col.id, &["claude-code".to_string()])
            .await
            .unwrap();

        assert!(result.succeeded.is_empty());
        assert!(result.failed.is_empty());
    }
}
