use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::State;

use crate::file_system::{self, FileOperationResult, FileVersion, TextFileRead};
use crate::metrics::{snapshot, AppMetricSnapshot};
use crate::settings::{AppSettings, SettingsStore};
use crate::workspace::{Workspace, WorkspaceRegistry};
use crate::workspace_scan::{self, FileTreeEntry};
use crate::workspace_store::WorkspaceRegistryStore;

pub struct AppState {
    registry: Mutex<WorkspaceRegistry>,
    registry_store: WorkspaceRegistryStore,
    settings: Mutex<AppSettings>,
    settings_store: SettingsStore,
}

impl AppState {
    pub fn new(config_dir: impl AsRef<Path>) -> Result<Self, String> {
        let registry_store =
            WorkspaceRegistryStore::new(config_dir.as_ref().join("workspace-registry.json"));
        let registry = registry_store.load()?;
        let settings_store = SettingsStore::new(config_dir.as_ref().join("settings.json"));
        let settings = settings_store.load()?;

        Ok(Self {
            registry: Mutex::new(registry),
            registry_store,
            settings: Mutex::new(settings),
            settings_store,
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
