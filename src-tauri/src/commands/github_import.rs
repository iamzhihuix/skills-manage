use chrono::Utc;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter, State};

use crate::{
    db::{self, DbPool, Skill},
    AppState,
};

pub(crate) fn github_request(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let req = client.get(url);
    match token {
        Some(t) => req.bearer_auth(t),
        None => req,
    }
}

/// Send a GET request; if the token is invalid (401), retry without it.
/// 403 (rate limit, permissions) still propagates so the caller can act.
pub(crate) async fn send_with_auth_fallback(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
) -> Result<reqwest::Response, reqwest::Error> {
    if let Some(t) = token {
        let resp = github_request(client, url, Some(t)).send().await?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return github_request(client, url, None).send().await;
        }
        return Ok(resp);
    }
    github_request(client, url, None).send().await
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoRef {
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub normalized_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateResolution {
    Overwrite,
    Skip,
    Rename,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSkillConflict {
    pub existing_skill_id: String,
    pub existing_name: String,
    pub existing_canonical_path: Option<String>,
    pub proposed_skill_id: String,
    pub proposed_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSkillPreview {
    pub source_path: String,
    pub skill_id: String,
    pub skill_name: String,
    pub description: Option<String>,
    pub root_directory: String,
    pub skill_directory_name: String,
    pub download_url: String,
    pub conflict: Option<GitHubSkillConflict>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoPreview {
    pub repo: GitHubRepoRef,
    pub skills: Vec<GitHubSkillPreview>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSkillImportSelection {
    pub source_path: String,
    pub resolution: DuplicateResolution,
    pub renamed_skill_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGitHubSkillSummary {
    pub source_path: String,
    pub original_skill_id: String,
    pub imported_skill_id: String,
    pub skill_name: String,
    pub target_directory: String,
    pub resolution: DuplicateResolution,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoImportResult {
    pub repo: GitHubRepoRef,
    pub imported_skills: Vec<ImportedGitHubSkillSummary>,
    pub skipped_skills: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitHubImportProgressPhase {
    Preparing,
    Writing,
    Finalizing,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubImportProgressPayload {
    pub phase: GitHubImportProgressPhase,
    pub current_skill: Option<String>,
    pub current_path: Option<String>,
    pub completed_files: usize,
    pub total_files: usize,
    pub completed_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SkillFrontmatter {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct RemoteSkillCandidate {
    pub(crate) source_path: String,
    pub(crate) skill_id: String,
    pub(crate) skill_name: String,
    pub(crate) description: Option<String>,
    pub(crate) root_directory: String,
    pub(crate) skill_directory_name: String,
    pub(crate) download_url: String,
}

#[derive(Debug, Clone, Default)]
struct GitHubRepoSnapshot {
    files: HashMap<String, Vec<u8>>,
}

const GITHUB_PAT_SETTING_KEY: &str = "github_pat";

#[derive(Debug, Clone, PartialEq, Eq)]
enum GitHubAccessDenialKind {
    RateLimited {
        reset_at: Option<String>,
        remaining: Option<String>,
    },
    AuthenticationOrPermission,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GitHubAccessDenial {
    kind: GitHubAccessDenialKind,
    operation: &'static str,
    status: reqwest::StatusCode,
    github_message: Option<String>,
}

impl fmt::Display for GitHubAccessDenial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let status = self.status.as_u16();
        match &self.kind {
            GitHubAccessDenialKind::RateLimited {
                reset_at,
                remaining,
            } => {
                write!(
                    f,
                    "GitHub API access was denied while {} because the rate limit was exceeded (HTTP {}). Retry later",
                    self.operation, status
                )?;
                if let Some(reset_at) = reset_at {
                    write!(f, " after {} UTC", reset_at)?;
                }
                write!(f, " or use authenticated GitHub requests")?;
                if let Some(remaining) = remaining {
                    write!(f, " (remaining quota: {})", remaining)?;
                }
                if let Some(message) = &self.github_message {
                    write!(f, ". GitHub said: {}", message)?;
                } else {
                    write!(f, ".")?;
                }
                Ok(())
            }
            GitHubAccessDenialKind::AuthenticationOrPermission => {
                write!(
                    f,
                    "GitHub denied access while {} (HTTP {}). The repository may require authentication, your API quota may need authenticated requests, or the token/permissions are insufficient. Verify repository access, sign in with a GitHub token that can read the repo, or retry later",
                    self.operation, status
                )?;
                if let Some(message) = &self.github_message {
                    write!(f, ". GitHub said: {}", message)?;
                } else {
                    write!(f, ".")?;
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Deserialize)]
struct GitHubErrorResponse {
    message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitHubFetchSurface {
    Api,
    Raw,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MirrorAttemptOutcome {
    status: Option<reqwest::StatusCode>,
    error_message: String,
}

#[derive(Debug, Clone, Copy)]
struct GitHubMirrorEndpoint {
    label: &'static str,
    api_base: &'static str,
    raw_base: &'static str,
}

const GITHUB_MIRROR_ENDPOINTS: &[GitHubMirrorEndpoint] = &[
    GitHubMirrorEndpoint {
        label: "github",
        api_base: "https://api.github.com",
        raw_base: "https://raw.githubusercontent.com",
    },
    GitHubMirrorEndpoint {
        label: "ghfast",
        api_base: "https://ghfast.top/https://api.github.com",
        raw_base: "https://ghfast.top/https://raw.githubusercontent.com",
    },
    GitHubMirrorEndpoint {
        label: "ghproxy",
        api_base: "https://ghproxy.net/https://api.github.com",
        raw_base: "https://ghproxy.net/https://raw.githubusercontent.com",
    },
    GitHubMirrorEndpoint {
        label: "gitproxy",
        api_base: "https://mirror.ghproxy.com/https://api.github.com",
        raw_base: "https://mirror.ghproxy.com/https://raw.githubusercontent.com",
    },
];

#[tauri::command]
pub async fn preview_github_repo_import(
    state: State<'_, AppState>,
    repo_url: String,
) -> Result<GitHubRepoPreview, String> {
    preview_github_repo_import_impl(&state.db, &repo_url).await
}

#[tauri::command]
pub async fn import_github_repo_skills(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_url: String,
    selections: Vec<GitHubSkillImportSelection>,
) -> Result<GitHubRepoImportResult, String> {
    import_github_repo_skills_impl(&state.db, &repo_url, selections, Some(&app)).await
}

#[tauri::command]
pub async fn fetch_github_skill_markdown(
    state: State<'_, AppState>,
    download_url: String,
) -> Result<String, String> {
    let client = github_client()?;
    let auth = github_direct_auth_from_settings(&state.db).await?;
    fetch_raw_text(&client, &download_url, auth.as_deref()).await
}

async fn preview_github_repo_import_impl(
    pool: &DbPool,
    repo_url: &str,
) -> Result<GitHubRepoPreview, String> {
    let auth = github_direct_auth_from_settings(pool).await?;
    let repo = resolve_repo_ref(repo_url, auth.as_deref()).await?;
    let candidates = fetch_repo_skill_candidates(&repo, auth.as_deref()).await?;
    let skills = build_preview_skills(pool, &candidates).await?;

    if skills.is_empty() {
        return Err(
            "No importable skills found in this repository. Supported layouts are repo-root skill directories or a top-level skills/ directory."
                .to_string(),
        );
    }

    Ok(GitHubRepoPreview { repo, skills })
}

async fn import_github_repo_skills_impl(
    pool: &DbPool,
    repo_url: &str,
    selections: Vec<GitHubSkillImportSelection>,
    app: Option<&AppHandle>,
) -> Result<GitHubRepoImportResult, String> {
    emit_github_import_progress(
        app,
        GitHubImportProgressPayload {
            phase: GitHubImportProgressPhase::Preparing,
            current_skill: None,
            current_path: None,
            completed_files: 0,
            total_files: 0,
            completed_bytes: 0,
            total_bytes: 0,
        },
    );

    let auth = github_direct_auth_from_settings(pool).await?;
    let repo = resolve_repo_ref(repo_url, auth.as_deref()).await?;
    let client = github_client()?;
    let snapshot = download_repo_snapshot(&client, &repo, auth.as_deref()).await?;
    let candidates = build_repo_skill_candidates_from_snapshot(&repo, &snapshot)?;
    if candidates.is_empty() {
        return Err(
            "No importable skills found in this repository. Supported layouts are repo-root skill directories or a top-level skills/ directory."
                .to_string(),
        );
    }

    if selections.is_empty() {
        return Err("Select at least one skill to import.".to_string());
    }

    let mut selected_paths = HashSet::new();
    let mut selected = Vec::new();
    for selection in selections {
        let candidate = candidates
            .iter()
            .find(|candidate| candidate.source_path == selection.source_path)
            .ok_or_else(|| {
                format!(
                    "Selected skill '{}' is no longer available in the preview.",
                    selection.source_path
                )
            })?
            .clone();

        if !selected_paths.insert(candidate.source_path.clone()) {
            return Err(format!(
                "Skill '{}' was selected more than once.",
                candidate.source_path
            ));
        }

        selected.push((candidate, selection));
    }

    let central_root = central_skills_root(pool).await?;
    std::fs::create_dir_all(&central_root)
        .map_err(|e| format!("Failed to create central skills directory: {}", e))?;

    let mut occupied_ids = current_central_skill_ids(pool).await?;
    let mut staging_ops = Vec::new();
    let mut skipped_skills = Vec::new();

    for (candidate, selection) in &selected {
        match selection.resolution {
            DuplicateResolution::Skip => {
                skipped_skills.push(candidate.source_path.clone());
                continue;
            }
            DuplicateResolution::Overwrite => {
                if let Some(existing) = db::get_skill_by_id(pool, &candidate.skill_id).await? {
                    if !existing.is_central {
                        return Err(format!(
                            "Skill '{}' conflicts with a non-central record and cannot be overwritten safely.",
                            candidate.skill_id
                        ));
                    }
                }
                occupied_ids.insert(candidate.skill_id.clone());
                staging_ops.push(StagedImport {
                    candidate: candidate.clone(),
                    final_skill_id: candidate.skill_id.clone(),
                    resolution: DuplicateResolution::Overwrite,
                    source_files: Vec::new(),
                });
            }
            DuplicateResolution::Rename => {
                let requested_id =
                    sanitize_skill_id(selection.renamed_skill_id.as_deref().ok_or_else(|| {
                        format!(
                            "Skill '{}' requires a renamed skill id for rename resolution.",
                            candidate.source_path
                        )
                    })?)?;
                if occupied_ids.contains(&requested_id) {
                    return Err(format!(
                        "Renamed skill id '{}' is already in use.",
                        requested_id
                    ));
                }
                occupied_ids.insert(requested_id.clone());
                staging_ops.push(StagedImport {
                    candidate: candidate.clone(),
                    final_skill_id: requested_id,
                    resolution: DuplicateResolution::Rename,
                    source_files: Vec::new(),
                });
            }
        }
    }

    if staging_ops.is_empty() && skipped_skills.is_empty() {
        return Err("No valid import operations were requested.".to_string());
    }

    for op in &mut staging_ops {
        op.source_files = collect_snapshot_source_files(&snapshot, &op.candidate.source_path)?;
    }

    let total_files = staging_ops
        .iter()
        .map(|op| op.source_files.len())
        .sum::<usize>();
    let total_bytes = staging_ops
        .iter()
        .flat_map(|op| op.source_files.iter())
        .map(|file| file.byte_len as u64)
        .sum::<u64>();
    let mut progress_state = GitHubImportProgressState {
        completed_files: 0,
        total_files,
        completed_bytes: 0,
        total_bytes,
    };

    emit_github_import_progress(
        app,
        GitHubImportProgressPayload {
            phase: GitHubImportProgressPhase::Writing,
            current_skill: None,
            current_path: None,
            completed_files: 0,
            total_files,
            completed_bytes: 0,
            total_bytes,
        },
    );

    let mut imported_skills = Vec::new();
    let mut created_paths = Vec::new();

    for op in &staging_ops {
        let target_dir = central_root.join(&op.final_skill_id);
        if target_dir.exists() {
            if op.resolution == DuplicateResolution::Overwrite {
                std::fs::remove_dir_all(&target_dir).map_err(|e| {
                    format!(
                        "Failed to replace existing canonical skill '{}': {}",
                        op.final_skill_id, e
                    )
                })?;
            } else {
                cleanup_created_directories(&created_paths);
                return Err(format!(
                    "Target directory '{}' already exists.",
                    target_dir.display()
                ));
            }
        }

        if let Err(error) = write_snapshot_source_to_target(
            &snapshot,
            &op.source_files,
            &target_dir,
            &op.candidate.source_path,
            &mut progress_state,
            app,
        ) {
            cleanup_created_directories(&created_paths);
            if target_dir.exists() {
                let _ = std::fs::remove_dir_all(&target_dir);
            }
            return Err(error);
        }

        created_paths.push(target_dir.clone());

        let skill_md_path = target_dir.join("SKILL.md");
        let raw = std::fs::read_to_string(&skill_md_path)
            .map_err(|e| format!("Failed to read imported SKILL.md: {}", e))?;
        let frontmatter = parse_frontmatter(&raw).ok_or_else(|| {
            format!(
                "Imported skill '{}' is missing valid frontmatter.",
                op.candidate.source_path
            )
        })?;

        let db_skill = Skill {
            id: op.final_skill_id.clone(),
            name: frontmatter.name.clone(),
            description: frontmatter.description.clone(),
            file_path: skill_md_path.to_string_lossy().into_owned(),
            canonical_path: Some(target_dir.to_string_lossy().into_owned()),
            is_central: true,
            source: Some(format!("github:{}/{}", repo.owner, repo.repo)),
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        };
        db::upsert_skill(pool, &db_skill).await?;

        imported_skills.push(ImportedGitHubSkillSummary {
            source_path: op.candidate.source_path.clone(),
            original_skill_id: op.candidate.skill_id.clone(),
            imported_skill_id: op.final_skill_id.clone(),
            skill_name: frontmatter.name,
            target_directory: target_dir.to_string_lossy().into_owned(),
            resolution: op.resolution.clone(),
        });
    }

    emit_github_import_progress(
        app,
        GitHubImportProgressPayload {
            phase: GitHubImportProgressPhase::Finalizing,
            current_skill: None,
            current_path: None,
            completed_files: progress_state.completed_files,
            total_files: progress_state.total_files,
            completed_bytes: progress_state.completed_bytes,
            total_bytes: progress_state.total_bytes,
        },
    );

    Ok(GitHubRepoImportResult {
        repo,
        imported_skills,
        skipped_skills,
    })
}

#[derive(Debug, Clone)]
struct StagedImport {
    candidate: RemoteSkillCandidate,
    final_skill_id: String,
    resolution: DuplicateResolution,
    source_files: Vec<SnapshotSourceFile>,
}

fn cleanup_created_directories(paths: &[PathBuf]) {
    for path in paths.iter().rev() {
        let _ = std::fs::remove_dir_all(path);
    }
}

async fn central_skills_root(pool: &DbPool) -> Result<PathBuf, String> {
    let central = db::get_agent_by_id(pool, "central")
        .await?
        .ok_or_else(|| "Central agent not found in database".to_string())?;
    Ok(PathBuf::from(central.global_skills_dir))
}

async fn current_central_skill_ids(pool: &DbPool) -> Result<HashSet<String>, String> {
    let rows = sqlx::query("SELECT id FROM skills WHERE is_central = 1")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|row| row.get::<String, _>("id"))
        .collect::<HashSet<_>>())
}

async fn build_preview_skills(
    pool: &DbPool,
    candidates: &[RemoteSkillCandidate],
) -> Result<Vec<GitHubSkillPreview>, String> {
    let mut skills = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let existing = db::get_skill_by_id(pool, &candidate.skill_id).await?;
        let conflict = existing.and_then(|existing| {
            if existing.is_central {
                Some(GitHubSkillConflict {
                    existing_skill_id: existing.id,
                    existing_name: existing.name,
                    existing_canonical_path: existing.canonical_path,
                    proposed_skill_id: candidate.skill_id.clone(),
                    proposed_name: candidate.skill_name.clone(),
                })
            } else {
                None
            }
        });

        skills.push(GitHubSkillPreview {
            source_path: candidate.source_path.clone(),
            skill_id: candidate.skill_id.clone(),
            skill_name: candidate.skill_name.clone(),
            description: candidate.description.clone(),
            root_directory: candidate.root_directory.clone(),
            skill_directory_name: candidate.skill_directory_name.clone(),
            download_url: candidate.download_url.clone(),
            conflict,
        });
    }
    Ok(skills)
}

pub(crate) async fn resolve_repo_ref(
    repo_url: &str,
    auth_token: Option<&str>,
) -> Result<GitHubRepoRef, String> {
    let (owner, repo) = parse_github_url(repo_url)?;
    let client = github_client()?;
    let response = send_github_request_with_fallback(
        &client,
        GitHubFetchSurface::Api,
        |endpoint| {
            github_endpoint_url(
                endpoint,
                GitHubFetchSurface::Api,
                &format!("/repos/{owner}/{repo}"),
            )
        },
        "Failed to inspect GitHub repository",
        auth_token,
    )
    .await?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("GitHub repository not found.".to_string());
    }
    if !response.status().is_success() {
        let status = response.status();
        return Err(
            classify_github_denial_response(response, "inspecting the repository")
                .await
                .unwrap_or_else(|| format!("Failed to inspect GitHub repository: HTTP {}", status)),
        );
    }

    let payload: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let branch = payload
        .get("default_branch")
        .and_then(|v| v.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("main")
        .to_string();

    Ok(GitHubRepoRef {
        owner: owner.clone(),
        repo: repo.clone(),
        branch,
        normalized_url: format!("https://github.com/{owner}/{repo}"),
    })
}

pub(crate) async fn github_direct_auth_from_settings(
    pool: &DbPool,
) -> Result<Option<String>, String> {
    Ok(db::get_setting(pool, GITHUB_PAT_SETTING_KEY)
        .await?
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty()))
}

fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("skills-manage/0.9.1")
        .build()
        .map_err(|e| e.to_string())
}

fn parse_github_url(url: &str) -> Result<(String, String), String> {
    let trimmed = url.trim();
    let parsed =
        reqwest::Url::parse(trimmed).map_err(|_| "Invalid GitHub repository URL.".to_string())?;

    if parsed.scheme() != "https" {
        return Err("Only https:// GitHub repository URLs are supported.".to_string());
    }
    if parsed.host_str() != Some("github.com") {
        return Err("Only github.com repository URLs are supported.".to_string());
    }

    let mut segments = parsed
        .path_segments()
        .ok_or_else(|| "Invalid GitHub repository URL.".to_string())?;
    let owner = segments
        .next()
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| "GitHub repository URL must include an owner.".to_string())?;
    let repo = segments
        .next()
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| "GitHub repository URL must include a repository name.".to_string())?;

    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    if owner.is_empty() || repo.is_empty() {
        return Err("GitHub repository URL is missing owner or repository.".to_string());
    }

    Ok((owner.to_lowercase(), repo.to_lowercase()))
}

pub(crate) async fn fetch_repo_skill_candidates(
    repo: &GitHubRepoRef,
    auth_token: Option<&str>,
) -> Result<Vec<RemoteSkillCandidate>, String> {
    let client = github_client()?;
    let snapshot = download_repo_snapshot(&client, repo, auth_token).await?;
    build_repo_skill_candidates_from_snapshot(repo, &snapshot)
}

fn build_repo_skill_candidates_from_snapshot(
    repo: &GitHubRepoRef,
    snapshot: &GitHubRepoSnapshot,
) -> Result<Vec<RemoteSkillCandidate>, String> {
    let direct_endpoint = GITHUB_MIRROR_ENDPOINTS.first().expect("github endpoint");
    let mut manifests = snapshot
        .files
        .keys()
        .filter_map(|path| classify_skill_manifest_path(path))
        .collect::<Vec<_>>();
    manifests.sort_by(|left, right| left.source_path.cmp(&right.source_path));

    let mut candidates = Vec::with_capacity(manifests.len());
    for manifest in manifests {
        let raw = snapshot
            .files
            .get(&manifest.skill_md_path)
            .ok_or_else(|| format!("Missing snapshot file '{}'.", manifest.skill_md_path))?;
        let content = String::from_utf8(raw.clone())
            .map_err(|_| format!("Skill '{}' is not valid UTF-8.", manifest.source_path))?;
        let frontmatter = parse_frontmatter(&content).ok_or_else(|| {
            if manifest.source_path == "." {
                "Repository root SKILL.md is missing valid frontmatter.".to_string()
            } else {
                format!(
                    "Skill '{}' is missing valid frontmatter.",
                    manifest.source_path
                )
            }
        })?;

        let skill_id = if manifest.source_path == "." {
            let repo_skill_id = sanitize_skill_id(&repo.repo)?;
            repo_skill_id
                .strip_suffix("-skill")
                .unwrap_or(&repo_skill_id)
                .to_string()
        } else {
            sanitize_skill_id(&manifest.skill_directory_name)?
        };

        candidates.push(RemoteSkillCandidate {
            source_path: manifest.source_path.clone(),
            skill_id,
            skill_name: frontmatter.name,
            description: frontmatter.description,
            root_directory: manifest.root_directory,
            skill_directory_name: if manifest.source_path == "." {
                repo.repo.clone()
            } else {
                manifest.skill_directory_name
            },
            download_url: raw_file_url(direct_endpoint, repo, &manifest.skill_md_path),
        });
    }

    Ok(candidates)
}

#[derive(Debug, Clone)]
struct SnapshotSkillManifest {
    source_path: String,
    root_directory: String,
    skill_directory_name: String,
    skill_md_path: String,
}

fn classify_skill_manifest_path(path: &str) -> Option<SnapshotSkillManifest> {
    let normalized = path.trim_matches('/');
    if normalized.is_empty() {
        return None;
    }

    if normalized.eq_ignore_ascii_case("SKILL.md") {
        return Some(SnapshotSkillManifest {
            source_path: ".".to_string(),
            root_directory: "/".to_string(),
            skill_directory_name: String::new(),
            skill_md_path: "SKILL.md".to_string(),
        });
    }

    let parts = normalized.split('/').collect::<Vec<_>>();
    let (skill_md, source_parts) = parts.split_last()?;
    if !skill_md.eq_ignore_ascii_case("SKILL.md") {
        return None;
    }

    match source_parts {
        [skill_dir] if *skill_dir != ".github" && *skill_dir != "skills" => {
            Some(SnapshotSkillManifest {
                source_path: (*skill_dir).to_string(),
                root_directory: "/".to_string(),
                skill_directory_name: (*skill_dir).to_string(),
                skill_md_path: normalized.to_string(),
            })
        }
        _ if source_parts.first() == Some(&"skills") && source_parts.len() >= 2 => {
            Some(SnapshotSkillManifest {
                source_path: source_parts.join("/"),
                root_directory: source_parts[..source_parts.len() - 1].join("/"),
                skill_directory_name: source_parts.last()?.to_string(),
                skill_md_path: normalized.to_string(),
            })
        }
        _ => None,
    }
}

async fn download_repo_snapshot(
    client: &reqwest::Client,
    repo: &GitHubRepoRef,
    auth_token: Option<&str>,
) -> Result<GitHubRepoSnapshot, String> {
    let archive = download_repository_archive(client, repo, auth_token).await?;
    snapshot_from_repository_archive(&archive)
}

async fn download_repository_archive(
    client: &reqwest::Client,
    repo: &GitHubRepoRef,
    auth_token: Option<&str>,
) -> Result<Vec<u8>, String> {
    let response = send_github_request_with_fallback(
        client,
        GitHubFetchSurface::Api,
        |endpoint| {
            github_endpoint_url(
                endpoint,
                GitHubFetchSurface::Api,
                &format!(
                    "/repos/{}/{}/tarball/{}",
                    repo.owner, repo.repo, repo.branch
                ),
            )
        },
        "Failed to download GitHub repository archive",
        auth_token,
    )
    .await?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("GitHub repository archive is unavailable.".to_string());
    }
    if !response.status().is_success() {
        let status = response.status();
        return Err(classify_github_denial_response(
            response,
            "downloading the repository archive",
        )
        .await
        .unwrap_or_else(|| {
            format!(
                "Failed to download GitHub repository archive: HTTP {}",
                status
            )
        }));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|e| format!("Failed to read GitHub repository archive: {}", e))
}

fn snapshot_from_repository_archive(archive_bytes: &[u8]) -> Result<GitHubRepoSnapshot, String> {
    let cursor = Cursor::new(archive_bytes);
    let decoder = GzDecoder::new(cursor);
    let mut archive = tar::Archive::new(decoder);
    let mut files = HashMap::new();

    for entry_result in archive
        .entries()
        .map_err(|e| format!("Failed to inspect GitHub repository archive: {}", e))?
    {
        let mut entry = entry_result
            .map_err(|e| format!("Failed to inspect GitHub repository archive: {}", e))?;

        if !entry.header().entry_type().is_file() {
            continue;
        }

        let relative_path = relative_archive_path(&entry)?;
        let mut content = Vec::new();
        entry.read_to_end(&mut content).map_err(|e| {
            format!(
                "Failed to read GitHub repository archive entry '{}': {}",
                relative_path, e
            )
        })?;
        files.insert(relative_path, content);
    }

    Ok(GitHubRepoSnapshot { files })
}

fn relative_archive_path<R: Read>(entry: &tar::Entry<'_, R>) -> Result<String, String> {
    let archive_path = entry
        .path()
        .map_err(|e| format!("Failed to inspect GitHub repository archive: {}", e))?;
    let relative = archive_path
        .components()
        .skip(1)
        .map(|component| match component {
            Component::Normal(value) => Ok(value.to_string_lossy().into_owned()),
            _ => Err("GitHub repository archive contains an unsupported path.".to_string()),
        })
        .collect::<Result<Vec<_>, _>>()?;

    if relative.is_empty() {
        return Err("GitHub repository archive contains an unsupported path.".to_string());
    }

    let joined = relative.join("/");
    if !is_safe_repo_relative_path(&joined) {
        return Err(format!(
            "GitHub repository archive contains an unsupported path '{}'.",
            joined
        ));
    }

    Ok(joined)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SnapshotSourceFile {
    repo_path: String,
    relative_path: String,
    byte_len: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct GitHubImportProgressState {
    completed_files: usize,
    total_files: usize,
    completed_bytes: u64,
    total_bytes: u64,
}

fn collect_snapshot_source_files(
    snapshot: &GitHubRepoSnapshot,
    source_path: &str,
) -> Result<Vec<SnapshotSourceFile>, String> {
    let mut files = snapshot
        .files
        .iter()
        .filter_map(|(path, bytes)| {
            let relative_path = if source_path == "." {
                if path.contains('/') {
                    return None;
                }
                path.clone()
            } else {
                let prefix = format!("{}/", source_path.trim_matches('/'));
                let relative = path.strip_prefix(&prefix)?;
                if relative.is_empty() {
                    return None;
                }
                relative.to_string()
            };

            Some(SnapshotSourceFile {
                repo_path: path.clone(),
                relative_path,
                byte_len: bytes.len(),
            })
        })
        .collect::<Vec<_>>();

    files.sort_by(|left, right| left.repo_path.cmp(&right.repo_path));

    if files.is_empty() {
        return Err(format!(
            "Repository path '{}' is no longer available in the archive.",
            source_path
        ));
    }

    Ok(files)
}

fn write_snapshot_source_to_target(
    snapshot: &GitHubRepoSnapshot,
    files: &[SnapshotSourceFile],
    target_dir: &Path,
    source_path: &str,
    progress_state: &mut GitHubImportProgressState,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    std::fs::create_dir_all(target_dir)
        .map_err(|e| format!("Failed to create import target directory: {}", e))?;

    for file in files {
        if !is_safe_repo_relative_path(&file.relative_path) {
            return Err(format!(
                "Repository contains an unsupported path '{}'.",
                file.repo_path
            ));
        }

        let bytes = snapshot.files.get(&file.repo_path).ok_or_else(|| {
            format!(
                "Repository file '{}' is no longer available in the archive.",
                file.repo_path
            )
        })?;

        let destination = target_dir.join(&file.relative_path);
        let parent = destination
            .parent()
            .ok_or_else(|| "Failed to determine imported file parent directory.".to_string())?;
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create imported file parent directory: {}", e))?;
        std::fs::write(&destination, bytes).map_err(|e| {
            format!(
                "Failed to write imported file '{}': {}",
                destination.display(),
                e
            )
        })?;

        progress_state.completed_files += 1;
        progress_state.completed_bytes += file.byte_len as u64;
        emit_github_import_progress(
            app,
            GitHubImportProgressPayload {
                phase: GitHubImportProgressPhase::Writing,
                current_skill: Some(source_path.to_string()),
                current_path: Some(file.relative_path.clone()),
                completed_files: progress_state.completed_files,
                total_files: progress_state.total_files,
                completed_bytes: progress_state.completed_bytes,
                total_bytes: progress_state.total_bytes,
            },
        );
    }

    Ok(())
}

fn emit_github_import_progress(app: Option<&AppHandle>, payload: GitHubImportProgressPayload) {
    if let Some(app) = app {
        let _ = app.emit("github-import:progress", payload);
    }
}

fn is_safe_repo_relative_path(path: &str) -> bool {
    let relative = Path::new(path);
    !relative.is_absolute()
        && relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

async fn fetch_raw_text(
    client: &reqwest::Client,
    url: &str,
    auth_token: Option<&str>,
) -> Result<String, String> {
    let response = send_github_request_with_fallback(
        client,
        GitHubFetchSurface::Raw,
        |endpoint| {
            if let Some(path) = raw_url_to_repo_path(url) {
                raw_file_url(endpoint, &path.repo, &path.file_path)
            } else {
                url.to_string()
            }
        },
        "Failed to download skill metadata",
        auth_token,
    )
    .await?;

    if !response.status().is_success() {
        return Err(
            classify_github_denial_response(response, "downloading skill metadata")
                .await
                .unwrap_or_else(|| "Failed to download skill metadata.".to_string()),
        );
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read skill metadata: {}", e))
}

#[derive(Debug, Clone)]
struct RawRepoPath {
    repo: GitHubRepoRef,
    file_path: String,
}

fn raw_url_to_repo_path(url: &str) -> Option<RawRepoPath> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    if host != "raw.githubusercontent.com" {
        return None;
    }

    let segments = parsed.path_segments()?;
    let parts = segments.collect::<Vec<_>>();
    if parts.len() < 4 {
        return None;
    }

    Some(RawRepoPath {
        repo: GitHubRepoRef {
            owner: parts[0].to_string(),
            repo: parts[1].to_string(),
            branch: parts[2].to_string(),
            normalized_url: format!("https://github.com/{}/{}", parts[0], parts[1]),
        },
        file_path: parts[3..].join("/"),
    })
}

fn github_endpoint_url(
    endpoint: &GitHubMirrorEndpoint,
    surface: GitHubFetchSurface,
    path: &str,
) -> String {
    let base = match surface {
        GitHubFetchSurface::Api => endpoint.api_base,
        GitHubFetchSurface::Raw => endpoint.raw_base,
    };
    format!("{}{}", base.trim_end_matches('/'), path)
}

fn raw_file_url(endpoint: &GitHubMirrorEndpoint, repo: &GitHubRepoRef, file_path: &str) -> String {
    github_endpoint_url(
        endpoint,
        GitHubFetchSurface::Raw,
        &format!(
            "/{}/{}/{}/{}",
            repo.owner,
            repo.repo,
            repo.branch,
            file_path.trim_start_matches('/')
        ),
    )
}

async fn send_github_request_with_fallback<F>(
    client: &reqwest::Client,
    surface: GitHubFetchSurface,
    build_url: F,
    failure_prefix: &str,
    auth_token: Option<&str>,
) -> Result<reqwest::Response, String>
where
    F: Fn(&GitHubMirrorEndpoint) -> String,
{
    let mut attempts = Vec::new();
    let mut last_retryable_denial = None;

    for endpoint in GITHUB_MIRROR_ENDPOINTS {
        let url = build_url(endpoint);
        let mut request = client.get(url);
        if endpoint.label == "github" {
            if let Some(token) = auth_token {
                request = request.bearer_auth(token);
            }
        }
        match request.send().await {
            Ok(response) => {
                let status = response.status();
                if matches!(
                    status,
                    reqwest::StatusCode::UNAUTHORIZED
                        | reqwest::StatusCode::FORBIDDEN
                        | reqwest::StatusCode::TOO_MANY_REQUESTS
                ) {
                    let denial = parse_github_denial_response(response, "contacting GitHub").await;
                    let can_retry_public_mirror = auth_token.is_none()
                        && denial.as_ref().is_some_and(|denial| {
                            matches!(denial.kind, GitHubAccessDenialKind::RateLimited { .. })
                        });
                    if can_retry_public_mirror {
                        last_retryable_denial = denial;
                        attempts.push(MirrorAttemptOutcome {
                            status: Some(status),
                            error_message: format!(
                                "{} mirror '{}' returned HTTP {} due to rate limiting",
                                surface_label(surface),
                                endpoint.label,
                                status
                            ),
                        });
                        continue;
                    }

                    return Err(denial
                        .map(|denial| denial.to_string())
                        .unwrap_or_else(|| format!("{}: HTTP {}", failure_prefix, status)));
                }

                if status.is_success() {
                    return Ok(response);
                }

                if status == reqwest::StatusCode::NOT_FOUND {
                    if last_retryable_denial.is_some() && auth_token.is_none() {
                        attempts.push(MirrorAttemptOutcome {
                            status: Some(status),
                            error_message: format!(
                                "{} mirror '{}' returned HTTP 404 after a prior rate-limit denial",
                                surface_label(surface),
                                endpoint.label
                            ),
                        });
                        continue;
                    }
                    return Ok(response);
                }

                if should_retry_via_mirror_status(surface, status) {
                    attempts.push(MirrorAttemptOutcome {
                        status: Some(status),
                        error_message: format!(
                            "{} mirror '{}' returned HTTP {}",
                            surface_label(surface),
                            endpoint.label,
                            status
                        ),
                    });
                    continue;
                }

                return Err(format!("{}: HTTP {}", failure_prefix, status));
            }
            Err(error) => {
                if is_retryable_github_transport_error(&error) {
                    attempts.push(MirrorAttemptOutcome {
                        status: error.status(),
                        error_message: format!(
                            "{} mirror '{}' failed: {}",
                            surface_label(surface),
                            endpoint.label,
                            error
                        ),
                    });
                    continue;
                }

                return Err(format!("{}: {}", failure_prefix, error));
            }
        }
    }

    if let Some(denial) = last_retryable_denial {
        return Err(denial.to_string());
    }

    Err(format!(
        "{}. Direct GitHub access and built-in mirrors were unreachable. Retry later or try a different network path. Last errors: {}",
        failure_prefix,
        summarize_mirror_attempts(&attempts)
    ))
}

fn should_retry_via_mirror_status(
    surface: GitHubFetchSurface,
    status: reqwest::StatusCode,
) -> bool {
    match surface {
        GitHubFetchSurface::Api | GitHubFetchSurface::Raw => {
            status.is_server_error()
                || status == reqwest::StatusCode::BAD_GATEWAY
                || status == reqwest::StatusCode::SERVICE_UNAVAILABLE
                || status == reqwest::StatusCode::GATEWAY_TIMEOUT
        }
    }
}

fn is_retryable_github_transport_error(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect() || error.is_request() || error.is_body()
}

fn summarize_mirror_attempts(attempts: &[MirrorAttemptOutcome]) -> String {
    attempts
        .iter()
        .map(|attempt| attempt.error_message.clone())
        .collect::<Vec<_>>()
        .join("; ")
}

fn surface_label(surface: GitHubFetchSurface) -> &'static str {
    match surface {
        GitHubFetchSurface::Api => "API",
        GitHubFetchSurface::Raw => "raw",
    }
}

async fn classify_github_denial_response(
    response: reqwest::Response,
    operation: &'static str,
) -> Option<String> {
    parse_github_denial_response(response, operation)
        .await
        .map(|denial| denial.to_string())
}

async fn parse_github_denial_response(
    response: reqwest::Response,
    operation: &'static str,
) -> Option<GitHubAccessDenial> {
    let status = response.status();
    if status != reqwest::StatusCode::UNAUTHORIZED
        && status != reqwest::StatusCode::FORBIDDEN
        && status != reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return None;
    }

    let headers = response.headers().clone();
    let body = response.text().await.ok();
    let github_message = body.as_deref().and_then(parse_github_error_message);

    let remaining = header_value(&headers, "x-ratelimit-remaining");
    let reset_at = header_value(&headers, "x-ratelimit-reset")
        .as_deref()
        .and_then(parse_rate_limit_reset_epoch);

    let message_lower = github_message
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let remaining_is_zero = remaining.as_deref() == Some("0");
    let kind = if status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || remaining_is_zero
        || message_lower.contains("rate limit")
        || message_lower.contains("api rate limit exceeded")
        || header_value(&headers, "x-ratelimit-resource").is_some()
    {
        GitHubAccessDenialKind::RateLimited {
            reset_at,
            remaining,
        }
    } else {
        GitHubAccessDenialKind::AuthenticationOrPermission
    };

    Some(GitHubAccessDenial {
        kind,
        operation,
        status,
        github_message,
    })
}

fn parse_github_error_message(body: &str) -> Option<String> {
    serde_json::from_str::<GitHubErrorResponse>(body)
        .ok()
        .and_then(|payload| payload.message)
}

fn header_value(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_rate_limit_reset_epoch(raw: &str) -> Option<String> {
    let epoch = raw.parse::<i64>().ok()?;
    chrono::DateTime::<Utc>::from_timestamp(epoch, 0)
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

pub(crate) fn parse_frontmatter(content: &str) -> Option<SkillFrontmatter> {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return None;
    }
    let rest = &trimmed[3..];
    let end = rest.find("---")?;
    serde_yaml::from_str::<SkillFrontmatter>(&rest[..end]).ok()
}

fn sanitize_skill_id(raw: &str) -> Result<String, String> {
    let lowered = raw.trim().to_lowercase();
    let mut sanitized = String::new();
    let mut last_was_dash = false;
    for ch in lowered.chars() {
        if ch.is_ascii_alphanumeric() {
            sanitized.push(ch);
            last_was_dash = false;
        } else if !last_was_dash {
            sanitized.push('-');
            last_was_dash = true;
        }
    }
    let sanitized = sanitized.trim_matches('-').to_string();
    if sanitized.is_empty() {
        return Err(format!("Skill identifier '{}' is not supported.", raw));
    }
    Ok(sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::collections::HashMap;
    use tempfile::tempdir;

    async fn setup_test_db() -> DbPool {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("github-import.sqlite");
        let pool = db::create_pool(db_path.to_str().unwrap())
            .await
            .expect("create db");
        db::init_database(&pool).await.expect("init db");
        std::mem::forget(dir);
        pool
    }

    fn sample_frontmatter(name: &str, description: &str) -> String {
        format!("---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n")
    }

    fn repo_snapshot(files: &[(&str, String)]) -> GitHubRepoSnapshot {
        GitHubRepoSnapshot {
            files: files
                .iter()
                .map(|(path, content)| (path.to_string(), content.as_bytes().to_vec()))
                .collect::<HashMap<_, _>>(),
        }
    }

    fn root_repo_snapshot() -> GitHubRepoSnapshot {
        repo_snapshot(&[
            (
                "SKILL.md",
                sample_frontmatter("twitterapi-io", "root skill"),
            ),
            ("README.md", "# repo\n".to_string()),
        ])
    }

    fn multi_skill_snapshot() -> GitHubRepoSnapshot {
        repo_snapshot(&[
            (
                "skills/agent-planner/SKILL.md",
                sample_frontmatter("Agent Planner", "Agent Planner description"),
            ),
            (
                "skills/commit/SKILL.md",
                sample_frontmatter("Commit", "Commit description"),
            ),
            (
                "skills/code-review/SKILL.md",
                sample_frontmatter("Code Review", "Code Review description"),
            ),
            ("skills/commit/README.md", "# commit\n".to_string()),
        ])
    }

    fn namespaced_skill_snapshot() -> GitHubRepoSnapshot {
        repo_snapshot(&[
            (
                "skills/.curated/openai-docs/SKILL.md",
                sample_frontmatter("openai-docs", "OpenAI docs skill"),
            ),
            (
                "skills/.curated/openai-docs/references/api.md",
                "# api\n".to_string(),
            ),
            (
                "skills/.system/skill-creator/SKILL.md",
                sample_frontmatter("skill-creator", "Create skills"),
            ),
            (
                "skills/.system/skill-creator/scripts/init_skill.py",
                "print('hi')\n".to_string(),
            ),
        ])
    }

    fn repository_archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        let encoder = GzEncoder::new(Vec::new(), Compression::default());
        let mut builder = tar::Builder::new(encoder);
        for (path, content) in files {
            let archive_path = format!("repo-snapshot/{}", path);
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_entry_type(tar::EntryType::Regular);
            header.set_cksum();
            builder
                .append_data(&mut header, archive_path, *content)
                .expect("append archive entry");
        }
        let encoder = builder.into_inner().expect("finalize tar");
        encoder.finish().expect("finalize gzip")
    }

    #[test]
    fn parse_github_url_normalizes_owner_and_repo() {
        let (owner, repo) =
            parse_github_url("https://github.com/Anthropics/Skills/").expect("parse");
        assert_eq!(owner, "anthropics");
        assert_eq!(repo, "skills");
    }

    #[test]
    fn parse_github_url_rejects_non_github_hosts() {
        let error = parse_github_url("https://gitlab.com/example/repo").unwrap_err();
        assert!(error.contains("github.com"));
    }

    #[test]
    fn sanitize_skill_id_collapses_symbols() {
        let skill_id = sanitize_skill_id("My Cool_Skill!").expect("sanitize");
        assert_eq!(skill_id, "my-cool-skill");
    }

    #[test]
    fn parse_frontmatter_requires_yaml_block() {
        assert!(parse_frontmatter("# nope").is_none());
        let parsed = parse_frontmatter(&sample_frontmatter("alpha", "desc")).expect("fm");
        assert_eq!(parsed.name, "alpha");
        assert_eq!(parsed.description.as_deref(), Some("desc"));
    }

    #[test]
    fn classify_github_rate_limit_denial_returns_actionable_message() {
        let denial = GitHubAccessDenial {
            kind: GitHubAccessDenialKind::RateLimited {
                reset_at: Some("2026-04-17 12:34:56".to_string()),
                remaining: Some("0".to_string()),
            },
            operation: "inspecting the repository",
            status: reqwest::StatusCode::FORBIDDEN,
            github_message: Some("API rate limit exceeded for 1.2.3.4.".to_string()),
        };

        let message = denial.to_string();

        assert!(message.contains("rate limit was exceeded"));
        assert!(message.contains("Retry later after 2026-04-17 12:34:56 UTC"));
        assert!(message.contains("authenticated GitHub requests"));
        assert!(message.contains("API rate limit exceeded"));
    }

    #[test]
    fn classify_github_permission_denial_returns_actionable_message() {
        let denial = GitHubAccessDenial {
            kind: GitHubAccessDenialKind::AuthenticationOrPermission,
            operation: "reading repository contents",
            status: reqwest::StatusCode::UNAUTHORIZED,
            github_message: Some("Requires authentication".to_string()),
        };

        let message = denial.to_string();

        assert!(message.contains("denied access"));
        assert!(message.contains("require authentication"));
        assert!(message.contains("token/permissions are insufficient"));
        assert!(message.contains("Requires authentication"));
    }

    #[test]
    fn raw_url_to_repo_path_parses_github_raw_urls() {
        let parsed = raw_url_to_repo_path(
            "https://raw.githubusercontent.com/owner/repo/main/skills/demo/SKILL.md",
        )
        .expect("parsed");

        assert_eq!(parsed.repo.owner, "owner");
        assert_eq!(parsed.repo.repo, "repo");
        assert_eq!(parsed.repo.branch, "main");
        assert_eq!(parsed.file_path, "skills/demo/SKILL.md");
    }

    #[test]
    fn raw_url_to_repo_path_ignores_non_github_raw_hosts() {
        assert!(raw_url_to_repo_path("https://example.com/file.txt").is_none());
    }

    #[test]
    fn mirror_status_retry_excludes_auth_denials() {
        assert!(should_retry_via_mirror_status(
            GitHubFetchSurface::Api,
            reqwest::StatusCode::BAD_GATEWAY
        ));
        assert!(!should_retry_via_mirror_status(
            GitHubFetchSurface::Api,
            reqwest::StatusCode::FORBIDDEN
        ));
        assert!(!should_retry_via_mirror_status(
            GitHubFetchSurface::Raw,
            reqwest::StatusCode::TOO_MANY_REQUESTS
        ));
    }

    #[test]
    fn summarize_mirror_attempts_reports_all_failures() {
        let message = summarize_mirror_attempts(&[
            MirrorAttemptOutcome {
                status: None,
                error_message: "API mirror 'github' failed: timeout".to_string(),
            },
            MirrorAttemptOutcome {
                status: Some(reqwest::StatusCode::BAD_GATEWAY),
                error_message: "API mirror 'ghfast' returned HTTP 502".to_string(),
            },
        ]);

        assert!(message.contains("timeout"));
        assert!(message.contains("HTTP 502"));
    }

    #[test]
    fn snapshot_from_repository_archive_strips_archive_root_directory() {
        let archive = repository_archive(&[
            (
                "skills/demo/SKILL.md",
                sample_frontmatter("Demo", "Archive demo").as_bytes(),
            ),
            ("README.md", b"# readme\n"),
        ]);

        let snapshot = snapshot_from_repository_archive(&archive).expect("snapshot");

        assert!(snapshot.files.contains_key("skills/demo/SKILL.md"));
        assert!(snapshot.files.contains_key("README.md"));
    }

    #[tokio::test]
    async fn preview_marks_canonical_conflicts_without_writing() {
        let pool = setup_test_db().await;
        let central_root = tempdir().expect("central");
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'central'")
            .bind(central_root.path().to_string_lossy().into_owned())
            .execute(&pool)
            .await
            .expect("update central");

        let existing_dir = central_root.path().join("twitterapi-io");
        std::fs::create_dir_all(&existing_dir).expect("mkdir");
        std::fs::write(
            existing_dir.join("SKILL.md"),
            sample_frontmatter("twitterapi-io", "existing"),
        )
        .expect("write skill");

        db::upsert_skill(
            &pool,
            &Skill {
                id: "twitterapi-io".to_string(),
                name: "twitterapi-io".to_string(),
                description: Some("existing".to_string()),
                file_path: existing_dir.join("SKILL.md").to_string_lossy().into_owned(),
                canonical_path: Some(existing_dir.to_string_lossy().into_owned()),
                is_central: true,
                source: Some("local".to_string()),
                content: None,
                scanned_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .expect("upsert skill");

        let repo = GitHubRepoRef {
            owner: "dorukardahan".to_string(),
            repo: "twitterapi-io-skill".to_string(),
            branch: "main".to_string(),
            normalized_url: "https://github.com/dorukardahan/twitterapi-io-skill".to_string(),
        };
        let candidates = build_repo_skill_candidates_from_snapshot(&repo, &root_repo_snapshot())
            .expect("candidates");
        let preview = GitHubRepoPreview {
            repo,
            skills: build_preview_skills(&pool, &candidates)
                .await
                .expect("preview skills"),
        };

        assert!(!preview.skills.is_empty());
        let conflict = preview
            .skills
            .iter()
            .find(|skill| skill.skill_id == "twitterapi-io")
            .and_then(|skill| skill.conflict.clone())
            .expect("conflict");
        assert_eq!(conflict.existing_skill_id, "twitterapi-io");

        let central_entries = std::fs::read_dir(central_root.path())
            .expect("read dir")
            .count();
        assert_eq!(central_entries, 1, "preview should not write to central");
    }

    #[tokio::test]
    async fn import_repo_skills_honors_skip_rename_and_overwrite() {
        let pool = setup_test_db().await;
        let snapshot = multi_skill_snapshot();
        let repo = GitHubRepoRef {
            owner: "anthropics".to_string(),
            repo: "skills".to_string(),
            branch: "main".to_string(),
            normalized_url: "https://github.com/anthropics/skills".to_string(),
        };

        let candidates =
            build_repo_skill_candidates_from_snapshot(&repo, &snapshot).expect("candidates");

        let agent_planner = candidates
            .iter()
            .find(|candidate| candidate.source_path == "skills/agent-planner")
            .expect("agent planner");
        let commit = candidates
            .iter()
            .find(|candidate| candidate.source_path == "skills/commit")
            .expect("commit");
        let code_review = candidates
            .iter()
            .find(|candidate| candidate.source_path == "skills/code-review")
            .expect("code review");

        db::upsert_skill(
            &pool,
            &Skill {
                id: agent_planner.skill_id.clone(),
                name: "Agent Planner".to_string(),
                description: Some("existing".to_string()),
                file_path: "/tmp/agent-planner/SKILL.md".to_string(),
                canonical_path: Some("/tmp/agent-planner".to_string()),
                is_central: true,
                source: Some("local".to_string()),
                content: None,
                scanned_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .expect("seed rename conflict");
        db::upsert_skill(
            &pool,
            &Skill {
                id: commit.skill_id.clone(),
                name: "Commit".to_string(),
                description: Some("existing".to_string()),
                file_path: "/tmp/commit/SKILL.md".to_string(),
                canonical_path: Some("/tmp/commit".to_string()),
                is_central: true,
                source: Some("local".to_string()),
                content: None,
                scanned_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .expect("seed skip conflict");
        db::upsert_skill(
            &pool,
            &Skill {
                id: code_review.skill_id.clone(),
                name: "Code Review".to_string(),
                description: Some("existing".to_string()),
                file_path: "/tmp/code-review/SKILL.md".to_string(),
                canonical_path: Some("/tmp/code-review".to_string()),
                is_central: true,
                source: Some("local".to_string()),
                content: None,
                scanned_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .expect("seed overwrite conflict");

        let mut occupied = current_central_skill_ids(&pool).await.expect("occupied");
        assert!(occupied.contains(&agent_planner.skill_id));
        assert!(occupied.contains(&commit.skill_id));
        assert!(occupied.contains(&code_review.skill_id));

        let rename_target = sanitize_skill_id("agent-planner-imported").expect("rename target");
        assert!(
            !occupied.contains(&rename_target),
            "rename target should be available before import"
        );
        occupied.insert(rename_target.clone());

        assert!(
            occupied.contains(&rename_target),
            "rename should reserve the requested canonical id"
        );
        assert!(
            occupied.contains(&code_review.skill_id),
            "overwrite keeps the original canonical id occupied"
        );
        assert!(
            occupied.contains(&commit.skill_id),
            "skip leaves the existing canonical id occupied without needing a new id"
        );
    }

    #[tokio::test]
    async fn import_invalid_repo_leaves_central_storage_unchanged() {
        let pool = setup_test_db().await;
        let central_root = tempdir().expect("central");
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'central'")
            .bind(central_root.path().to_string_lossy().into_owned())
            .execute(&pool)
            .await
            .expect("update central");

        let result = import_github_repo_skills_impl(
            &pool,
            "https://github.com/example/definitely-missing-repo",
            vec![GitHubSkillImportSelection {
                source_path: "skills/foo".to_string(),
                resolution: DuplicateResolution::Skip,
                renamed_skill_id: None,
            }],
            None,
        )
        .await;

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_dir(central_root.path())
                .expect("read central")
                .count(),
            0
        );
        let central_skills = db::get_central_skills(&pool).await.expect("central skills");
        assert!(central_skills.is_empty());
    }

    #[tokio::test]
    async fn denied_import_selection_performs_no_writes_or_db_mutations() {
        let pool = setup_test_db().await;
        let central_root = tempdir().expect("central");
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'central'")
            .bind(central_root.path().to_string_lossy().into_owned())
            .execute(&pool)
            .await
            .expect("update central");

        let before_skills = db::get_central_skills(&pool).await.expect("before skills");
        let before_entries = std::fs::read_dir(central_root.path())
            .expect("read central before")
            .count();

        let result = import_github_repo_skills_impl(
            &pool,
            "https://github.com/example/restricted-repo",
            vec![GitHubSkillImportSelection {
                source_path: "skills/private-skill".to_string(),
                resolution: DuplicateResolution::Overwrite,
                renamed_skill_id: None,
            }],
            None,
        )
        .await;

        let error = result.expect_err("denied import should fail");
        assert!(
            !error.trim().is_empty(),
            "failure should return an error message"
        );

        let after_skills = db::get_central_skills(&pool).await.expect("after skills");
        let after_entries = std::fs::read_dir(central_root.path())
            .expect("read central after")
            .count();
        assert_eq!(
            before_entries, after_entries,
            "denied import should not write files"
        );
        assert_eq!(
            before_skills.len(),
            after_skills.len(),
            "denied import should not mutate DB"
        );
    }

    #[tokio::test]
    async fn preview_top_level_skills_directory_discovers_candidates() {
        let pool = setup_test_db().await;
        let repo = GitHubRepoRef {
            owner: "anthropics".to_string(),
            repo: "skills".to_string(),
            branch: "main".to_string(),
            normalized_url: "https://github.com/anthropics/skills".to_string(),
        };
        let candidates = build_repo_skill_candidates_from_snapshot(&repo, &multi_skill_snapshot())
            .expect("candidates");
        let preview = GitHubRepoPreview {
            repo,
            skills: build_preview_skills(&pool, &candidates)
                .await
                .expect("skills"),
        };

        assert!(preview
            .skills
            .iter()
            .any(|skill| skill.source_path.starts_with("skills/")));
    }

    #[tokio::test]
    async fn preview_namespaced_skills_directory_discovers_candidates() {
        let pool = setup_test_db().await;
        let repo = GitHubRepoRef {
            owner: "openai".to_string(),
            repo: "skills".to_string(),
            branch: "main".to_string(),
            normalized_url: "https://github.com/openai/skills".to_string(),
        };

        let candidates =
            build_repo_skill_candidates_from_snapshot(&repo, &namespaced_skill_snapshot())
                .expect("candidates");

        assert_eq!(
            candidates.len(),
            2,
            "expected two namespaced skill candidates"
        );

        let curated = candidates
            .iter()
            .find(|candidate| candidate.source_path == "skills/.curated/openai-docs")
            .expect("curated skill");
        assert_eq!(curated.root_directory, "skills/.curated");
        assert_eq!(curated.skill_directory_name, "openai-docs");
        assert_eq!(curated.skill_id, "openai-docs");

        let system = candidates
            .iter()
            .find(|candidate| candidate.source_path == "skills/.system/skill-creator")
            .expect("system skill");
        assert_eq!(system.root_directory, "skills/.system");
        assert_eq!(system.skill_directory_name, "skill-creator");
        assert_eq!(system.skill_id, "skill-creator");

        let preview = GitHubRepoPreview {
            repo,
            skills: build_preview_skills(&pool, &candidates)
                .await
                .expect("preview skills"),
        };

        assert!(preview
            .skills
            .iter()
            .any(|skill| skill.source_path == "skills/.curated/openai-docs"));
        assert!(preview
            .skills
            .iter()
            .any(|skill| skill.source_path == "skills/.system/skill-creator"));
    }

    #[tokio::test]
    async fn github_pat_setting_is_trimmed_and_empty_values_are_ignored() {
        let pool = setup_test_db().await;

        db::set_setting(&pool, GITHUB_PAT_SETTING_KEY, "  test-token  ")
            .await
            .expect("set token");
        assert_eq!(
            github_direct_auth_from_settings(&pool)
                .await
                .expect("read token"),
            Some("test-token".to_string())
        );

        db::set_setting(&pool, GITHUB_PAT_SETTING_KEY, "   ")
            .await
            .expect("clear token");
        assert_eq!(
            github_direct_auth_from_settings(&pool)
                .await
                .expect("read empty"),
            None
        );
    }

    #[tokio::test]
    async fn authenticated_api_fallback_does_not_forward_bearer_auth_to_mirror() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        };

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        let requests = Arc::new(Mutex::new(Vec::<String>::new()));
        let accepted = Arc::new(AtomicUsize::new(0));
        let requests_clone = Arc::clone(&requests);
        let accepted_clone = Arc::clone(&accepted);

        let server = std::thread::spawn(move || {
            while accepted_clone.load(Ordering::SeqCst) < 2 {
                let (mut stream, _) = listener.accept().expect("accept");
                let mut buffer = [0_u8; 2048];
                let bytes_read = stream.read(&mut buffer).expect("read");
                let request_text = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                requests_clone
                    .lock()
                    .expect("lock")
                    .push(request_text.clone());
                accepted_clone.fetch_add(1, Ordering::SeqCst);

                if request_text.contains("GET /direct") {
                    let response =
                        "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 11\r\n\r\nbad gateway";
                    stream.write_all(response.as_bytes()).expect("write direct");
                } else {
                    let response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok";
                    stream.write_all(response.as_bytes()).expect("write mirror");
                }
            }
        });

        let client = github_client().expect("client");
        let direct_url = format!("http://{}/direct", address);
        let mirror_url = format!("http://{}/mirror", address);

        let response = send_github_request_with_fallback(
            &client,
            GitHubFetchSurface::Api,
            |endpoint| {
                if endpoint.label == "github" {
                    direct_url.clone()
                } else {
                    mirror_url.clone()
                }
            },
            "direct request failed",
            Some("direct-token"),
        )
        .await
        .expect("fallback response");
        assert!(response.status().is_success());

        server.join().expect("server join");
        let captured = requests.lock().expect("captured");
        let direct_request = captured
            .iter()
            .find(|request| request.contains("GET /direct"))
            .expect("captured direct request");
        let mirror_request = captured
            .iter()
            .find(|request| request.contains("GET /mirror"))
            .expect("captured mirror request");
        assert!(
            direct_request.contains("authorization: Bearer direct-token")
                || direct_request.contains("Authorization: Bearer direct-token"),
            "direct github request should include bearer auth"
        );
        assert!(
            !mirror_request.contains("authorization: Bearer direct-token")
                && !mirror_request.contains("Authorization: Bearer direct-token"),
            "mirror request should not include bearer auth"
        );
    }

    #[tokio::test]
    async fn authenticated_raw_fallback_does_not_forward_bearer_auth_to_mirror() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        };

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        let requests = Arc::new(Mutex::new(Vec::<String>::new()));
        let accepted = Arc::new(AtomicUsize::new(0));
        let requests_clone = Arc::clone(&requests);
        let accepted_clone = Arc::clone(&accepted);

        let server = std::thread::spawn(move || {
            while accepted_clone.load(Ordering::SeqCst) < 2 {
                let (mut stream, _) = listener.accept().expect("accept");
                let mut buffer = [0_u8; 2048];
                let bytes_read = stream.read(&mut buffer).expect("read");
                let request_text = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                requests_clone
                    .lock()
                    .expect("lock")
                    .push(request_text.clone());
                accepted_clone.fetch_add(1, Ordering::SeqCst);

                if request_text.contains("GET /raw-direct") {
                    let response = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 19\r\n\r\nservice unavailable";
                    stream.write_all(response.as_bytes()).expect("write direct");
                } else {
                    let response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok";
                    stream.write_all(response.as_bytes()).expect("write mirror");
                }
            }
        });

        let client = github_client().expect("client");
        let direct_url = format!("http://{}/raw-direct", address);
        let mirror_url = format!("http://{}/raw-mirror", address);

        let response = send_github_request_with_fallback(
            &client,
            GitHubFetchSurface::Raw,
            |endpoint| {
                if endpoint.label == "github" {
                    direct_url.clone()
                } else {
                    mirror_url.clone()
                }
            },
            "raw request failed",
            Some("direct-token"),
        )
        .await
        .expect("fallback response");
        assert!(response.status().is_success());

        server.join().expect("server join");
        let captured = requests.lock().expect("captured");
        let direct_request = captured
            .iter()
            .find(|request| request.contains("GET /raw-direct"))
            .expect("captured direct request");
        let mirror_request = captured
            .iter()
            .find(|request| request.contains("GET /raw-mirror"))
            .expect("captured mirror request");
        assert!(
            direct_request.contains("authorization: Bearer direct-token")
                || direct_request.contains("Authorization: Bearer direct-token"),
            "direct raw request should include bearer auth"
        );
        assert!(
            !mirror_request.contains("authorization: Bearer direct-token")
                && !mirror_request.contains("Authorization: Bearer direct-token"),
            "mirror raw request should not include bearer auth"
        );
    }

    #[tokio::test]
    async fn unauthenticated_rate_limit_retries_public_mirror_before_failing() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        };

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        let requests = Arc::new(Mutex::new(Vec::<String>::new()));
        let accepted = Arc::new(AtomicUsize::new(0));
        let requests_clone = Arc::clone(&requests);
        let accepted_clone = Arc::clone(&accepted);

        let server = std::thread::spawn(move || {
            while accepted_clone.load(Ordering::SeqCst) < 2 {
                let (mut stream, _) = listener.accept().expect("accept");
                let mut buffer = [0_u8; 2048];
                let bytes_read = stream.read(&mut buffer).expect("read");
                let request_text = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                let is_direct = request_text.contains("GET /direct");
                requests_clone.lock().expect("lock").push(request_text);
                accepted_clone.fetch_add(1, Ordering::SeqCst);

                if is_direct {
                    let response = concat!(
                        "HTTP/1.1 403 Forbidden\r\n",
                        "Content-Type: application/json\r\n",
                        "X-RateLimit-Remaining: 0\r\n",
                        "X-RateLimit-Reset: 1786576453\r\n",
                        "Content-Length: 48\r\n\r\n",
                        "{\"message\":\"API rate limit exceeded for 1.2.3.4\"}"
                    );
                    stream.write_all(response.as_bytes()).expect("write direct");
                } else {
                    let response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok";
                    stream.write_all(response.as_bytes()).expect("write mirror");
                }
            }
        });

        let client = github_client().expect("client");
        let direct_url = format!("http://{}/direct", address);
        let mirror_url = format!("http://{}/mirror", address);

        let response = send_github_request_with_fallback(
            &client,
            GitHubFetchSurface::Api,
            |endpoint| {
                if endpoint.label == "github" {
                    direct_url.clone()
                } else {
                    mirror_url.clone()
                }
            },
            "request failed",
            None,
        )
        .await
        .expect("mirror retry response");
        assert!(response.status().is_success());

        server.join().expect("server join");
        let captured = requests.lock().expect("captured");
        assert!(captured
            .iter()
            .any(|request| request.contains("GET /direct")));
        assert!(captured
            .iter()
            .any(|request| request.contains("GET /mirror")));
    }
}
