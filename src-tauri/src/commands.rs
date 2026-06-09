use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{AppHandle, State};

use crate::file_system::{self, FileOperationResult, FileVersion, TextFileRead};
use crate::file_watcher::{FileWatcherState, WatchWorkspaceHandle};
use crate::metrics::{snapshot, AppMetricSnapshot};
use crate::search::WorkspaceSearchResult;
use crate::settings::{AppSettings, SettingsStore};
use crate::tasks::{TaskRun, TaskState, WorkspaceTask};
use crate::terminal::{TerminalSessionInfo, TerminalState};
use crate::workspace::{Workspace, WorkspaceRegistry};
use crate::workspace_scan::{self, FileTreeEntry};
use crate::workspace_store::WorkspaceRegistryStore;

pub struct AppState {
    registry: Mutex<WorkspaceRegistry>,
    registry_store: WorkspaceRegistryStore,
    settings: Mutex<AppSettings>,
    settings_store: SettingsStore,
    docs_store: crate::docs::ContextPackStore,
}

impl AppState {
    pub fn new(config_dir: impl AsRef<Path>) -> Result<Self, String> {
        let registry_store =
            WorkspaceRegistryStore::new(config_dir.as_ref().join("workspace-registry.json"));
        let registry = registry_store.load()?;
        let settings_store = SettingsStore::new(config_dir.as_ref().join("settings.json"));
        let settings = settings_store.load()?;
        let docs_store =
            crate::docs::ContextPackStore::new(config_dir.as_ref().join("context-packs.json"));

        Ok(Self {
            registry: Mutex::new(registry),
            registry_store,
            settings: Mutex::new(settings),
            settings_store,
            docs_store,
        })
    }

    fn mutate_registry(
        &self,
        mutate: impl FnOnce(&mut WorkspaceRegistry) -> Result<(), String>,
    ) -> Result<WorkspaceRegistry, String> {
        let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
        let mut candidate = registry.clone();
        mutate(&mut candidate)?;
        self.registry_store.save(&candidate)?;
        *registry = candidate.clone();
        Ok(candidate)
    }

    pub fn registry_snapshot(&self) -> Result<WorkspaceRegistry, String> {
        let registry = self.registry.lock().map_err(|err| err.to_string())?;
        Ok(registry.clone())
    }

    pub fn trusted_workspace_root(&self, workspace_root: &str) -> Result<PathBuf, String> {
        let supplied = Path::new(workspace_root)
            .canonicalize()
            .map_err(|_| format!("workspace not registered: {workspace_root}"))?;
        let registry = self.registry.lock().map_err(|err| err.to_string())?;

        for workspace in &registry.workspaces {
            let Ok(registered) = workspace.path.canonicalize() else {
                continue;
            };
            if supplied == registered {
                return Ok(registered);
            }
        }

        Err(format!("workspace not registered: {workspace_root}"))
    }

    fn active_workspace_root(&self) -> Result<PathBuf, String> {
        let registry = self.registry.lock().map_err(|err| err.to_string())?;
        let active_id = registry
            .active_workspace_id
            .as_deref()
            .ok_or_else(|| "no active workspace selected".to_string())?;
        let workspace = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.id == active_id)
            .ok_or_else(|| format!("active workspace not found: {active_id}"))?;

