use std::process::Command;

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Write content to a skill file (SKILL.md).
#[tauri::command]
pub async fn write_skill_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write '{}': {}", path, e))
}

/// Run `git pull` in the given repository directory.
/// Returns the combined stdout/stderr output.
#[tauri::command]
pub async fn git_pull(repo_path: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", &repo_path, "pull"])
        .output()
        .map_err(|e| format!("Failed to execute git pull: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let combined = [stdout, stderr]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Ok(if combined.is_empty() {
            "Pull completed with no output.".to_string()
        } else {
            combined
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("git pull failed (exit code: {:?})", output.status.code())
        } else {
            stderr
        })
    }
}

/// Stage the given file, commit with the given message, and push to remote.
///
/// Steps:
/// 1. `git add <file_path>` (relative or absolute within the repo)
/// 2. `git commit -m <message>`
/// 3. `git push`
#[tauri::command]
pub async fn git_commit_and_push(
    repo_path: String,
    file_path: String,
    message: String,
) -> Result<String, String> {
    // git add
    let add_output = Command::new("git")
        .args(["-C", &repo_path, "add", &file_path])
        .output()
        .map_err(|e| format!("Failed to execute git add: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr).trim().to_string();
        return Err(format!("git add failed: {}", stderr));
    }

    // git commit
    let commit_output = Command::new("git")
        .args(["-C", &repo_path, "commit", "-m", &message])
        .output()
        .map_err(|e| format!("Failed to execute git commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr).trim().to_string();
        // If there's nothing to commit, that's not a hard error — proceed to push anyway.
        if !stderr.contains("nothing to commit") && !stderr.contains("no changes added") {
            return Err(format!("git commit failed: {}", stderr));
        }
    }

    // git push
    let push_output = Command::new("git")
        .args(["-C", &repo_path, "push"])
        .output()
        .map_err(|e| format!("Failed to execute git push: {}", e))?;

    if push_output.status.success() {
        let stdout = String::from_utf8_lossy(&push_output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&push_output.stderr).trim().to_string();
        let combined = [stdout, stderr]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Ok(if combined.is_empty() {
            "Changes committed and pushed successfully.".to_string()
        } else {
            combined
        })
    } else {
        let stderr = String::from_utf8_lossy(&push_output.stderr).trim().to_string();
        Err(format!("git push failed: {}", stderr))
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Helper: initialise a bare "remote" repo and a clone that acts as the
    /// "local" repo, so we can test push/pull round-trips without needing a
    /// network.  Returns (local_dir, remote_dir).
    fn setup_git_repos() -> (TempDir, TempDir) {
        let remote = TempDir::new().unwrap();
        let local = TempDir::new().unwrap();

        // Init bare remote
        Command::new("git")
            .args(["init", "--bare", remote.path().to_str().unwrap()])
            .output()
            .unwrap();

        // Clone into local
        Command::new("git")
            .args(["clone", remote.path().to_str().unwrap(), local.path().to_str().unwrap()])
            .output()
            .unwrap();

        // Configure user for local repo
        Command::new("git")
            .args(["-C", local.path().to_str().unwrap(), "config", "user.email", "test@test.com"])
            .output()
            .unwrap();
        Command::new("git")
            .args(["-C", local.path().to_str().unwrap(), "config", "user.name", "Test User"])
            .output()
            .unwrap();

        // Create initial commit so push has something to work with
        let readme = local.path().join("README.md");
        fs::write(&readme, "# Skills").unwrap();
        Command::new("git")
            .args(["-C", local.path().to_str().unwrap(), "add", "README.md"])
            .output()
            .unwrap();
        Command::new("git")
            .args(["-C", local.path().to_str().unwrap(), "commit", "-m", "Initial commit"])
            .output()
            .unwrap();
        Command::new("git")
            .args(["-C", local.path().to_str().unwrap(), "push"])
            .output()
            .unwrap();

        (local, remote)
    }

    #[tokio::test]
    async fn test_write_skill_file_creates_file() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("SKILL.md");
        let content = "---\nname: test\n---\n\n# Test";

        let result = write_skill_file(
            file_path.to_string_lossy().into_owned(),
            content.to_string(),
        )
        .await;
        assert!(result.is_ok());
        let written = fs::read_to_string(&file_path).unwrap();
        assert_eq!(written, content);
    }

    #[tokio::test]
    async fn test_write_skill_file_invalid_path_fails() {
        let result = write_skill_file(
            "/nonexistent/deeply/nested/SKILL.md".to_string(),
            "content".to_string(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_git_commit_and_push_roundtrip_async() {
        let (local, _remote) = setup_git_repos();
        let local_path = local.path().to_string_lossy().into_owned();
        let file_path = local.path().join("test-skill/SKILL.md");
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        fs::write(&file_path, "---\nname: test\n---\n\nContent").unwrap();

        let result = git_commit_and_push(
            local_path.clone(),
            file_path.to_string_lossy().into_owned(),
            "Add test skill".to_string(),
        )
        .await;
        assert!(result.is_ok(), "commit and push should succeed: {:?}", result.err());
        let msg = result.unwrap();
        assert!(!msg.is_empty(), "should have output");
    }

    #[tokio::test]
    async fn test_git_commit_and_push_no_changes() {
        let (local, _remote) = setup_git_repos();
        let local_path = local.path().to_string_lossy().into_owned();

        // Commit+push without any changes — should still succeed (nothing to commit is not an error).
        let result = git_commit_and_push(
            local_path.clone(),
            local.path().join("README.md").to_string_lossy().into_owned(),
            "No-op commit".to_string(),
        )
        .await;
        assert!(result.is_ok(), "no-op commit+push should succeed: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_git_pull_success() {
        let (local, _remote) = setup_git_repos();
        let local_path = local.path().to_string_lossy().into_owned();

        let result = git_pull(local_path).await;
        assert!(
            result.is_ok(),
            "git pull in a fresh clone should succeed: {:?}",
            result.err()
        );
        let output = result.unwrap();
        assert!(
            output.contains("Already up to date") || output.contains("already up-to-date"),
            "Expected 'Already up to date' in output, got: {}",
            output
        );
    }

    #[tokio::test]
    async fn test_git_pull_invalid_dir_fails() {
        let result = git_pull("/nonexistent/path".to_string()).await;
        assert!(result.is_err());
    }
}
