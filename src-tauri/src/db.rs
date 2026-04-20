use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    FromRow, Row, SqlitePool,
};
use std::str::FromStr;
use uuid::Uuid;

pub type DbPool = SqlitePool;

// ─── Data Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub canonical_path: Option<String>,
    pub is_central: bool,
    pub source: Option<String>,
    pub content: Option<String>,
    pub scanned_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SkillInstallation {
    pub skill_id: String,
    pub agent_id: String,
    pub installed_path: String,
    pub link_type: String,
    pub symlink_target: Option<String>,
    /// ISO 8601 timestamp of when the skill was first installed.
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Agent {
    pub id: String,
    pub display_name: String,
    pub category: String,
    pub global_skills_dir: String,
    pub project_skills_dir: Option<String>,
    pub icon_name: Option<String>,
    pub is_detected: bool,
    pub is_builtin: bool,
    pub is_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ScanDirectory {
    pub id: i64,
    pub path: String,
    pub label: Option<String>,
    pub is_active: bool,
    pub is_builtin: bool,
    pub added_at: String,
}

// ─── Pool Creation ────────────────────────────────────────────────────────────

/// Create a production SQLite pool for the given file path with WAL mode enabled.
pub async fn create_pool(db_path: &str) -> Result<DbPool, String> {
    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path))
        .map_err(|e| e.to_string())?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/// Initialize all database tables (idempotent) and seed built-in agents.
pub async fn init_database(pool: &DbPool) -> Result<(), String> {
    // Enable WAL mode (no-op for in-memory databases)
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // skills table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skills (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT,
            file_path      TEXT NOT NULL,
            canonical_path TEXT,
            is_central     BOOLEAN NOT NULL DEFAULT 0,
            source         TEXT,
            content        TEXT,
            scanned_at     TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // skill_installations table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skill_installations (
            skill_id       TEXT NOT NULL,
            agent_id       TEXT NOT NULL,
            installed_path TEXT NOT NULL,
            link_type      TEXT NOT NULL,
            symlink_target TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (skill_id, agent_id)
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Migration: add created_at column to skill_installations for existing databases
    // that were created before this column was introduced. We check via PRAGMA table_info
    // and run a two-step migration only when the column is absent:
    //   1. ALTER TABLE ADD COLUMN created_at TEXT  (nullable, no default expression –
    //      SQLite's ALTER TABLE does not support non-constant default expressions on
    //      some builds, e.g. the Apple-modified SQLite on macOS).
    //   2. UPDATE … SET created_at = datetime('now') WHERE created_at IS NULL  –
    //      backfills existing rows with the current timestamp.
    // New rows written by the application always supply created_at explicitly, so
    // there is no need for a database-level DEFAULT after the migration runs.
    let columns = sqlx::query("PRAGMA table_info(skill_installations)")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let has_created_at = columns.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "created_at")
            .unwrap_or(false)
    });

    if !has_created_at {
        // Step 1: add the column (nullable, no expression default for compatibility).
        sqlx::query("ALTER TABLE skill_installations ADD COLUMN created_at TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        // Step 2: backfill existing rows with the current timestamp.
        sqlx::query(
            "UPDATE skill_installations SET created_at = datetime('now') WHERE created_at IS NULL",
        )
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    // agents table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agents (
            id                 TEXT PRIMARY KEY,
            display_name       TEXT NOT NULL,
            category           TEXT NOT NULL,
            global_skills_dir  TEXT NOT NULL,
            project_skills_dir TEXT,
            icon_name          TEXT,
            is_detected        BOOLEAN NOT NULL DEFAULT 0,
            is_builtin         BOOLEAN NOT NULL DEFAULT 1,
            is_enabled         BOOLEAN NOT NULL DEFAULT 1
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // collections table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS collections (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // collection_skills table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS collection_skills (
            collection_id TEXT NOT NULL,
            skill_id      TEXT NOT NULL,
            added_at      TEXT NOT NULL,
            PRIMARY KEY (collection_id, skill_id)
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // scan_directories table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS scan_directories (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            path       TEXT NOT NULL UNIQUE,
            label      TEXT,
            is_active  BOOLEAN NOT NULL DEFAULT 1,
            is_builtin BOOLEAN NOT NULL DEFAULT 0,
            added_at   TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // settings table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // discovered_skills table — skills found in project-level directories
    // during a "discover project skills" scan.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS discovered_skills (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT,
            file_path      TEXT NOT NULL,
            dir_path       TEXT NOT NULL,
            project_path   TEXT NOT NULL,
            project_name   TEXT NOT NULL,
            platform_id    TEXT NOT NULL,
            discovered_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // skill_registries table — remote skill sources (marketplace)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skill_registries (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            source_type TEXT NOT NULL,
            url         TEXT NOT NULL,
            is_builtin  BOOLEAN NOT NULL DEFAULT 0,
            is_enabled  BOOLEAN NOT NULL DEFAULT 1,
            last_synced TEXT,
            last_attempted_sync TEXT,
            last_sync_status TEXT NOT NULL DEFAULT 'never',
            last_sync_error TEXT,
            cache_updated_at TEXT,
            cache_expires_at TEXT,
            etag TEXT,
            last_modified TEXT,
            created_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // marketplace_skills table — cached remote skill metadata
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS marketplace_skills (
            id           TEXT PRIMARY KEY,
            registry_id  TEXT NOT NULL,
            name         TEXT NOT NULL,
            description  TEXT,
            download_url TEXT NOT NULL,
            is_installed BOOLEAN NOT NULL DEFAULT 0,
            synced_at    TEXT NOT NULL,
            cache_updated_at TEXT,
            FOREIGN KEY (registry_id) REFERENCES skill_registries(id)
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // skill_explanations table — cached AI-generated skill explanations
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skill_explanations (
            skill_id    TEXT NOT NULL,
            explanation TEXT NOT NULL,
            lang        TEXT NOT NULL DEFAULT 'zh',
            model       TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (skill_id, lang)
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    ensure_column(
        pool,
        "skill_registries",
        "last_attempted_sync",
        "ALTER TABLE skill_registries ADD COLUMN last_attempted_sync TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "last_sync_status",
        "ALTER TABLE skill_registries ADD COLUMN last_sync_status TEXT NOT NULL DEFAULT 'never'",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "last_sync_error",
        "ALTER TABLE skill_registries ADD COLUMN last_sync_error TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "cache_updated_at",
        "ALTER TABLE skill_registries ADD COLUMN cache_updated_at TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "cache_expires_at",
        "ALTER TABLE skill_registries ADD COLUMN cache_expires_at TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "etag",
        "ALTER TABLE skill_registries ADD COLUMN etag TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "last_modified",
        "ALTER TABLE skill_registries ADD COLUMN last_modified TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "marketplace_skills",
        "cache_updated_at",
        "ALTER TABLE marketplace_skills ADD COLUMN cache_updated_at TEXT",
    )
    .await?;

    // Seed built-in agents (INSERT OR IGNORE so repeated init is safe)
    seed_builtin_agents(pool).await?;

    // Seed built-in scan directories from the built-in agent registry.
    seed_builtin_scan_directories(pool).await?;

    // Seed built-in skill registries (marketplace sources)
    seed_builtin_registries(pool).await?;

    Ok(())
}

async fn seed_builtin_agents(pool: &DbPool) -> Result<(), String> {
    let agents = builtin_agents();
    let builtin_ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();

    for agent in &agents {
        sqlx::query(
            "INSERT INTO agents
             (id, display_name, category, global_skills_dir, project_skills_dir,
              icon_name, is_detected, is_builtin, is_enabled)
             VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1)
             ON CONFLICT(id) DO UPDATE SET
              display_name = excluded.display_name,
              category = excluded.category,
              global_skills_dir = excluded.global_skills_dir,
              project_skills_dir = excluded.project_skills_dir,
              icon_name = excluded.icon_name",
        )
        .bind(&agent.id)
        .bind(&agent.display_name)
        .bind(&agent.category)
        .bind(&agent.global_skills_dir)
        .bind(&agent.project_skills_dir)
        .bind(&agent.icon_name)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Remove builtin agents that no longer exist in code
    let all_db_agents: Vec<(String,)> =
        sqlx::query_as("SELECT id FROM agents WHERE is_builtin = 1")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    for (id,) in &all_db_agents {
        if !builtin_ids.contains(&id.as_str()) {
            sqlx::query("DELETE FROM agents WHERE id = ? AND is_builtin = 1")
                .bind(id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Seed `scan_directories` with one row per unique `global_skills_dir` path
/// across all built-in agents.  Rows are marked `is_builtin = 1` and cannot
/// be removed by the user.  `INSERT OR IGNORE` keeps the operation idempotent:
/// if two built-in agents share the same path (codex and central both use
/// `~/.agents/skills`) only the first insert takes effect.
async fn seed_builtin_scan_directories(pool: &DbPool) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    for agent in builtin_agents() {
        sqlx::query(
            "INSERT OR IGNORE INTO scan_directories
             (path, label, is_active, is_builtin, added_at)
             VALUES (?, ?, 1, 1, ?)",
        )
        .bind(&agent.global_skills_dir)
        .bind(&agent.display_name)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Remove builtin scan directories that no longer exist in code
    let builtin_paths: std::collections::HashSet<String> = builtin_agents()
        .into_iter()
        .map(|a| a.global_skills_dir)
        .collect();
    let all_db_dirs: Vec<(String,)> =
        sqlx::query_as("SELECT path FROM scan_directories WHERE is_builtin = 1")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
    for (path,) in &all_db_dirs {
        if !builtin_paths.contains(path) {
            sqlx::query("DELETE FROM scan_directories WHERE path = ? AND is_builtin = 1")
                .bind(path)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

async fn seed_builtin_registries(pool: &DbPool) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let registries = vec![
        (
            "anthropic",
            "Anthropic",
            "github",
            "https://github.com/anthropics/skills",
        ),
        (
            "openai",
            "OpenAI",
            "github",
            "https://github.com/openai/skills",
        ),
        (
            "baoyu-skills",
            "baoyu-skills",
            "github",
            "https://github.com/jimliu/baoyu-skills",
        ),
    ];
    for (id, name, source_type, url) in registries {
        sqlx::query(
            "INSERT OR IGNORE INTO skill_registries
             (id, name, source_type, url, is_builtin, is_enabled, created_at)
             VALUES (?, ?, ?, ?, 1, 1, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(source_type)
        .bind(url)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn ensure_column(
    pool: &DbPool,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> Result<(), String> {
    let pragma = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&pragma)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let has_column = rows.iter().any(|row| {
        use sqlx::Row;
        row.get::<String, _>("name") == column
    });

    if !has_column {
        sqlx::query(alter_sql)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Returns the list of built-in agents using the current user's home directory.
pub fn builtin_agents() -> Vec<Agent> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    vec![
        // ── Coding platforms ─────────────────────────────────────────────────
        Agent {
            id: "claude-code".to_string(),
            display_name: "Claude Code".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.claude/skills", home),
            project_skills_dir: None,
            icon_name: Some("claude".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "codex".to_string(),
            display_name: "Codex CLI".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.agents/skills", home),
            project_skills_dir: None,
            icon_name: Some("codex".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "cursor".to_string(),
            display_name: "Cursor".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.cursor/skills", home),
            project_skills_dir: None,
            icon_name: Some("cursor".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "gemini-cli".to_string(),
            display_name: "Gemini CLI".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.gemini/skills", home),
            project_skills_dir: None,
            icon_name: Some("gemini".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "trae".to_string(),
            display_name: "Trae".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.trae/skills", home),
            project_skills_dir: None,
            icon_name: Some("trae".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "factory-droid".to_string(),
            display_name: "Factory Droid".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.factory/skills", home),
            project_skills_dir: None,
            icon_name: Some("factory".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "junie".to_string(),
            display_name: "Junie".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.junie/skills", home),
            project_skills_dir: None,
            icon_name: Some("junie".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "qwen".to_string(),
            display_name: "Qwen".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.qwen/skills", home),
            project_skills_dir: None,
            icon_name: Some("qwen".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "trae-cn".to_string(),
            display_name: "Trae CN".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.trae-cn/skills", home),
            project_skills_dir: None,
            icon_name: Some("trae-cn".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "windsurf".to_string(),
            display_name: "Windsurf".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.windsurf/skills", home),
            project_skills_dir: None,
            icon_name: Some("windsurf".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "qoder".to_string(),
            display_name: "Qoder".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.qoder/skills", home),
            project_skills_dir: None,
            icon_name: Some("qoder".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "augment".to_string(),
            display_name: "Augment".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.augment/skills", home),
            project_skills_dir: None,
            icon_name: Some("augment".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "opencode".to_string(),
            display_name: "OpenCode".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.opencode/skills", home),
            project_skills_dir: None,
            icon_name: Some("opencode".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "kilocode".to_string(),
            display_name: "KiloCode".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.kilocode/skills", home),
            project_skills_dir: None,
            icon_name: Some("kilocode".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "ob1".to_string(),
            display_name: "OB1".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.ob1/skills", home),
            project_skills_dir: None,
            icon_name: Some("ob1".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "amp".to_string(),
            display_name: "Amp".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.amp/skills", home),
            project_skills_dir: None,
            icon_name: Some("amp".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "kiro".to_string(),
            display_name: "Kiro".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.kiro/skills", home),
            project_skills_dir: None,
            icon_name: Some("kiro".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "codebuddy".to_string(),
            display_name: "CodeBuddy".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.codebuddy/skills", home),
            project_skills_dir: None,
            icon_name: Some("codebuddy".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "hermes".to_string(),
            display_name: "Hermes".to_string(),
            category: "lobster".to_string(),
            global_skills_dir: format!("{}/.hermes/skills", home),
            project_skills_dir: None,
            icon_name: Some("hermes".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "copilot".to_string(),
            display_name: "Copilot".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.copilot/skills", home),
            project_skills_dir: None,
            icon_name: Some("copilot".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "aider".to_string(),
            display_name: "Aider".to_string(),
            category: "coding".to_string(),
            global_skills_dir: format!("{}/.aider/skills", home),
            project_skills_dir: None,
            icon_name: Some("aider".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        // ── Lobster platforms ────────────────────────────────────────────────
        Agent {
            id: "openclaw".to_string(),
            display_name: "OpenClaw".to_string(),
            category: "lobster".to_string(),
            global_skills_dir: format!("{}/.openclaw/skills", home),
            project_skills_dir: None,
            icon_name: Some("openclaw".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "qclaw".to_string(),
            display_name: "QClaw".to_string(),
            category: "lobster".to_string(),
            global_skills_dir: format!("{}/.qclaw/skills", home),
            project_skills_dir: None,
            icon_name: Some("qclaw".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "easyclaw".to_string(),
            display_name: "EasyClaw".to_string(),
            category: "lobster".to_string(),
            global_skills_dir: format!("{}/.easyclaw/skills", home),
            project_skills_dir: None,
            icon_name: Some("easyclaw".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "autoclaw".to_string(),
            display_name: "AutoClaw".to_string(),
            category: "lobster".to_string(),
            global_skills_dir: format!("{}/.openclaw-autoclaw/skills", home),
            project_skills_dir: None,
            icon_name: Some("autoclaw".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        Agent {
            id: "workbuddy".to_string(),
            display_name: "WorkBuddy".to_string(),
            category: "lobster".to_string(),
            global_skills_dir: format!("{}/.workbuddy/skills-marketplace/skills", home),
            project_skills_dir: None,
            icon_name: Some("workbuddy".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
        // ── Central Skills ────────────────────────────────────────────────────
        Agent {
            id: "central".to_string(),
            display_name: "Central Skills".to_string(),
            category: "central".to_string(),
            global_skills_dir: format!("{}/.agents/skills", home),
            project_skills_dir: None,
            icon_name: Some("central".to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        },
    ]
}

// ─── Skills ───────────────────────────────────────────────────────────────────

/// Insert or update a skill record.
///
/// Uses `ON CONFLICT DO UPDATE` to preserve `is_central = true` if a prior
/// scan already marked the skill as central (e.g., when the central agent and
/// codex both point to `~/.agents/skills/` and are scanned in different
/// orders). Once a skill is flagged as central it must never be downgraded to
/// non-central by a subsequent scan of the same directory by a non-central agent.
pub async fn upsert_skill(pool: &DbPool, skill: &Skill) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO skills
         (id, name, description, file_path, canonical_path, is_central, source, content, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name           = excluded.name,
           description    = excluded.description,
           file_path      = excluded.file_path,
           canonical_path = COALESCE(excluded.canonical_path, skills.canonical_path),
           is_central     = MAX(skills.is_central, excluded.is_central),
           source         = excluded.source,
           content        = excluded.content,
           scanned_at     = excluded.scanned_at",
    )
    .bind(&skill.id)
    .bind(&skill.name)
    .bind(&skill.description)
    .bind(&skill.file_path)
    .bind(&skill.canonical_path)
    .bind(skill.is_central)
    .bind(&skill.source)
    .bind(&skill.content)
    .bind(&skill.scanned_at)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Retrieve all skills installed for a given agent.
pub async fn get_skills_by_agent(pool: &DbPool, agent_id: &str) -> Result<Vec<Skill>, String> {
    sqlx::query_as::<_, Skill>(
        "SELECT s.* FROM skills s
         JOIN skill_installations si ON s.id = si.skill_id
         WHERE si.agent_id = ?",
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// A skill enriched with the installation-specific fields for a given agent.
///
/// Returned by `get_skills_for_agent`. The extra fields come from the
/// `skill_installations` row and allow the frontend `SkillCard` to display
/// the correct source indicator without a second round-trip.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SkillForAgent {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Absolute path to the `SKILL.md` file.
    pub file_path: String,
    /// Absolute path to the skill directory as installed for this agent
    /// (i.e., `skill_installations.installed_path`).
    pub dir_path: String,
    /// How the skill is linked: "symlink", "copy", or "native".
    pub link_type: String,
    /// Symlink target path, if `link_type` is "symlink".
    pub symlink_target: Option<String>,
    pub is_central: bool,
}

/// Retrieve skills installed for a given agent, enriched with installation
/// metadata (`dir_path`, `link_type`, `symlink_target`) required by the
/// platform-view skill cards.
pub async fn get_skills_for_agent(
    pool: &DbPool,
    agent_id: &str,
) -> Result<Vec<SkillForAgent>, String> {
    sqlx::query_as::<_, SkillForAgent>(
        "SELECT s.id, s.name, s.description, s.file_path,
                si.installed_path AS dir_path,
                si.link_type,
                si.symlink_target,
                s.is_central
         FROM skills s
         JOIN skill_installations si ON s.id = si.skill_id
         WHERE si.agent_id = ?",
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Retrieve all Central Skills (is_central = true).
pub async fn get_central_skills(pool: &DbPool) -> Result<Vec<Skill>, String> {
    sqlx::query_as::<_, Skill>("SELECT * FROM skills WHERE is_central = 1")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Retrieve a skill by its ID.
pub async fn get_skill_by_id(pool: &DbPool, skill_id: &str) -> Result<Option<Skill>, String> {
    sqlx::query_as::<_, Skill>("SELECT * FROM skills WHERE id = ?")
        .bind(skill_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a skill and all its installation records.
pub async fn delete_skill(pool: &DbPool, skill_id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM skill_installations WHERE skill_id = ?")
        .bind(skill_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM skills WHERE id = ?")
        .bind(skill_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ─── Skill Installations ──────────────────────────────────────────────────────

/// Insert or update a skill installation record.
///
/// On conflict (same skill_id + agent_id), updates the mutable fields
/// (installed_path, link_type, symlink_target) but **preserves the original
/// `created_at`** so the installation timestamp reflects when the skill was
/// first installed, not when it was last re-scanned.
pub async fn upsert_skill_installation(
    pool: &DbPool,
    installation: &SkillInstallation,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO skill_installations
         (skill_id, agent_id, installed_path, link_type, symlink_target, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(skill_id, agent_id) DO UPDATE SET
           installed_path = excluded.installed_path,
           link_type      = excluded.link_type,
           symlink_target = excluded.symlink_target",
    )
    .bind(&installation.skill_id)
    .bind(&installation.agent_id)
    .bind(&installation.installed_path)
    .bind(&installation.link_type)
    .bind(&installation.symlink_target)
    .bind(&installation.created_at)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Delete an installation record for a specific skill+agent pair.
pub async fn delete_skill_installation(
    pool: &DbPool,
    skill_id: &str,
    agent_id: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM skill_installations WHERE skill_id = ? AND agent_id = ?")
        .bind(skill_id)
        .bind(agent_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Remove installation records for a given agent where the skill ID is NOT in
/// `found_skill_ids`. Pass an empty slice to remove ALL installations for the
/// agent (used when the agent's skills directory no longer exists).
pub async fn delete_stale_skill_installations(
    pool: &DbPool,
    agent_id: &str,
    found_skill_ids: &[String],
) -> Result<(), String> {
    if found_skill_ids.is_empty() {
        return sqlx::query("DELETE FROM skill_installations WHERE agent_id = ?")
            .bind(agent_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string());
    }

    let placeholders = found_skill_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "DELETE FROM skill_installations WHERE agent_id = ? AND skill_id NOT IN ({})",
        placeholders
    );

    let mut q = sqlx::query(&sql).bind(agent_id);
    for id in found_skill_ids {
        q = q.bind(id.as_str());
    }
    q.execute(pool).await.map(|_| ()).map_err(|e| e.to_string())
}

/// Delete skills whose IDs are NOT in `found_skill_ids`. Also cascades to
/// remove any orphaned `skill_installations` rows for those skills.
///
/// This is the global reconciliation step run after a full scan to purge rows
/// for skills that no longer exist on disk in any scanned scope.
///
/// Pass an empty slice to delete ALL skills (used only when every scanned
/// directory is empty or missing).
pub async fn delete_skills_not_in_scope(
    pool: &DbPool,
    found_skill_ids: &[String],
) -> Result<(), String> {
    if found_skill_ids.is_empty() {
        // Nothing found — delete all installation records first, then all skills.
        sqlx::query("DELETE FROM skill_installations")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        return sqlx::query("DELETE FROM skills")
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string());
    }

    let placeholders = found_skill_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");

    // Cascade: remove installation rows for skills that are no longer on disk.
    let install_sql = format!(
        "DELETE FROM skill_installations WHERE skill_id NOT IN ({})",
        placeholders
    );
    let mut q = sqlx::query(&install_sql);
    for id in found_skill_ids {
        q = q.bind(id.as_str());
    }
    q.execute(pool).await.map_err(|e| e.to_string())?;

    // Remove the stale skills themselves.
    let skill_sql = format!("DELETE FROM skills WHERE id NOT IN ({})", placeholders);
    let mut q2 = sqlx::query(&skill_sql);
    for id in found_skill_ids {
        q2 = q2.bind(id.as_str());
    }
    q2.execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Retrieve all installation records for a given skill.
pub async fn get_skill_installations(
    pool: &DbPool,
    skill_id: &str,
) -> Result<Vec<SkillInstallation>, String> {
    sqlx::query_as::<_, SkillInstallation>("SELECT * FROM skill_installations WHERE skill_id = ?")
        .bind(skill_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

// ─── Agents ───────────────────────────────────────────────────────────────────

/// Retrieve all agents.
pub async fn get_all_agents(pool: &DbPool) -> Result<Vec<Agent>, String> {
    sqlx::query_as::<_, Agent>("SELECT * FROM agents ORDER BY is_builtin DESC, display_name")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Retrieve a single agent by ID.
pub async fn get_agent_by_id(pool: &DbPool, agent_id: &str) -> Result<Option<Agent>, String> {
    sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE id = ?")
        .bind(agent_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Update the `is_detected` flag for an agent.
pub async fn update_agent_detected(
    pool: &DbPool,
    agent_id: &str,
    is_detected: bool,
) -> Result<(), String> {
    sqlx::query("UPDATE agents SET is_detected = ? WHERE id = ?")
        .bind(is_detected)
        .bind(agent_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Insert a new custom agent (non-builtin).
pub async fn insert_custom_agent(pool: &DbPool, agent: &Agent) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO agents
         (id, display_name, category, global_skills_dir, project_skills_dir,
          icon_name, is_detected, is_builtin, is_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)",
    )
    .bind(&agent.id)
    .bind(&agent.display_name)
    .bind(&agent.category)
    .bind(&agent.global_skills_dir)
    .bind(&agent.project_skills_dir)
    .bind(&agent.icon_name)
    .bind(agent.is_detected)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Delete a custom (non-builtin) agent by ID. Returns an error if the agent is builtin.
pub async fn delete_custom_agent(pool: &DbPool, agent_id: &str) -> Result<(), String> {
    let agent = get_agent_by_id(pool, agent_id).await?;
    match agent {
        None => Err(format!("Agent '{}' not found", agent_id)),
        Some(a) if a.is_builtin => Err(format!("Cannot delete built-in agent '{}'", agent_id)),
        Some(_) => sqlx::query("DELETE FROM agents WHERE id = ?")
            .bind(agent_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
    }
}

/// Update a custom (non-builtin) agent's mutable fields.
/// Returns the updated agent record, or an error if the agent is builtin or not found.
pub async fn update_custom_agent(
    pool: &DbPool,
    agent_id: &str,
    display_name: &str,
    category: &str,
    global_skills_dir: &str,
) -> Result<Agent, String> {
    let agent = get_agent_by_id(pool, agent_id).await?;
    match agent {
        None => return Err(format!("Agent '{}' not found", agent_id)),
        Some(a) if a.is_builtin => {
            return Err(format!("Cannot update built-in agent '{}'", agent_id))
        }
        Some(_) => {}
    }

    sqlx::query(
        "UPDATE agents SET display_name = ?, category = ?, global_skills_dir = ? WHERE id = ?",
    )
    .bind(display_name)
    .bind(category)
    .bind(global_skills_dir)
    .bind(agent_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    get_agent_by_id(pool, agent_id)
        .await?
        .ok_or_else(|| "Failed to retrieve updated agent".to_string())
}

// ─── Collections ──────────────────────────────────────────────────────────────

/// Create a new collection and return it.
pub async fn create_collection(
    pool: &DbPool,
    name: &str,
    description: Option<&str>,
) -> Result<Collection, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO collections (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(description)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    get_collection_by_id(pool, &id)
        .await?
        .ok_or_else(|| "Failed to retrieve newly created collection".to_string())
}

/// Retrieve all collections.
pub async fn get_all_collections(pool: &DbPool) -> Result<Vec<Collection>, String> {
    sqlx::query_as::<_, Collection>("SELECT * FROM collections ORDER BY created_at")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Retrieve a collection by ID.
pub async fn get_collection_by_id(
    pool: &DbPool,
    collection_id: &str,
) -> Result<Option<Collection>, String> {
    sqlx::query_as::<_, Collection>("SELECT * FROM collections WHERE id = ?")
        .bind(collection_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Update a collection's name and/or description.
pub async fn update_collection(
    pool: &DbPool,
    collection_id: &str,
    name: &str,
    description: Option<&str>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(description)
        .bind(&now)
        .bind(collection_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Delete a collection and all its skill memberships.
pub async fn delete_collection(pool: &DbPool, collection_id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_skills WHERE collection_id = ?")
        .bind(collection_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(collection_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Add a skill to a collection (idempotent).
pub async fn add_skill_to_collection(
    pool: &DbPool,
    collection_id: &str,
    skill_id: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO collection_skills (collection_id, skill_id, added_at)
         VALUES (?, ?, ?)",
    )
    .bind(collection_id)
    .bind(skill_id)
    .bind(&now)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Remove a skill from a collection.
pub async fn remove_skill_from_collection(
    pool: &DbPool,
    collection_id: &str,
    skill_id: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_skills WHERE collection_id = ? AND skill_id = ?")
        .bind(collection_id)
        .bind(skill_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Retrieve all skills belonging to a collection.
pub async fn get_collection_skills(
    pool: &DbPool,
    collection_id: &str,
) -> Result<Vec<Skill>, String> {
    sqlx::query_as::<_, Skill>(
        "SELECT s.* FROM skills s
         JOIN collection_skills cs ON s.id = cs.skill_id
         WHERE cs.collection_id = ?
         ORDER BY cs.added_at",
    )
    .bind(collection_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Retrieve all collections that contain a given skill.
pub async fn get_skill_collections(pool: &DbPool, skill_id: &str) -> Result<Vec<Collection>, String> {
    sqlx::query_as::<_, Collection>(
        "SELECT c.* FROM collections c
         JOIN collection_skills cs ON c.id = cs.collection_id
         WHERE cs.skill_id = ?
         ORDER BY cs.added_at",
    )
    .bind(skill_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

// ─── Scan Directories ─────────────────────────────────────────────────────────

/// Retrieve all scan directories.
pub async fn get_scan_directories(pool: &DbPool) -> Result<Vec<ScanDirectory>, String> {
    sqlx::query_as::<_, ScanDirectory>(
        "SELECT * FROM scan_directories ORDER BY is_builtin DESC, added_at",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Add a new scan directory entry (non-builtin by default).
pub async fn add_scan_directory(
    pool: &DbPool,
    path: &str,
    label: Option<&str>,
) -> Result<ScanDirectory, String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO scan_directories (path, label, is_active, is_builtin, added_at)
         VALUES (?, ?, 1, 0, ?)",
    )
    .bind(path)
    .bind(label)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query_as::<_, ScanDirectory>("SELECT * FROM scan_directories WHERE path = ?")
        .bind(path)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Remove a scan directory. Returns an error if the directory is builtin.
pub async fn remove_scan_directory(pool: &DbPool, path: &str) -> Result<(), String> {
    let row = sqlx::query("SELECT is_builtin FROM scan_directories WHERE path = ?")
        .bind(path)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    match row {
        None => Err(format!("Scan directory '{}' not found", path)),
        Some(r) => {
            let is_builtin: bool = r.try_get("is_builtin").map_err(|e| e.to_string())?;
            if is_builtin {
                return Err(format!("Cannot remove built-in scan directory '{}'", path));
            }
            sqlx::query("DELETE FROM scan_directories WHERE path = ?")
                .bind(path)
                .execute(pool)
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
    }
}

/// Toggle the `is_active` flag on a scan directory.
pub async fn toggle_scan_directory(
    pool: &DbPool,
    path: &str,
    is_active: bool,
) -> Result<(), String> {
    sqlx::query("UPDATE scan_directories SET is_active = ? WHERE path = ?")
        .bind(is_active)
        .bind(path)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ─── Discovered Skills ────────────────────────────────────────────────────────

/// A skill discovered in a project-level directory during a full-disk scan.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DiscoveredSkillRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub dir_path: String,
    pub project_path: String,
    pub project_name: String,
    pub platform_id: String,
    pub discovered_at: String,
}

/// Insert a discovered skill record.
#[allow(clippy::too_many_arguments)]
pub async fn insert_discovered_skill(
    pool: &DbPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    file_path: &str,
    dir_path: &str,
    project_path: &str,
    project_name: &str,
    platform_id: &str,
    discovered_at: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR IGNORE INTO discovered_skills
         (id, name, description, file_path, dir_path, project_path, project_name, platform_id, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(file_path)
    .bind(dir_path)
    .bind(project_path)
    .bind(project_name)
    .bind(platform_id)
    .bind(discovered_at)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Retrieve a discovered skill by its qualified ID.
pub async fn get_discovered_skill_by_id(
    pool: &DbPool,
    id: &str,
) -> Result<Option<DiscoveredSkillRow>, String> {
    sqlx::query_as::<_, DiscoveredSkillRow>("SELECT * FROM discovered_skills WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Retrieve all discovered skills.
pub async fn get_all_discovered_skills(pool: &DbPool) -> Result<Vec<DiscoveredSkillRow>, String> {
    sqlx::query_as::<_, DiscoveredSkillRow>(
        "SELECT * FROM discovered_skills ORDER BY project_name, platform_id, name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Delete a discovered skill by ID.
pub async fn delete_discovered_skill(pool: &DbPool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM discovered_skills WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Clear all discovered skills.
pub async fn clear_all_discovered_skills(pool: &DbPool) -> Result<(), String> {
    sqlx::query("DELETE FROM discovered_skills")
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Get count of discovered projects (distinct project_path values).
pub async fn get_discovered_project_count(pool: &DbPool) -> Result<i64, String> {
    let row = sqlx::query("SELECT COUNT(DISTINCT project_path) AS cnt FROM discovered_skills")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

    row.try_get::<i64, _>("cnt").map_err(|e| e.to_string())
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/// Get a setting value by key.
pub async fn get_setting(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.map(|r| r.get::<String, _>("value")))
}

/// Set (upsert) a setting value.
pub async fn set_setting(pool: &DbPool, key: &str, value: &str) -> Result<(), String> {
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Create an in-memory SQLite pool and initialize the schema.
    async fn setup_test_db() -> DbPool {
        let pool = SqlitePool::connect(":memory:")
            .await
            .expect("Failed to create in-memory SQLite pool");
        init_database(&pool)
            .await
            .expect("Failed to initialize test database");
        pool
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_init_creates_all_tables() {
        let pool = setup_test_db().await;

        // Verify all 7 tables exist by counting rows (empty is fine)
        let tables = [
            "skills",
            "skill_installations",
            "agents",
            "collections",
            "collection_skills",
            "scan_directories",
            "settings",
        ];
        for table in &tables {
            let result = sqlx::query(&format!("SELECT COUNT(*) as cnt FROM {}", table))
                .fetch_one(&pool)
                .await;
            assert!(result.is_ok(), "Table '{}' should exist", table);
        }
    }

    #[tokio::test]
    async fn test_init_is_idempotent() {
        let pool = setup_test_db().await;
        // Calling init_database again should not fail
        let result = init_database(&pool).await;
        assert!(result.is_ok(), "Second init should be idempotent");
    }

    #[tokio::test]
    async fn test_builtin_agents_seeded() {
        let pool = setup_test_db().await;
        let agents = get_all_agents(&pool).await.unwrap();
        assert_eq!(agents.len(), 27, "Should have exactly 27 built-in agents");

        let ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();
        // Coding platforms
        assert!(ids.contains(&"claude-code"));
        assert!(ids.contains(&"codex"));
        assert!(ids.contains(&"cursor"));
        assert!(ids.contains(&"gemini-cli"));
        assert!(ids.contains(&"trae"));
        assert!(ids.contains(&"factory-droid"));
        assert!(ids.contains(&"junie"));
        assert!(ids.contains(&"qwen"));
        assert!(ids.contains(&"trae-cn"));
        assert!(ids.contains(&"windsurf"));
        assert!(ids.contains(&"qoder"));
        assert!(ids.contains(&"augment"));
        assert!(ids.contains(&"opencode"));
        assert!(ids.contains(&"kilocode"));
        assert!(ids.contains(&"ob1"));
        assert!(ids.contains(&"amp"));
        assert!(ids.contains(&"kiro"));
        assert!(ids.contains(&"codebuddy"));
        assert!(ids.contains(&"hermes"));
        assert!(ids.contains(&"copilot"));
        assert!(ids.contains(&"aider"));
        // Lobster platforms
        assert!(ids.contains(&"openclaw"));
        assert!(ids.contains(&"qclaw"));
        assert!(ids.contains(&"easyclaw"));
        assert!(ids.contains(&"autoclaw"));
        assert!(ids.contains(&"workbuddy"));
        // Central
        assert!(ids.contains(&"central"));
    }

    #[tokio::test]
    async fn test_builtin_agents_are_marked_builtin() {
        let pool = setup_test_db().await;
        let agents = get_all_agents(&pool).await.unwrap();
        for agent in &agents {
            assert!(agent.is_builtin, "All seeded agents should be builtin");
        }
    }

    #[tokio::test]
    async fn test_init_does_not_duplicate_agents_on_reinit() {
        let pool = setup_test_db().await;
        init_database(&pool).await.unwrap(); // Call a second time
        let agents = get_all_agents(&pool).await.unwrap();
        assert_eq!(agents.len(), 27, "Reinit must not duplicate agents");
    }

    // ── Skills ────────────────────────────────────────────────────────────────

    fn make_skill(id: &str, name: &str, is_central: bool) -> Skill {
        Skill {
            id: id.to_string(),
            name: name.to_string(),
            description: Some(format!("Description for {}", name)),
            file_path: format!("/tmp/{}/SKILL.md", id),
            canonical_path: if is_central {
                Some(format!("/tmp/.agents/skills/{}", id))
            } else {
                None
            },
            is_central,
            source: None,
            content: Some("# Test Skill\n\nContent here.".to_string()),
            scanned_at: Utc::now().to_rfc3339(),
        }
    }

    #[tokio::test]
    async fn test_upsert_skill_insert() {
        let pool = setup_test_db().await;
        let skill = make_skill("test-skill", "Test Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();

        let retrieved = get_skill_by_id(&pool, "test-skill").await.unwrap();
        assert!(retrieved.is_some());
        let s = retrieved.unwrap();
        assert_eq!(s.name, "Test Skill");
        assert!(!s.is_central);
    }

    #[tokio::test]
    async fn test_upsert_skill_update() {
        let pool = setup_test_db().await;
        let mut skill = make_skill("skill-1", "Original Name", false);
        upsert_skill(&pool, &skill).await.unwrap();

        skill.name = "Updated Name".to_string();
        upsert_skill(&pool, &skill).await.unwrap();

        let retrieved = get_skill_by_id(&pool, "skill-1").await.unwrap().unwrap();
        assert_eq!(retrieved.name, "Updated Name");
    }

    #[tokio::test]
    async fn test_get_skill_by_id_not_found() {
        let pool = setup_test_db().await;
        let result = get_skill_by_id(&pool, "nonexistent").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_central_skills() {
        let pool = setup_test_db().await;
        upsert_skill(&pool, &make_skill("central-1", "Central One", true))
            .await
            .unwrap();
        upsert_skill(&pool, &make_skill("non-central", "Not Central", false))
            .await
            .unwrap();

        let central = get_central_skills(&pool).await.unwrap();
        assert_eq!(central.len(), 1);
        assert_eq!(central[0].id, "central-1");
    }

    #[tokio::test]
    async fn test_delete_skill() {
        let pool = setup_test_db().await;
        let skill = make_skill("to-delete", "Delete Me", false);
        upsert_skill(&pool, &skill).await.unwrap();

        delete_skill(&pool, "to-delete").await.unwrap();
        let result = get_skill_by_id(&pool, "to-delete").await.unwrap();
        assert!(result.is_none());
    }

    // ── Skill Installations ───────────────────────────────────────────────────

    fn make_installation(skill_id: &str, agent_id: &str, link_type: &str) -> SkillInstallation {
        SkillInstallation {
            skill_id: skill_id.to_string(),
            agent_id: agent_id.to_string(),
            installed_path: format!("/tmp/{}/{}", agent_id, skill_id),
            link_type: link_type.to_string(),
            symlink_target: if link_type == "symlink" {
                Some(format!("/tmp/.agents/skills/{}", skill_id))
            } else {
                None
            },
            created_at: Utc::now().to_rfc3339(),
        }
    }

    #[tokio::test]
    async fn test_upsert_and_get_skill_installation() {
        let pool = setup_test_db().await;
        let skill = make_skill("my-skill", "My Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();

        let inst = make_installation("my-skill", "claude-code", "symlink");
        upsert_skill_installation(&pool, &inst).await.unwrap();

        let installations = get_skill_installations(&pool, "my-skill").await.unwrap();
        assert_eq!(installations.len(), 1);
        assert_eq!(installations[0].agent_id, "claude-code");
        assert_eq!(installations[0].link_type, "symlink");
    }

    #[tokio::test]
    async fn test_delete_skill_installation() {
        let pool = setup_test_db().await;
        let skill = make_skill("del-skill", "Del Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();
        upsert_skill_installation(&pool, &make_installation("del-skill", "cursor", "copy"))
            .await
            .unwrap();

        delete_skill_installation(&pool, "del-skill", "cursor")
            .await
            .unwrap();

        let installations = get_skill_installations(&pool, "del-skill").await.unwrap();
        assert!(installations.is_empty());
    }

    #[tokio::test]
    async fn test_get_skills_by_agent() {
        let pool = setup_test_db().await;
        let skill_a = make_skill("skill-a", "Skill A", false);
        let skill_b = make_skill("skill-b", "Skill B", false);
        upsert_skill(&pool, &skill_a).await.unwrap();
        upsert_skill(&pool, &skill_b).await.unwrap();

        upsert_skill_installation(
            &pool,
            &make_installation("skill-a", "claude-code", "symlink"),
        )
        .await
        .unwrap();
        upsert_skill_installation(&pool, &make_installation("skill-b", "cursor", "copy"))
            .await
            .unwrap();

        let claude_skills = get_skills_by_agent(&pool, "claude-code").await.unwrap();
        assert_eq!(claude_skills.len(), 1);
        assert_eq!(claude_skills[0].id, "skill-a");

        let cursor_skills = get_skills_by_agent(&pool, "cursor").await.unwrap();
        assert_eq!(cursor_skills.len(), 1);
        assert_eq!(cursor_skills[0].id, "skill-b");

        let empty = get_skills_by_agent(&pool, "codex").await.unwrap();
        assert!(empty.is_empty());
    }

    // ── Agents ────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_agent_by_id() {
        let pool = setup_test_db().await;
        let agent = get_agent_by_id(&pool, "claude-code").await.unwrap();
        assert!(agent.is_some());
        let a = agent.unwrap();
        assert_eq!(a.display_name, "Claude Code");
        assert_eq!(a.category, "coding");
        assert!(a.is_builtin);
    }

    #[tokio::test]
    async fn test_get_agent_by_id_not_found() {
        let pool = setup_test_db().await;
        let agent = get_agent_by_id(&pool, "nonexistent-agent").await.unwrap();
        assert!(agent.is_none());
    }

    #[tokio::test]
    async fn test_update_agent_detected() {
        let pool = setup_test_db().await;
        update_agent_detected(&pool, "cursor", true).await.unwrap();
        let agent = get_agent_by_id(&pool, "cursor").await.unwrap().unwrap();
        assert!(agent.is_detected);

        update_agent_detected(&pool, "cursor", false).await.unwrap();
        let agent = get_agent_by_id(&pool, "cursor").await.unwrap().unwrap();
        assert!(!agent.is_detected);
    }

    #[tokio::test]
    async fn test_insert_custom_agent() {
        let pool = setup_test_db().await;
        let custom = Agent {
            id: "my-custom-agent".to_string(),
            display_name: "My Custom Agent".to_string(),
            category: "other".to_string(),
            global_skills_dir: "/tmp/custom/skills".to_string(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        insert_custom_agent(&pool, &custom).await.unwrap();

        let all = get_all_agents(&pool).await.unwrap();
        assert_eq!(all.len(), 28, "Should have 27 builtins + 1 custom");

        let retrieved = get_agent_by_id(&pool, "my-custom-agent")
            .await
            .unwrap()
            .unwrap();
        assert!(!retrieved.is_builtin);
        assert_eq!(retrieved.display_name, "My Custom Agent");
    }

    #[tokio::test]
    async fn test_delete_custom_agent() {
        let pool = setup_test_db().await;
        let custom = Agent {
            id: "deletable-agent".to_string(),
            display_name: "Deletable".to_string(),
            category: "other".to_string(),
            global_skills_dir: "/tmp/deletable/skills".to_string(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        insert_custom_agent(&pool, &custom).await.unwrap();
        delete_custom_agent(&pool, "deletable-agent").await.unwrap();

        let retrieved = get_agent_by_id(&pool, "deletable-agent").await.unwrap();
        assert!(retrieved.is_none());
    }

    #[tokio::test]
    async fn test_cannot_delete_builtin_agent() {
        let pool = setup_test_db().await;
        let result = delete_custom_agent(&pool, "claude-code").await;
        assert!(
            result.is_err(),
            "Should not be able to delete built-in agent"
        );
    }

    #[tokio::test]
    async fn test_workbuddy_scans_correct_directory() {
        let pool = setup_test_db().await;
        let wb = get_agent_by_id(&pool, "workbuddy")
            .await
            .unwrap()
            .expect("WorkBuddy agent should exist");
        assert_eq!(wb.display_name, "WorkBuddy");
        assert!(
            wb.global_skills_dir
                .contains(".workbuddy/skills-marketplace/skills"),
            "WorkBuddy should scan ~/.workbuddy/skills-marketplace/skills, got: {}",
            wb.global_skills_dir
        );
    }

    #[tokio::test]
    async fn test_autoclaw_is_separate_from_workbuddy() {
        let pool = setup_test_db().await;
        let ac = get_agent_by_id(&pool, "autoclaw")
            .await
            .unwrap()
            .expect("AutoClaw agent should exist");
        assert_eq!(ac.display_name, "AutoClaw");
        assert_eq!(ac.category, "lobster");
        assert!(
            ac.global_skills_dir.contains(".openclaw-autoclaw/skills"),
            "AutoClaw should scan ~/.openclaw-autoclaw/skills, got: {}",
            ac.global_skills_dir
        );
        // Verify AutoClaw and WorkBuddy are distinct entries
        assert_ne!(ac.id, "workbuddy");
        assert_ne!(
            ac.global_skills_dir,
            get_agent_by_id(&pool, "workbuddy")
                .await
                .unwrap()
                .unwrap()
                .global_skills_dir
        );
    }

    // ── Collections ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_create_collection() {
        let pool = setup_test_db().await;
        let col = create_collection(&pool, "My Collection", Some("A test collection"))
            .await
            .unwrap();
        assert!(!col.id.is_empty());
        assert_eq!(col.name, "My Collection");
        assert_eq!(col.description.as_deref(), Some("A test collection"));
    }

    #[tokio::test]
    async fn test_get_all_collections() {
        let pool = setup_test_db().await;
        create_collection(&pool, "Collection A", None)
            .await
            .unwrap();
        create_collection(&pool, "Collection B", Some("Desc"))
            .await
            .unwrap();

        let all = get_all_collections(&pool).await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_update_collection() {
        let pool = setup_test_db().await;
        let col = create_collection(&pool, "Old Name", None).await.unwrap();
        update_collection(&pool, &col.id, "New Name", Some("New desc"))
            .await
            .unwrap();

        let updated = get_collection_by_id(&pool, &col.id).await.unwrap().unwrap();
        assert_eq!(updated.name, "New Name");
        assert_eq!(updated.description.as_deref(), Some("New desc"));
    }

    #[tokio::test]
    async fn test_delete_collection() {
        let pool = setup_test_db().await;
        let col = create_collection(&pool, "To Delete", None).await.unwrap();
        delete_collection(&pool, &col.id).await.unwrap();

        let retrieved = get_collection_by_id(&pool, &col.id).await.unwrap();
        assert!(retrieved.is_none());
    }

    #[tokio::test]
    async fn test_add_and_remove_skill_from_collection() {
        let pool = setup_test_db().await;
        let skill = make_skill("collection-skill", "Collection Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();
        let col = create_collection(&pool, "Test Col", None).await.unwrap();

        add_skill_to_collection(&pool, &col.id, "collection-skill")
            .await
            .unwrap();

        let skills = get_collection_skills(&pool, &col.id).await.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "collection-skill");

        remove_skill_from_collection(&pool, &col.id, "collection-skill")
            .await
            .unwrap();

        let skills_after = get_collection_skills(&pool, &col.id).await.unwrap();
        assert!(skills_after.is_empty());
    }

    #[tokio::test]
    async fn test_add_skill_to_collection_is_idempotent() {
        let pool = setup_test_db().await;
        let skill = make_skill("idem-skill", "Idem Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();
        let col = create_collection(&pool, "Idem Col", None).await.unwrap();

        add_skill_to_collection(&pool, &col.id, "idem-skill")
            .await
            .unwrap();
        add_skill_to_collection(&pool, &col.id, "idem-skill")
            .await
            .unwrap();

        let skills = get_collection_skills(&pool, &col.id).await.unwrap();
        assert_eq!(skills.len(), 1, "Duplicate add should be a no-op");
    }

    #[tokio::test]
    async fn test_delete_collection_also_removes_skill_memberships() {
        let pool = setup_test_db().await;
        let skill = make_skill("cascade-skill", "Cascade Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();
        let col = create_collection(&pool, "Cascade Col", None).await.unwrap();
        add_skill_to_collection(&pool, &col.id, "cascade-skill")
            .await
            .unwrap();

        delete_collection(&pool, &col.id).await.unwrap();

        // The collection_skills row should also be gone
        let rows: Vec<_> = sqlx::query("SELECT * FROM collection_skills WHERE collection_id = ?")
            .bind(&col.id)
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(rows.is_empty(), "Memberships should be cascade-deleted");
    }

    // ── Scan Directories ──────────────────────────────────────────────────────

    /// Returns the number of *unique* global_skills_dir paths across all
    /// built-in agents.  This is the number of rows that seed_builtin_scan_directories
    /// inserts (codex and central share ~/.agents/skills, so the count is 10).
    fn expected_builtin_scan_dir_count() -> usize {
        let mut paths = std::collections::HashSet::new();
        for agent in builtin_agents() {
            paths.insert(agent.global_skills_dir);
        }
        paths.len()
    }

    #[tokio::test]
    async fn test_builtin_scan_dirs_seeded() {
        let pool = setup_test_db().await;
        let dirs = get_scan_directories(&pool).await.unwrap();
        let builtin_count = expected_builtin_scan_dir_count();

        // Expect exactly one row per unique global_skills_dir across built-in agents.
        assert_eq!(
            dirs.len(),
            builtin_count,
            "Should have {} built-in scan directories after init (got {})",
            builtin_count,
            dirs.len()
        );

        // Every seeded row must be marked as built-in and active.
        for dir in &dirs {
            assert!(
                dir.is_builtin,
                "Seeded scan directory '{}' must have is_builtin=true",
                dir.path
            );
            assert!(
                dir.is_active,
                "Seeded scan directory '{}' must be active by default",
                dir.path
            );
        }

        // The paths must match the unique global_skills_dir values.
        let seeded_paths: std::collections::HashSet<&str> =
            dirs.iter().map(|d| d.path.as_str()).collect();
        for agent in builtin_agents() {
            assert!(
                seeded_paths.contains(agent.global_skills_dir.as_str()),
                "Built-in agent '{}' global_skills_dir '{}' must be in scan_directories",
                agent.id,
                agent.global_skills_dir
            );
        }
    }

    #[tokio::test]
    async fn test_builtin_scan_dirs_seeded_is_idempotent() {
        let pool = setup_test_db().await;
        // Second call to init_database must not create duplicate rows.
        init_database(&pool).await.unwrap();
        let dirs = get_scan_directories(&pool).await.unwrap();
        let builtin_count = expected_builtin_scan_dir_count();
        assert_eq!(
            dirs.len(),
            builtin_count,
            "Repeated init must not create duplicate scan directory rows"
        );
    }

    #[tokio::test]
    async fn test_add_scan_directory() {
        let pool = setup_test_db().await;
        let dir = add_scan_directory(&pool, "/tmp/my-project", Some("My Project"))
            .await
            .unwrap();
        assert_eq!(dir.path, "/tmp/my-project");
        assert_eq!(dir.label.as_deref(), Some("My Project"));
        assert!(dir.is_active);
        assert!(!dir.is_builtin);
    }

    #[tokio::test]
    async fn test_get_scan_directories() {
        let pool = setup_test_db().await;
        add_scan_directory(&pool, "/tmp/dir-a", None).await.unwrap();
        add_scan_directory(&pool, "/tmp/dir-b", Some("Dir B"))
            .await
            .unwrap();

        let dirs = get_scan_directories(&pool).await.unwrap();
        // There are N built-in dirs (seeded on init) plus the 2 we just added.
        let builtin_count = expected_builtin_scan_dir_count();
        assert_eq!(dirs.len(), builtin_count + 2);

        // Verify the custom ones are present.
        let paths: Vec<&str> = dirs.iter().map(|d| d.path.as_str()).collect();
        assert!(paths.contains(&"/tmp/dir-a"));
        assert!(paths.contains(&"/tmp/dir-b"));
    }

    #[tokio::test]
    async fn test_remove_scan_directory() {
        let pool = setup_test_db().await;
        add_scan_directory(&pool, "/tmp/removable", None)
            .await
            .unwrap();
        remove_scan_directory(&pool, "/tmp/removable")
            .await
            .unwrap();

        let dirs = get_scan_directories(&pool).await.unwrap();
        // Built-in dirs remain; only the custom one is removed.
        let builtin_count = expected_builtin_scan_dir_count();
        assert_eq!(dirs.len(), builtin_count);
        assert!(!dirs.iter().any(|d| d.path == "/tmp/removable"));
    }

    #[tokio::test]
    async fn test_cannot_remove_builtin_scan_directory() {
        let pool = setup_test_db().await;
        // Manually insert a builtin directory
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO scan_directories (path, is_active, is_builtin, added_at)
             VALUES ('/builtin/path', 1, 1, ?)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let result = remove_scan_directory(&pool, "/builtin/path").await;
        assert!(
            result.is_err(),
            "Should not remove a builtin scan directory"
        );
    }

    #[tokio::test]
    async fn test_remove_nonexistent_scan_directory_returns_error() {
        let pool = setup_test_db().await;
        let result = remove_scan_directory(&pool, "/nonexistent/path").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_toggle_scan_directory() {
        let pool = setup_test_db().await;
        add_scan_directory(&pool, "/tmp/toggle-dir", None)
            .await
            .unwrap();
        toggle_scan_directory(&pool, "/tmp/toggle-dir", false)
            .await
            .unwrap();

        let dirs = get_scan_directories(&pool).await.unwrap();
        let dir = dirs.iter().find(|d| d.path == "/tmp/toggle-dir").unwrap();
        assert!(!dir.is_active);
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_set_and_get_setting() {
        let pool = setup_test_db().await;
        set_setting(&pool, "theme", "dark").await.unwrap();
        let value = get_setting(&pool, "theme").await.unwrap();
        assert_eq!(value.as_deref(), Some("dark"));
    }

    #[tokio::test]
    async fn test_get_missing_setting_returns_none() {
        let pool = setup_test_db().await;
        let value = get_setting(&pool, "nonexistent_key").await.unwrap();
        assert!(value.is_none());
    }

    #[tokio::test]
    async fn test_set_setting_upserts() {
        let pool = setup_test_db().await;
        set_setting(&pool, "lang", "en").await.unwrap();
        set_setting(&pool, "lang", "zh").await.unwrap();
        let value = get_setting(&pool, "lang").await.unwrap();
        assert_eq!(value.as_deref(), Some("zh"));
    }

    #[tokio::test]
    async fn test_multiple_settings() {
        let pool = setup_test_db().await;
        set_setting(&pool, "key1", "val1").await.unwrap();
        set_setting(&pool, "key2", "val2").await.unwrap();
        set_setting(&pool, "key3", "val3").await.unwrap();

        assert_eq!(
            get_setting(&pool, "key1").await.unwrap().as_deref(),
            Some("val1")
        );
        assert_eq!(
            get_setting(&pool, "key2").await.unwrap().as_deref(),
            Some("val2")
        );
        assert_eq!(
            get_setting(&pool, "key3").await.unwrap().as_deref(),
            Some("val3")
        );
    }

    // ── Migration: created_at ─────────────────────────────────────────────────

    /// Verifies that `init_database` adds the `created_at` column to an existing
    /// `skill_installations` table that was created with the old schema (before
    /// the column was introduced), and that existing rows are backfilled.
    #[tokio::test]
    async fn test_migration_adds_created_at_to_skill_installations() {
        // Create a fresh in-memory pool WITHOUT calling init_database first.
        let pool = SqlitePool::connect(":memory:")
            .await
            .expect("Failed to create in-memory SQLite pool");

        // Build the OLD skill_installations schema — no created_at column.
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS skill_installations (
                skill_id       TEXT NOT NULL,
                agent_id       TEXT NOT NULL,
                installed_path TEXT NOT NULL,
                link_type      TEXT NOT NULL,
                symlink_target TEXT,
                PRIMARY KEY (skill_id, agent_id)
            )",
        )
        .execute(&pool)
        .await
        .expect("Failed to create old skill_installations table");

        // Create the skills table so the FK-style relationship is consistent.
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS skills (
                id             TEXT PRIMARY KEY,
                name           TEXT NOT NULL,
                description    TEXT,
                file_path      TEXT NOT NULL,
                canonical_path TEXT,
                is_central     BOOLEAN NOT NULL DEFAULT 0,
                source         TEXT,
                content        TEXT,
                scanned_at     TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("Failed to create skills table");

        // Insert a skill row (needed before the installation row references it).
        sqlx::query(
            "INSERT INTO skills (id, name, file_path, is_central, scanned_at)
             VALUES ('legacy-skill', 'Legacy Skill', '/tmp/legacy-skill/SKILL.md', 0, '2024-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("Failed to insert legacy skill");

        // Insert an installation row using the OLD schema (no created_at column).
        sqlx::query(
            "INSERT INTO skill_installations (skill_id, agent_id, installed_path, link_type)
             VALUES ('legacy-skill', 'claude-code', '/tmp/claude/legacy-skill', 'symlink')",
        )
        .execute(&pool)
        .await
        .expect("Failed to insert legacy skill_installations row");

        // Run init_database — should detect the missing created_at column and add it.
        init_database(&pool)
            .await
            .expect("init_database should succeed and apply the created_at migration");

        // Confirm the column now exists in PRAGMA table_info.
        let columns = sqlx::query("PRAGMA table_info(skill_installations)")
            .fetch_all(&pool)
            .await
            .expect("PRAGMA table_info should succeed");

        let has_created_at = columns.iter().any(|row| {
            row.try_get::<String, _>("name")
                .map(|name| name == "created_at")
                .unwrap_or(false)
        });
        assert!(
            has_created_at,
            "created_at column must exist in skill_installations after migration"
        );

        // Confirm that the pre-existing row has a non-empty created_at value
        // (backfilled by the DEFAULT (datetime('now')) expression).
        let row = sqlx::query(
            "SELECT created_at FROM skill_installations \
             WHERE skill_id = 'legacy-skill' AND agent_id = 'claude-code'",
        )
        .fetch_one(&pool)
        .await
        .expect("Pre-existing installation row should still be queryable after migration");

        let created_at: String = row
            .try_get("created_at")
            .expect("created_at should be readable from the pre-existing row");
        assert!(
            !created_at.is_empty(),
            "Pre-existing rows must have a non-empty created_at value after migration (got: '{}')",
            created_at
        );
    }

    /// Verifies that calling `init_database` on a fresh database (one that already
    /// includes created_at in the CREATE TABLE) does NOT trigger the ALTER TABLE
    /// migration path — i.e., the second `init_database` call is fully idempotent
    /// and does not fail.
    #[tokio::test]
    async fn test_migration_skipped_when_created_at_already_exists() {
        // setup_test_db calls init_database, which creates the table WITH created_at.
        let pool = setup_test_db().await;

        // A second call to init_database must succeed without error (idempotent).
        let result = init_database(&pool).await;
        assert!(
            result.is_ok(),
            "Second init_database should be idempotent when created_at already exists"
        );

        // Confirm created_at is still present and there's exactly one occurrence.
        let columns = sqlx::query("PRAGMA table_info(skill_installations)")
            .fetch_all(&pool)
            .await
            .unwrap();
        let created_at_count = columns
            .iter()
            .filter(|row| {
                row.try_get::<String, _>("name")
                    .map(|name| name == "created_at")
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(
            created_at_count, 1,
            "created_at column should appear exactly once after repeated init"
        );
    }
}