        workspace
            .path
            .canonicalize()
            .map_err(|err| format!("active workspace unavailable: {err}"))
    }

    fn ensure_context_pack_in_active_workspace(&self, id: &str) -> Result<(), String> {
        let active_workspace_root = self.active_workspace_root()?;
        let pack_workspace_root = self.docs_store.pack_workspace_root(id)?;
        if pack_workspace_root == active_workspace_root.to_string_lossy() {
            return Ok(());
        }

        Err(format!(
            "context pack does not belong to active workspace: {id}"
        ))
    }

    pub fn settings_snapshot(&self) -> Result<AppSettings, String> {
        let settings = self.settings.lock().map_err(|err| err.to_string())?;
        Ok(settings.clone())
    }

    pub fn save_settings(&self, settings: AppSettings) -> Result<AppSettings, String> {
        let mut current = self.settings.lock().map_err(|err| err.to_string())?;
        self.settings_store.save(&settings)?;
        *current = settings.clone();
        Ok(settings)
    }

    pub fn open_workspace_path(&self, path: PathBuf) -> Result<WorkspaceRegistry, String> {
        if !path.is_dir() {
            return Err(format!(
                "workspace path is not a directory: {}",
                path.display()
            ));
        }

        self.mutate_registry(|registry| {
            registry.add_workspace(Workspace::from_path(path));
            Ok(())
        })
    }

    pub fn list_context_packs(
        &self,
        workspace_root: &str,
    ) -> Result<Vec<crate::docs::ContextPack>, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.docs_store
            .list_packs(&workspace_root.to_string_lossy())
    }

    pub fn create_context_pack(
        &self,
        workspace_root: &str,
        name: String,
        doc_paths: Vec<String>,
    ) -> Result<crate::docs::ContextPack, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        for doc_path in &doc_paths {
            crate::docs::preview_doc(&workspace_root, doc_path)?;
        }
        self.docs_store
            .create_pack(&workspace_root.to_string_lossy(), &name, doc_paths)
    }

    pub fn delete_context_pack(&self, id: String) -> Result<(), String> {
        self.ensure_context_pack_in_active_workspace(&id)?;
        self.docs_store.delete_pack(&id)
    }

    pub fn link_context_pack(
        &self,
        id: String,
        task_run_id: Option<String>,
        agent_session_id: Option<String>,
    ) -> Result<crate::docs::ContextPack, String> {
        self.ensure_context_pack_in_active_workspace(&id)?;
        self.docs_store
            .link_pack(&id, task_run_id.as_deref(), agent_session_id.as_deref())
    }
}

#[tauri::command]
pub fn load_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.settings_snapshot()
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    state.save_settings(settings)
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<WorkspaceRegistry, String> {
    state.registry_snapshot()
}

#[tauri::command]
pub fn add_workspace(
    state: State<'_, AppState>,
    workspace: Workspace,
) -> Result<WorkspaceRegistry, String> {
    state.mutate_registry(|registry| {
        registry.add_workspace(workspace);
        Ok(())
    })
}

#[tauri::command]
pub fn switch_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<WorkspaceRegistry, String> {
    state.mutate_registry(|registry| {
        if registry.switch_workspace(&id) {
            Ok(())
        } else {
            Err(format!("workspace not found: {id}"))
        }
    })
}

#[tauri::command]
pub fn open_workspace_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<WorkspaceRegistry, String> {
    state.open_workspace_path(PathBuf::from(path))
}

#[tauri::command]
pub fn remove_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<WorkspaceRegistry, String> {
    state.mutate_registry(|registry| {
        if registry.remove_workspace(&id) {
            Ok(())
        } else {
            Err(format!("workspace not found: {id}"))
        }
    })
}

#[tauri::command]
pub fn pin_workspace(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<WorkspaceRegistry, String> {
    state.mutate_registry(|registry| {
        if registry.set_workspace_pinned(&id, pinned) {
            Ok(())
        } else {
            Err(format!("workspace not found: {id}"))
        }
    })
}

#[tauri::command]
pub fn scan_workspace(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<FileTreeEntry>, String> {
    scan_workspace_root(state.inner(), &path)
}

fn scan_workspace_root(state: &AppState, path: &str) -> Result<Vec<FileTreeEntry>, String> {
    let workspace_root = state.trusted_workspace_root(path)?;
    workspace_scan::scan_top_level(&workspace_root)
}

#[tauri::command]
pub fn scan_directory(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<Vec<FileTreeEntry>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    workspace_scan::scan_directory(&workspace_root, Path::new(&path))
}

#[tauri::command]
pub fn search_workspace(
    state: State<'_, AppState>,
    workspace_root: String,
    query: String,
) -> Result<WorkspaceSearchResult, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::search::search_workspace(
        &workspace_root,
        &query,
        100,
        file_system::EDITABLE_TEXT_LIMIT_BYTES,
    )
}

#[tauri::command]
pub fn docs_index(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::docs::DocIndexEntry>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::docs::index_docs(&workspace_root)
}

#[tauri::command]
pub fn docs_preview(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<crate::docs::DocPreview, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::docs::preview_doc(&workspace_root, &path)
}

#[tauri::command]
pub fn docs_search(
    state: State<'_, AppState>,
    workspace_root: String,
    query: String,
) -> Result<crate::docs::DocSearchResult, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::docs::search_docs(&workspace_root, &query, crate::docs::MAX_DOC_SEARCH_RESULTS)
}

