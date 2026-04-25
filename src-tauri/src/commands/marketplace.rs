use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use super::github_import;
use crate::path_utils::central_skills_dir;
use crate::AppState;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillRegistry {
    pub id: String,
    pub name: String,
    pub source_type: String,
    pub url: String,
    pub is_builtin: bool,
    pub is_enabled: bool,
    pub last_synced: Option<String>,
    pub last_attempted_sync: Option<String>,
    pub last_sync_status: String,
    pub last_sync_error: Option<String>,
    pub cache_updated_at: Option<String>,
    pub cache_expires_at: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MarketplaceSkill {
    pub id: String,
    pub registry_id: String,
    pub name: String,
    pub description: Option<String>,
    pub download_url: String,
    pub is_installed: bool,
    pub synced_at: String,
    pub cache_updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillsShSkill {
    pub id: String,
    pub skill_id: String,
    pub name: String,
    pub source: String,
    pub installs: u64,
    pub stars: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegistrySyncStatus {
    Never,
    Success,
    Error,
}

impl RegistrySyncStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::Success => "success",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RegistryCacheMetadata {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub cache_expires_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncRegistryOptions {
    pub force_refresh: bool,
}

// ─── Registry Fetcher ────────────────────────────────────────────────────────

/// Fetch skills from a GitHub repository.
/// Reuses the same repository snapshot + manifest classification logic as
/// the GitHub import flow so Marketplace preview and import stay in sync.
async fn fetch_github_skills(
    pool: &crate::db::DbPool,
    url: &str,
    registry_id: &str,
) -> Result<Vec<MarketplaceSkill>, String> {
    let auth = github_import::github_direct_auth_from_settings(pool).await?;
    let repo = github_import::resolve_repo_ref(url, auth.as_deref()).await?;
    let candidates = github_import::fetch_repo_skill_candidates(&repo, auth.as_deref()).await?;
    Ok(marketplace_skills_from_candidates(registry_id, candidates))
}

fn marketplace_skills_from_candidates(
    registry_id: &str,
    candidates: Vec<github_import::RemoteSkillCandidate>,
) -> Vec<MarketplaceSkill> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut seen_names = HashSet::new();
    let mut skills = Vec::new();

    for candidate in candidates {
        if !seen_names.insert(candidate.skill_name.clone()) {
            continue;
        }

        skills.push(MarketplaceSkill {
            id: format!("{}::{}", registry_id, candidate.skill_id),
            registry_id: registry_id.to_string(),
            name: candidate.skill_name,
            description: candidate.description,
            download_url: candidate.download_url,
            is_installed: false,
            synced_at: now.clone(),
            cache_updated_at: Some(now.clone()),
        });
    }

    skills
}

// ─── IPC Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_registries(state: State<'_, AppState>) -> Result<Vec<SkillRegistry>, String> {
    let rows = sqlx::query(
        "SELECT id, name, source_type, url, is_builtin, is_enabled, last_synced,
                last_attempted_sync, last_sync_status, last_sync_error,
                cache_updated_at, cache_expires_at, etag, last_modified, created_at
         FROM skill_registries ORDER BY is_builtin DESC, name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            use sqlx::Row;
            SkillRegistry {
                id: r.get("id"),
                name: r.get("name"),
                source_type: r.get("source_type"),
                url: r.get("url"),
                is_builtin: r.get("is_builtin"),
                is_enabled: r.get("is_enabled"),
                last_synced: r.get("last_synced"),
                last_attempted_sync: r.get("last_attempted_sync"),
                last_sync_status: r.get("last_sync_status"),
                last_sync_error: r.get("last_sync_error"),
                cache_updated_at: r.get("cache_updated_at"),
                cache_expires_at: r.get("cache_expires_at"),
                etag: r.get("etag"),
                last_modified: r.get("last_modified"),
                created_at: r.get("created_at"),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn add_registry(
    state: State<'_, AppState>,
    name: String,
    source_type: String,
    url: String,
) -> Result<SkillRegistry, String> {
    add_registry_impl(&state.db, name, source_type, url, None).await
}

async fn add_registry_impl(
    pool: &crate::db::DbPool,
    name: String,
    source_type: String,
    url: String,
    cache_metadata: Option<RegistryCacheMetadata>,
) -> Result<SkillRegistry, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let cache_metadata = cache_metadata.unwrap_or_default();

    sqlx::query(
        "INSERT INTO skill_registries
         (id, name, source_type, url, is_builtin, is_enabled, last_sync_status,
          cache_expires_at, etag, last_modified, created_at)
         VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(&source_type)
    .bind(&url)
    .bind(RegistrySyncStatus::Never.as_str())
    .bind(&cache_metadata.cache_expires_at)
    .bind(&cache_metadata.etag)
    .bind(&cache_metadata.last_modified)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(SkillRegistry {
        id,
        name,
        source_type,
        url,
        is_builtin: false,
        is_enabled: true,
        last_synced: None,
        last_attempted_sync: None,
        last_sync_status: RegistrySyncStatus::Never.as_str().to_string(),
        last_sync_error: None,
        cache_updated_at: None,
        cache_expires_at: cache_metadata.cache_expires_at,
        etag: cache_metadata.etag,
        last_modified: cache_metadata.last_modified,
        created_at: now,
    })
}

#[tauri::command]
pub async fn remove_registry(
    state: State<'_, AppState>,
    registry_id: String,
) -> Result<(), String> {
    // Don't allow removing built-in registries
    let row = sqlx::query("SELECT is_builtin FROM skill_registries WHERE id = ?")
        .bind(&registry_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(r) = &row {
        use sqlx::Row;
        if r.get::<bool, _>("is_builtin") {
            return Err("Cannot remove built-in registry".to_string());
        }
    }

    // Delete cached skills first
    sqlx::query("DELETE FROM marketplace_skills WHERE registry_id = ?")
        .bind(&registry_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM skill_registries WHERE id = ?")
        .bind(&registry_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn sync_registry(
    state: State<'_, AppState>,
    registry_id: String,
) -> Result<Vec<MarketplaceSkill>, String> {
    sync_registry_impl(&state.db, registry_id, SyncRegistryOptions::default()).await
}

#[tauri::command]
pub async fn sync_registry_with_options(
    state: State<'_, AppState>,
    registry_id: String,
    options: Option<SyncRegistryOptions>,
) -> Result<Vec<MarketplaceSkill>, String> {
    sync_registry_impl(&state.db, registry_id, options.unwrap_or_default()).await
}

async fn sync_registry_impl(
    pool: &crate::db::DbPool,
    registry_id: String,
    options: SyncRegistryOptions,
) -> Result<Vec<MarketplaceSkill>, String> {
    // Get registry info
    let row = sqlx::query(
        "SELECT id, name, source_type, url, is_builtin, is_enabled, last_synced,
                last_attempted_sync, last_sync_status, last_sync_error,
                cache_updated_at, cache_expires_at, etag, last_modified, created_at
         FROM skill_registries WHERE id = ?",
    )
    .bind(&registry_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Registry not found".to_string())?;

    let registry = {
        use sqlx::Row;
        SkillRegistry {
            id: row.get("id"),
            name: row.get("name"),
            source_type: row.get("source_type"),
            url: row.get("url"),
            is_builtin: row.get("is_builtin"),
            is_enabled: row.get("is_enabled"),
            last_synced: row.get("last_synced"),
            last_attempted_sync: row.get("last_attempted_sync"),
            last_sync_status: row.get("last_sync_status"),
            last_sync_error: row.get("last_sync_error"),
            cache_updated_at: row.get("cache_updated_at"),
            cache_expires_at: row.get("cache_expires_at"),
            etag: row.get("etag"),
            last_modified: row.get("last_modified"),
            created_at: row.get("created_at"),
        }
    };

    if !options.force_refresh && registry_has_cached_skills(pool, &registry.id).await? {
        return search_marketplace_skills_impl(pool, Some(registry_id), None).await;
    }

    let attempt_time = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE skill_registries
         SET last_attempted_sync = ?, last_sync_error = NULL
         WHERE id = ?",
    )
    .bind(&attempt_time)
    .bind(&registry.id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Fetch skills based on source type
    let skills = match registry.source_type.as_str() {
        "github" => match fetch_github_skills(pool, &registry.url, &registry.id).await {
            Ok(skills) => skills,
            Err(error) => {
                sqlx::query(
                    "UPDATE skill_registries
                     SET last_attempted_sync = ?, last_sync_status = ?, last_sync_error = ?
                     WHERE id = ?",
                )
                .bind(&attempt_time)
                .bind(RegistrySyncStatus::Error.as_str())
                .bind(&error)
                .bind(&registry.id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;

                if registry_has_cached_skills(pool, &registry.id).await? {
                    return search_marketplace_skills_impl(pool, Some(registry_id), None).await;
                }

                return Err(error);
            }
        },
        _ => return Err(format!("Unsupported source type: {}", registry.source_type)),
    };

    // Check which skills are already installed locally
    let central_dir = central_skills_dir();

    // Upsert skills into marketplace_skills
    for skill in &skills {
        let is_installed = central_dir.join(&skill.name).join("SKILL.md").exists();

        sqlx::query(
            "INSERT INTO marketplace_skills (id, registry_id, name, description, download_url, is_installed, synced_at, cache_updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                download_url = excluded.download_url,
                is_installed = excluded.is_installed,
                synced_at = excluded.synced_at,
                cache_updated_at = excluded.cache_updated_at",
        )
        .bind(&skill.id)
        .bind(&skill.registry_id)
        .bind(&skill.name)
        .bind(&skill.description)
        .bind(&skill.download_url)
        .bind(is_installed)
        .bind(&skill.synced_at)
        .bind(&skill.cache_updated_at)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Update last_synced
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE skill_registries
         SET last_synced = ?, last_attempted_sync = ?, last_sync_status = ?, last_sync_error = NULL, cache_updated_at = ?
         WHERE id = ?",
    )
        .bind(&now)
        .bind(&attempt_time)
        .bind(RegistrySyncStatus::Success.as_str())
        .bind(&now)
        .bind(&registry_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // Return the updated list
    search_marketplace_skills_impl(pool, Some(registry_id), None).await
}

#[tauri::command]
pub async fn search_marketplace_skills(
    state: State<'_, AppState>,
    registry_id: Option<String>,
    query: Option<String>,
) -> Result<Vec<MarketplaceSkill>, String> {
    search_marketplace_skills_impl(&state.db, registry_id, query).await
}

async fn search_marketplace_skills_impl(
    pool: &crate::db::DbPool,
    registry_id: Option<String>,
    query: Option<String>,
) -> Result<Vec<MarketplaceSkill>, String> {
    let mut sql = String::from(
        r#"SELECT id, registry_id, name, description, download_url,
            is_installed, synced_at, cache_updated_at
         FROM marketplace_skills WHERE 1=1"#,
    );
    let mut bindings: Vec<String> = Vec::new();

    if let Some(ref rid) = registry_id {
        sql.push_str(" AND registry_id = ?");
        bindings.push(rid.clone());
    }
    if let Some(ref q) = query {
        if !q.trim().is_empty() {
            sql.push_str(" AND (name LIKE ? OR description LIKE ?)");
            let pattern = format!("%{}%", q);
            bindings.push(pattern.clone());
            bindings.push(pattern);
        }
    }
    sql.push_str(" ORDER BY name");

    let mut q = sqlx::query(&sql);
    for b in &bindings {
        q = q.bind(b);
    }

    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows.iter().map(row_to_marketplace_skill).collect())
}

async fn registry_has_cached_skills(
    pool: &crate::db::DbPool,
    registry_id: &str,
) -> Result<bool, String> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM marketplace_skills WHERE registry_id = ?",
    )
    .bind(registry_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(count > 0)
}

fn row_to_marketplace_skill(row: &sqlx::sqlite::SqliteRow) -> MarketplaceSkill {
    use sqlx::Row;

    MarketplaceSkill {
        id: row.get("id"),
        registry_id: row.get("registry_id"),
        name: row.get("name"),
        description: row.get("description"),
        download_url: row.get("download_url"),
        is_installed: row.get::<i64, _>("is_installed") != 0,
        synced_at: row.get("synced_at"),
        cache_updated_at: row.get("cache_updated_at"),
    }
}

#[derive(sqlx::FromRow)]
struct MarketplaceSkillRow {
    name: String,
    download_url: String,
}

#[tauri::command]
pub async fn install_marketplace_skill(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<(), String> {
    // Get skill info
    let skill = sqlx::query_as::<_, MarketplaceSkillRow>(
        "SELECT id, registry_id, name, description, download_url, is_installed, synced_at
         FROM marketplace_skills WHERE id = ?",
    )
    .bind(&skill_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Skill not found".to_string())?;

    // Download SKILL.md content
    let client = reqwest::Client::builder()
        .user_agent("skills-manage/0.9.1")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&skill.download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download returned {}", resp.status()));
    }

    let content = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Create directory and write SKILL.md
    let skill_dir = central_skills_dir().join(&skill.name);
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let skill_md_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_md_path, &content)
        .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

    // Mark as installed in DB
    sqlx::query("UPDATE marketplace_skills SET is_installed = 1 WHERE id = ?")
        .bind(&skill_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ─── skills.sh Integration ───────────────────────────────────────────────────

#[tauri::command]
pub async fn search_skills_sh(
    state: State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SkillsShSkill>, String> {
    let limit = limit.unwrap_or(10).min(50);

    let client = reqwest::Client::builder()
        .user_agent("skills-manage/0.9.1")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://skills.sh/api/search")
        .query(&[("q", &query), ("limit", &limit.to_string())])
        .send()
        .await
        .map_err(|e| format!("skills.sh search failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("skills.sh returned {}", resp.status()));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let mut skills: Vec<SkillsShSkill> = data
        .get("skills")
        .and_then(|s| s.as_array())
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|skill| {
            let id = skill.get("id")?.as_str()?.to_string();
            let skill_id = skill.get("skillId")?.as_str()?.to_string();
            let name = skill.get("name")?.as_str()?.to_string();
            let source = skill.get("source")?.as_str()?.to_string();
            let installs = skill.get("installs")?.as_u64().unwrap_or(0);
            Some(SkillsShSkill {
                id,
                skill_id,
                name,
                source,
                installs,
                stars: None,
            })
        })
        .collect();

    // Enrich with GitHub star counts for unique sources (use token if available)
    let auth_str = github_import::github_direct_auth_from_settings(&state.db).await?;
    let auth = auth_str.as_deref();

    let unique_sources: Vec<&str> = {
        let mut seen = std::collections::HashSet::new();
        skills
            .iter()
            .filter(|s| seen.insert(s.source.as_str()))
            .map(|s| s.source.as_str())
            .collect()
    };

    let star_futs: Vec<_> = unique_sources
        .iter()
        .map(|source| {
            let url = format!("https://api.github.com/repos/{}", source);
            let c = client.clone();
            let token = auth.map(|t| t.to_string());
            async move {
                let resp = github_import::send_with_auth_fallback(&c, &url, token.as_deref())
                    .await
                    .ok()?;
                let data: serde_json::Value = resp.json().await.ok()?;
                let stars = data.get("stargazers_count")?.as_u64()?;
                Some((source.to_string(), stars))
            }
        })
        .collect();

    let star_results = futures_util::future::join_all(star_futs).await;
    let star_map: std::collections::HashMap<String, u64> = star_results
        .into_iter()
        .flatten()
        .collect();

    for skill in &mut skills {
        skill.stars = star_map.get(&skill.source).copied();
    }

    Ok(skills)
}

/// Common skill directory prefixes (most likely first).
/// Only the top 2 are tried as direct GETs since >95% of skills live at
/// one of these paths.  Everything else falls through to the tree API.
const COMMON_SKILL_PREFIXES: &[&str] = &["", "skills/"];

/// Try to find SKILL.md in a repo.
///
/// Strategy (2 phases, max 3 HTTP calls):
///   1. Try `""` and `"skills/"` prefixes in parallel (covers >95% of skills).
///   2. Fetch the full repo tree via GitHub API and search for `{skill_id}/SKILL.md`
///      (a single request that handles any directory depth).
async fn find_skill_md_url(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    branch: &str,
    skill_id: &str,
    auth: Option<&str>,
) -> Result<String, String> {
    // Phase 1: try common prefixes in parallel
    let futs: Vec<_> = COMMON_SKILL_PREFIXES
        .iter()
        .map(|prefix| {
            let url = format!(
                "https://raw.githubusercontent.com/{}/{}/{}{}/SKILL.md",
                owner, repo, branch, prefix
            );
            async {
                let resp = client.get(&url).send().await.ok()?;
                if resp.status().is_success() {
                    Some(url)
                } else {
                    None
                }
            }
        })
        .collect();

    let results = futures_util::future::join_all(futs).await;
    for url in results.into_iter().flatten() {
        return Ok(url);
    }

    // Phase 2: search the full repo tree for `{skill_id}/SKILL.md`
    // (a single request that handles any directory depth)
    let tree_url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
        owner, repo, branch
    );
    let resp = github_import::send_with_auth_fallback(client, &tree_url, auth)
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    if resp.status().is_success() {
        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse tree: {}", e))?;

        let target_suffix = format!("{}/SKILL.md", skill_id);
        if let Some(tree) = data.get("tree").and_then(|t| t.as_array()) {
            for entry in tree {
                let path = match entry.get("path").and_then(|p| p.as_str()) {
                    Some(p) => p,
                    None => continue,
                };
                if path.ends_with(&target_suffix) {
                    return Ok(format!(
                        "https://raw.githubusercontent.com/{}/{}/{}/{}",
                        owner, repo, branch, path
                    ));
                }
            }
        }
    }

    Err(format!(
        "Could not find SKILL.md for '{}' in {}/{}",
        skill_id, owner, repo
    ))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillsShFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn browse_skills_sh_directory(
    state: State<'_, AppState>,
    source: String,
    skill_id: String,
) -> Result<Vec<SkillsShFileEntry>, String> {
    let repo_url = format!("https://github.com/{}", source);
    let auth_str = github_import::github_direct_auth_from_settings(&state.db).await?;
    let auth = auth_str.as_deref();
    let repo = match github_import::resolve_repo_ref(&repo_url, auth).await {
        Ok(r) => r,
        Err(e) if auth.is_some() => {
            github_import::resolve_repo_ref(&repo_url, None).await.map_err(|_| e)?
        }
        Err(e) => return Err(e),
    };

    let client = reqwest::Client::builder()
        .user_agent("skills-manage/0.9.1")
        .build()
        .map_err(|e| e.to_string())?;

    let md_url = find_skill_md_url(&client, &repo.owner, &repo.repo, &repo.branch, &skill_id, auth).await?;

    // Extract directory path from the resolved URL
    // URL: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{dir...}/SKILL.md
    let dir_path = md_url
        .strip_suffix("/SKILL.md")
        .and_then(|u| {
            let parts: Vec<&str> = u.split('/').collect();
            // parts = ["https:", "", "raw.githubusercontent.com", owner, repo, branch, ...rest]
            if parts.len() > 6 {
                Some(parts[6..].join("/"))
            } else {
                Some(String::new())
            }
        })
        .unwrap_or_default();

    let api_url = format!(
        "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
        repo.owner, repo.repo, dir_path, repo.branch
    );
    let resp = github_import::send_with_auth_fallback(&client, &api_url, auth)
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    let entries: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let files = entries
        .into_iter()
        .filter_map(|entry| {
            let name = entry.get("name")?.as_str()?.to_string();
            let path = entry.get("path")?.as_str()?.to_string();
            let is_dir = entry.get("type")?.as_str() == Some("dir");
            Some(SkillsShFileEntry { name, path, is_dir })
        })
        .collect();

    Ok(files)
}

#[tauri::command]
pub async fn resolve_skills_sh_url(
    state: State<'_, AppState>,
    source: String,
    skill_id: String,
) -> Result<String, String> {
    let repo_url = format!("https://github.com/{}", source);
    let auth_str = github_import::github_direct_auth_from_settings(&state.db).await?;
    let auth = auth_str.as_deref();
    let repo = match github_import::resolve_repo_ref(&repo_url, auth).await {
        Ok(r) => r,
        Err(e) if auth.is_some() => {
            github_import::resolve_repo_ref(&repo_url, None).await.map_err(|_| e)?
        }
        Err(e) => return Err(e),
    };

    let client = reqwest::Client::builder()
        .user_agent("skills-manage/0.9.1")
        .build()
        .map_err(|e| e.to_string())?;

    find_skill_md_url(&client, &repo.owner, &repo.repo, &repo.branch, &skill_id, auth).await
}

#[tauri::command]
pub async fn install_from_skills_sh(
    state: State<'_, AppState>,
    source: String,
    skill_id: String,
) -> Result<String, String> {
    let repo_url = format!("https://github.com/{}", source);
    let auth_str = github_import::github_direct_auth_from_settings(&state.db).await?;
    let auth = auth_str.as_deref();
    let repo = github_import::resolve_repo_ref(&repo_url, auth).await?;

    let client = reqwest::Client::builder()
        .user_agent("skills-manage/0.9.1")
        .build()
        .map_err(|e| e.to_string())?;

    // Use user's GitHub token for tree search (raw.githubusercontent.com doesn't need auth)
    let md_url = find_skill_md_url(
        &client,
        &repo.owner,
        &repo.repo,
        &repo.branch,
        &skill_id,
        auth,
    )
    .await?;

    let resp = client
        .get(&md_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download returned {}", resp.status()));
    }

    let content = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let frontmatter =
        github_import::parse_frontmatter(&content)
            .ok_or_else(|| "Skill is missing valid frontmatter.".to_string())?;

    let skill_name = frontmatter.name;

    // Write to central
    let skill_dir = central_skills_dir().join(&skill_name);
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let skill_md_path = skill_dir.join("SKILL.md");
    std::fs::write(&skill_md_path, &content)
        .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

    // Upsert to DB
    let db_skill = crate::db::Skill {
        id: skill_name.clone(),
        name: skill_name.clone(),
        description: frontmatter.description,
        file_path: skill_md_path.to_string_lossy().into_owned(),
        canonical_path: Some(skill_dir.to_string_lossy().into_owned()),
        is_central: true,
        source: Some(format!("skills.sh:{}", source)),
        content: None,
        scanned_at: chrono::Utc::now().to_rfc3339(),
    };
    crate::db::upsert_skill(&state.db, &db_skill).await?;

    Ok(skill_name)
}

// ─── AI Explanation ──────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<ClaudeMessage>,
}

#[derive(Serialize)]
struct ClaudeMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContentBlock>,
}

#[derive(Deserialize)]
struct ClaudeContentBlock {
    #[serde(rename = "type", default)]
    block_type: String,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExplanationApiProtocol {
    AnthropicCompatible,
    OpenAiCompatible,
    Unknown,
}

fn detect_explanation_api_protocol(api_url: &str) -> ExplanationApiProtocol {
    let path = reqwest::Url::parse(api_url)
        .ok()
        .map(|url| url.path().trim_end_matches('/').to_ascii_lowercase())
        .unwrap_or_else(|| api_url.trim_end_matches('/').to_ascii_lowercase());

    if path.ends_with("/v1/messages") || path.contains("/anthropic/v1/messages") {
        return ExplanationApiProtocol::AnthropicCompatible;
    }

    if path.ends_with("/v1/chat/completions") {
        return ExplanationApiProtocol::OpenAiCompatible;
    }

    ExplanationApiProtocol::Unknown
}

/// Resolve API protocol: explicit user preference overrides URL auto-detection.
fn resolve_api_protocol(
    api_url: &str,
    explicit_protocol: Option<&str>,
) -> ExplanationApiProtocol {
    match explicit_protocol {
        Some("openai") => ExplanationApiProtocol::OpenAiCompatible,
        Some("anthropic") => ExplanationApiProtocol::AnthropicCompatible,
        _ => detect_explanation_api_protocol(api_url),
    }
}

fn resolve_custom_url(raw_url: &str, protocol: &ExplanationApiProtocol) -> String {
    let trimmed = raw_url.trim();
    if !trimmed.ends_with("/v1") {
        return trimmed.to_string();
    }
    match protocol {
        ExplanationApiProtocol::OpenAiCompatible => trimmed.to_string() + "/chat/completions",
        ExplanationApiProtocol::AnthropicCompatible => trimmed.to_string() + "/messages",
        ExplanationApiProtocol::Unknown => trimmed.to_string(),
    }
}

/// Error kind for AI explanation network failures, used by the frontend
/// to render targeted UI (friendly summary + expandable details).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExplanationErrorKind {
    Proxy,
    Connect,
    Timeout,
    Dns,
    Tls,
    Auth,
    Response,
    Unknown,
}

/// Structured AI explanation error payload sent via Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplanationErrorInfo {
    pub message: String,
    pub details: String,
    pub kind: ExplanationErrorKind,
    pub retryable: bool,
    pub fallback_tried: bool,
}

/// Classify a reqwest error into a structured `ExplanationErrorInfo`.
fn classify_reqwest_error(e: &reqwest::Error, fallback_tried: bool) -> ExplanationErrorInfo {
    use std::error::Error as _;

    let mut parts: Vec<String> = vec![e.to_string()];
    let mut cur: Option<&(dyn std::error::Error + 'static)> = e.source();
    while let Some(src) = cur {
        parts.push(src.to_string());
        cur = src.source();
    }
    let chain = parts.join(" → ");
    let low = chain.to_ascii_lowercase();

    let (kind, message, retryable) = if low.contains("tunnel")
        || (low.contains("proxy") && low.contains("connect"))
        || (low.contains("proxy") && low.contains("unsuccessful"))
    {
        (
            ExplanationErrorKind::Proxy,
            "代理或网络隧道连接失败，请尝试切换区域端点或在终端执行 `unset HTTPS_PROXY HTTP_PROXY ALL_PROXY` 后重启应用".to_string(),
            true,
        )
    } else if low.contains("proxy") {
        (
            ExplanationErrorKind::Proxy,
            "系统代理可能拦截了请求。请尝试为该域名配置直连规则或切换区域端点".to_string(),
            true,
        )
    } else if e.is_timeout() || low.contains("timed out") {
        (
            ExplanationErrorKind::Timeout,
            "请求超时，可能网络不通或被防火墙拦截。可在终端 `curl -v <url>` 验证连通性".to_string(),
            true,
        )
    } else if e.is_connect() || low.contains("connect") {
        (
            ExplanationErrorKind::Connect,
            "无法建立连接。请确认 URL 可从本机访问，或尝试切换区域端点".to_string(),
            true,
        )
    } else if low.contains("dns") || low.contains("lookup") {
        (
            ExplanationErrorKind::Dns,
            "DNS 解析失败。请确认域名拼写正确，或尝试切换 DNS".to_string(),
            true,
        )
    } else if low.contains("certificate") || low.contains("tls") || low.contains("handshake") {
        (
            ExplanationErrorKind::Tls,
            "TLS/证书握手失败。请检查系统时间是否正确，或排查中间人代理".to_string(),
            false,
        )
    } else {
        (
            ExplanationErrorKind::Unknown,
            "网络请求失败".to_string(),
            false,
        )
    };

    ExplanationErrorInfo {
        message,
        details: chain,
        kind,
        retryable,
        fallback_tried,
    }
}

/// Expand a `reqwest::Error` into a single readable string (for non-streaming path).
fn format_reqwest_error(e: &reqwest::Error) -> String {
    let info = classify_reqwest_error(e, false);
    if info.message.is_empty() {
        info.details
    } else {
        format!("{}\n{}", info.details, info.message)
    }
}

#[tauri::command]
pub async fn explain_skill(state: State<'_, AppState>, content: String) -> Result<String, String> {
    let api_key = get_provider_setting(&state.db, "ai_api_key")
        .await
        .ok_or_else(|| "请先在设置中配置 AI API Key".to_string())?;

    let api_url = get_provider_setting(&state.db, "ai_api_url")
        .await
        .unwrap_or_else(|| "https://api.anthropic.com/v1/messages".to_string());

    let model = get_provider_setting(&state.db, "ai_model")
        .await
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());

    let client = reqwest::Client::builder()
        .user_agent("skills-manage/0.9.1")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let truncated = if content.len() > 8000 {
        format!("{}...\n\n(内容已截断)", &content[..8000])
    } else {
        content
    };

    let request = ClaudeRequest {
        model,
        max_tokens: 1024,
        messages: vec![ClaudeMessage {
            role: "user".to_string(),
            content: format!(
                "请用中文简洁地解释以下 AI Agent Skill（SKILL.md）的用途、使用场景和关键功能。\
                分为三部分：1) 一句话总结 2) 适用场景 3) 关键功能点。\
                控制在 200 字以内。\n\n---\n\n{}",
                truncated
            ),
        }],
    };

    let explicit_protocol_opt = get_provider_setting(&state.db, "ai_protocol").await;
    let explicit_protocol = explicit_protocol_opt.as_deref();
    let protocol = resolve_api_protocol(&api_url, explicit_protocol);
    let resolved_url = resolve_custom_url(&api_url, &protocol);
    let mut req_builder = client
        .post(&resolved_url)
        .header("content-type", "application/json");

    match protocol {
        ExplanationApiProtocol::AnthropicCompatible | ExplanationApiProtocol::Unknown => {
            req_builder = req_builder
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01");
        }
        ExplanationApiProtocol::OpenAiCompatible => {
            req_builder = req_builder.header("authorization", format!("Bearer {}", api_key));
        }
    }

    let resp = req_builder
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {}", format_reqwest_error(&e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API 返回错误 {}: {}", status, body));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    // Try parsing as Anthropic format: { "content": [{ "type": "text", "text": "..." }] }
    if let Ok(claude_resp) = serde_json::from_str::<ClaudeResponse>(&body) {
        // Filter for "text" type blocks, skip "thinking" blocks
        if let Some(block) = claude_resp
            .content
            .iter()
            .find(|b| b.block_type.is_empty() || b.block_type == "text")
        {
            if !block.text.is_empty() {
                return Ok(block.text.clone());
            }
        }
    }

    // Fallback: try extracting text from any JSON with a "text" or "content" field
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
        // Some providers return { "choices": [{ "message": { "content": "..." } }] }
        if let Some(text) = val
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
        {
            return Ok(text.to_string());
        }
    }

    Err(format!("无法解析响应: {}", &body[..body.len().min(500)]))
}

// ─── Test AI Connection ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn test_ai_connection(state: State<'_, AppState>) -> Result<String, String> {
    let api_key = get_provider_setting(&state.db, "ai_api_key")
        .await
        .ok_or_else(|| "请先在设置中配置 AI API Key".to_string())?;

    let api_url = get_provider_setting(&state.db, "ai_api_url")
        .await
        .unwrap_or_else(|| "https://api.anthropic.com/v1/messages".to_string());

    let model = get_provider_setting(&state.db, "ai_model")
        .await
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());

    let client = reqwest::Client::builder()
        .user_agent("skills-manage/0.9.1")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let request = serde_json::json!({
        "model": model,
        "max_tokens": 1,
        "messages": [{
            "role": "user",
            "content": "OK"
        }]
    });

    let explicit_protocol_opt = get_provider_setting(&state.db, "ai_protocol").await;
    let explicit_protocol = explicit_protocol_opt.as_deref();
    let protocol = resolve_api_protocol(&api_url, explicit_protocol);
    let resolved_url = resolve_custom_url(&api_url, &protocol);
    let mut req_builder = client
        .post(&resolved_url)
        .header("content-type", "application/json");

    match protocol {
        ExplanationApiProtocol::AnthropicCompatible | ExplanationApiProtocol::Unknown => {
            req_builder = req_builder
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01");
        }
        ExplanationApiProtocol::OpenAiCompatible => {
            req_builder = req_builder.header("authorization", format!("Bearer {}", api_key));
        }
    }

    let resp = req_builder
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {}", format_reqwest_error(&e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API 返回错误 {}: {}", status, body));
    }

    // Parse and check response body — just enough to confirm it's a valid API response
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    // Accept either Anthropic or OpenAI response shape
    let val: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| format!("无法解析响应: {}", &body[..body.len().min(200)]))?;

    if val.get("content").is_some() || val.get("choices").is_some() {
        Ok("Connection OK".to_string())
    } else {
        Err(format!("无法识别的响应格式: {}", &body[..body.len().min(200)]))
    }
}

// ─── Streaming AI Explanation ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplanationChunkPayload {
    pub skill_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplanationCompletePayload {
    pub skill_id: String,
    pub explanation: Option<String>,
}

fn explanation_has_content(explanation: &str) -> bool {
    !explanation.trim().is_empty()
}

async fn delete_cached_skill_explanation(
    pool: &crate::db::DbPool,
    skill_id: &str,
    lang: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM skill_explanations WHERE skill_id = ? AND lang = ?")
        .bind(skill_id)
        .bind(lang)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn load_cached_skill_explanation(
    pool: &crate::db::DbPool,
    skill_id: &str,
    lang: &str,
) -> Result<Option<String>, String> {
    use sqlx::Row;

    let row =
        sqlx::query("SELECT explanation FROM skill_explanations WHERE skill_id = ? AND lang = ?")
            .bind(skill_id)
            .bind(lang)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    match row {
        Some(row) => {
            let explanation: String = row.get("explanation");
            if explanation_has_content(&explanation) {
                Ok(Some(explanation))
            } else {
                // Older builds could persist empty strings. Treat them as cache
                // corruption so the next request re-generates a fresh explanation.
                delete_cached_skill_explanation(pool, skill_id, lang).await?;
                Ok(None)
            }
        }
        None => Ok(None),
    }
}

async fn cache_skill_explanation(
    pool: &crate::db::DbPool,
    skill_id: &str,
    lang: &str,
    model: &str,
    explanation: &str,
) -> Result<(), String> {
    if !explanation_has_content(explanation) {
        return Err("AI explanation returned no content.".to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR REPLACE INTO skill_explanations (skill_id, explanation, lang, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, 
            COALESCE((SELECT created_at FROM skill_explanations WHERE skill_id = ? AND lang = ?), ?),
            ?)",
    )
    .bind(skill_id)
    .bind(explanation)
    .bind(lang)
    .bind(model)
    .bind(skill_id)
    .bind(lang)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| format!("缓存解释失败: {}", e))?;

    Ok(())
}

fn empty_explanation_error_info(lang: &str, saw_thinking_delta: bool) -> ExplanationErrorInfo {
    let message = match lang {
        "en" => "The model returned no displayable explanation text.".to_string(),
        _ => "模型没有返回可显示的解释正文。".to_string(),
    };
    let details = if saw_thinking_delta {
        "Streaming completed without any text_delta content. The provider emitted thinking deltas but no final text block.".to_string()
    } else {
        "Streaming completed without any text_delta content.".to_string()
    };

    ExplanationErrorInfo {
        message,
        details,
        kind: ExplanationErrorKind::Response,
        retryable: true,
        fallback_tried: false,
    }
}

/// Helper: read a setting from the DB, filtering out empty values.
async fn get_ai_setting(pool: &crate::db::DbPool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .filter(|v| !v.trim().is_empty())
}

async fn get_provider_setting(pool: &crate::db::DbPool, key: &str) -> Option<String> {
    let provider = get_ai_setting(pool, "ai_provider").await.unwrap_or_default();
    let suffixed = format!("{}__{}", key, provider);
    get_ai_setting(pool, &suffixed).await
}

/// Helper: truncate skill content to 8000 chars.
fn truncate_content(content: &str) -> String {
    if content.len() > 8000 {
        format!("{}...\n\n(内容已截断)", &content[..8000])
    } else {
        content.to_string()
    }
}

/// Helper: build the explanation prompt based on language.
fn build_explanation_prompt(truncated: &str, lang: &str) -> String {
    match lang {
        "en" => format!(
            "Please explain in English concisely the purpose, use cases, and key features \
            of the following AI Agent Skill (SKILL.md). \
            Divide into three parts: 1) One-sentence summary 2) Applicable scenarios 3) Key features. \
            Keep it under 200 words.\n\n---\n\n{}",
            truncated
        ),
        _ => format!(
            "请用中文简洁地解释以下 AI Agent Skill（SKILL.md）的用途、使用场景和关键功能。\
            分为三部分：1) 一句话总结 2) 适用场景 3) 关键功能点。\
            控制在 200 字以内。\n\n---\n\n{}",
            truncated
        ),
    }
}

/// Build the streaming request body as serde_json::Value.
/// Both Anthropic and OpenAI use the same messages format with `stream: true`.
fn build_stream_request_body(model: &str, prompt: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "stream": true,
        "messages": [{
            "role": "user",
            "content": prompt
        }]
    })
}

/// Provider fallback endpoint mapping. Returns the alternative endpoint for
/// multi-region providers so the backend can retry once on connect failure.
fn get_fallback_endpoint(provider: &str, current_url: &str) -> Option<String> {
    let alternatives: &[(&str, &str)] = match provider {
        "minimax" => &[
            (
                "minimaxi.com",
                "https://api.minimax.io/anthropic/v1/messages",
            ),
            (
                "minimax.io",
                "https://api.minimaxi.com/anthropic/v1/messages",
            ),
        ],
        "glm" => &[
            ("bigmodel.cn", "https://api.z.ai/api/anthropic/v1/messages"),
            (
                "api.z.ai",
                "https://open.bigmodel.cn/api/anthropic/v1/messages",
            ),
        ],
        _ => return None,
    };
    for (needle, fallback) in alternatives {
        if current_url.contains(needle) {
            return Some(fallback.to_string());
        }
    }
    None
}

/// Send a streaming explanation request to the given URL. Returns the response
/// on success, or a classified `ExplanationErrorInfo` on connect / transport failure.
async fn send_stream_request(
    client: &reqwest::Client,
    api_url: &str,
    api_key: &str,
    body: &serde_json::Value,
    is_anthropic: bool,
    fallback_tried: bool,
) -> Result<reqwest::Response, ExplanationErrorInfo> {
    let mut req_builder = client
        .post(api_url)
        .header("content-type", "application/json");

    if is_anthropic {
        req_builder = req_builder
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01");
    } else {
        req_builder = req_builder.header("authorization", format!("Bearer {}", api_key));
    }

    match req_builder.json(body).send().await {
        Ok(resp) => Ok(resp),
        Err(e) => Err(classify_reqwest_error(&e, fallback_tried)),
    }
}

/// Core streaming logic shared by `explain_skill_stream` and `refresh_skill_explanation`.
async fn do_explain_skill_stream(
    pool: &crate::db::DbPool,
    app: &AppHandle,
    skill_id: &str,
    content: &str,
    lang: &str,
) -> Result<(), String> {
    let api_key = get_provider_setting(pool, "ai_api_key")
        .await
        .ok_or_else(|| "请先在设置中配置 AI API Key".to_string())?;

    let api_url = get_provider_setting(pool, "ai_api_url")
        .await
        .unwrap_or_else(|| "https://api.anthropic.com/v1/messages".to_string());

    let model = get_provider_setting(pool, "ai_model")
        .await
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());

    let provider = get_ai_setting(pool, "ai_provider")
        .await
        .unwrap_or_default();

    let explicit_protocol_opt = get_provider_setting(pool, "ai_protocol").await;
    let explicit_protocol = explicit_protocol_opt.as_deref();
    let protocol = resolve_api_protocol(&api_url, explicit_protocol);
    let resolved_url = resolve_custom_url(&api_url, &protocol);
    let is_anthropic = matches!(
        protocol,
        ExplanationApiProtocol::AnthropicCompatible | ExplanationApiProtocol::Unknown
    );

    let truncated = truncate_content(content);
    let prompt = build_explanation_prompt(&truncated, lang);
    let body = build_stream_request_body(&model, &prompt);

    // Streaming: only connect_timeout (total `.timeout()` would kill long streams).
    let client = reqwest::Client::builder()
        .user_agent("skills-manage/0.9.1")
        .connect_timeout(Duration::from_secs(10))
        .pool_idle_timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    // Try primary endpoint; on connect-layer failure, try fallback once
    let resp =
        match send_stream_request(&client, &resolved_url, &api_key, &body, is_anthropic, false).await {
            Ok(r) => r,
            Err(err_info) => {
                // Only retry on connect-layer errors that are retryable
                if err_info.retryable {
                    if let Some(fallback_url) = get_fallback_endpoint(&provider, &resolved_url) {
                        eprintln!(
                            "[explain] primary endpoint failed ({:?}), trying fallback: {}",
                            err_info.kind, fallback_url
                        );
                        let fallback_protocol = detect_explanation_api_protocol(&fallback_url);
                        let fallback_anthropic = matches!(
                            fallback_protocol,
                            ExplanationApiProtocol::AnthropicCompatible
                                | ExplanationApiProtocol::Unknown
                        );
                        match send_stream_request(
                            &client,
                            &fallback_url,
                            &api_key,
                            &body,
                            fallback_anthropic,
                            true,
                        )
                        .await
                        {
                            Ok(r) => r,
                            Err(fallback_err) => {
                                let _ = app.emit(
                                    "skill:explanation:error",
                                    serde_json::json!({
                                        "skill_id": skill_id,
                                        "error": &fallback_err.message,
                                        "error_info": fallback_err,
                                    }),
                                );
                                return Err(fallback_err.message);
                            }
                        }
                    } else {
                        let _ = app.emit(
                            "skill:explanation:error",
                            serde_json::json!({
                                "skill_id": skill_id,
                                "error": &err_info.message,
                                "error_info": err_info,
                            }),
                        );
                        return Err(err_info.message);
                    }
                } else {
                    let _ = app.emit(
                        "skill:explanation:error",
                        serde_json::json!({
                            "skill_id": skill_id,
                            "error": &err_info.message,
                            "error_info": err_info,
                        }),
                    );
                    return Err(err_info.message);
                }
            }
        };

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        let status_code = status.as_u16();
        let err_kind = if status_code == 401 || status_code == 403 {
            ExplanationErrorKind::Auth
        } else {
            ExplanationErrorKind::Response
        };
        let user_msg = if status_code == 401 || status_code == 403 {
            "API Key 无效或权限不足，请检查设置中的 API Key".to_string()
        } else if status_code == 429 {
            "请求过于频繁，请稍后重试".to_string()
        } else {
            format!("API 返回错误 {}", status)
        };
        let err_info = ExplanationErrorInfo {
            message: user_msg,
            details: format!("HTTP {}: {}", status, body_text),
            kind: err_kind,
            retryable: status_code == 429,
            fallback_tried: false,
        };
        let _ = app.emit(
            "skill:explanation:error",
            serde_json::json!({
                "skill_id": skill_id,
                "error": &err_info.message,
                "error_info": err_info,
            }),
        );
        return Err(format!("API 返回错误 {}: {}", status, body_text));
    }

    // Stream SSE response
    let mut stream = resp.bytes_stream();
    let mut full_text = String::new();
    let mut sse_buffer = String::new();
    let mut saw_thinking_delta = false;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("流读取失败: {}", e))?;
        sse_buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete SSE lines
        while let Some(newline_pos) = sse_buffer.find('\n') {
            let line = sse_buffer[..newline_pos].trim().to_string();
            sse_buffer = sse_buffer[newline_pos + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            let data = if let Some(stripped) = line.strip_prefix("data: ") {
                stripped
            } else if let Some(stripped) = line.strip_prefix("data:") {
                stripped.trim()
            } else {
                continue;
            };

            if data == "[DONE]" {
                continue;
            }

            let parsed: serde_json::Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let text_chunk = if is_anthropic {
                // Anthropic SSE: { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "..." } }
                let event_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");
                let delta_type = parsed
                    .get("delta")
                    .and_then(|d| d.get("type"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                if event_type == "content_block_delta" && delta_type == "thinking_delta" {
                    saw_thinking_delta = true;
                }
                if event_type == "content_block_delta" {
                    parsed
                        .get("delta")
                        .and_then(|d| d.get("text"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string()
                } else {
                    String::new()
                }
            } else {
                // OpenAI SSE: { "choices": [{ "delta": { "content": "..." } }] }
                parsed
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string()
            };

            if !text_chunk.is_empty() {
                full_text.push_str(&text_chunk);
                let _ = app.emit(
                    "skill:explanation:chunk",
                    ExplanationChunkPayload {
                        skill_id: skill_id.to_string(),
                        text: text_chunk,
                    },
                );
            }
        }
    }

    if !explanation_has_content(&full_text) {
        let err_info = empty_explanation_error_info(lang, saw_thinking_delta);
        let _ = app.emit(
            "skill:explanation:error",
            serde_json::json!({
                "skill_id": skill_id,
                "error": &err_info.message,
                "error_info": err_info,
            }),
        );
        return Err("AI explanation returned no content.".to_string());
    }

    cache_skill_explanation(pool, skill_id, lang, &model, &full_text).await?;

    let _ = app.emit(
        "skill:explanation:complete",
        ExplanationCompletePayload {
            skill_id: skill_id.to_string(),
            explanation: Some(full_text.clone()),
        },
    );

    Ok(())
}

/// Retrieve a cached skill explanation from the database.
#[tauri::command]
pub async fn get_skill_explanation(
    state: State<'_, AppState>,
    skill_id: String,
    lang: String,
) -> Result<Option<String>, String> {
    load_cached_skill_explanation(&state.db, &skill_id, &lang).await
}

/// Stream an AI-generated explanation for a skill, with DB caching.
/// If a cached explanation exists, it is emitted as a single chunk.
/// Otherwise, the AI API is called with streaming and chunks are emitted
/// as they arrive. The full explanation is cached after completion.
#[tauri::command]
pub async fn explain_skill_stream(
    state: State<'_, AppState>,
    app: AppHandle,
    skill_id: String,
    content: String,
    lang: String,
) -> Result<(), String> {
    // Check cache first
    if let Some(explanation) = load_cached_skill_explanation(&state.db, &skill_id, &lang).await? {
        let _ = app.emit(
            "skill:explanation:chunk",
            ExplanationChunkPayload {
                skill_id: skill_id.clone(),
                text: explanation.clone(),
            },
        );
        let _ = app.emit(
            "skill:explanation:complete",
            ExplanationCompletePayload {
                skill_id: skill_id.clone(),
                explanation: Some(explanation),
            },
        );
        return Ok(());
    }

    do_explain_skill_stream(&state.db, &app, &skill_id, &content, &lang).await
}

/// Refresh (re-generate) a skill explanation by deleting the cache and re-streaming.
#[tauri::command]
pub async fn refresh_skill_explanation(
    state: State<'_, AppState>,
    app: AppHandle,
    skill_id: String,
    content: String,
    lang: String,
) -> Result<(), String> {
    // Delete cached explanation
    delete_cached_skill_explanation(&state.db, &skill_id, &lang).await?;

    do_explain_skill_stream(&state.db, &app, &skill_id, &content, &lang).await
}

#[cfg(test)]
mod tests {
    use super::{
        add_registry_impl, cache_skill_explanation, classify_reqwest_error,
        detect_explanation_api_protocol, format_reqwest_error, get_fallback_endpoint,
        load_cached_skill_explanation, marketplace_skills_from_candidates,
        registry_has_cached_skills, resolve_api_protocol, resolve_custom_url, search_marketplace_skills_impl, sync_registry_impl,
        ExplanationApiProtocol, ExplanationErrorKind, RegistryCacheMetadata, RegistrySyncStatus,
        SyncRegistryOptions,
    };
    use crate::commands::github_import::RemoteSkillCandidate;
    use crate::db;
    use tempfile::{tempdir, TempDir};

    async fn setup_test_db() -> (crate::db::DbPool, TempDir) {
        let dir = tempdir().expect("create tempdir");
        let db_path = dir.path().join("marketplace-cache.sqlite");
        let db_path = db_path.to_string_lossy().into_owned();
        let pool = db::create_pool(&db_path).await.expect("create pool");
        db::init_database(&pool).await.expect("init db");
        (pool, dir)
    }

    #[test]
    fn marketplace_skills_from_candidates_supports_namespaced_layouts() {
        let skills = marketplace_skills_from_candidates(
            "openai",
            vec![
                RemoteSkillCandidate {
                    source_path: "skills/.curated/openai-docs".to_string(),
                    skill_id: "openai-docs".to_string(),
                    skill_name: "openai-docs".to_string(),
                    description: Some("Docs skill".to_string()),
                    root_directory: "skills/.curated".to_string(),
                    skill_directory_name: "openai-docs".to_string(),
                    download_url:
                        "https://raw.githubusercontent.com/openai/skills/main/skills/.curated/openai-docs/SKILL.md"
                            .to_string(),
                },
                RemoteSkillCandidate {
                    source_path: "skills/.system/skill-creator".to_string(),
                    skill_id: "skill-creator".to_string(),
                    skill_name: "skill-creator".to_string(),
                    description: Some("Create skills".to_string()),
                    root_directory: "skills/.system".to_string(),
                    skill_directory_name: "skill-creator".to_string(),
                    download_url:
                        "https://raw.githubusercontent.com/openai/skills/main/skills/.system/skill-creator/SKILL.md"
                            .to_string(),
                },
            ],
        );

        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].id, "openai::openai-docs");
        assert_eq!(skills[0].name, "openai-docs");
        assert!(skills[0]
            .download_url
            .contains("skills/.curated/openai-docs"));
        assert_eq!(skills[1].id, "openai::skill-creator");
        assert_eq!(skills[1].name, "skill-creator");
        assert!(skills[1]
            .download_url
            .contains("skills/.system/skill-creator"));
    }

    #[test]
    fn detects_anthropic_compatible_message_endpoints() {
        assert_eq!(
            detect_explanation_api_protocol("https://api.minimaxi.com/anthropic/v1/messages"),
            ExplanationApiProtocol::AnthropicCompatible
        );
        assert_eq!(
            detect_explanation_api_protocol("https://open.bigmodel.cn/api/anthropic/v1/messages"),
            ExplanationApiProtocol::AnthropicCompatible
        );
        assert_eq!(
            detect_explanation_api_protocol("https://api.anthropic.com/v1/messages"),
            ExplanationApiProtocol::AnthropicCompatible
        );
    }

    #[test]
    fn detects_openai_chat_completions_endpoints() {
        assert_eq!(
            detect_explanation_api_protocol("https://api.openai.com/v1/chat/completions"),
            ExplanationApiProtocol::OpenAiCompatible
        );
    }

    #[test]
    fn leaves_unknown_endpoints_unclassified() {
        assert_eq!(
            detect_explanation_api_protocol("https://example.com/custom/generate"),
            ExplanationApiProtocol::Unknown
        );
    }

    /// A live reqwest error (connect-refused on localhost:1) must be
    /// classified with an actionable Chinese hint, not just the opaque
    /// top-level "error sending request for url (...)".
    /// `.no_proxy()` ensures the test is deterministic even when the
    /// developer has `HTTP(S)_PROXY` set in their environment.
    #[tokio::test]
    async fn format_reqwest_error_surfaces_actionable_hint() {
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(std::time::Duration::from_millis(500))
            .build()
            .expect("build client");
        let err = client
            .post("http://127.0.0.1:1/")
            .send()
            .await
            .expect_err("expected connect failure");
        let msg = format_reqwest_error(&err);
        assert!(
            msg.contains("切换区域端点") || msg.contains("建立连接"),
            "expected actionable Chinese hint in formatted error, got: {msg}"
        );
    }

    #[tokio::test]
    async fn classify_connect_error_as_connect_kind() {
        let client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(std::time::Duration::from_millis(500))
            .build()
            .expect("build client");
        let err = client
            .post("http://127.0.0.1:1/")
            .send()
            .await
            .expect_err("expected connect failure");
        let info = classify_reqwest_error(&err, false);
        assert_eq!(info.kind, ExplanationErrorKind::Connect);
        assert!(info.retryable);
        assert!(!info.message.is_empty());
        assert!(!info.details.is_empty());
    }

    // ── Fallback endpoint tests ──────────────────────────────────────────

    #[test]
    fn minimax_cn_falls_back_to_intl() {
        let fb = get_fallback_endpoint("minimax", "https://api.minimaxi.com/anthropic/v1/messages");
        assert_eq!(
            fb.as_deref(),
            Some("https://api.minimax.io/anthropic/v1/messages")
        );
    }

    #[test]
    fn minimax_intl_falls_back_to_cn() {
        let fb = get_fallback_endpoint("minimax", "https://api.minimax.io/anthropic/v1/messages");
        assert_eq!(
            fb.as_deref(),
            Some("https://api.minimaxi.com/anthropic/v1/messages")
        );
    }

    #[test]
    fn glm_cn_falls_back_to_intl() {
        let fb = get_fallback_endpoint("glm", "https://open.bigmodel.cn/api/anthropic/v1/messages");
        assert_eq!(
            fb.as_deref(),
            Some("https://api.z.ai/api/anthropic/v1/messages")
        );
    }

    #[test]
    fn glm_intl_falls_back_to_cn() {
        let fb = get_fallback_endpoint("glm", "https://api.z.ai/api/anthropic/v1/messages");
        assert_eq!(
            fb.as_deref(),
            Some("https://open.bigmodel.cn/api/anthropic/v1/messages")
        );
    }

    #[test]
    fn claude_has_no_fallback() {
        let fb = get_fallback_endpoint("claude", "https://api.anthropic.com/v1/messages");
        assert!(fb.is_none());
    }

    #[test]
    fn custom_provider_has_no_fallback() {
        let fb = get_fallback_endpoint("custom", "https://my-proxy.example.com/v1/messages");
        assert!(fb.is_none());
    }

    #[tokio::test]
    async fn load_cached_skill_explanation_drops_empty_rows() {
        let (pool, _dir) = setup_test_db().await;

        sqlx::query(
            "INSERT INTO skill_explanations (skill_id, explanation, lang, model, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind("defuddle")
        .bind("")
        .bind("zh")
        .bind("MiniMax-M2.7")
        .bind("2026-04-19T00:00:00Z")
        .bind("2026-04-19T00:00:00Z")
        .execute(&pool)
        .await
        .expect("insert empty explanation");

        let explanation = load_cached_skill_explanation(&pool, "defuddle", "zh")
            .await
            .expect("load cached explanation");
        assert!(explanation.is_none());

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM skill_explanations WHERE skill_id = ? AND lang = ?",
        )
        .bind("defuddle")
        .bind("zh")
        .fetch_one(&pool)
        .await
        .expect("count explanations");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn cache_skill_explanation_rejects_blank_text() {
        let (pool, _dir) = setup_test_db().await;

        let err = cache_skill_explanation(&pool, "defuddle", "zh", "MiniMax-M2.7", "   ")
            .await
            .expect_err("blank explanations should be rejected");
        assert!(err.contains("no content"));

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM skill_explanations WHERE skill_id = ? AND lang = ?",
        )
        .bind("defuddle")
        .bind("zh")
        .fetch_one(&pool)
        .await
        .expect("count explanations");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn add_registry_persists_cache_metadata() {
        let (pool, _dir) = setup_test_db().await;
        let registry = add_registry_impl(
            &pool,
            "Custom Repo".to_string(),
            "github".to_string(),
            "https://github.com/example/custom".to_string(),
            Some(RegistryCacheMetadata {
                etag: Some("etag-123".to_string()),
                last_modified: Some("Wed, 01 Jan 2025 00:00:00 GMT".to_string()),
                cache_expires_at: Some("2026-04-16T00:00:00Z".to_string()),
            }),
        )
        .await
        .expect("registry created");

        let row = sqlx::query(
            "SELECT last_sync_status, etag, last_modified, cache_expires_at
             FROM skill_registries WHERE id = ?",
        )
        .bind(&registry.id)
        .fetch_one(&pool)
        .await
        .expect("fetch registry");

        use sqlx::Row;
        assert_eq!(
            row.get::<String, _>("last_sync_status"),
            RegistrySyncStatus::Never.as_str()
        );
        assert_eq!(
            row.get::<Option<String>, _>("etag").as_deref(),
            Some("etag-123")
        );
        assert_eq!(
            row.get::<Option<String>, _>("last_modified").as_deref(),
            Some("Wed, 01 Jan 2025 00:00:00 GMT")
        );
        assert_eq!(
            row.get::<Option<String>, _>("cache_expires_at").as_deref(),
            Some("2026-04-16T00:00:00Z")
        );
    }

    #[tokio::test]
    async fn sync_registry_uses_cached_skills_without_refresh() {
        let (pool, _dir) = setup_test_db().await;
        let registry = add_registry_impl(
            &pool,
            "Cached Repo".to_string(),
            "github".to_string(),
            "https://github.com/example/invalid".to_string(),
            None,
        )
        .await
        .expect("registry created");

        sqlx::query(
            "INSERT INTO marketplace_skills
             (id, registry_id, name, description, download_url, is_installed, synced_at, cache_updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(format!("{}::cached-skill", registry.id))
        .bind(&registry.id)
        .bind("cached-skill")
        .bind("served from cache")
        .bind("https://example.com/SKILL.md")
        .bind("2026-04-16T12:00:00Z")
        .bind("2026-04-16T12:00:00Z")
        .execute(&pool)
        .await
        .expect("insert cached skill");

        let skills = sync_registry_impl(&pool, registry.id.clone(), SyncRegistryOptions::default())
            .await
            .expect("sync succeeds from cache");

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "cached-skill");

        let row = sqlx::query(
            "SELECT last_attempted_sync, last_synced, last_sync_status
             FROM skill_registries WHERE id = ?",
        )
        .bind(&registry.id)
        .fetch_one(&pool)
        .await
        .expect("fetch registry");

        use sqlx::Row;
        assert!(row
            .get::<Option<String>, _>("last_attempted_sync")
            .is_none());
        assert!(row.get::<Option<String>, _>("last_synced").is_none());
        assert_eq!(
            row.get::<String, _>("last_sync_status"),
            RegistrySyncStatus::Never.as_str()
        );
    }

    #[tokio::test]
    async fn force_refresh_failure_preserves_last_good_cached_data() {
        let (pool, _dir) = setup_test_db().await;
        let registry = add_registry_impl(
            &pool,
            "Broken Repo".to_string(),
            "github".to_string(),
            "not-a-valid-github-url".to_string(),
            None,
        )
        .await
        .expect("registry created");

        sqlx::query(
            "INSERT INTO marketplace_skills
             (id, registry_id, name, description, download_url, is_installed, synced_at, cache_updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(format!("{}::last-good", registry.id))
        .bind(&registry.id)
        .bind("last-good")
        .bind("cached before failure")
        .bind("https://example.com/last-good/SKILL.md")
        .bind("2026-04-16T12:00:00Z")
        .bind("2026-04-16T12:00:00Z")
        .execute(&pool)
        .await
        .expect("insert cached skill");

        let skills = sync_registry_impl(
            &pool,
            registry.id.clone(),
            SyncRegistryOptions {
                force_refresh: true,
            },
        )
        .await
        .expect("force refresh returns cached data on failure");

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "last-good");

        let row = sqlx::query(
            "SELECT last_sync_status, last_sync_error, last_synced
             FROM skill_registries WHERE id = ?",
        )
        .bind(&registry.id)
        .fetch_one(&pool)
        .await
        .expect("fetch registry");

        use sqlx::Row;
        assert_eq!(
            row.get::<String, _>("last_sync_status"),
            RegistrySyncStatus::Error.as_str()
        );
        let last_sync_error = row
            .get::<Option<String>, _>("last_sync_error")
            .unwrap_or_default();
        assert!(
            last_sync_error.contains("GitHub repository URL")
                || last_sync_error.contains("github.com"),
            "unexpected sync error: {last_sync_error}"
        );
        assert!(row.get::<Option<String>, _>("last_synced").is_none());

        let cached_skills = search_marketplace_skills_impl(&pool, Some(registry.id.clone()), None)
            .await
            .expect("cached skills still queryable");
        assert_eq!(cached_skills.len(), 1);
        assert_eq!(cached_skills[0].name, "last-good");
    }

    #[tokio::test]
    async fn registry_cache_column_migration_is_idempotent() {
        let dir = tempdir().expect("create tempdir");
        let db_path = dir.path().join("migration.sqlite");
        let db_path = db_path.to_string_lossy().into_owned();
        let pool = db::create_pool(&db_path).await.expect("create pool");

        sqlx::query(
            "CREATE TABLE skill_registries (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source_type TEXT NOT NULL,
                url TEXT NOT NULL,
                is_builtin BOOLEAN NOT NULL DEFAULT 0,
                is_enabled BOOLEAN NOT NULL DEFAULT 1,
                last_synced TEXT,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create legacy skill_registries");
        sqlx::query(
            "CREATE TABLE marketplace_skills (
                id TEXT PRIMARY KEY,
                registry_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                download_url TEXT NOT NULL,
                is_installed BOOLEAN NOT NULL DEFAULT 0,
                synced_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create legacy marketplace_skills");

        db::init_database(&pool).await.expect("migrate once");
        db::init_database(&pool).await.expect("migrate twice");

        let registry_columns = sqlx::query("PRAGMA table_info(skill_registries)")
            .fetch_all(&pool)
            .await
            .expect("pragma registry");
        let skill_columns = sqlx::query("PRAGMA table_info(marketplace_skills)")
            .fetch_all(&pool)
            .await
            .expect("pragma skills");

        use sqlx::Row;
        let registry_names: Vec<String> =
            registry_columns.iter().map(|row| row.get("name")).collect();
        let skill_names: Vec<String> = skill_columns.iter().map(|row| row.get("name")).collect();

        for expected in [
            "last_attempted_sync",
            "last_sync_status",
            "last_sync_error",
            "cache_updated_at",
            "cache_expires_at",
            "etag",
            "last_modified",
        ] {
            assert!(
                registry_names.iter().any(|name| name == expected),
                "missing registry column {expected}"
            );
        }
        assert!(
            skill_names.iter().any(|name| name == "cache_updated_at"),
            "missing marketplace_skills.cache_updated_at"
        );
    }

    #[tokio::test]
    async fn registry_has_cached_skills_detects_persisted_rows() {
        let (pool, _dir) = setup_test_db().await;
        let registry = add_registry_impl(
            &pool,
            "Cache Check".to_string(),
            "github".to_string(),
            "https://github.com/example/cache-check".to_string(),
            None,
        )
        .await
        .expect("registry created");

        assert!(!registry_has_cached_skills(&pool, &registry.id)
            .await
            .expect("empty"));

        sqlx::query(
            "INSERT INTO marketplace_skills
             (id, registry_id, name, description, download_url, is_installed, synced_at, cache_updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(format!("{}::cached", registry.id))
        .bind(&registry.id)
        .bind("cached")
        .bind("cached row")
        .bind("https://example.com/cached/SKILL.md")
        .bind("2026-04-16T12:00:00Z")
        .bind("2026-04-16T12:00:00Z")
        .execute(&pool)
        .await
        .expect("insert skill");

        assert!(registry_has_cached_skills(&pool, &registry.id)
            .await
            .expect("cached"));
    }

    // ── resolve_api_protocol tests ─────────────────────────────────────────

    #[test]
    fn resolve_api_protocol_explicit_overrides_detection() {
        assert_eq!(
            resolve_api_protocol("https://example.com/v1/messages", Some("openai")),
            ExplanationApiProtocol::OpenAiCompatible
        );
    }

    #[test]
    fn resolve_api_protocol_falls_back_to_detection_when_none() {
        assert_eq!(
            resolve_api_protocol("https://example.com/v1/messages", None),
            ExplanationApiProtocol::AnthropicCompatible
        );
        assert_eq!(
            resolve_api_protocol("https://example.com/v1/chat/completions", None),
            ExplanationApiProtocol::OpenAiCompatible
        );
    }

    #[test]
    fn resolve_api_protocol_empty_string_same_as_none() {
        assert_eq!(
            resolve_api_protocol("https://example.com/v1/messages", Some("")),
            ExplanationApiProtocol::AnthropicCompatible
        );
    }

    #[test]
    fn resolve_api_protocol_anthropic_explicit() {
        assert_eq!(
            resolve_api_protocol("https://example.com/v1/chat/completions", Some("anthropic")),
            ExplanationApiProtocol::AnthropicCompatible
        );
    }

    #[test]
    fn resolve_custom_url_appends_path_for_v1_suffix() {
        assert_eq!(
            resolve_custom_url("https://api.example.com/v1", &ExplanationApiProtocol::OpenAiCompatible),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            resolve_custom_url("https://api.example.com/v1", &ExplanationApiProtocol::AnthropicCompatible),
            "https://api.example.com/v1/messages"
        );
        assert_eq!(
            resolve_custom_url("https://api.example.com/v1", &ExplanationApiProtocol::Unknown),
            "https://api.example.com/v1"
        );
    }

    #[test]
    fn resolve_custom_url_leaves_non_v1_unchanged() {
        assert_eq!(
            resolve_custom_url("https://api.example.com/v1/chat/completions", &ExplanationApiProtocol::OpenAiCompatible),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            resolve_custom_url("https://api.anthropic.com/v1/messages", &ExplanationApiProtocol::AnthropicCompatible),
            "https://api.anthropic.com/v1/messages"
        );
    }
}
