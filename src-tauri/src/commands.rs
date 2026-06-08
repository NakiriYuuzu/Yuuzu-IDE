use std::sync::Mutex;

use tauri::State;

use crate::workspace::{Workspace, WorkspaceRegistry};
use crate::workspace_scan::{self, FileTreeEntry};

pub struct AppState {
    registry: Mutex<WorkspaceRegistry>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            registry: Mutex::new(WorkspaceRegistry::default()),
        }
    }
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<WorkspaceRegistry, String> {
    let registry = state.registry.lock().map_err(|err| err.to_string())?;
    Ok(registry.clone())
}

#[tauri::command]
pub fn add_workspace(
    state: State<'_, AppState>,
    workspace: Workspace,
) -> Result<WorkspaceRegistry, String> {
    let mut registry = state.registry.lock().map_err(|err| err.to_string())?;
    registry.add_workspace(workspace);
    Ok(registry.clone())
}

#[tauri::command]
pub fn switch_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<WorkspaceRegistry, String> {
    let mut registry = state.registry.lock().map_err(|err| err.to_string())?;

    if registry.switch_workspace(&id) {
        Ok(registry.clone())
    } else {
        Err(format!("workspace not found: {id}"))
    }
}

#[tauri::command]
pub fn scan_workspace(path: String) -> Result<Vec<FileTreeEntry>, String> {
    workspace_scan::scan_top_level(std::path::Path::new(&path))
}

#[tauri::command]
pub fn terminal_probe() -> Result<String, String> {
    crate::pty::spawn_shell_probe()
}