#[tauri::command]
pub fn list_context_packs(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::docs::ContextPack>, String> {
    state.list_context_packs(&workspace_root)
}

#[tauri::command]
pub fn create_context_pack(
    state: State<'_, AppState>,
    workspace_root: String,
    name: String,
    doc_paths: Vec<String>,
) -> Result<crate::docs::ContextPack, String> {
    state.create_context_pack(&workspace_root, name, doc_paths)
}

#[tauri::command]
pub fn delete_context_pack(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.delete_context_pack(id)
}

#[tauri::command]
pub fn link_context_pack(
    state: State<'_, AppState>,
    id: String,
    task_run_id: Option<String>,
    agent_session_id: Option<String>,
) -> Result<crate::docs::ContextPack, String> {
    state.link_context_pack(id, task_run_id, agent_session_id)
}

#[tauri::command]
pub fn git_status(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::repository_status(&workspace_root)
}

#[tauri::command]
pub fn git_diff_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
    staged: bool,
) -> Result<crate::git::GitDiff, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::diff_file(&workspace_root, &path, staged)
}

#[tauri::command]
pub fn git_stage_paths(
    state: State<'_, AppState>,
    workspace_root: String,
    paths: Vec<String>,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::stage_paths(&workspace_root, &paths)
}

#[tauri::command]
pub fn git_unstage_paths(
    state: State<'_, AppState>,
    workspace_root: String,
    paths: Vec<String>,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::unstage_paths(&workspace_root, &paths)
}

#[tauri::command]
pub fn git_discard_paths(
    state: State<'_, AppState>,
    workspace_root: String,
    paths: Vec<String>,
    confirmation: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::discard_paths(&workspace_root, &paths, &confirmation)
}

#[tauri::command]
pub fn git_commit(
    state: State<'_, AppState>,
    workspace_root: String,
    message: String,
    amend: bool,
    push_after: bool,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::commit(&workspace_root, &message, amend, push_after)
}

#[tauri::command]
pub fn git_stash(
    state: State<'_, AppState>,
    workspace_root: String,
    message: String,
    include_untracked: bool,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::stash(&workspace_root, &message, include_untracked)
}

#[tauri::command]
pub fn git_list_branches(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::git::GitBranch>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::list_branches(&workspace_root)
}

#[tauri::command]
pub fn git_create_branch(
    state: State<'_, AppState>,
    workspace_root: String,
    name: String,
) -> Result<Vec<crate::git::GitBranch>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::create_branch(&workspace_root, &name)
}

#[tauri::command]
pub fn git_checkout_branch(
    state: State<'_, AppState>,
    workspace_root: String,
    name: String,
    confirmation: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::checkout_branch(&workspace_root, &name, &confirmation)
}

#[tauri::command]
pub fn git_fetch(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::fetch(&workspace_root)
}

#[tauri::command]
pub fn git_pull(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::pull(&workspace_root)
}

#[tauri::command]
pub fn git_push(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::push(&workspace_root)
}

#[tauri::command]
pub fn git_commit_graph(
    state: State<'_, AppState>,
    workspace_root: String,
    limit: usize,
) -> Result<Vec<crate::git::GitCommitSummary>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::commit_graph(&workspace_root, limit)
}

#[tauri::command]
pub fn git_reset_hard(
    state: State<'_, AppState>,
    workspace_root: String,
    confirmation: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::reset_hard(&workspace_root, &confirmation)
}

#[tauri::command]
pub fn git_rebase_onto(
    state: State<'_, AppState>,
    workspace_root: String,
    target: String,
    confirmation: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::rebase_onto(&workspace_root, &target, &confirmation)
}

#[tauri::command]
pub fn watch_workspace(
    app: AppHandle,
    app_state: State<'_, AppState>,
    watcher_state: State<'_, FileWatcherState>,
    workspace_root: String,
) -> Result<WatchWorkspaceHandle, String> {
    let workspace_root = app_state.trusted_workspace_root(&workspace_root)?;
    watcher_state.watch_workspace(app, workspace_root)
}

