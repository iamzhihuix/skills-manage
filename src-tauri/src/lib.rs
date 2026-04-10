pub mod commands;
pub mod db;

use db::DbPool;
use std::fs;
use tauri::Manager;

/// Application state shared across Tauri commands.
pub struct AppState {
    pub db: DbPool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Resolve ~/.skillsmanage/db.sqlite
            let home_dir = app
                .path()
                .home_dir()
                .expect("Failed to resolve home directory");
            let db_dir = home_dir.join(".skillsmanage");
            fs::create_dir_all(&db_dir)
                .expect("Failed to create ~/.skillsmanage directory");
            let db_path = db_dir
                .join("db.sqlite")
                .to_string_lossy()
                .into_owned();

            // Create pool and initialize schema
            let pool = tauri::async_runtime::block_on(async {
                db::create_pool(&db_path)
                    .await
                    .expect("Failed to open SQLite database")
            });
            tauri::async_runtime::block_on(async {
                db::init_database(&pool)
                    .await
                    .expect("Failed to initialize database schema")
            });

            app.manage(AppState { db: pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Scanner
            commands::scanner::scan_all_skills,
            // Agents
            commands::agents::get_agents,
            commands::agents::detect_agents,
            commands::agents::add_custom_agent,
            // Linker
            commands::linker::install_skill_to_agent,
            commands::linker::uninstall_skill_from_agent,
            commands::linker::batch_install_to_agents,
            // Skills
            commands::skills::get_skills_by_agent,
            commands::skills::get_central_skills,
            commands::skills::get_skill_detail,
            commands::skills::read_skill_content,
            // Collections
            commands::collections::create_collection,
            commands::collections::get_collections,
            commands::collections::get_collection_detail,
            commands::collections::add_skill_to_collection,
            commands::collections::remove_skill_from_collection,
            commands::collections::delete_collection,
            commands::collections::update_collection,
            commands::collections::batch_install_collection,
            commands::collections::export_collection,
            commands::collections::import_collection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
