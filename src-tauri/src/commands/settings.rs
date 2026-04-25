use tauri::State;

use crate::db::{self, DbPool, ScanDirectory};
use crate::path_utils::{central_skills_dir, expand_home_path, path_to_string};
use crate::AppState;

// ─── Core Implementations (testable without Tauri State) ──────────────────────

/// Return all scan directories, built-in first then custom ordered by added_at.
pub async fn get_scan_directories_impl(pool: &DbPool) -> Result<Vec<ScanDirectory>, String> {
    db::get_scan_directories(pool).await
}

/// Add a new custom (non-builtin) scan directory.
/// Returns the newly created record.
pub async fn add_scan_directory_impl(
    pool: &DbPool,
    path: &str,
    label: Option<&str>,
) -> Result<ScanDirectory, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Scan directory path cannot be empty".to_string());
    }
    let expanded_path = path_to_string(&expand_home_path(path));
    db::add_scan_directory(pool, &expanded_path, label).await
}

/// Remove a custom (non-builtin) scan directory by path.
/// Returns an error if the directory is built-in or not found.
pub async fn remove_scan_directory_impl(pool: &DbPool, path: &str) -> Result<(), String> {
    db::remove_scan_directory(pool, path).await
}

/// Toggle the `is_active` flag on a scan directory by path.
pub async fn set_scan_directory_active_impl(
    pool: &DbPool,
    path: &str,
    is_active: bool,
) -> Result<(), String> {
    db::toggle_scan_directory(pool, path, is_active).await
}

/// Get a settings value by key. Returns `None` if the key is not set.
pub async fn get_setting_impl(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
    db::get_setting(pool, key).await
}

/// Set (upsert) a settings value.
pub async fn set_setting_impl(pool: &DbPool, key: &str, value: &str) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("Settings key cannot be empty".to_string());
    }
    db::set_setting(pool, key, value).await
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Tauri command: return all scan directories.
#[tauri::command]
pub async fn get_scan_directories(
    state: State<'_, AppState>,
) -> Result<Vec<ScanDirectory>, String> {
    get_scan_directories_impl(&state.db).await
}

/// Tauri command: add a new custom scan directory.
#[tauri::command]
pub async fn add_scan_directory(
    state: State<'_, AppState>,
    path: String,
    label: Option<String>,
) -> Result<ScanDirectory, String> {
    add_scan_directory_impl(&state.db, &path, label.as_deref()).await
}

/// Tauri command: remove a custom scan directory by path.
#[tauri::command]
pub async fn remove_scan_directory(state: State<'_, AppState>, path: String) -> Result<(), String> {
    remove_scan_directory_impl(&state.db, &path).await
}

/// Tauri command: set the is_active flag on a scan directory.
#[tauri::command]
pub async fn set_scan_directory_active(
    state: State<'_, AppState>,
    path: String,
    is_active: bool,
) -> Result<(), String> {
    set_scan_directory_active_impl(&state.db, &path, is_active).await
}

/// Tauri command: get a settings value by key.
#[tauri::command]
pub async fn get_setting(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    get_setting_impl(&state.db, &key).await
}

/// Tauri command: set (upsert) a settings value.
#[tauri::command]
pub async fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    set_setting_impl(&state.db, &key, &value).await
}

// ─── Central Skills Directory ────────────────────────────────────────────────

/// Get the central skills directory path.
/// Reads from settings, falls back to the default `~/.agents/skills/`.
pub async fn get_central_skills_dir_impl(pool: &DbPool) -> Result<String, String> {
    let setting = db::get_setting(pool, "central_skills_dir").await?;
    match setting {
        Some(path) if !path.trim().is_empty() => Ok(path),
        _ => Ok(path_to_string(&central_skills_dir())),
    }
}

/// Return the hardcoded default central skills directory path (~/.agents/skills).
pub fn get_default_central_skills_dir_impl() -> String {
    path_to_string(&central_skills_dir())
}