#[tauri::command]
pub fn unwatch_workspace(
    watcher_state: State<'_, FileWatcherState>,
    handle: WatchWorkspaceHandle,
) -> Result<(), String> {
    watcher_state.unwatch_workspace(handle)
}

#[tauri::command]
pub fn terminal_probe() -> Result<String, String> {
    crate::pty::spawn_shell_probe()
}

#[tauri::command]
pub fn list_terminal_sessions(
    state: State<'_, TerminalState>,
    workspace_id: String,
) -> Result<Vec<TerminalSessionInfo>, String> {
    state.list_sessions(&workspace_id)
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri command exposes the planned flat frontend API contract"
)]
pub fn spawn_terminal_session(
    app: AppHandle,
    app_state: State<'_, AppState>,
    terminal_state: State<'_, TerminalState>,
    workspace_id: String,
    workspace_root: String,
    cwd: String,
    name: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<TerminalSessionInfo, String> {
    let workspace_root = app_state.trusted_workspace_root(&workspace_root)?;
    let cwd = file_system::workspace_child_for_existing_dir(&workspace_root, Path::new(&cwd))?;
    terminal_state.spawn_session(app, workspace_id, cwd, name, rows, cols)
}

#[tauri::command]
pub fn write_terminal_session(
    state: State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.write_session(&session_id, &data)
}

#[tauri::command]
pub fn close_terminal_session(
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<TerminalSessionInfo, String> {
    state.close_session(&session_id)
}

#[tauri::command]
pub fn list_workspace_tasks(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<WorkspaceTask>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::tasks::detect_tasks(&workspace_root)
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri command exposes the planned flat frontend API contract"
)]
pub fn run_workspace_task(
    app: AppHandle,
    app_state: State<'_, AppState>,
    task_state: State<'_, TaskState>,
    workspace_id: String,
    workspace_root: String,
    label: String,
    command: String,
    cwd: String,
) -> Result<TaskRun, String> {
    let workspace_root = app_state.trusted_workspace_root(&workspace_root)?;
    let cwd = file_system::workspace_child_for_existing_dir(&workspace_root, Path::new(&cwd))?;
    task_state.run_task(app, workspace_id, label, command, cwd)
}

#[tauri::command]
pub fn stop_task_run(task_state: State<'_, TaskState>, run_id: String) -> Result<TaskRun, String> {
    task_state.stop_task(&run_id)
}

#[tauri::command]
pub fn list_task_runs(
    task_state: State<'_, TaskState>,
    workspace_id: String,
) -> Result<Vec<TaskRun>, String> {
    task_state.list_runs(&workspace_id)
}

#[tauri::command]
pub fn metric_snapshot() -> Result<AppMetricSnapshot, String> {
    Ok(snapshot())
}

#[tauri::command]
pub fn read_text_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<TextFileRead, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    file_system::read_text_file(
        &workspace_root,
        Path::new(&path),
        file_system::EDITABLE_TEXT_LIMIT_BYTES,
    )
}

#[tauri::command]
pub fn write_text_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
    content: String,
    expected_version: Option<FileVersion>,
) -> Result<FileOperationResult, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    file_system::write_text_file(
        &workspace_root,
        Path::new(&path),
        &content,
        expected_version,
    )
}

#[tauri::command]
pub fn create_text_file(
    state: State<'_, AppState>,
    workspace_root: String,
    relative_path: String,
) -> Result<FileOperationResult, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    file_system::create_text_file(&workspace_root, &relative_path)
}

#[tauri::command]
pub fn rename_path(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
    new_name: String,
) -> Result<FileOperationResult, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    file_system::rename_path(&workspace_root, Path::new(&path), &new_name)
}

