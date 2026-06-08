use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::State;

use crate::metrics::{snapshot, AppMetricSnapshot};
use crate::workspace::{Workspace, WorkspaceRegistry};
use crate::workspace_scan::{self, FileTreeEntry};
use crate::workspace_store::WorkspaceRegistryStore;

pub struct AppState {
    registry: Mutex<WorkspaceRegistry>,
    registry_store: WorkspaceRegistryStore,
}

impl AppState {
    pub fn new(config_dir: impl AsRef<Path>) -> Result<Self, String> {
        let registry_store =
            WorkspaceRegistryStore::new(config_dir.as_ref().join("workspace-registry.json"));
        let registry = registry_store.load()?;

        Ok(Self {
            registry: Mutex::new(registry),
            registry_store,
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
pub fn scan_workspace(path: String) -> Result<Vec<FileTreeEntry>, String> {
    workspace_scan::scan_top_level(std::path::Path::new(&path))
}

#[tauri::command]
pub fn terminal_probe() -> Result<String, String> {
    crate::pty::spawn_shell_probe()
}

#[tauri::command]
pub fn metric_snapshot() -> Result<AppMetricSnapshot, String> {
    Ok(snapshot())
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

    #[test]
    fn app_state_loads_registry_from_store() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");

        let registry = state.registry_snapshot().expect("registry");

        assert_eq!(registry.workspaces.len(), 0);
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