/// Set the central skills directory path.
/// Validates the path, saves to settings, and updates the central agent.
/// Also cleans up the stale built-in scan directory entry for the old path.
pub async fn set_central_skills_dir_impl(pool: &DbPool, path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Central skills directory path cannot be empty".to_string());
    }
    let expanded = path_to_string(&expand_home_path(path));

    // Read the old central dir setting and remove its scan directory entry.
    if let Ok(Some(old_path)) = db::get_setting(pool, "central_skills_dir").await {
        if !old_path.trim().is_empty() && old_path != expanded {
            let _ = db::delete_builtin_scan_directory(pool, &old_path).await;
        }
    }

    db::set_setting(pool, "central_skills_dir", &expanded).await?;
    db::update_agent_global_skills_dir(pool, "central", &expanded).await?;
    Ok(expanded)
}

/// Tauri command: get the central skills directory path.
#[tauri::command]
pub async fn get_central_skills_dir(
    state: State<'_, AppState>,
) -> Result<String, String> {
    get_central_skills_dir_impl(&state.db).await
}

/// Tauri command: set the central skills directory path.
#[tauri::command]
pub async fn set_central_skills_dir(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    set_central_skills_dir_impl(&state.db, &path).await
}

/// Tauri command: return the hardcoded default central skills directory path.
#[tauri::command]
pub fn get_default_central_skills_dir() -> String {
    get_default_central_skills_dir_impl()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use sqlx::SqlitePool;

    async fn setup_test_db() -> DbPool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();
        pool
    }

    // ── get_scan_directories_impl ─────────────────────────────────────────────

    /// Counts unique global_skills_dir paths across all built-in agents — the
    /// same number that seed_builtin_scan_directories inserts.
    fn expected_builtin_count() -> usize {
        let mut paths = std::collections::HashSet::new();
        for agent in db::builtin_agents() {
            paths.insert(agent.global_skills_dir);
        }
        paths.len()
    }

    #[tokio::test]
    async fn test_get_scan_directories_has_builtin_dirs_initially() {
        let pool = setup_test_db().await;
        let dirs = get_scan_directories_impl(&pool).await.unwrap();
        let builtin_count = expected_builtin_count();
        // After init, built-in scan directories are seeded automatically.
        assert_eq!(
            dirs.len(),
            builtin_count,
            "Fresh database should have {} built-in scan directories, got {}",
            builtin_count,
            dirs.len()
        );
        // All seeded rows must be marked built-in.
        for dir in &dirs {
            assert!(
                dir.is_builtin,
                "Scan directory '{}' seeded during init must have is_builtin=true",
                dir.path
            );
        }
    }

    #[tokio::test]
    async fn test_get_scan_directories_returns_added() {
        let pool = setup_test_db().await;
        add_scan_directory_impl(&pool, "/tmp/proj-a", Some("Project A"))
            .await
            .unwrap();
        add_scan_directory_impl(&pool, "/tmp/proj-b", None)
            .await
            .unwrap();

        let dirs = get_scan_directories_impl(&pool).await.unwrap();
        // N built-in dirs are already there; we added 2 custom ones.
        let builtin_count = expected_builtin_count();
        assert_eq!(dirs.len(), builtin_count + 2);
        let paths: Vec<&str> = dirs.iter().map(|d| d.path.as_str()).collect();
        assert!(paths.contains(&"/tmp/proj-a"));
        assert!(paths.contains(&"/tmp/proj-b"));
    }

    // ── add_scan_directory_impl ───────────────────────────────────────────────

    #[tokio::test]
    async fn test_add_scan_directory_creates_non_builtin() {
        let pool = setup_test_db().await;
        let dir = add_scan_directory_impl(&pool, "/tmp/my-project", Some("My Project"))
            .await
            .unwrap();

        assert_eq!(dir.path, "/tmp/my-project");
        assert_eq!(dir.label.as_deref(), Some("My Project"));
        assert!(dir.is_active);
        assert!(
            !dir.is_builtin,
            "Newly added directory should not be built-in"
        );
    }

    #[tokio::test]
    async fn test_add_scan_directory_without_label() {
        let pool = setup_test_db().await;
        let dir = add_scan_directory_impl(&pool, "/tmp/no-label", None)
            .await
            .unwrap();
        assert!(dir.label.is_none());
    }

    #[tokio::test]
    async fn test_add_scan_directory_expands_tilde() {
        let pool = setup_test_db().await;
        let dir = add_scan_directory_impl(&pool, "~/.skillsmanage/custom-scan", None)
            .await
            .unwrap();
        assert!(
            !dir.path.starts_with('~'),
            "tilde paths must be expanded before persistence"
        );
        assert!(dir.path.contains(".skillsmanage"));
    }

    #[tokio::test]
    async fn test_add_scan_directory_empty_path_fails() {
        let pool = setup_test_db().await;
        let result = add_scan_directory_impl(&pool, "   ", None).await;
        assert!(result.is_err(), "Empty path should fail validation");
    }

    #[tokio::test]
    async fn test_add_scan_directory_duplicate_path_fails() {
        let pool = setup_test_db().await;
        add_scan_directory_impl(&pool, "/tmp/same-path", None)
            .await
            .unwrap();
        let result = add_scan_directory_impl(&pool, "/tmp/same-path", None).await;
        assert!(
            result.is_err(),
            "Duplicate path should fail (UNIQUE constraint)"
        );
    }

    // ── remove_scan_directory_impl ────────────────────────────────────────────

    #[tokio::test]
    async fn test_remove_scan_directory_success() {
        let pool = setup_test_db().await;
        add_scan_directory_impl(&pool, "/tmp/removable", None)
            .await
            .unwrap();

        remove_scan_directory_impl(&pool, "/tmp/removable")
            .await
            .unwrap();

        let dirs = get_scan_directories_impl(&pool).await.unwrap();
        // Built-in dirs remain; only the custom /tmp/removable should be gone.
        let builtin_count = expected_builtin_count();
        assert_eq!(
            dirs.len(),
            builtin_count,
            "Only the custom directory should be removed"
        );
        assert!(
            !dirs.iter().any(|d| d.path == "/tmp/removable"),
            "Removed directory must not appear in the list"
        );
    }

    #[tokio::test]
    async fn test_remove_nonexistent_scan_directory_fails() {
        let pool = setup_test_db().await;
        let result = remove_scan_directory_impl(&pool, "/nonexistent/path").await;
        assert!(
            result.is_err(),
            "Removing a nonexistent directory should fail"
        );
    }

    #[tokio::test]
    async fn test_remove_builtin_scan_directory_fails() {
        let pool = setup_test_db().await;
        // Manually insert a builtin directory
        sqlx::query(
            "INSERT INTO scan_directories (path, is_active, is_builtin, added_at)
             VALUES ('/builtin/path', 1, 1, datetime('now'))",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = remove_scan_directory_impl(&pool, "/builtin/path").await;
        assert!(result.is_err(), "Removing a built-in directory should fail");
    }

    // ── set_scan_directory_active_impl ────────────────────────────────────────

    #[tokio::test]
    async fn test_set_scan_directory_active_disables() {
        let pool = setup_test_db().await;
        add_scan_directory_impl(&pool, "/tmp/toggle-me", None)
            .await
            .unwrap();
        set_scan_directory_active_impl(&pool, "/tmp/toggle-me", false)
            .await
            .unwrap();
        let dirs = get_scan_directories_impl(&pool).await.unwrap();
        let dir = dirs.iter().find(|d| d.path == "/tmp/toggle-me").unwrap();
        assert!(!dir.is_active, "Directory should be inactive");
    }

    #[tokio::test]
    async fn test_set_scan_directory_active_enables() {
        let pool = setup_test_db().await;
        add_scan_directory_impl(&pool, "/tmp/re-enable-me", None)
            .await
            .unwrap();
        // First disable
        set_scan_directory_active_impl(&pool, "/tmp/re-enable-me", false)
            .await
            .unwrap();
        // Then re-enable
        set_scan_directory_active_impl(&pool, "/tmp/re-enable-me", true)
            .await
            .unwrap();
        let dirs = get_scan_directories_impl(&pool).await.unwrap();
        let dir = dirs.iter().find(|d| d.path == "/tmp/re-enable-me").unwrap();
        assert!(dir.is_active, "Directory should be active again");
    }

    // ── get_setting_impl ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_setting_not_set_returns_none() {
        let pool = setup_test_db().await;
        let value = get_setting_impl(&pool, "unset_key").await.unwrap();
        assert!(value.is_none(), "Unset key should return None");
    }

    #[tokio::test]
    async fn test_get_setting_after_set() {
        let pool = setup_test_db().await;
        set_setting_impl(&pool, "theme", "dark").await.unwrap();

        let value = get_setting_impl(&pool, "theme").await.unwrap();
        assert_eq!(value.as_deref(), Some("dark"));
    }

    // ── set_setting_impl ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_set_setting_upserts() {
        let pool = setup_test_db().await;
        set_setting_impl(&pool, "lang", "en").await.unwrap();
        set_setting_impl(&pool, "lang", "zh").await.unwrap();

        let value = get_setting_impl(&pool, "lang").await.unwrap();
        assert_eq!(
            value.as_deref(),
            Some("zh"),
            "Second set should overwrite first"
        );
    }

    #[tokio::test]
    async fn test_set_setting_empty_key_fails() {
        let pool = setup_test_db().await;
        let result = set_setting_impl(&pool, "  ", "some-value").await;
        assert!(result.is_err(), "Empty key should fail validation");
    }

    #[tokio::test]
    async fn test_set_and_get_multiple_settings() {
        let pool = setup_test_db().await;
        set_setting_impl(&pool, "a", "1").await.unwrap();
        set_setting_impl(&pool, "b", "2").await.unwrap();
        set_setting_impl(&pool, "c", "3").await.unwrap();

        assert_eq!(
            get_setting_impl(&pool, "a").await.unwrap().as_deref(),
            Some("1")
        );
        assert_eq!(
            get_setting_impl(&pool, "b").await.unwrap().as_deref(),
            Some("2")
        );
        assert_eq!(
            get_setting_impl(&pool, "c").await.unwrap().as_deref(),
            Some("3")
        );
    }

    #[tokio::test]
    async fn test_set_setting_empty_value_is_allowed() {
        let pool = setup_test_db().await;
        // Empty value is valid — it means the key is explicitly set to empty string.
        let result = set_setting_impl(&pool, "empty-val", "").await;
        assert!(result.is_ok(), "Setting an empty value should succeed");
        let value = get_setting_impl(&pool, "empty-val").await.unwrap();
        assert_eq!(value.as_deref(), Some(""));
    }

    // ── Central Skills Directory ──────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_central_skills_dir_default_when_not_set() {
        let pool = setup_test_db().await;
        let path = get_central_skills_dir_impl(&pool).await.unwrap();
        // When no setting, should return the default ~/.agents/skills/
        assert!(
            path.contains(".agents/skills"),
            "Default path should contain '.agents/skills', got: {}",
            path
        );
    }

    #[tokio::test]
    async fn test_set_central_skills_dir_saves_and_updates() {
        let pool = setup_test_db().await;
        let new_path = "/tmp/custom-central-skills";
        let result = set_central_skills_dir_impl(&pool, new_path).await.unwrap();
        assert_eq!(result, new_path, "Should return the expanded path");

        // Verify setting is persisted
        let saved = get_setting_impl(&pool, "central_skills_dir")
            .await
            .unwrap();
        assert_eq!(saved.as_deref(), Some(new_path));

        // Verify central agent is updated
        let central = db::get_agent_by_id(&pool, "central").await.unwrap().unwrap();
        assert_eq!(
            central.global_skills_dir, new_path,
            "Central agent's global_skills_dir should be updated"
        );

        // Verify get_central_skills_dir returns the new path
        let retrieved = get_central_skills_dir_impl(&pool).await.unwrap();
        assert_eq!(retrieved, new_path);
    }

    #[tokio::test]
    async fn test_set_central_skills_dir_empty_fails() {
        let pool = setup_test_db().await;
        let result = set_central_skills_dir_impl(&pool, "  ").await;
        assert!(result.is_err(), "Empty path should fail validation");
    }

    #[tokio::test]
    async fn test_set_central_skills_dir_expands_tilde() {
        let pool = setup_test_db().await;
        let result = set_central_skills_dir_impl(&pool, "~/.skillsmanage/custom-central")
            .await
            .unwrap();
        assert!(
            !result.starts_with('~'),
            "Tilde paths must be expanded, got: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_get_central_skills_dir_after_clear() {
        let pool = setup_test_db().await;
        // Set a custom path
        set_central_skills_dir_impl(&pool, "/tmp/custom").await.unwrap();
        // Clear it by setting empty string via raw set_setting
        set_setting_impl(&pool, "central_skills_dir", "").await.unwrap();
        // Should fall back to default
        let path = get_central_skills_dir_impl(&pool).await.unwrap();
        assert!(
            path.contains(".agents/skills"),
            "After clearing, should return default path, got: {}",
            path
        );
    }
}