#[tauri::command]
pub fn delete_path(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<(), String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    file_system::delete_path(&workspace_root, Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[cfg(unix)]
    struct PermissionGuard {
        path: PathBuf,
        mode: u32,
    }

    #[cfg(unix)]
    impl PermissionGuard {
        fn set(path: impl AsRef<Path>, mode: u32) -> Self {
            let path = path.as_ref().to_path_buf();
            let previous = std::fs::metadata(&path)
                .expect("metadata")
                .permissions()
                .mode();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode))
                .expect("set permissions");

            Self {
                path,
                mode: previous,
            }
        }
    }

    #[cfg(unix)]
    impl Drop for PermissionGuard {
        fn drop(&mut self) {
            let _ =
                std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(self.mode));
        }
    }

    fn settings(density: &str, color_theme: &str) -> AppSettings {
        AppSettings {
            density: density.to_string(),
            color_theme: color_theme.to_string(),
        }
    }

    #[test]
    fn app_state_loads_registry_from_store() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");

        let registry = state.registry_snapshot().expect("registry");

        assert_eq!(registry.workspaces.len(), 0);
    }

    #[test]
    fn app_state_loads_settings_from_store() {
        let temp = tempdir().expect("temp dir");
        let expected = settings("comfortable", "light");
        SettingsStore::new(temp.path().join("settings.json"))
            .save(&expected)
            .expect("save settings");

        let state = AppState::new(temp.path()).expect("state");

        assert_eq!(state.settings_snapshot().expect("settings"), expected);
    }

    #[test]
    fn app_state_persists_settings_changes() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");
        let changed = settings("comfortable", "light");

        state.save_settings(changed.clone()).expect("save settings");
        let reloaded = AppState::new(temp.path()).expect("reload");

        assert_eq!(reloaded.settings_snapshot().expect("settings"), changed);
    }

    #[test]
    fn app_state_persists_registry_mutations() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");
        let workspace_path = temp.path().join("project-a");
        std::fs::create_dir(&workspace_path).expect("project dir");

        state
            .open_workspace_path(workspace_path.clone())
            .expect("open");
        let reloaded = AppState::new(temp.path()).expect("reload");

        assert_eq!(
            reloaded
                .registry_snapshot()
                .expect("registry")
                .workspaces
                .len(),
            1
        );
    }

    #[test]
    fn trusted_workspace_root_accepts_registered_workspace() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");
        let workspace_path = temp.path().join("project-a");
        std::fs::create_dir(&workspace_path).expect("project dir");
        state
            .open_workspace_path(workspace_path.clone())
            .expect("open");

        let trusted = state
            .trusted_workspace_root(workspace_path.to_str().expect("workspace path"))
            .expect("trusted workspace");

        assert_eq!(trusted, workspace_path.canonicalize().expect("canonical"));
    }

    #[test]
    fn trusted_workspace_root_rejects_unregistered_workspace() {
        let config = tempdir().expect("config dir");
        let unregistered = tempdir().expect("unregistered workspace");
        let state = AppState::new(config.path()).expect("state");

        let result = state.trusted_workspace_root(unregistered.path().to_str().expect("path"));

        assert!(result.unwrap_err().contains("workspace not registered"));
    }

    #[test]
    fn scan_workspace_root_uses_trusted_canonical_root() {
        let config = tempdir().expect("config dir");
        let state = AppState::new(config.path()).expect("state");
        let workspace_path = config.path().join("project-a");
        let src_path = workspace_path.join("src");
        std::fs::create_dir(&workspace_path).expect("workspace dir");
        std::fs::create_dir(&src_path).expect("src dir");
        std::fs::File::create(src_path.join("main.ts")).expect("main file");
        state
            .open_workspace_path(workspace_path.clone())
            .expect("open workspace");

        let lexical_workspace = workspace_path.join(".");
        let entries =
            super::scan_workspace_root(&state, lexical_workspace.to_str().expect("workspace path"))
                .expect("scan workspace");

        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].path,
            workspace_path
                .canonicalize()
                .expect("canonical")
                .join("src"),
        );
    }

    #[test]
    fn scan_workspace_root_rejects_unregistered_workspace() {
        let config = tempdir().expect("config dir");
        let unregistered = tempdir().expect("unregistered workspace");
        let state = AppState::new(config.path()).expect("state");

        let result =
            super::scan_workspace_root(&state, unregistered.path().to_str().expect("path"));

        assert!(result.unwrap_err().contains("workspace not registered"));
    }

    #[test]
    fn spawn_terminal_session_preserves_flat_command_signature() {
        type FlatSpawnTerminalSessionCommand =
            for<'app_state, 'terminal_state> fn(
                AppHandle,
                State<'app_state, AppState>,
                State<'terminal_state, TerminalState>,
                String,
                String,
                String,
                Option<String>,
                u16,
                u16,
            ) -> Result<TerminalSessionInfo, String>;

        fn assert_flat_signature(_command: FlatSpawnTerminalSessionCommand) {}

        assert_flat_signature(super::spawn_terminal_session);
    }

    #[test]
    fn run_workspace_task_preserves_flat_command_signature() {
        type FlatRunWorkspaceTaskCommand =
            for<'app_state, 'task_state> fn(
                AppHandle,
                State<'app_state, AppState>,
                State<'task_state, crate::tasks::TaskState>,
                String,
                String,
                String,
                String,
                String,
            ) -> Result<crate::tasks::TaskRun, String>;

        fn assert_flat_signature(_command: FlatRunWorkspaceTaskCommand) {}

        assert_flat_signature(super::run_workspace_task);
    }

    #[test]
    fn create_context_pack_preserves_flat_command_signature() {
        type FlatCreateContextPackCommand =
            for<'app_state> fn(
                State<'app_state, AppState>,
                String,
                String,
                Vec<String>,
            ) -> Result<crate::docs::ContextPack, String>;

        fn assert_flat_signature(_command: FlatCreateContextPackCommand) {}

        assert_flat_signature(create_context_pack);
    }

    #[test]
    fn context_pack_delete_and_link_reject_inactive_workspace_pack() {
        let config = tempdir().expect("config dir");
        let active_workspace = config.path().join("active-workspace");
        let inactive_workspace = config.path().join("inactive-workspace");
        std::fs::create_dir_all(&active_workspace).expect("active workspace");
        std::fs::create_dir_all(&inactive_workspace).expect("inactive workspace");
        std::fs::write(inactive_workspace.join("README.md"), "# Inactive\n").expect("readme");
        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(active_workspace.clone())
            .expect("open active");
        state
            .open_workspace_path(inactive_workspace.clone())
            .expect("open inactive");
        let inactive_root = inactive_workspace
            .canonicalize()
            .expect("inactive canonical");
        let inactive_root = inactive_root.to_str().expect("inactive root");
        let delete_pack = state
            .create_context_pack(
                inactive_root,
                "Delete pack".to_string(),
                vec!["README.md".into()],
            )
            .expect("create delete pack");
        let link_pack = state
            .create_context_pack(
                inactive_root,
                "Link pack".to_string(),
                vec!["README.md".into()],
            )
            .expect("create link pack");

        let delete_result = state.delete_context_pack(delete_pack.id.clone());
        let link_result = state.link_context_pack(
            link_pack.id.clone(),
            Some("workspace:task-1".to_string()),
            Some("agent-session-1".to_string()),
        );

        assert!(delete_result
            .expect_err("delete should reject inactive workspace")
            .contains("active workspace"));
        assert!(link_result
            .expect_err("link should reject inactive workspace")
            .contains("active workspace"));
        assert_eq!(
            state
                .list_context_packs(inactive_root)
                .expect("inactive packs")
                .len(),
            2
        );
    }

    #[cfg(unix)]
    #[test]
    fn app_state_rolls_back_settings_when_save_fails() {
        let temp = tempdir().expect("temp dir");
        let settings_path = temp.path().join("settings.json");
        let original = settings("compact", "dark");
        let changed = settings("comfortable", "light");
        SettingsStore::new(settings_path.clone())
            .save(&original)
            .expect("initial save");
        std::fs::set_permissions(&settings_path, std::fs::Permissions::from_mode(0o600))
            .expect("settings file writable");
        let state = AppState::new(temp.path()).expect("state");
        let _config_permissions = PermissionGuard::set(temp.path(), 0o500);

        let result = state.save_settings(changed);

        assert!(result.is_err(), "save should fail without config dir write");
        assert_eq!(state.settings_snapshot().expect("settings"), original);
    }

    #[cfg(unix)]
    #[test]
    fn app_state_rolls_back_registry_when_save_fails() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");
        let workspace_path = temp.path().join("project-a");
        std::fs::create_dir(&workspace_path).expect("project dir");
        let _config_permissions = PermissionGuard::set(temp.path(), 0o500);

        let result = state.open_workspace_path(workspace_path);

        assert!(result.is_err(), "save should fail without config dir write");
        assert_eq!(
            state
                .registry_snapshot()
                .expect("registry")
                .workspaces
                .len(),
            0
        );
    }
}
