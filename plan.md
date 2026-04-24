# 计划：中央 Skills 仓库路径可配置

## 概览

当前中央 skills 路径硬编码为 `~/.agents/skills/`，定义在 `path_utils.rs:45-47`，同时 `codex` 和 `central` 两个内置 agent 也硬编码此路径。本计划将此路径改造为可通过设置页面配置。

## 改动清单

### Rust 后端

| # | 文件 | 改动 |
|---|------|------|
| 1 | `db.rs` | 新增 `update_agent_global_skills_dir(pool, agent_id, new_dir)` 函数 |
| 2 | `commands/settings.rs` | 新增两个 `impl` 函数 + 两个 Tauri command：<br>`get_central_skills_dir_impl(pool)` - 读 setting，无则回退到 `path_utils::central_skills_dir()`<br>`set_central_skills_dir_impl(pool, path)` - 验证、保存 setting、更新 `central` agent 的 `global_skills_dir` |
| 3 | `commands/discover.rs` | 3 处 `central_skills_dir()` 调用改为从 DB 读取（所有调用方都有 `state.db`） |
| 4 | `commands/marketplace.rs` | 2 处 `central_skills_dir()` 调用改为从 DB 读取（`sync_registry_impl` 有 `pool` 参数，`install_marketplace_skill` 有 `state.db`） |
| 5 | `lib.rs` | 注册新命令 `get_central_skills_dir` / `set_central_skills_dir` |

### 前端

| # | 文件 | 改动 |
|---|------|------|
| 6 | `settingsStore.ts` | 新增 `centralSkillsDir` 状态 + `loadCentralSkillsDir` / `saveCentralSkillsDir` 动作 |
| 7 | `SettingsView.tsx` | 在 GitHub Import Auth 卡片后新增「中央技能目录」设置卡片（显示当前路径 + 输入框 + 保存按钮 + 重置按钮） |
| 8 | `en.json` + `zh.json` | 新增 `settings.centralDir*` 翻译键 |

## 详细设计

### Rust: `db.rs`

新增函数：
```rust
pub async fn update_agent_global_skills_dir(
    pool: &DbPool,
    agent_id: &str,
    new_dir: &str,
) -> Result<(), String> {
    sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = ?")
        .bind(new_dir)
        .bind(agent_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}
```

### Rust: `commands/settings.rs`

```rust
pub async fn get_central_skills_dir_impl(pool: &DbPool) -> Result<String, String> {
    let setting = db::get_setting(pool, "central_skills_dir").await?;
    match setting {
        Some(path) if !path.trim().is_empty() => Ok(path),
        _ => Ok(path_to_string(&central_skills_dir())),
    }
}

pub async fn set_central_skills_dir_impl(pool: &DbPool, path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Central skills directory path cannot be empty".to_string());
    }
    let expanded = path_to_string(&expand_home_path(path));
    // Save to settings
    db::set_setting(pool, "central_skills_dir", &expanded).await?;
    // Update the central agent's dir
    db::update_agent_global_skills_dir(pool, "central", &expanded).await?;
    Ok(expanded)
}
```

Tauri commands `get_central_skills_dir` / `set_central_skills_dir` 为对上述的薄包装。

### Rust: 调用方替换

**`discover.rs`** - 所有三处:
```rust
// 原: let central_dir = central_skills_dir();
// 新: let central_dir = PathBuf::from(commands::settings::get_central_skills_dir_impl(pool).await?);
```
其中 `pool = &state.db`。

**`marketplace.rs`** - 两处:
- `sync_registry_impl`: 已有 `pool` 参数，同上替换
- `install_marketplace_skill`: 有 `state.db`，同上替换

### 前端: `settingsStore.ts`

```typescript
interface SettingsState {
  // ... 现有 ...
  centralSkillsDir: string;
  isLoadingCentralDir: boolean;
  isSavingCentralDir: boolean;
  // 新动作
  loadCentralSkillsDir: () => Promise<void>;
  saveCentralSkillsDir: (path: string) => Promise<void>;
  resetCentralSkillsDir: () => Promise<void>;
}
```

### 前端: `SettingsView.tsx`

在 GitHub Import Auth 卡片（Section 2）之后、AI Provider 卡片（Section 3）之前插入新卡片：

- 标题：「中央技能目录」/ "Central Skills Directory"
- 描述：说明当前中央目录路径
- Input 显示当前路径，支持 `~` 缩写
- 保存按钮 + 重置为默认按钮
- 保存后刷新 store

### 前端: i18n

新增键：
```json
{
  "centralDirTitle": "中央技能目录 / Central Skills Directory",
  "centralDirDesc": "设置中央技能仓库的存储路径。修改后需要重新扫描技能。",
  "centralDirLabel": "路径",
  "centralDirSave": "保存",
  "centralDirReset": "重置为默认",
  "centralDirSaved": "中央目录路径已保存",
  "centralDirResetDone": "已重置为默认路径"
}
```

## 注意事项

- `codex` agent 的路径**不**随中央路径改变（codex 代表真实的 Codex CLI 安装路径）
- 修改中央路径后，用户需要手动触发重新扫描（现有 UI 的 Scan 功能）
- `central` agent 的 `global_skills_dir` 会在保存时同步更新，保证 `linker.rs` 使用正确路径
- 旧路径的技能**不会**自动迁移到新路径（这是未来的增强点）
