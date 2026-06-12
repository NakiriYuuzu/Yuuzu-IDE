#[cfg(test)]
use rusqlite::Connection;
use std::{
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, State};

use crate::extensions::{ExtensionPerformanceSample, ExtensionWorkspaceStatus};
use crate::file_system::{self, FileOperationResult, FileVersion, TextFileRead};
use crate::file_watcher::{FileWatcherState, WatchWorkspaceHandle};
use crate::metrics::{snapshot, AppMetricInput, AppMetricSnapshot};
use crate::search::WorkspaceSearchResult;
use crate::settings::{import_vscode_keybindings, AppSettings, SettingsStore};
use crate::tasks::{TaskRun, TaskState, WorkspaceTask};
use crate::terminal::{TerminalSessionInfo, TerminalState};
use crate::workspace::{Workspace, WorkspaceRegistry};
use crate::workspace_scan::{self, FileTreeEntry};
use crate::workspace_store::WorkspaceRegistryStore;

const MAX_METRIC_INDEX_ENTRIES: usize = 1_000_000;

/// Run blocking work on the dedicated blocking pool so async commands never
/// stall the UI thread or starve the async runtime.
async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|err| err.to_string())?
}

pub struct AppState {
    registry: Mutex<WorkspaceRegistry>,
    registry_store: WorkspaceRegistryStore,
    settings: Mutex<AppSettings>,
    settings_store: SettingsStore,
    recovery_store: crate::recovery::RecoveryStore,
    diagnostics_store: crate::diagnostics::DiagnosticsStore,
    started_ms: u128,
    docs_store: crate::docs::ContextPackStore,
    agent_store: crate::agent::AgentSessionStore,
    database_profiles: crate::database::DatabaseProfileStore,
    database_secrets: crate::database::KeyringDatabaseSecretStore,
    database_query_history: crate::database::DatabaseQueryHistoryStore,
    remote_profiles: crate::remote::RemoteHostProfileStore,
    remote_secrets: crate::remote::KeyringRemoteSecretStore,
    debug_launch_configs: crate::debug::DebugLaunchConfigStore,
    extension_store: crate::extensions::ExtensionWorkspaceStore,
}

impl AppState {
    pub fn new(config_dir: impl AsRef<Path>) -> Result<Self, String> {
        let registry_store =
            WorkspaceRegistryStore::new(config_dir.as_ref().join("workspace-registry.json"));
        let registry = registry_store.load()?;
        let settings_store = SettingsStore::new(config_dir.as_ref().join("settings.json"));
        let settings = settings_store.load()?;
        let recovery_store =
            crate::recovery::RecoveryStore::new(config_dir.as_ref().join("unsaved-backups"));
        let diagnostics_store = crate::diagnostics::DiagnosticsStore::new(
            config_dir.as_ref().join("diagnostics.jsonl"),
        );
        let docs_store =
            crate::docs::ContextPackStore::new(config_dir.as_ref().join("context-packs.json"));
        let agent_store =
            crate::agent::AgentSessionStore::new(config_dir.as_ref().join("agent-sessions.json"));
        let database_profiles = crate::database::DatabaseProfileStore::new(
            config_dir.as_ref().join("database-profiles.json"),
        );
        let database_secrets =
            crate::database::KeyringDatabaseSecretStore::new("yuuzu-ide.database");
        let database_query_history = crate::database::DatabaseQueryHistoryStore::new();
        let remote_profiles = crate::remote::RemoteHostProfileStore::new(
            config_dir.as_ref().join("remote-hosts.json"),
        );
        let remote_secrets = crate::remote::KeyringRemoteSecretStore::new("yuuzu-ide.remote");
        let debug_launch_configs = crate::debug::DebugLaunchConfigStore::new(
            config_dir.as_ref().join("debug-launch.json"),
        );
        let extension_store = crate::extensions::ExtensionWorkspaceStore::new(
            config_dir.as_ref().join("extensions-workspace.json"),
        );

        Ok(Self {
            registry: Mutex::new(registry),
            registry_store,
            settings: Mutex::new(settings),
            settings_store,
            recovery_store,
            diagnostics_store,
            started_ms: crate::metrics::current_time_ms(),
            docs_store,
            agent_store,
            database_profiles,
            database_secrets,
            database_query_history,
            remote_profiles,
            remote_secrets,
            debug_launch_configs,
            extension_store,
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

    fn workspace_identity(&self, workspace_root: &Path) -> Result<(String, String), String> {
        let registry = self.registry.lock().map_err(|err| err.to_string())?;

        for workspace in &registry.workspaces {
            let Ok(registered) = workspace.path.canonicalize() else {
                continue;
            };

            if registered == workspace_root {
                return Ok((
                    workspace.id.clone(),
                    workspace_root.to_string_lossy().to_string(),
                ));
            }
        }

        Err(format!(
            "workspace not registered: {}",
            workspace_root.display()
        ))
    }

    fn ensure_workspace_id_matches_root_path(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
    ) -> Result<String, String> {
        let (resolved_workspace_id, _) = self.workspace_identity(workspace_root)?;
        if resolved_workspace_id == workspace_id {
            Ok(resolved_workspace_id)
        } else {
            Err("workspace id does not match workspace root".to_string())
        }
    }

    pub fn save_unsaved_backup(
        &self,
        workspace_root: &str,
        workspace_id: &str,
        path: String,
        content: String,
        version: Option<FileVersion>,
    ) -> Result<crate::recovery::UnsavedBackup, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.ensure_workspace_id_matches_root_path(workspace_id, &workspace_root)?;

        self.recovery_store
            .save_backup(crate::recovery::UnsavedBackup {
                id: String::new(),
                workspace_id: workspace_id.to_string(),
                workspace_root: workspace_root.to_string_lossy().to_string(),
                path,
                content,
                version,
                updated_ms: current_time_ms()?,
            })
    }

    pub fn list_unsaved_backups(
        &self,
        workspace_root: &str,
        workspace_id: &str,
    ) -> Result<Vec<crate::recovery::UnsavedBackup>, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.ensure_workspace_id_matches_root_path(workspace_id, &workspace_root)?;
        self.recovery_store
            .list_backups(workspace_id, &workspace_root.to_string_lossy())
    }

    pub fn discard_unsaved_backup(
        &self,
        workspace_root: &str,
        workspace_id: &str,
        backup_id: String,
    ) -> Result<(), String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.ensure_workspace_id_matches_root_path(workspace_id, &workspace_root)?;
        self.recovery_store.discard_backup(
            workspace_id,
            &workspace_root.to_string_lossy(),
            &backup_id,
        )
    }

    pub fn append_diagnostic_event(
        &self,
        event: crate::diagnostics::DiagnosticEventInput,
    ) -> Result<crate::diagnostics::DiagnosticEvent, String> {
        self.diagnostics_store.append(event)
    }

    pub fn list_diagnostic_events(
        &self,
        limit: usize,
    ) -> Result<Vec<crate::diagnostics::DiagnosticEvent>, String> {
        self.diagnostics_store.list(limit)
    }

    pub fn metric_snapshot(
        &self,
        docs_index_entries: usize,
        file_tree_entries: usize,
    ) -> Result<AppMetricSnapshot, String> {
        let registry = self.registry.lock().map_err(|err| err.to_string())?;
        Ok(snapshot(AppMetricInput {
            started_ms: self.started_ms,
            workspace_count: registry.workspaces.len(),
            active_workspace_id: registry.active_workspace_id.clone(),
            docs_index_entries: docs_index_entries.min(MAX_METRIC_INDEX_ENTRIES),
            file_tree_entries: file_tree_entries.min(MAX_METRIC_INDEX_ENTRIES),
        }))
    }

    fn lsp_workspace_identity(&self, workspace_root: &str) -> Result<(String, String), String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.workspace_identity(&workspace_root)
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

    fn active_workspace_id(&self) -> Result<String, String> {
        let registry = self.registry.lock().map_err(|err| err.to_string())?;
        registry
            .active_workspace_id
            .clone()
            .ok_or_else(|| "no active workspace selected".to_string())
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

    fn ensure_agent_session_in_active_workspace(&self, session_id: &str) -> Result<(), String> {
        let active_workspace_root = self.active_workspace_root()?;
        let session_workspace_root = self.agent_store.session_workspace_root(session_id)?;
        if session_workspace_root == active_workspace_root.to_string_lossy() {
            return Ok(());
        }

        Err(format!(
            "agent session does not belong to active workspace: {session_id}"
        ))
    }

    fn ensure_task_run_in_active_workspace(
        &self,
        task_state: &TaskState,
        task_run_id: &str,
    ) -> Result<(), String> {
        let active_workspace_id = self.active_workspace_id()?;
        let run = task_state.get_run(task_run_id)?;
        if run.workspace_id == active_workspace_id {
            return Ok(());
        }

        Err(format!(
            "task run does not belong to active workspace: {task_run_id}"
        ))
    }

    pub fn settings_snapshot(&self) -> Result<AppSettings, String> {
        let settings = self.settings.lock().map_err(|err| err.to_string())?;
        Ok(settings.clone())
    }

    pub fn save_settings(&self, settings: AppSettings) -> Result<AppSettings, String> {
        let settings = settings.normalized();
        let mut current = self.settings.lock().map_err(|err| err.to_string())?;
        self.settings_store.save(&settings)?;
        *current = settings.clone();
        Ok(settings)
    }

    pub fn import_keybindings(&self, source: &str, content: String) -> Result<AppSettings, String> {
        if source != "vscode" {
            return Err(format!("unsupported keybinding import source: {source}"));
        }

        let mut current = self.settings.lock().map_err(|err| err.to_string())?;
        let imported = import_vscode_keybindings(current.clone(), &content)?;
        self.settings_store.save(&imported)?;
        *current = imported.clone();
        Ok(imported)
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
        task_state: &TaskState,
        task_run_id: Option<String>,
        agent_session_id: Option<String>,
    ) -> Result<crate::docs::ContextPack, String> {
        self.ensure_context_pack_in_active_workspace(&id)?;
        if let Some(task_run_id) = task_run_id.as_deref() {
            self.ensure_task_run_in_active_workspace(task_state, task_run_id)?;
        }
        if let Some(agent_session_id) = agent_session_id.as_deref() {
            self.ensure_agent_session_in_active_workspace(agent_session_id)?;
        }
        self.docs_store
            .link_pack(&id, task_run_id.as_deref(), agent_session_id.as_deref())
    }

    pub fn list_agent_sessions(
        &self,
        workspace_root: &str,
    ) -> Result<Vec<crate::agent::AgentSession>, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.agent_store
            .list_sessions(&workspace_root.to_string_lossy())
    }

    pub fn delete_database_profile(
        &self,
        workspace_root: &str,
        profile_id: &str,
    ) -> Result<(), String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        let profile = self.database_profiles.get_profile(profile_id)?;
        if profile.workspace_root != workspace_root.to_string_lossy() {
            return Err("database profile does not belong to workspace".to_string());
        }

        self.database_profiles
            .delete_profile(profile_id, &self.database_secrets)
    }

    pub fn list_remote_hosts(
        &self,
        workspace_root: &str,
    ) -> Result<Vec<crate::remote::RemoteHostProfile>, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.remote_profiles
            .list_profiles(&workspace_root.to_string_lossy())
    }

    pub fn save_remote_host(
        &self,
        input: crate::remote::RemoteHostProfileInput,
    ) -> Result<crate::remote::RemoteHostProfile, String> {
        let workspace_root = self.trusted_workspace_root(&input.workspace_root)?;
        if let Some(profile_id) = input.id.as_deref() {
            if let Ok(profile) = self.remote_profiles.get_profile(profile_id) {
                if profile.workspace_root != workspace_root.to_string_lossy() {
                    return Err("remote host profile does not belong to workspace".to_string());
                }
            }
        }

        self.remote_profiles.save_profile(
            crate::remote::RemoteHostProfileInput {
                workspace_root: workspace_root.to_string_lossy().to_string(),
                ..input
            },
            &self.remote_secrets,
            || Ok(crate::remote::remote_now_ms()),
            crate::remote::new_remote_host_id,
        )
    }

    pub fn delete_remote_host(&self, workspace_root: &str, profile_id: &str) -> Result<(), String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        let profile = self.remote_profiles.get_profile(profile_id)?;
        if profile.workspace_root != workspace_root.to_string_lossy() {
            return Err("remote host profile does not belong to workspace".to_string());
        }
        self.remote_profiles
            .delete_profile(profile_id, &self.remote_secrets)
    }

    pub fn debug_list_launch_configs(
        &self,
        workspace_root: &str,
    ) -> Result<Vec<crate::debug::DebugLaunchConfig>, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.debug_launch_configs
            .list_configs(&workspace_root.to_string_lossy())
    }

    pub fn debug_save_launch_config(
        &self,
        input: crate::debug::DebugLaunchConfigInput,
    ) -> Result<crate::debug::DebugLaunchConfig, String> {
        let workspace_root = self.trusted_workspace_root(&input.workspace_root)?;
        let workspace_root = workspace_root.to_string_lossy().to_string();
        self.debug_launch_configs.save_config_for_workspace(
            &workspace_root,
            crate::debug::DebugLaunchConfigInput {
                workspace_root: workspace_root.clone(),
                ..input
            },
            || Ok(crate::debug::debug_now_ms()),
            crate::debug::new_debug_config_id,
        )
    }

    #[allow(dead_code)]
    pub fn save_debug_launch_config(
        &self,
        input: crate::debug::DebugLaunchConfigInput,
    ) -> Result<crate::debug::DebugLaunchConfig, String> {
        self.debug_save_launch_config(input)
    }

    pub fn debug_delete_launch_config(
        &self,
        workspace_root: &str,
        config_id: &str,
    ) -> Result<(), String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.debug_launch_configs
            .delete_config_for_workspace(&workspace_root.to_string_lossy(), config_id)
    }

    pub fn extension_statuses(
        &self,
        workspace_root: &str,
    ) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        crate::extensions::extension_statuses(
            &crate::extensions::ExtensionCatalog::builtin(),
            &self.extension_store,
            &workspace_root.to_string_lossy(),
        )
    }

    pub fn set_extension_enabled(
        &self,
        workspace_root: &str,
        extension_id: String,
        enabled: bool,
    ) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        let root = workspace_root.to_string_lossy().to_string();
        self.extension_store
            .set_enabled(&root, &extension_id, enabled, current_time_ms)?;
        self.extension_statuses(&root)
    }

    pub fn record_extension_performance(
        &self,
        workspace_root: &str,
        sample: ExtensionPerformanceSample,
    ) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        let root = workspace_root.to_string_lossy().to_string();
        self.extension_store.record_performance(&root, sample)?;
        self.extension_statuses(&root)
    }

    pub fn debug_list_sessions(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
    ) -> Result<Vec<crate::debug::DebugSessionInfo>, String> {
        let (workspace_id, _, _) = self.debug_workspace_identity(workspace_root, workspace_id)?;
        Ok(debug_state.list_sessions(&workspace_id))
    }

    pub fn debug_start_session(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        config_id: &str,
    ) -> Result<crate::debug::DebugSessionInfo, String> {
        let (workspace_id, workspace_root, _) =
            self.debug_workspace_identity(workspace_root, workspace_id)?;
        let config = self.debug_launch_configs.get_config(config_id)?;
        if config.workspace_root != workspace_root {
            return Err("debug launch config does not belong to workspace".to_string());
        }

        debug_state.start_session(crate::debug::DebugStartSessionRequest {
            workspace_id,
            workspace_root,
            config,
        })
    }

    pub fn debug_set_breakpoints(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        source_path: String,
        breakpoints: Vec<crate::debug::DebugSourceBreakpointInput>,
    ) -> Result<Vec<crate::debug::DebugSourceBreakpoint>, String> {
        let (workspace_id, workspace_root, workspace_root_path) =
            self.debug_workspace_identity(workspace_root, workspace_id)?;
        let source_path =
            crate::debug::normalize_debug_source_path(&workspace_root_path, &source_path)?;
        debug_state.set_breakpoints(workspace_id, workspace_root, source_path, breakpoints)
    }

    pub fn debug_set_session_breakpoints(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
        source_path: String,
        breakpoints: Vec<crate::debug::DebugSourceBreakpointInput>,
    ) -> Result<Vec<crate::debug::DebugSourceBreakpoint>, String> {
        let (_, _, workspace_root_path) = self.ensure_debug_session_workspace(
            debug_state,
            workspace_root,
            workspace_id,
            session_id,
        )?;
        let source_path =
            crate::debug::normalize_debug_source_path(&workspace_root_path, &source_path)?;
        debug_state.set_session_breakpoints(session_id, source_path, breakpoints)
    }

    pub fn debug_continue(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<crate::debug::DebugSessionInfo, String> {
        self.ensure_debug_session_workspace(debug_state, workspace_root, workspace_id, session_id)?;
        debug_state.continue_session(session_id)
    }

    pub fn debug_step_over(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<crate::debug::DebugSessionInfo, String> {
        self.ensure_debug_session_workspace(debug_state, workspace_root, workspace_id, session_id)?;
        debug_state.step_over(session_id)
    }

    pub fn debug_pause(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<crate::debug::DebugSessionInfo, String> {
        self.ensure_debug_session_workspace(debug_state, workspace_root, workspace_id, session_id)?;
        debug_state.pause(session_id)
    }

    pub fn debug_disconnect(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<crate::debug::DebugSessionInfo, String> {
        self.ensure_debug_session_workspace(debug_state, workspace_root, workspace_id, session_id)?;
        debug_state.disconnect_session(session_id)
    }

    pub fn debug_stack_trace(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
        thread_id: i64,
    ) -> Result<Vec<crate::debug::DebugStackFrame>, String> {
        self.ensure_debug_session_workspace(debug_state, workspace_root, workspace_id, session_id)?;
        debug_state.stack_trace(session_id, thread_id)
    }

    pub fn debug_scopes(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
        frame_id: i64,
    ) -> Result<Vec<crate::debug::DebugScope>, String> {
        self.ensure_debug_session_workspace(debug_state, workspace_root, workspace_id, session_id)?;
        debug_state.scopes(session_id, frame_id)
    }

    pub fn debug_variables(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
        variables_reference: i64,
    ) -> Result<Vec<crate::debug::DebugVariable>, String> {
        self.ensure_debug_session_workspace(debug_state, workspace_root, workspace_id, session_id)?;
        debug_state.variables(session_id, variables_reference)
    }

    pub fn debug_evaluate(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
        expression: String,
    ) -> Result<crate::debug::DebugVariable, String> {
        self.ensure_debug_session_workspace(debug_state, workspace_root, workspace_id, session_id)?;
        debug_state.evaluate(session_id, &expression)
    }

    pub fn debug_session_logs(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
    ) -> Result<Vec<String>, String> {
        let (workspace_id, _, _) = self.debug_workspace_identity(workspace_root, workspace_id)?;
        Ok(debug_state.session_logs(&workspace_id))
    }

    fn debug_workspace_identity(
        &self,
        workspace_root: &str,
        workspace_id: &str,
    ) -> Result<(String, String, PathBuf), String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        let workspace_id =
            self.ensure_workspace_id_matches_root_path(workspace_id, &workspace_root)?;
        let workspace_root_string = workspace_root.to_string_lossy().to_string();
        Ok((workspace_id, workspace_root_string, workspace_root))
    }

    fn ensure_debug_session_workspace(
        &self,
        debug_state: &crate::debug::DebugState,
        workspace_root: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<(String, String, PathBuf), String> {
        let (workspace_id, workspace_root, workspace_root_path) =
            self.debug_workspace_identity(workspace_root, workspace_id)?;
        if debug_state.session_belongs_to(session_id, &workspace_id, &workspace_root)? {
            Ok((workspace_id, workspace_root, workspace_root_path))
        } else {
            Err("debug session does not belong to workspace".to_string())
        }
    }

    #[allow(dead_code)] // Task 2 will consume this active-workspace guard for remote commands.
    pub fn remote_host_in_active_workspace(
        &self,
        profile_id: &str,
    ) -> Result<crate::remote::RemoteHostProfile, String> {
        let profile = self.remote_profiles.get_profile(profile_id)?;
        let active_workspace_root = self.active_workspace_root()?;

        if profile.workspace_root == active_workspace_root.to_string_lossy() {
            Ok(profile)
        } else {
            Err("remote host profile does not belong to active workspace".to_string())
        }
    }

    pub fn save_database_profile(
        &self,
        input: crate::database::DatabaseProfileInput,
    ) -> Result<crate::database::DatabaseProfile, String> {
        let workspace_root = self.trusted_workspace_root(&input.workspace_root)?;
        if let Some(profile_id) = input.id.as_deref() {
            if let Ok(profile) = self.database_profiles.get_profile(profile_id) {
                if profile.workspace_root != workspace_root.to_string_lossy() {
                    return Err("database profile does not belong to workspace".to_string());
                }
            }
        }

        let input = crate::database::DatabaseProfileInput {
            workspace_root: workspace_root.to_string_lossy().to_string(),
            ..input
        };

        self.database_profiles.save_profile(
            input,
            &self.database_secrets,
            || Ok(crate::database::database_now_ms()),
            || uuid::Uuid::new_v4().to_string(),
        )
    }

    fn database_profile_in_active_workspace(
        &self,
        profile_id: &str,
    ) -> Result<crate::database::DatabaseProfile, String> {
        let profile = self.database_profiles.get_profile(profile_id)?;
        let active_workspace_root = self.active_workspace_root()?;

        if profile.workspace_root == active_workspace_root.to_string_lossy() {
            Ok(profile)
        } else {
            Err("database profile does not belong to active workspace".to_string())
        }
    }

    pub async fn inspect_database_schema(
        &self,
        profile_id: &str,
    ) -> Result<crate::database::DatabaseSchema, String> {
        let profile = self.database_profile_in_active_workspace(profile_id)?;
        crate::database::inspect_database_schema_async(&profile, &self.database_secrets).await
    }

    pub async fn execute_database_query(
        &self,
        request: crate::database::DatabaseQueryRequest,
    ) -> Result<crate::database::DatabaseQueryResult, String> {
        let profile = self.database_profile_in_active_workspace(&request.profile_id)?;
        let mut result = crate::database::execute_database_query_async(
            &profile,
            request,
            &self.database_secrets,
        )
        .await?;

        let affected_rows = result.affected_rows;
        let row_count = if matches!(result.classification.kind, crate::database::QueryKind::Read) {
            Some(result.rows.len() as u64)
        } else {
            None
        };
        let history_id = self.database_query_history.record(
            &result.profile_id,
            &result.sql,
            result.classification.kind.clone(),
            result.executed_ms,
            affected_rows,
            row_count,
        );
        result.history_id = history_id;
        Ok(result)
    }

    pub fn list_database_query_history(
        &self,
        profile_id: &str,
    ) -> Result<Vec<crate::database::DatabaseQueryHistoryEntry>, String> {
        self.database_profile_in_active_workspace(profile_id)?;
        Ok(self.database_query_history.list(profile_id))
    }

    pub fn export_database_query_result(
        &self,
        workspace_root: &str,
        result: &crate::database::DatabaseQueryResult,
    ) -> Result<crate::database::DatabaseExport, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        let profile = self.database_profile_in_active_workspace(&result.profile_id)?;
        if workspace_root.to_string_lossy() != profile.workspace_root {
            return Err("database profile does not belong to workspace".to_string());
        }
        let export_root = workspace_root
            .join(".yuuzu-ide")
            .join("exports")
            .join("database");
        let export_path = crate::database::export_query_result_csv(export_root, result)?;

        Ok(crate::database::DatabaseExport {
            path: export_path.to_string_lossy().to_string(),
        })
    }

    pub fn start_agent_session(
        &self,
        workspace_root: &str,
        mode: crate::agent::AgentMode,
        prompt: String,
        context_items: Vec<crate::agent::AgentContextItem>,
    ) -> Result<crate::agent::AgentSession, String> {
        let workspace_root = self.trusted_workspace_root(workspace_root)?;
        self.agent_store.start_session(
            &workspace_root.to_string_lossy(),
            mode,
            &prompt,
            context_items,
        )
    }

    pub fn append_agent_transcript(
        &self,
        session_id: String,
        entry: crate::agent::AgentTranscriptInput,
    ) -> Result<crate::agent::AgentTranscriptEntry, String> {
        self.ensure_agent_session_in_active_workspace(&session_id)?;
        self.agent_store.append_transcript(&session_id, entry)
    }

    pub fn update_agent_approval(
        &self,
        session_id: String,
        approval_id: String,
        status: crate::agent::AgentApprovalStatus,
    ) -> Result<crate::agent::AgentSession, String> {
        self.ensure_agent_session_in_active_workspace(&session_id)?;
        self.agent_store
            .update_approval(&session_id, &approval_id, status)
    }

    pub fn export_agent_prompt(
        &self,
        session_id: String,
    ) -> Result<crate::agent::AgentPromptExport, String> {
        self.ensure_agent_session_in_active_workspace(&session_id)?;
        self.agent_store.export_prompt(&session_id)
    }

    pub fn validate_browser_url(
        &self,
        value: &str,
    ) -> Result<crate::browser_preview::BrowserUrl, String> {
        crate::browser_preview::normalize_browser_url(value)
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
pub fn import_keybindings(
    state: State<'_, AppState>,
    source: String,
    content: String,
) -> Result<AppSettings, String> {
    state.import_keybindings(&source, content)
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
pub fn save_unsaved_backup(
    state: State<'_, AppState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
    content: String,
    version: Option<FileVersion>,
) -> Result<crate::recovery::UnsavedBackup, String> {
    state.save_unsaved_backup(&workspace_root, &workspace_id, path, content, version)
}

#[tauri::command]
pub fn list_unsaved_backups(
    state: State<'_, AppState>,
    workspace_root: String,
    workspace_id: String,
) -> Result<Vec<crate::recovery::UnsavedBackup>, String> {
    state.list_unsaved_backups(&workspace_root, &workspace_id)
}

#[tauri::command]
pub fn discard_unsaved_backup(
    state: State<'_, AppState>,
    workspace_root: String,
    workspace_id: String,
    backup_id: String,
) -> Result<(), String> {
    state.discard_unsaved_backup(&workspace_root, &workspace_id, backup_id)
}

#[tauri::command]
pub fn append_diagnostic_event(
    state: State<'_, AppState>,
    event: crate::diagnostics::DiagnosticEventInput,
) -> Result<crate::diagnostics::DiagnosticEvent, String> {
    state.append_diagnostic_event(event)
}

#[tauri::command]
pub fn list_diagnostic_events(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<crate::diagnostics::DiagnosticEvent>, String> {
    state.list_diagnostic_events(limit)
}

#[tauri::command]
pub async fn scan_workspace(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<FileTreeEntry>, String> {
    let workspace_root = state.trusted_workspace_root(&path)?;
    run_blocking(move || workspace_scan::scan_top_level(&workspace_root)).await
}

#[tauri::command]
pub async fn scan_directory(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<Vec<FileTreeEntry>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || workspace_scan::scan_directory(&workspace_root, Path::new(&path))).await
}

#[tauri::command]
pub async fn search_workspace(
    state: State<'_, AppState>,
    workspace_root: String,
    query: String,
) -> Result<WorkspaceSearchResult, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || {
        crate::search::search_workspace(
            &workspace_root,
            &query,
            100,
            file_system::EDITABLE_TEXT_LIMIT_BYTES,
        )
    })
    .await
}

#[tauri::command]
pub async fn docs_index(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::docs::DocIndexEntry>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::docs::index_docs(&workspace_root)).await
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
pub async fn docs_search(
    state: State<'_, AppState>,
    workspace_root: String,
    query: String,
) -> Result<crate::docs::DocSearchResult, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || {
        crate::docs::search_docs(&workspace_root, &query, crate::docs::MAX_DOC_SEARCH_RESULTS)
    })
    .await
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
    task_state: State<'_, TaskState>,
    id: String,
    task_run_id: Option<String>,
    agent_session_id: Option<String>,
) -> Result<crate::docs::ContextPack, String> {
    state.link_context_pack(id, &task_state, task_run_id, agent_session_id)
}

#[tauri::command]
pub fn list_database_profiles(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::database::DatabaseProfile>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    state
        .database_profiles
        .list_profiles(&workspace_root.to_string_lossy())
}

#[tauri::command]
pub fn save_database_profile(
    state: State<'_, AppState>,
    input: crate::database::DatabaseProfileInput,
) -> Result<crate::database::DatabaseProfile, String> {
    state.save_database_profile(input)
}

#[tauri::command]
pub fn delete_database_profile(
    state: State<'_, AppState>,
    workspace_root: String,
    profile_id: String,
) -> Result<(), String> {
    state.delete_database_profile(&workspace_root, &profile_id)
}

#[tauri::command]
pub fn list_remote_hosts(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::remote::RemoteHostProfile>, String> {
    state.list_remote_hosts(&workspace_root)
}

#[tauri::command]
pub fn save_remote_host(
    state: State<'_, AppState>,
    input: crate::remote::RemoteHostProfileInput,
) -> Result<crate::remote::RemoteHostProfile, String> {
    state.save_remote_host(input)
}

#[tauri::command]
pub fn delete_remote_host(
    state: State<'_, AppState>,
    workspace_root: String,
    profile_id: String,
) -> Result<(), String> {
    state.delete_remote_host(&workspace_root, &profile_id)
}

#[tauri::command]
pub fn debug_list_launch_configs(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::debug::DebugLaunchConfig>, String> {
    state.debug_list_launch_configs(&workspace_root)
}

#[tauri::command]
pub fn debug_save_launch_config(
    state: State<'_, AppState>,
    input: crate::debug::DebugLaunchConfigInput,
) -> Result<crate::debug::DebugLaunchConfig, String> {
    state.debug_save_launch_config(input)
}

#[tauri::command]
pub fn debug_delete_launch_config(
    state: State<'_, AppState>,
    workspace_root: String,
    config_id: String,
) -> Result<(), String> {
    state.debug_delete_launch_config(&workspace_root, &config_id)
}

#[tauri::command]
pub fn extension_statuses(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    state.extension_statuses(&workspace_root)
}

#[tauri::command]
pub fn set_extension_enabled(
    state: State<'_, AppState>,
    workspace_root: String,
    extension_id: String,
    enabled: bool,
) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    state.set_extension_enabled(&workspace_root, extension_id, enabled)
}

#[tauri::command]
pub fn record_extension_performance(
    state: State<'_, AppState>,
    workspace_root: String,
    sample: ExtensionPerformanceSample,
) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    state.record_extension_performance(&workspace_root, sample)
}

#[tauri::command]
pub fn debug_list_sessions(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
) -> Result<Vec<crate::debug::DebugSessionInfo>, String> {
    state.debug_list_sessions(&debug_state, &workspace_root, &workspace_id)
}

#[tauri::command]
pub fn debug_start_session(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    config_id: String,
) -> Result<crate::debug::DebugSessionInfo, String> {
    state.debug_start_session(&debug_state, &workspace_root, &workspace_id, &config_id)
}

#[tauri::command]
pub fn debug_set_breakpoints(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    source_path: String,
    breakpoints: Vec<crate::debug::DebugSourceBreakpointInput>,
) -> Result<Vec<crate::debug::DebugSourceBreakpoint>, String> {
    state.debug_set_breakpoints(
        &debug_state,
        &workspace_root,
        &workspace_id,
        source_path,
        breakpoints,
    )
}

#[tauri::command]
pub fn debug_set_session_breakpoints(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    session_id: String,
    source_path: String,
    breakpoints: Vec<crate::debug::DebugSourceBreakpointInput>,
) -> Result<Vec<crate::debug::DebugSourceBreakpoint>, String> {
    state.debug_set_session_breakpoints(
        &debug_state,
        &workspace_root,
        &workspace_id,
        &session_id,
        source_path,
        breakpoints,
    )
}

#[tauri::command]
pub fn debug_continue(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    session_id: String,
) -> Result<crate::debug::DebugSessionInfo, String> {
    state.debug_continue(&debug_state, &workspace_root, &workspace_id, &session_id)
}

#[tauri::command]
pub fn debug_step_over(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    session_id: String,
) -> Result<crate::debug::DebugSessionInfo, String> {
    state.debug_step_over(&debug_state, &workspace_root, &workspace_id, &session_id)
}

#[tauri::command]
pub fn debug_pause(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    session_id: String,
) -> Result<crate::debug::DebugSessionInfo, String> {
    state.debug_pause(&debug_state, &workspace_root, &workspace_id, &session_id)
}

#[tauri::command]
pub fn debug_disconnect(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    session_id: String,
) -> Result<crate::debug::DebugSessionInfo, String> {
    state.debug_disconnect(&debug_state, &workspace_root, &workspace_id, &session_id)
}

#[tauri::command]
pub fn debug_stack_trace(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    session_id: String,
    thread_id: i64,
) -> Result<Vec<crate::debug::DebugStackFrame>, String> {
    state.debug_stack_trace(
        &debug_state,
        &workspace_root,
        &workspace_id,
        &session_id,
        thread_id,
    )
}

#[tauri::command]
pub fn debug_scopes(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    session_id: String,
    frame_id: i64,
) -> Result<Vec<crate::debug::DebugScope>, String> {
    state.debug_scopes(
        &debug_state,
        &workspace_root,
        &workspace_id,
        &session_id,
        frame_id,
    )
}

#[tauri::command]
pub fn debug_variables(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    session_id: String,
    variables_reference: i64,
) -> Result<Vec<crate::debug::DebugVariable>, String> {
    state.debug_variables(
        &debug_state,
        &workspace_root,
        &workspace_id,
        &session_id,
        variables_reference,
    )
}

#[tauri::command]
pub fn debug_evaluate(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
    session_id: String,
    expression: String,
) -> Result<crate::debug::DebugVariable, String> {
    state.debug_evaluate(
        &debug_state,
        &workspace_root,
        &workspace_id,
        &session_id,
        expression,
    )
}

#[tauri::command]
pub fn debug_session_logs(
    state: State<'_, AppState>,
    debug_state: State<'_, crate::debug::DebugState>,
    workspace_root: String,
    workspace_id: String,
) -> Result<Vec<String>, String> {
    state.debug_session_logs(&debug_state, &workspace_root, &workspace_id)
}

#[tauri::command]
pub async fn connect_remote_host(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    profile_id: String,
) -> Result<crate::remote::RemoteConnectionSnapshot, String> {
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    remote_state
        .connect_host(&profile, &app_state.remote_secrets)
        .await
}

#[tauri::command]
pub async fn disconnect_remote_host(
    remote_state: State<'_, crate::remote::RemoteState>,
    profile_id: String,
) -> Result<crate::remote::RemoteConnectionSnapshot, String> {
    remote_state.disconnect_host(&profile_id).await
}

#[tauri::command]
pub fn list_ssh_terminal_sessions(
    remote_state: State<'_, crate::remote::RemoteState>,
    workspace_id: String,
) -> Result<Vec<crate::remote::RemoteTerminalSessionInfo>, String> {
    remote_state.list_ssh_terminal_sessions(&workspace_id)
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri command exposes the planned flat frontend API contract"
)]
pub async fn spawn_ssh_terminal(
    app: AppHandle,
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    workspace_id: String,
    workspace_root: String,
    profile_id: String,
    rows: u16,
    cols: u16,
) -> Result<crate::remote::RemoteTerminalSessionInfo, String> {
    let workspace_root = app_state.trusted_workspace_root(&workspace_root)?;
    app_state.ensure_workspace_id_matches_root_path(&workspace_id, &workspace_root)?;
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    if profile.workspace_root != workspace_root.to_string_lossy() {
        return Err("remote host profile does not belong to workspace".to_string());
    }

    remote_state
        .spawn_ssh_terminal(
            &workspace_id,
            &profile,
            &app_state.remote_secrets,
            Arc::new(crate::remote::TauriRemoteTerminalEventSink::new(app)),
            rows,
            cols,
        )
        .await
}

#[tauri::command]
pub async fn write_ssh_terminal(
    remote_state: State<'_, crate::remote::RemoteState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    remote_state.write_ssh_terminal(&session_id, &data).await
}

#[tauri::command]
pub async fn close_ssh_terminal(
    remote_state: State<'_, crate::remote::RemoteState>,
    session_id: String,
) -> Result<crate::remote::RemoteTerminalSessionInfo, String> {
    remote_state.close_ssh_terminal(&session_id).await
}

#[tauri::command]
pub async fn run_remote_command(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    profile_id: String,
    command: String,
) -> Result<crate::remote::RemoteCommandResult, String> {
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    remote_state
        .run_remote_command(&profile, &app_state.remote_secrets, &command)
        .await
}

#[tauri::command]
pub async fn list_sftp_directory(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    profile_id: String,
    path: String,
) -> Result<Vec<crate::remote::RemoteFileEntry>, String> {
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    remote_state
        .list_sftp_directory(&profile, &app_state.remote_secrets, &path)
        .await
}

#[tauri::command]
pub async fn download_sftp_file(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    workspace_root: String,
    profile_id: String,
    remote_path: String,
    local_relative_path: String,
) -> Result<crate::remote::RemoteTransferResult, String> {
    let workspace_root = app_state.trusted_workspace_root(&workspace_root)?;
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    if profile.workspace_root != workspace_root.to_string_lossy() {
        return Err("remote host profile does not belong to workspace".to_string());
    }

    remote_state
        .download_sftp_file(
            &profile,
            &app_state.remote_secrets,
            &remote_path,
            &workspace_root,
            &local_relative_path,
        )
        .await
}

#[tauri::command]
pub async fn upload_sftp_file(
    app_state: State<'_, AppState>,
    remote_state: State<'_, crate::remote::RemoteState>,
    workspace_root: String,
    profile_id: String,
    local_relative_path: String,
    remote_path: String,
) -> Result<crate::remote::RemoteTransferResult, String> {
    let workspace_root = app_state.trusted_workspace_root(&workspace_root)?;
    let profile = app_state.remote_host_in_active_workspace(&profile_id)?;
    if profile.workspace_root != workspace_root.to_string_lossy() {
        return Err("remote host profile does not belong to workspace".to_string());
    }

    remote_state
        .upload_sftp_file(
            &profile,
            &app_state.remote_secrets,
            &workspace_root,
            &local_relative_path,
            &remote_path,
        )
        .await
}

#[tauri::command]
pub async fn inspect_database_schema(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<crate::database::DatabaseSchema, String> {
    state.inspect_database_schema(&profile_id).await
}

#[tauri::command]
pub async fn execute_database_query(
    state: State<'_, AppState>,
    request: crate::database::DatabaseQueryRequest,
) -> Result<crate::database::DatabaseQueryResult, String> {
    state.execute_database_query(request).await
}

#[tauri::command]
pub fn list_database_query_history(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<crate::database::DatabaseQueryHistoryEntry>, String> {
    state.list_database_query_history(&profile_id)
}

#[tauri::command]
pub fn export_database_query_result(
    state: State<'_, AppState>,
    workspace_root: String,
    result: crate::database::DatabaseQueryResult,
) -> Result<crate::database::DatabaseExport, String> {
    state.export_database_query_result(&workspace_root, &result)
}

#[tauri::command]
pub fn list_agent_sessions(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<Vec<crate::agent::AgentSession>, String> {
    state.list_agent_sessions(&workspace_root)
}

#[tauri::command]
pub fn start_agent_session(
    state: State<'_, AppState>,
    workspace_root: String,
    mode: crate::agent::AgentMode,
    prompt: String,
    context_items: Vec<crate::agent::AgentContextItem>,
) -> Result<crate::agent::AgentSession, String> {
    state.start_agent_session(&workspace_root, mode, prompt, context_items)
}

#[tauri::command]
pub fn append_agent_transcript(
    state: State<'_, AppState>,
    session_id: String,
    entry: crate::agent::AgentTranscriptInput,
) -> Result<crate::agent::AgentTranscriptEntry, String> {
    state.append_agent_transcript(session_id, entry)
}

#[tauri::command]
pub fn update_agent_approval(
    state: State<'_, AppState>,
    session_id: String,
    approval_id: String,
    status: crate::agent::AgentApprovalStatus,
) -> Result<crate::agent::AgentSession, String> {
    state.update_agent_approval(session_id, approval_id, status)
}

#[tauri::command]
pub fn export_agent_prompt(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<crate::agent::AgentPromptExport, String> {
    state.export_agent_prompt(session_id)
}

#[tauri::command]
pub fn browser_validate_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<crate::browser_preview::BrowserUrl, String> {
    state.validate_browser_url(&url)
}

#[tauri::command]
pub async fn browser_capture_preview(
    state: State<'_, AppState>,
    workspace_root: String,
    request: crate::browser_preview::BrowserCaptureRequest,
) -> Result<crate::browser_preview::BrowserScreenshot, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || {
        crate::browser_preview::capture_preview(workspace_root.to_string_lossy(), request)
    })
    .await
}

#[tauri::command]
pub async fn git_status(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::repository_status(&workspace_root)).await
}

#[tauri::command]
pub async fn git_diff_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
    staged: bool,
) -> Result<crate::git::GitDiff, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::diff_file(&workspace_root, &path, staged)).await
}

#[tauri::command]
pub async fn git_diff_hunks(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
    staged: bool,
) -> Result<crate::git::GitDiffHunks, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::diff_file_hunks(&workspace_root, &path, staged)).await
}

#[tauri::command]
pub async fn git_stage_paths(
    state: State<'_, AppState>,
    workspace_root: String,
    paths: Vec<String>,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::stage_paths(&workspace_root, &paths)).await
}

#[tauri::command]
pub async fn git_unstage_paths(
    state: State<'_, AppState>,
    workspace_root: String,
    paths: Vec<String>,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::unstage_paths(&workspace_root, &paths)).await
}

#[tauri::command]
pub async fn git_discard_paths(
    state: State<'_, AppState>,
    workspace_root: String,
    paths: Vec<String>,
    confirmation: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::discard_paths(&workspace_root, &paths, &confirmation)).await
}

#[tauri::command]
pub async fn git_commit(
    state: State<'_, AppState>,
    workspace_root: String,
    message: String,
    amend: bool,
    push_after: bool,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::commit(&workspace_root, &message, amend, push_after)).await
}

#[tauri::command]
pub async fn git_stash(
    state: State<'_, AppState>,
    workspace_root: String,
    message: String,
    include_untracked: bool,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::stash(&workspace_root, &message, include_untracked)).await
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
pub async fn git_create_branch(
    state: State<'_, AppState>,
    workspace_root: String,
    name: String,
) -> Result<Vec<crate::git::GitBranch>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::create_branch(&workspace_root, &name)).await
}

#[tauri::command]
pub async fn git_checkout_branch(
    state: State<'_, AppState>,
    workspace_root: String,
    name: String,
    confirmation: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::checkout_branch(&workspace_root, &name, &confirmation)).await
}

#[tauri::command]
pub async fn git_fetch(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::fetch(&workspace_root)).await
}

#[tauri::command]
pub async fn git_pull(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::pull(&workspace_root)).await
}

#[tauri::command]
pub async fn git_push(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::push(&workspace_root)).await
}

#[tauri::command]
pub async fn git_commit_graph(
    state: State<'_, AppState>,
    workspace_root: String,
    limit: usize,
) -> Result<Vec<crate::git::GitCommitSummary>, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::commit_graph(&workspace_root, limit)).await
}

#[tauri::command]
pub async fn git_reset_hard(
    state: State<'_, AppState>,
    workspace_root: String,
    confirmation: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::reset_hard(&workspace_root, &confirmation)).await
}

#[tauri::command]
pub async fn git_rebase_onto(
    state: State<'_, AppState>,
    workspace_root: String,
    target: String,
    confirmation: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || crate::git::rebase_onto(&workspace_root, &target, &confirmation)).await
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
pub fn resize_terminal_session(
    state: State<'_, TerminalState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    state.resize_session(&session_id, rows, cols)
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
pub async fn run_workspace_task(
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
    let workspace_id =
        app_state.ensure_workspace_id_matches_root_path(&workspace_id, &workspace_root)?;
    let cwd = file_system::workspace_child_for_existing_dir(&workspace_root, Path::new(&cwd))?;
    let tasks = task_state.inner().clone();
    run_blocking(move || tasks.run_task(app, workspace_id, label, command, cwd)).await
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
pub fn metric_snapshot(
    state: State<'_, AppState>,
    docs_index_entries: usize,
    file_tree_entries: usize,
) -> Result<AppMetricSnapshot, String> {
    state.metric_snapshot(docs_index_entries, file_tree_entries)
}

#[tauri::command]
pub async fn read_text_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
) -> Result<TextFileRead, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || {
        file_system::read_text_file(
            &workspace_root,
            Path::new(&path),
            file_system::EDITABLE_TEXT_LIMIT_BYTES,
        )
    })
    .await
}

#[tauri::command]
pub async fn write_text_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
    content: String,
    expected_version: Option<FileVersion>,
) -> Result<FileOperationResult, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    run_blocking(move || {
        file_system::write_text_file(
            &workspace_root,
            Path::new(&path),
            &content,
            expected_version,
        )
    })
    .await
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

fn normalize_lsp_document_path(path: &str) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(part) => {
                let part = part
                    .to_str()
                    .ok_or_else(|| "document path is not valid UTF-8".to_string())?;
                parts.push(part.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir => return Err("document path escapes workspace".to_string()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("document path escapes workspace".to_string());
            }
        }
    }

    if parts.is_empty() {
        return Err("document path is empty".to_string());
    }

    Ok(parts.join("/"))
}

fn current_time_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis() as u64)
}

#[tauri::command]
pub async fn lsp_server_status(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
) -> Result<Vec<crate::lsp::LanguageServerStatus>, String> {
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || Ok(lsp.statuses(workspace_id, workspace_root))).await
}

#[tauri::command]
pub async fn lsp_open_document(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
    content: String,
) -> Result<crate::lsp::LanguageServerStatus, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || lsp.open_document(workspace_id, workspace_root, path, content)).await
}

#[tauri::command]
pub async fn lsp_close_document(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
) -> Result<crate::lsp::LanguageServerStatus, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || lsp.close_document(workspace_id, workspace_root, path)).await
}

#[tauri::command]
pub async fn lsp_document_diagnostics(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
) -> Result<Vec<crate::lsp::LspDiagnostic>, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || Ok(lsp.document_diagnostics(&workspace_id, &workspace_root, &path))).await
}

#[tauri::command]
pub async fn lsp_workspace_diagnostics(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
) -> Result<Vec<crate::lsp::LspDiagnostic>, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || Ok(lsp.workspace_diagnostics(&workspace_id, &workspace_root))).await
}

#[tauri::command]
pub async fn lsp_hover(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
    _line: u32,
    _character: u32,
) -> Result<serde_json::Value, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || lsp.hover(workspace_id, workspace_root, path, _line, _character)).await
}

#[tauri::command]
pub async fn lsp_definition(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
    _line: u32,
    _character: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || lsp.definition(workspace_id, workspace_root, path, _line, _character))
        .await
}

#[tauri::command]
pub async fn lsp_references(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
    _line: u32,
    _character: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || lsp.references(workspace_id, workspace_root, path, _line, _character))
        .await
}

#[tauri::command]
pub async fn lsp_completion(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
    _line: u32,
    _character: u32,
) -> Result<serde_json::Value, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || lsp.completion(workspace_id, workspace_root, path, _line, _character))
        .await
}

#[tauri::command]
pub async fn lsp_code_actions(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
    _line: u32,
    _character: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || lsp.code_actions(workspace_id, workspace_root, path, _line, _character))
        .await
}

#[tauri::command]
pub async fn lsp_symbols(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || lsp.symbols(workspace_id, workspace_root)).await
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri command exposes the planned flat frontend API contract"
)]
pub async fn lsp_rename(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
    _line: u32,
    _character: u32,
    new_name: String,
) -> Result<serde_json::Value, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || {
        lsp.rename(
            workspace_id,
            workspace_root,
            path,
            _line,
            _character,
            new_name,
        )
    })
    .await
}

#[tauri::command]
pub async fn lsp_restart_server(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
    path: String,
) -> Result<crate::lsp::LanguageServerStatus, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let path = normalize_lsp_document_path(&path)?;
    let language =
        crate::lsp::detect_language(&path).ok_or_else(|| "unsupported file type".to_string())?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || lsp.restart_server(workspace_id, workspace_root, language)).await
}

#[tauri::command]
pub async fn lsp_server_logs(
    state: State<'_, AppState>,
    lsp_state: State<'_, crate::lsp::LspState>,
    workspace_root: String,
    workspace_id: String,
) -> Result<Vec<String>, String> {
    let _ = workspace_id;
    let (workspace_id, workspace_root) = state.lsp_workspace_identity(&workspace_root)?;
    let lsp = lsp_state.inner().clone();
    run_blocking(move || Ok(lsp.server_logs(workspace_id, workspace_root))).await
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
            ..AppSettings::default()
        }
    }

    fn app_state_with_two_workspaces() -> (
        tempfile::TempDir,
        AppState,
        PathBuf,
        PathBuf,
        String,
        String,
    ) {
        let config = tempfile::tempdir().expect("config dir");
        let workspace_a = config.path().join("workspace-a");
        let workspace_b = config.path().join("workspace-b");
        std::fs::create_dir_all(&workspace_a).expect("workspace a");
        std::fs::create_dir_all(&workspace_b).expect("workspace b");
        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace_a.clone())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.clone())
            .expect("open workspace b");
        let registry = state.registry_snapshot().expect("registry");
        let workspace_a_id = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.path == workspace_a)
            .map(|workspace| workspace.id.clone())
            .expect("workspace a id");
        let workspace_b_id = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.path == workspace_b)
            .map(|workspace| workspace.id.clone())
            .expect("workspace b id");

        (
            config,
            state,
            workspace_a.canonicalize().expect("workspace a canonical"),
            workspace_b.canonicalize().expect("workspace b canonical"),
            workspace_a_id,
            workspace_b_id,
        )
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
    fn app_state_import_keybindings_imports_vscode_shortcuts() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");

        let imported = state
            .import_keybindings(
                "vscode",
                r#"[{"key":"cmd+k","command":"workbench.action.showCommands"}]"#.to_string(),
            )
            .expect("import keybindings");

        assert_eq!(
            imported.keybindings,
            vec![crate::settings::KeybindingSetting {
                command_id: "open-command-palette".to_string(),
                key: "cmd+k".to_string(),
                source: "vscode".to_string(),
            }]
        );
        assert_eq!(state.settings_snapshot().expect("settings"), imported);

        let reloaded = AppState::new(temp.path()).expect("reload");
        assert_eq!(reloaded.settings_snapshot().expect("settings"), imported);
    }

    #[test]
    fn app_state_import_keybindings_rejects_unsupported_source() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");
        let original = state.settings_snapshot().expect("settings");

        let result = state.import_keybindings("jetbrains", "[]".to_string());

        assert_eq!(
            result.expect_err("unsupported source"),
            "unsupported keybinding import source: jetbrains"
        );
        assert_eq!(state.settings_snapshot().expect("settings"), original);
    }

    #[test]
    fn app_state_import_keybindings_preserves_concurrent_settings_save() {
        let temp = tempdir().expect("temp dir");
        let state = std::sync::Arc::new(AppState::new(temp.path()).expect("state"));
        let import_state = std::sync::Arc::clone(&state);
        let content = format!(
            "[{}]",
            std::iter::repeat_n(r#"{"key":"cmd+x","command":"unknown.command"}"#, 120_000)
                .collect::<Vec<_>>()
                .join(",")
        );

        let import_thread = std::thread::spawn(move || {
            import_state
                .import_keybindings("vscode", content)
                .expect("import keybindings")
        });
        std::thread::sleep(std::time::Duration::from_millis(10));
        let changed = settings("comfortable", "light");

        state
            .save_settings(changed.clone())
            .expect("save concurrent settings");
        import_thread.join().expect("join import thread");

        let loaded = state.settings_snapshot().expect("settings");
        assert_eq!(loaded.density, changed.density);
        assert_eq!(loaded.color_theme, changed.color_theme);

        let reloaded = AppState::new(temp.path()).expect("reload");
        let persisted = reloaded.settings_snapshot().expect("settings");
        assert_eq!(persisted.density, changed.density);
        assert_eq!(persisted.color_theme, changed.color_theme);
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
    fn app_state_saves_and_lists_unsaved_backups_for_registered_workspace() {
        let (_config, state, workspace_a, _workspace_b, workspace_a_id, _workspace_b_id) =
            app_state_with_two_workspaces();

        let saved = state
            .save_unsaved_backup(
                &workspace_a.to_string_lossy(),
                &workspace_a_id,
                "src/main.ts".to_string(),
                "dirty text".to_string(),
                None,
            )
            .expect("save backup");

        let listed = state
            .list_unsaved_backups(&workspace_a.to_string_lossy(), &workspace_a_id)
            .expect("list backups");
        assert_eq!(listed, vec![saved]);
    }

    #[test]
    fn app_state_rejects_unsaved_backup_when_workspace_id_does_not_match_root() {
        let (_config, state, workspace_a, _workspace_b, _workspace_a_id, workspace_b_id) =
            app_state_with_two_workspaces();

        let result = state.save_unsaved_backup(
            &workspace_a.to_string_lossy(),
            &workspace_b_id,
            "src/main.ts".to_string(),
            "dirty text".to_string(),
            None,
        );

        assert_eq!(
            result.expect_err("workspace mismatch"),
            "workspace id does not match workspace root"
        );
    }

    #[test]
    fn app_state_records_diagnostic_events_newest_first() {
        let temp = tempdir().expect("temp dir");
        let state = AppState::new(temp.path()).expect("state");

        state
            .append_diagnostic_event(crate::diagnostics::DiagnosticEventInput {
                level: "info".to_string(),
                source: "startup".to_string(),
                message: "visible shell".to_string(),
            })
            .expect("append startup");
        state
            .append_diagnostic_event(crate::diagnostics::DiagnosticEventInput {
                level: "warn".to_string(),
                source: "indexing".to_string(),
                message: "large workspace".to_string(),
            })
            .expect("append indexing");

        let events = state.list_diagnostic_events(10).expect("list events");

        assert_eq!(events[0].source, "indexing");
        assert_eq!(events[1].source, "startup");
    }

    #[test]
    fn metric_snapshot_reports_registry_counts_and_clamped_index_counts() {
        let (_config, state, _workspace_a, _workspace_b, workspace_a_id, _workspace_b_id) =
            app_state_with_two_workspaces();

        let snapshot = state
            .metric_snapshot(usize::MAX, 1_000_001)
            .expect("snapshot");

        assert!(snapshot.uptime_ms <= crate::metrics::current_time_ms());
        assert_eq!(snapshot.workspace_count, 2);
        assert_eq!(
            snapshot.active_workspace_id.as_deref(),
            Some(workspace_a_id.as_str())
        );
        assert_eq!(snapshot.docs_index_entries, 1_000_000);
        assert_eq!(snapshot.file_tree_entries, 1_000_000);
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
    fn workspace_scan_uses_trusted_canonical_root() {
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
        let trusted_root = state
            .trusted_workspace_root(lexical_workspace.to_str().expect("workspace path"))
            .expect("trusted root");
        let entries = workspace_scan::scan_top_level(&trusted_root).expect("scan workspace");

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
    fn extension_commands_require_registered_workspace() {
        let config = tempfile::tempdir().expect("config");
        let unregistered = tempfile::tempdir().expect("unregistered workspace");
        let state = AppState::new(config.path()).expect("state");

        let error = state
            .extension_statuses(&unregistered.path().to_string_lossy())
            .expect_err("unregistered workspace rejected");

        assert!(error.contains("workspace not registered"));
    }

    #[test]
    fn extension_enablement_is_workspace_scoped_through_app_state() {
        let (_config, state, workspace_a, workspace_b, _workspace_a_id, _workspace_b_id) =
            app_state_with_two_workspaces();

        let disabled = state
            .set_extension_enabled(
                &workspace_a.to_string_lossy(),
                "yuuzu.debug-tools".to_string(),
                false,
            )
            .expect("disable");
        let enabled_elsewhere = state
            .extension_statuses(&workspace_b.to_string_lossy())
            .expect("workspace b statuses");

        assert!(
            !disabled
                .iter()
                .find(|status| status.manifest.id == "yuuzu.debug-tools")
                .expect("debug tools")
                .enabled
        );
        assert!(
            enabled_elsewhere
                .iter()
                .find(|status| status.manifest.id == "yuuzu.debug-tools")
                .expect("debug tools b")
                .enabled
        );
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
        fn assert_flat_signature<F>(_command: F)
        where
            F: for<'app_state, 'task_state> AsyncFn(
                AppHandle,
                State<'app_state, AppState>,
                State<'task_state, crate::tasks::TaskState>,
                String,
                String,
                String,
                String,
                String,
            )
                -> Result<crate::tasks::TaskRun, String>,
        {
        }

        assert_flat_signature(super::run_workspace_task);
    }

    #[test]
    fn run_workspace_task_rejects_mismatched_workspace_identity() {
        let config = tempfile::tempdir().expect("config dir");
        let workspace_a = config.path().join("workspace-a");
        let workspace_b = config.path().join("workspace-b");
        std::fs::create_dir_all(&workspace_a).expect("workspace a");
        std::fs::create_dir_all(&workspace_b).expect("workspace b");

        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace_a.clone())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.clone())
            .expect("open workspace b");

        let task_state = TaskState::new();
        let registry = state.registry_snapshot().expect("registry");
        let _workspace_a_id = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.path == workspace_a)
            .map(|workspace| workspace.id.clone())
            .expect("workspace a id");
        let workspace_b_id = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.path == workspace_b)
            .map(|workspace| workspace.id.clone())
            .expect("workspace b id");
        let workspace_a_root = workspace_a.canonicalize().expect("canonical workspace a");

        let forged_result = state
            .ensure_workspace_id_matches_root_path(&workspace_b_id, &workspace_a_root)
            .expect_err("mismatch should be rejected");
        assert!(forged_result.contains("workspace id does not match workspace root"));

        assert!(task_state
            .list_runs(&workspace_b_id)
            .expect("list runs")
            .is_empty());
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
    fn start_agent_session_preserves_flat_command_signature() {
        type FlatStartAgentSessionCommand = fn(
            State<'_, AppState>,
            String,
            crate::agent::AgentMode,
            String,
            Vec<crate::agent::AgentContextItem>,
        )
            -> Result<crate::agent::AgentSession, String>;

        fn assert_flat_signature(_command: FlatStartAgentSessionCommand) {}

        assert_flat_signature(start_agent_session);
    }

    #[test]
    fn list_database_profiles_preserves_flat_command_signature() {
        type FlatListDatabaseProfilesCommand =
            fn(
                State<'_, AppState>,
                String,
            ) -> Result<Vec<crate::database::DatabaseProfile>, String>;

        fn assert_flat_signature(_command: FlatListDatabaseProfilesCommand) {}

        assert_flat_signature(super::list_database_profiles);
    }

    #[test]
    fn save_database_profile_preserves_flat_command_signature() {
        type FlatSaveDatabaseProfileCommand =
            fn(
                State<'_, AppState>,
                crate::database::DatabaseProfileInput,
            ) -> Result<crate::database::DatabaseProfile, String>;

        fn assert_flat_signature(_command: FlatSaveDatabaseProfileCommand) {}

        assert_flat_signature(super::save_database_profile);
    }

    #[test]
    fn delete_database_profile_preserves_flat_command_signature() {
        type FlatDeleteDatabaseProfileCommand =
            fn(State<'_, AppState>, String, String) -> Result<(), String>;

        fn assert_flat_signature(_command: FlatDeleteDatabaseProfileCommand) {}

        assert_flat_signature(super::delete_database_profile);
    }

    #[test]
    fn list_remote_hosts_preserves_flat_command_signature() {
        type FlatListRemoteHostsCommand =
            fn(
                State<'_, AppState>,
                String,
            ) -> Result<Vec<crate::remote::RemoteHostProfile>, String>;

        fn assert_flat_signature(_command: FlatListRemoteHostsCommand) {}

        assert_flat_signature(super::list_remote_hosts);
    }

    #[test]
    fn save_remote_host_preserves_flat_command_signature() {
        type FlatSaveRemoteHostCommand = fn(
            State<'_, AppState>,
            crate::remote::RemoteHostProfileInput,
        )
            -> Result<crate::remote::RemoteHostProfile, String>;

        fn assert_flat_signature(_command: FlatSaveRemoteHostCommand) {}

        assert_flat_signature(super::save_remote_host);
    }

    #[test]
    fn delete_remote_host_preserves_flat_command_signature() {
        type FlatDeleteRemoteHostCommand =
            fn(State<'_, AppState>, String, String) -> Result<(), String>;

        fn assert_flat_signature(_command: FlatDeleteRemoteHostCommand) {}

        assert_flat_signature(super::delete_remote_host);
    }

    #[test]
    fn debug_start_session_rejects_mismatched_workspace_identity() {
        let (_config, state, workspace_a, workspace_b, workspace_a_id, _workspace_b_id) =
            app_state_with_two_workspaces();
        let debug_state = crate::debug::DebugState::new_for_tests();
        debug_state.install_test_adapter(
            crate::debug::DebugAdapterKind::Python,
            crate::debug::ScriptedDebugAdapter::python_stopped_at_line(8),
        );
        let config = crate::debug::DebugLaunchConfigInput {
            id: Some("cfg".to_string()),
            workspace_root: workspace_a.to_string_lossy().to_string(),
            name: "Python".to_string(),
            adapter: crate::debug::DebugAdapterKind::Python,
            request: crate::debug::DebugRequestKind::Launch,
            program: "app.py".to_string(),
            cwd: ".".to_string(),
            args: Vec::new(),
            env: Vec::new(),
            stop_on_entry: true,
            attach: None,
        };
        state.debug_save_launch_config(config).expect("save config");

        let result = state.debug_start_session(
            &debug_state,
            workspace_b.to_string_lossy().as_ref(),
            &workspace_a_id,
            "cfg",
        );

        assert!(result
            .expect_err("mismatch")
            .contains("workspace id does not match workspace root"));
    }

    #[test]
    fn debug_start_session_emits_frontend_events_through_test_sink() {
        let (_config, state, workspace_a, _workspace_b, workspace_a_id, _workspace_b_id) =
            app_state_with_two_workspaces();
        let sink = std::sync::Arc::new(crate::debug::TestDebugEventSink::default());
        let debug_state = crate::debug::DebugState::new_for_tests_with_event_sink(sink.clone());
        debug_state.install_test_adapter(
            crate::debug::DebugAdapterKind::Python,
            crate::debug::ScriptedDebugAdapter::python_stopped_at_line(8),
        );
        let config = crate::debug::DebugLaunchConfigInput {
            id: Some("cfg".to_string()),
            workspace_root: workspace_a.to_string_lossy().to_string(),
            name: "Python".to_string(),
            adapter: crate::debug::DebugAdapterKind::Python,
            request: crate::debug::DebugRequestKind::Launch,
            program: "app.py".to_string(),
            cwd: ".".to_string(),
            args: Vec::new(),
            env: Vec::new(),
            stop_on_entry: true,
            attach: None,
        };
        state.debug_save_launch_config(config).expect("save config");

        let session = state
            .debug_start_session(
                &debug_state,
                workspace_a.to_string_lossy().as_ref(),
                &workspace_a_id,
                "cfg",
            )
            .expect("start");

        let events = sink.events();
        assert!(events.iter().any(|event| {
            event.name == crate::debug::DEBUG_SESSION_EVENT
                && event.payload["session_id"] == session.id
                && event.payload["workspace_id"] == workspace_a_id
                && event.payload["workspace_root"] == workspace_a.to_string_lossy().to_string()
                && event.payload["sequence"].as_u64().is_some()
        }));
        assert!(events
            .iter()
            .any(|event| event.name == crate::debug::DEBUG_STOPPED_EVENT
                && event.payload["sequence"].as_u64() == Some(session.sequence)));
        assert!(events
            .iter()
            .any(|event| event.name == crate::debug::DEBUG_CONSOLE_EVENT));
    }

    #[test]
    fn debug_all_workspace_commands_reject_unregistered_workspaces() {
        let config = tempfile::tempdir().expect("config dir");
        let unregistered = tempfile::tempdir().expect("unregistered workspace");
        let state = AppState::new(config.path()).expect("state");
        let debug_state = crate::debug::DebugState::new_for_tests();
        let workspace_root = unregistered.path().to_string_lossy().to_string();
        let workspace_id = "workspace-a";
        let input = crate::debug::DebugLaunchConfigInput {
            id: Some("cfg".to_string()),
            workspace_root: workspace_root.clone(),
            name: "Python".to_string(),
            adapter: crate::debug::DebugAdapterKind::Python,
            request: crate::debug::DebugRequestKind::Launch,
            program: "app.py".to_string(),
            cwd: ".".to_string(),
            args: Vec::new(),
            env: Vec::new(),
            stop_on_entry: true,
            attach: None,
        };

        let results = [
            (
                "list launch configs",
                state.debug_list_launch_configs(&workspace_root).map(|_| ()),
            ),
            (
                "save launch config",
                state.debug_save_launch_config(input).map(|_| ()),
            ),
            (
                "delete launch config",
                state
                    .debug_delete_launch_config(&workspace_root, "cfg")
                    .map(|_| ()),
            ),
            (
                "list sessions",
                state
                    .debug_list_sessions(&debug_state, &workspace_root, workspace_id)
                    .map(|_| ()),
            ),
            (
                "start session",
                state
                    .debug_start_session(&debug_state, &workspace_root, workspace_id, "cfg")
                    .map(|_| ()),
            ),
            (
                "set breakpoints",
                state
                    .debug_set_breakpoints(
                        &debug_state,
                        &workspace_root,
                        workspace_id,
                        "app.py".to_string(),
                        Vec::new(),
                    )
                    .map(|_| ()),
            ),
            (
                "set session breakpoints",
                state
                    .debug_set_session_breakpoints(
                        &debug_state,
                        &workspace_root,
                        workspace_id,
                        "session",
                        "app.py".to_string(),
                        Vec::new(),
                    )
                    .map(|_| ()),
            ),
            (
                "continue",
                state
                    .debug_continue(&debug_state, &workspace_root, workspace_id, "session")
                    .map(|_| ()),
            ),
            (
                "step over",
                state
                    .debug_step_over(&debug_state, &workspace_root, workspace_id, "session")
                    .map(|_| ()),
            ),
            (
                "pause",
                state
                    .debug_pause(&debug_state, &workspace_root, workspace_id, "session")
                    .map(|_| ()),
            ),
            (
                "disconnect",
                state
                    .debug_disconnect(&debug_state, &workspace_root, workspace_id, "session")
                    .map(|_| ()),
            ),
            (
                "stack trace",
                state
                    .debug_stack_trace(&debug_state, &workspace_root, workspace_id, "session", 1)
                    .map(|_| ()),
            ),
            (
                "scopes",
                state
                    .debug_scopes(&debug_state, &workspace_root, workspace_id, "session", 1)
                    .map(|_| ()),
            ),
            (
                "variables",
                state
                    .debug_variables(&debug_state, &workspace_root, workspace_id, "session", 1)
                    .map(|_| ()),
            ),
            (
                "evaluate",
                state
                    .debug_evaluate(
                        &debug_state,
                        &workspace_root,
                        workspace_id,
                        "session",
                        "counter".to_string(),
                    )
                    .map(|_| ()),
            ),
            (
                "session logs",
                state
                    .debug_session_logs(&debug_state, &workspace_root, workspace_id)
                    .map(|_| ()),
            ),
        ];

        for (name, result) in results {
            assert!(
                result.expect_err(name).contains("workspace not registered"),
                "{name} should reject unregistered workspace"
            );
        }
    }

    #[test]
    fn debug_start_session_preserves_flat_command_signature() {
        type FlatDebugStartSessionCommand = fn(
            State<'_, AppState>,
            State<'_, crate::debug::DebugState>,
            String,
            String,
            String,
        )
            -> Result<crate::debug::DebugSessionInfo, String>;

        fn assert_flat_signature(_command: FlatDebugStartSessionCommand) {}

        assert_flat_signature(super::debug_start_session);
    }

    #[test]
    fn debug_set_breakpoints_preserves_flat_command_signature() {
        type FlatDebugSetBreakpointsCommand =
            fn(
                State<'_, AppState>,
                State<'_, crate::debug::DebugState>,
                String,
                String,
                String,
                Vec<crate::debug::DebugSourceBreakpointInput>,
            ) -> Result<Vec<crate::debug::DebugSourceBreakpoint>, String>;

        fn assert_flat_signature(_command: FlatDebugSetBreakpointsCommand) {}

        assert_flat_signature(super::debug_set_breakpoints);
    }

    #[test]
    fn debug_evaluate_preserves_flat_command_signature() {
        type FlatDebugEvaluateCommand = fn(
            State<'_, AppState>,
            State<'_, crate::debug::DebugState>,
            String,
            String,
            String,
            String,
        ) -> Result<crate::debug::DebugVariable, String>;

        fn assert_flat_signature(_command: FlatDebugEvaluateCommand) {}

        assert_flat_signature(super::debug_evaluate);
    }

    #[test]
    fn spawn_ssh_terminal_preserves_flat_command_signature() {
        fn assert_future<F>(_: F)
        where
            F: std::future::Future<
                Output = Result<crate::remote::RemoteTerminalSessionInfo, String>,
            >,
        {
        }

        #[allow(dead_code)]
        #[expect(
            clippy::too_many_arguments,
            reason = "signature probe intentionally mirrors the flat Tauri command contract"
        )]
        fn assert_flat_signature(
            app: AppHandle,
            app_state: State<'_, AppState>,
            remote_state: State<'_, crate::remote::RemoteState>,
            workspace_id: String,
            workspace_root: String,
            profile_id: String,
            rows: u16,
            cols: u16,
        ) {
            assert_future(super::spawn_ssh_terminal(
                app,
                app_state,
                remote_state,
                workspace_id,
                workspace_root,
                profile_id,
                rows,
                cols,
            ));
        }

        let _ = assert_flat_signature;
    }

    #[test]
    fn delete_remote_host_rejects_unregistered_workspace_root() {
        let config = tempfile::tempdir().expect("config");
        let state = AppState::new(config.path()).expect("state");

        let result = state.delete_remote_host("/not/registered", "missing");

        assert!(result
            .expect_err("reject")
            .contains("workspace not registered"));
    }

    #[test]
    fn delete_remote_host_rejects_profile_outside_workspace_root() {
        let config = tempfile::tempdir().expect("config");
        let workspace_a = tempfile::tempdir().expect("workspace-a");
        let workspace_b = tempfile::tempdir().expect("workspace-b");
        let state = AppState::new(config.path()).expect("state");
        state
            .mutate_registry(|registry| {
                registry.workspaces.push(crate::workspace::Workspace {
                    id: "a".to_string(),
                    name: "A".to_string(),
                    path: workspace_a.path().to_path_buf(),
                    pinned: false,
                });
                registry.workspaces.push(crate::workspace::Workspace {
                    id: "b".to_string(),
                    name: "B".to_string(),
                    path: workspace_b.path().to_path_buf(),
                    pinned: false,
                });
                Ok(())
            })
            .expect("registry");

        let profile = state
            .remote_profiles
            .save_profile(
                crate::remote::RemoteHostProfileInput {
                    id: Some("host-a".to_string()),
                    workspace_root: workspace_a.path().to_string_lossy().to_string(),
                    name: "edge".to_string(),
                    host: "edge.example.com".to_string(),
                    port: 22,
                    username: "deploy".to_string(),
                    auth_kind: crate::remote::RemoteAuthKind::Agent,
                    password: None,
                    key_path: None,
                    key_passphrase: None,
                    default_remote_path: "/var/www".to_string(),
                    keepalive_seconds: 30,
                    connect_timeout_seconds: 10,
                },
                &state.remote_secrets,
                || Ok(crate::remote::remote_now_ms()),
                crate::remote::new_remote_host_id,
            )
            .expect("profile");

        let result =
            state.delete_remote_host(workspace_b.path().to_string_lossy().as_ref(), &profile.id);

        assert!(result
            .expect_err("reject")
            .contains("remote host profile does not belong to workspace"));
    }

    #[test]
    fn remote_host_in_active_workspace_checks_active_workspace() {
        let config = tempfile::tempdir().expect("config");
        let workspace_a = tempfile::tempdir().expect("workspace-a");
        let workspace_b = tempfile::tempdir().expect("workspace-b");
        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace_a.path().to_path_buf())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.path().to_path_buf())
            .expect("open workspace b");

        let workspace_a_root = workspace_a
            .path()
            .canonicalize()
            .expect("canonical workspace a")
            .to_string_lossy()
            .to_string();
        let profile = state
            .remote_profiles
            .save_profile(
                crate::remote::RemoteHostProfileInput {
                    id: Some("host-a".to_string()),
                    workspace_root: workspace_a_root,
                    name: "edge".to_string(),
                    host: "edge.example.com".to_string(),
                    port: 22,
                    username: "deploy".to_string(),
                    auth_kind: crate::remote::RemoteAuthKind::Agent,
                    password: None,
                    key_path: None,
                    key_passphrase: None,
                    default_remote_path: "/var/www".to_string(),
                    keepalive_seconds: 30,
                    connect_timeout_seconds: 10,
                },
                &state.remote_secrets,
                || Ok(crate::remote::remote_now_ms()),
                crate::remote::new_remote_host_id,
            )
            .expect("profile");

        state
            .remote_host_in_active_workspace(&profile.id)
            .expect("active workspace");

        let registry = state.registry_snapshot().expect("registry");
        let workspace_b_id = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.path == workspace_b.path())
            .map(|workspace| workspace.id.clone())
            .expect("workspace b id");

        state
            .mutate_registry(|registry| {
                if registry.switch_workspace(&workspace_b_id) {
                    Ok(())
                } else {
                    Err(format!("workspace not found: {workspace_b_id}"))
                }
            })
            .expect("switch workspace");

        let err = state
            .remote_host_in_active_workspace(&profile.id)
            .expect_err("outside active workspace");
        assert!(err.contains("does not belong to active workspace"));
    }

    #[test]
    fn inspect_database_schema_preserves_flat_command_signature() {
        fn assert_flat_signature<T>(_command: T) {
            let _ = _command;
        }

        assert_flat_signature(super::inspect_database_schema);
    }

    #[test]
    fn execute_database_query_preserves_flat_command_signature() {
        fn assert_flat_signature<T>(_command: T) {
            let _ = _command;
        }

        assert_flat_signature(super::execute_database_query);
    }

    #[test]
    fn list_database_query_history_preserves_flat_command_signature() {
        type FlatListDatabaseQueryHistoryCommand =
            fn(
                State<'_, AppState>,
                String,
            ) -> Result<Vec<crate::database::DatabaseQueryHistoryEntry>, String>;

        fn assert_flat_signature(_command: FlatListDatabaseQueryHistoryCommand) {}

        assert_flat_signature(super::list_database_query_history);
    }

    #[test]
    fn export_database_query_result_preserves_flat_command_signature() {
        type FlatExportDatabaseQueryResultCommand =
            fn(
                State<'_, AppState>,
                String,
                crate::database::DatabaseQueryResult,
            ) -> Result<crate::database::DatabaseExport, String>;

        fn assert_flat_signature(_command: FlatExportDatabaseQueryResultCommand) {}

        assert_flat_signature(super::export_database_query_result);
    }

    #[tokio::test]
    async fn inspect_database_schema_rejects_profile_outside_active_workspace() {
        let config = tempdir().expect("config dir");
        let workspace_a = config.path().join("workspace-a");
        let workspace_b = config.path().join("workspace-b");
        std::fs::create_dir_all(&workspace_a).expect("workspace a");
        std::fs::create_dir_all(&workspace_b).expect("workspace b");

        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace_a.clone())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.clone())
            .expect("open workspace b");

        let profile = state
            .save_database_profile(crate::database::DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: workspace_a
                    .canonicalize()
                    .expect("canonical workspace a")
                    .to_string_lossy()
                    .to_string(),
                name: "legacy".to_string(),
                kind: crate::database::DatabaseKind::PostgreSQL,
                sqlite_path: None,
                host: Some("localhost".to_string()),
                port: Some(5432),
                database: Some("app".to_string()),
                username: Some("user".to_string()),
                password: None,
                read_only: false,
                production: false,
            })
            .expect("save profile");

        let registry = state.registry_snapshot().expect("registry");
        let workspace_b_id = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.path == workspace_b)
            .map(|workspace| workspace.id.clone())
            .expect("workspace b id");

        state
            .mutate_registry(|registry| {
                if registry.switch_workspace(&workspace_b_id) {
                    Ok(())
                } else {
                    Err(format!("workspace not found: {workspace_b_id}"))
                }
            })
            .expect("switch workspace");

        let result = state.inspect_database_schema(&profile.id).await;
        assert!(result
            .expect_err("profile outside active workspace should be rejected")
            .contains("does not belong to active workspace"));
    }

    #[tokio::test]
    async fn inspect_database_schema_tcp_profile_uses_async_path_without_nested_block_on_panic() {
        let config = tempdir().expect("config dir");
        let workspace = config.path().join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace");

        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace.clone())
            .expect("open workspace");
        let workspace_root = workspace
            .canonicalize()
            .expect("canonical workspace")
            .to_string_lossy()
            .to_string();
        let profile = state
            .save_database_profile(crate::database::DatabaseProfileInput {
                id: Some("postgres-profile".to_string()),
                workspace_root,
                name: "PostgreSQL".to_string(),
                kind: crate::database::DatabaseKind::PostgreSQL,
                sqlite_path: None,
                host: Some("127.0.0.1".to_string()),
                port: Some(5432),
                database: Some("does_not_exist".to_string()),
                username: Some("yuuzu".to_string()),
                password: None,
                read_only: false,
                production: false,
            })
            .expect("save profile");

        let profile_id = profile.id.clone();
        let joined = tokio::spawn(async move {
            let result = state.inspect_database_schema(&profile_id).await;
            (result, profile_id)
        })
        .await;

        assert!(
            joined.is_ok(),
            "async command path should not panic with nested runtime"
        );
        let result = joined.unwrap().0;
        assert!(
            result.is_err(),
            "TCP inspect should fail with connection error when server unavailable"
        );
    }

    #[tokio::test]
    async fn execute_database_query_records_history() {
        let config = tempdir().expect("config dir");
        let workspace = config.path().join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace");
        let db_path = workspace.join("app.sqlite");
        Connection::open(&db_path)
            .expect("seed sqlite open")
            .execute_batch(
                "DROP TABLE IF EXISTS items;\
                 CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);\
                 INSERT INTO items(id, name) VALUES (1, 'a'), (2, 'b');",
            )
            .expect("seed sqlite");

        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace.clone())
            .expect("open workspace");
        let profile = state
            .save_database_profile(crate::database::DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: workspace
                    .canonicalize()
                    .expect("canonical workspace")
                    .to_string_lossy()
                    .to_string(),
                name: "sqlite".to_string(),
                kind: crate::database::DatabaseKind::SQLite,
                sqlite_path: Some(db_path.to_string_lossy().to_string()),
                host: None,
                port: None,
                database: None,
                username: None,
                password: None,
                read_only: false,
                production: false,
            })
            .expect("save profile");

        let result = state
            .execute_database_query(crate::database::DatabaseQueryRequest {
                profile_id: profile.id,
                sql: "SELECT id, name FROM items ORDER BY id".to_string(),
                limit: 1,
                confirmation: None,
            })
            .await
            .expect("query");

        let history = state
            .list_database_query_history(&result.profile_id)
            .expect("list history");

        let last = history.last().expect("history entry");
        assert_eq!(last.sql, "SELECT id, name FROM items ORDER BY id");
        assert_eq!(last.kind, crate::database::QueryKind::Read);
        assert_eq!(last.affected_rows, None);
        assert_eq!(last.row_count, Some(1));
        assert_eq!(history.len(), 1);
    }

    #[tokio::test]
    async fn export_database_query_result_writes_csv_in_workspace_exports_dir() {
        let config = tempdir().expect("config dir");
        let workspace = config.path().join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace");
        let db_path = workspace.join("app.sqlite");
        let workspace_root = workspace
            .canonicalize()
            .expect("canonical workspace")
            .to_string_lossy()
            .to_string();
        Connection::open(&db_path)
            .expect("seed sqlite open")
            .execute_batch(
                "DROP TABLE IF EXISTS users;\
                 CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);\
                 INSERT INTO users(id, email) VALUES (1, 'a@example.test'), (2, 'b@example.test');",
            )
            .expect("seed sqlite");
        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace.clone())
            .expect("open workspace");
        let profile = state
            .save_database_profile(crate::database::DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: workspace
                    .canonicalize()
                    .expect("canonical workspace")
                    .to_string_lossy()
                    .to_string(),
                name: "SQLite".to_string(),
                kind: crate::database::DatabaseKind::SQLite,
                sqlite_path: Some(db_path.to_string_lossy().to_string()),
                host: None,
                port: None,
                database: None,
                username: None,
                password: None,
                read_only: false,
                production: false,
            })
            .expect("save profile");

        let result = state
            .execute_database_query(crate::database::DatabaseQueryRequest {
                profile_id: profile.id,
                sql: "SELECT id, email FROM users ORDER BY id LIMIT 1".to_string(),
                limit: 100,
                confirmation: None,
            })
            .await
            .expect("query");

        let export = state
            .export_database_query_result(workspace_root.as_str(), &result)
            .expect("export");

        let export_path = Path::new(&export.path);
        let workspace = workspace.canonicalize().expect("workspace canonicalized");
        let export_dir = workspace
            .join(".yuuzu-ide")
            .join("exports")
            .join("database");
        assert!(export_path.exists());
        assert!(export_path.starts_with(export_dir));
        assert!(!std::fs::read_to_string(export_path)
            .expect("read csv")
            .contains("profile-1"));
    }

    #[tokio::test]
    async fn export_database_query_result_rejects_mismatched_workspace_root() {
        let config = tempdir().expect("config dir");
        let workspace_a = config.path().join("workspace-a");
        let workspace_b = config.path().join("workspace-b");
        std::fs::create_dir_all(&workspace_a).expect("workspace a");
        std::fs::create_dir_all(&workspace_b).expect("workspace b");

        let db_path = workspace_a.join("app.sqlite");
        Connection::open(&db_path)
            .expect("seed sqlite open")
            .execute_batch(
                "DROP TABLE IF EXISTS users;\
                 CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);\
                 INSERT INTO users(id, email) VALUES (1, 'a@example.test');",
            )
            .expect("seed sqlite");

        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace_a.clone())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.clone())
            .expect("open workspace b");

        let workspace_a_root = workspace_a.canonicalize().expect("canonical workspace a");
        let workspace_b_root = workspace_b.canonicalize().expect("canonical workspace b");
        let registry = state.registry_snapshot().expect("registry");
        let workspace_a_id = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.path == workspace_a)
            .map(|workspace| workspace.id.clone())
            .expect("workspace a id");
        state
            .mutate_registry(|registry| {
                if registry.switch_workspace(&workspace_a_id) {
                    Ok(())
                } else {
                    Err(format!("workspace not found: {workspace_a_id}"))
                }
            })
            .expect("switch workspace");

        let profile = state
            .save_database_profile(crate::database::DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: workspace_a_root.to_string_lossy().to_string(),
                name: "sqlite".to_string(),
                kind: crate::database::DatabaseKind::SQLite,
                sqlite_path: Some(db_path.to_string_lossy().to_string()),
                host: None,
                port: None,
                database: None,
                username: None,
                password: None,
                read_only: false,
                production: false,
            })
            .expect("save profile");

        let result = state
            .execute_database_query(crate::database::DatabaseQueryRequest {
                profile_id: profile.id,
                sql: "SELECT id, email FROM users".to_string(),
                limit: 100,
                confirmation: None,
            })
            .await
            .expect("query");

        let export = state
            .export_database_query_result(workspace_b_root.to_string_lossy().as_ref(), &result);

        assert!(export.is_err());
        assert!(export
            .expect_err("workspace mismatch should be rejected")
            .contains("does not belong to workspace"));
    }

    #[test]
    fn delete_database_profile_rejects_unregistered_workspace_root() {
        let config = tempdir().expect("config dir");
        let unregistered = tempdir().expect("unregistered workspace");
        let state = AppState::new(config.path()).expect("state");

        let result = state.delete_database_profile(
            unregistered.path().to_str().expect("unregistered path"),
            "profile-id",
        );

        assert!(result.is_err());
        assert!(result
            .expect_err("unregistered workspace")
            .contains("workspace not registered"));
    }

    #[test]
    fn delete_database_profile_rejects_profile_outside_workspace_root() {
        let config = tempdir().expect("config dir");
        let workspace_a = config.path().join("workspace-a");
        let workspace_b = config.path().join("workspace-b");
        std::fs::create_dir_all(&workspace_a).expect("workspace a");
        std::fs::create_dir_all(&workspace_b).expect("workspace b");

        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace_a.clone())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.clone())
            .expect("open workspace b");

        let profile = state
            .database_profiles
            .save_profile(
                crate::database::DatabaseProfileInput {
                    id: Some("profile-1".to_string()),
                    workspace_root: workspace_a.to_str().expect("workspace root").to_string(),
                    name: "legacy".to_string(),
                    kind: crate::database::DatabaseKind::PostgreSQL,
                    sqlite_path: None,
                    host: Some("localhost".to_string()),
                    port: Some(5432),
                    database: Some("app".to_string()),
                    username: Some("user".to_string()),
                    password: None,
                    read_only: false,
                    production: false,
                },
                &state.database_secrets,
                || Ok(10),
                || "profile-1".to_string(),
            )
            .expect("save profile");

        let result = state.delete_database_profile(
            workspace_b.to_str().expect("workspace b"),
            profile.id.as_str(),
        );

        assert!(result.is_err());
        assert!(result
            .expect_err("workspace mismatch should be rejected")
            .contains("does not belong to workspace"));
        assert!(state.database_profiles.get_profile(&profile.id).is_ok());
    }

    #[test]
    fn save_database_profile_rejects_profile_outside_workspace_root() {
        let config = tempdir().expect("config dir");
        let workspace_a = config.path().join("workspace-a");
        let workspace_b = config.path().join("workspace-b");
        std::fs::create_dir_all(&workspace_a).expect("workspace a");
        std::fs::create_dir_all(&workspace_b).expect("workspace b");

        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace_a.clone())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.clone())
            .expect("open workspace b");

        let workspace_a_root = workspace_a
            .canonicalize()
            .expect("canonical workspace a")
            .to_string_lossy()
            .to_string();
        let workspace_b_root = workspace_b
            .canonicalize()
            .expect("canonical workspace b")
            .to_string_lossy()
            .to_string();

        let profile = state
            .save_database_profile(crate::database::DatabaseProfileInput {
                id: Some("profile-1".to_string()),
                workspace_root: workspace_a_root.clone(),
                name: "legacy".to_string(),
                kind: crate::database::DatabaseKind::PostgreSQL,
                sqlite_path: None,
                host: Some("localhost".to_string()),
                port: Some(5432),
                database: Some("app".to_string()),
                username: Some("user".to_string()),
                password: None,
                read_only: false,
                production: false,
            })
            .expect("save profile");

        let result = state.save_database_profile(crate::database::DatabaseProfileInput {
            id: Some(profile.id.clone()),
            workspace_root: workspace_b_root,
            name: "moved".to_string(),
            kind: crate::database::DatabaseKind::PostgreSQL,
            sqlite_path: None,
            host: Some("localhost".to_string()),
            port: Some(5432),
            database: Some("app".to_string()),
            username: Some("user".to_string()),
            password: None,
            read_only: false,
            production: false,
        });

        assert!(result.is_err());
        assert!(result
            .expect_err("workspace mismatch should be rejected")
            .contains("does not belong to workspace"));
        let current = state
            .database_profiles
            .get_profile(&profile.id)
            .expect("profile still exists");
        assert_eq!(current.name, "legacy");
        assert_eq!(current.workspace_root, workspace_a_root);
    }

    #[test]
    fn browser_validate_url_rejects_remote_hosts() {
        assert!(crate::browser_preview::normalize_browser_url("http://example.com:3000").is_err());
        assert!(crate::browser_preview::normalize_browser_url("localhost:3000").is_ok());
    }

    #[test]
    fn lsp_open_document_preserves_flat_command_signature() {
        fn assert_flat_signature<F>(_command: F)
        where
            F: for<'app_state, 'lsp_state> AsyncFn(
                State<'app_state, AppState>,
                State<'lsp_state, crate::lsp::LspState>,
                String,
                String,
                String,
                String,
            ) -> Result<
                crate::lsp::LanguageServerStatus,
                String,
            >,
        {
        }

        assert_flat_signature(super::lsp_open_document);
    }

    #[test]
    fn agent_sessions_reject_unregistered_workspaces() {
        let config = tempfile::tempdir().expect("config dir");
        let state = AppState::new(config.path()).expect("state");

        let result = state.start_agent_session(
            "/not/registered",
            crate::agent::AgentMode::Plan,
            "Plan work".to_string(),
            Vec::new(),
        );

        assert!(result.unwrap_err().contains("workspace not registered"));
    }

    #[test]
    fn agent_session_id_commands_require_active_workspace() {
        let temp = tempfile::tempdir().expect("config dir");
        let state = AppState::new(temp.path()).expect("state");
        let workspace_a = temp.path().join("workspace-a");
        let workspace_b = temp.path().join("workspace-b");
        std::fs::create_dir(&workspace_a).expect("workspace a");
        std::fs::create_dir(&workspace_b).expect("workspace b");

        state
            .open_workspace_path(workspace_a.clone())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.clone())
            .expect("open workspace b");

        let registry = state.registry_snapshot().expect("registry");
        let workspace_b_id = registry
            .workspaces
            .into_iter()
            .find(|workspace| workspace.path == workspace_b)
            .map(|workspace| workspace.id)
            .expect("workspace b id");
        let workspace_a_root = workspace_a
            .canonicalize()
            .expect("canonical workspace a")
            .to_string_lossy()
            .to_string();

        let session = state
            .start_agent_session(
                &workspace_a_root,
                crate::agent::AgentMode::Edit,
                "Plan in workspace a".to_string(),
                Vec::new(),
            )
            .expect("start session");

        state
            .mutate_registry(|registry| {
                if registry.switch_workspace(&workspace_b_id) {
                    Ok(())
                } else {
                    Err(format!("workspace not found: {workspace_b_id}"))
                }
            })
            .expect("switch workspace");

        let append = state.append_agent_transcript(
            session.id.clone(),
            crate::agent::AgentTranscriptInput {
                kind: crate::agent::AgentTranscriptKind::Verification,
                title: "Verify".to_string(),
                content: "ok".to_string(),
                status: Some(crate::agent::AgentEvidenceStatus::Passed),
                metadata: serde_json::json!({}),
            },
        );
        let update = state.update_agent_approval(
            session.id.clone(),
            "approval-id".to_string(),
            crate::agent::AgentApprovalStatus::Approved,
        );
        let export = state.export_agent_prompt(session.id.clone());

        assert!(append
            .unwrap_err()
            .contains("session does not belong to active workspace"));
        assert!(update
            .unwrap_err()
            .contains("session does not belong to active workspace"));
        assert!(export
            .unwrap_err()
            .contains("session does not belong to active workspace"));
    }

    #[test]
    fn lsp_status_rejects_unregistered_workspace() {
        let config = tempfile::tempdir().expect("config dir");
        let state = AppState::new(config.path()).expect("state");
        let unregistered_workspace = tempfile::tempdir().expect("unregistered workspace");

        let result =
            state.lsp_workspace_identity(unregistered_workspace.path().to_str().expect("path"));

        assert!(result.unwrap_err().contains("workspace not registered"));
    }

    #[test]
    fn lsp_provider_commands_restart_stopped_servers() {
        let config = tempfile::tempdir().expect("config dir");
        let state = AppState::new(config.path()).expect("state");
        let lsp_state = crate::lsp::LspState::new_for_tests();
        let workspace = tempfile::tempdir().expect("workspace");
        let workspace_root = workspace.path().to_str().expect("workspace path");
        state
            .open_workspace_path(workspace.path().to_path_buf())
            .expect("open workspace");
        let (workspace_id, trusted_root) = state
            .lsp_workspace_identity(workspace_root)
            .expect("workspace identity");

        lsp_state
            .open_document(
                workspace_id.clone(),
                trusted_root.clone(),
                normalize_lsp_document_path("src/main.rs").expect("path"),
                "fn main() {}".to_string(),
            )
            .expect("open document");
        lsp_state.sweep_idle_servers(u64::MAX, 100);
        assert_eq!(
            lsp_state.statuses(workspace_id.clone(), trusted_root.clone())[0].state,
            crate::lsp::ServerState::Stopped
        );

        lsp_state
            .hover(
                workspace_id.clone(),
                trusted_root.clone(),
                normalize_lsp_document_path("src/main.rs").expect("path"),
                0,
                1,
            )
            .expect("hover");

        assert_eq!(
            lsp_state.statuses(workspace_id, trusted_root)[0].state,
            crate::lsp::ServerState::Running
        );
    }

    #[test]
    fn lsp_commands_share_the_unregistered_workspace_gate() {
        let config = tempfile::tempdir().expect("config dir");
        let state = AppState::new(config.path()).expect("state");
        let unregistered_workspace = tempfile::tempdir().expect("unregistered workspace");
        let workspace_root = unregistered_workspace.path().to_str().expect("path");

        // Every lsp_* command resolves its workspace through
        // lsp_workspace_identity before touching the language server state.
        let result = state.lsp_workspace_identity(workspace_root);

        assert!(result
            .expect_err("identity gate should reject unregistered workspace")
            .contains("workspace not registered"));
    }

    #[test]
    fn lsp_document_paths_that_escape_workspace_are_rejected() {
        for path in ["../outside.rs", "/tmp/outside.rs", "src/../main.rs"] {
            let result = normalize_lsp_document_path(path);

            assert!(result
                .expect_err("path should be rejected")
                .contains("document path escapes workspace"));
        }
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
        let task_state = TaskState::new();

        let delete_result = state.delete_context_pack(delete_pack.id.clone());
        let link_result = state.link_context_pack(
            link_pack.id.clone(),
            &task_state,
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

    #[test]
    fn context_pack_agent_link_rejects_inactive_workspace_session() {
        let config = tempdir().expect("config dir");
        let workspace_a = config.path().join("workspace-a");
        let workspace_b = config.path().join("workspace-b");
        std::fs::create_dir_all(&workspace_a).expect("workspace a");
        std::fs::create_dir_all(&workspace_b).expect("workspace b");
        std::fs::write(workspace_a.join("A.md"), "# Workspace A\n").expect("workspace a note");
        std::fs::write(workspace_b.join("B.md"), "# Workspace B\n").expect("workspace b note");

        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace_a.clone())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.clone())
            .expect("open workspace b");

        let registry = state.registry_snapshot().expect("registry");
        let workspace_b_id = registry
            .workspaces
            .into_iter()
            .find(|workspace| workspace.path == workspace_b)
            .map(|workspace| workspace.id)
            .expect("workspace b id");

        let workspace_a_root = workspace_a
            .canonicalize()
            .expect("canonical workspace a")
            .to_string_lossy()
            .to_string();
        let workspace_b_root = workspace_b
            .canonicalize()
            .expect("canonical workspace b")
            .to_string_lossy()
            .to_string();

        let session_a = state
            .start_agent_session(
                &workspace_a_root,
                crate::agent::AgentMode::Edit,
                "Session in workspace A".to_string(),
                Vec::new(),
            )
            .expect("start session A");

        state
            .mutate_registry(|registry| {
                if registry.switch_workspace(&workspace_b_id) {
                    Ok(())
                } else {
                    Err(format!("workspace not found: {workspace_b_id}"))
                }
            })
            .expect("switch workspace");

        let pack_b = state
            .create_context_pack(
                workspace_b_root.as_str(),
                "Workspace B Pack".to_string(),
                vec!["B.md".to_string()],
            )
            .expect("create pack in workspace b");

        let task_state = TaskState::new();
        let reject = state.link_context_pack(
            pack_b.id.clone(),
            &task_state,
            None,
            Some(session_a.id.clone()),
        );
        assert!(reject
            .unwrap_err()
            .contains("agent session does not belong to active workspace"));

        let session_b = state
            .start_agent_session(
                &workspace_b_root,
                crate::agent::AgentMode::Edit,
                "Session in workspace B".to_string(),
                Vec::new(),
            )
            .expect("start session B");
        let link_ok = state.link_context_pack(
            pack_b.id.clone(),
            &task_state,
            None,
            Some(session_b.id.clone()),
        );
        assert!(link_ok.is_ok());
    }

    #[test]
    fn context_pack_task_link_rejects_inactive_or_missing_task_run() {
        let config = tempdir().expect("config dir");
        let workspace_a = config.path().join("workspace-a");
        let workspace_b = config.path().join("workspace-b");
        std::fs::create_dir_all(&workspace_a).expect("workspace a");
        std::fs::create_dir_all(&workspace_b).expect("workspace b");
        std::fs::write(workspace_a.join("A.md"), "# Workspace A\n").expect("workspace a note");
        std::fs::write(workspace_b.join("B.md"), "# Workspace B\n").expect("workspace b note");

        let state = AppState::new(config.path()).expect("state");
        state
            .open_workspace_path(workspace_a.clone())
            .expect("open workspace a");
        state
            .open_workspace_path(workspace_b.clone())
            .expect("open workspace b");

        let registry = state.registry_snapshot().expect("registry");
        let workspace_a_id = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.path == workspace_a)
            .map(|workspace| workspace.id.clone())
            .expect("workspace a id");
        let workspace_b_id = registry
            .workspaces
            .iter()
            .find(|workspace| workspace.path == workspace_b)
            .map(|workspace| workspace.id.clone())
            .expect("workspace b id");

        let workspace_a_root = workspace_a
            .canonicalize()
            .expect("canonical workspace a")
            .to_string_lossy()
            .to_string();
        let workspace_b_root = workspace_b
            .canonicalize()
            .expect("canonical workspace b")
            .to_string_lossy()
            .to_string();

        let task_state = TaskState::new();
        let run_a = task_state
            .register_test_run(
                workspace_a_id,
                "A task".to_string(),
                "echo A".to_string(),
                PathBuf::from(&workspace_a_root),
            )
            .expect("register A task");
        let run_b = task_state
            .register_test_run(
                workspace_b_id.clone(),
                "B task".to_string(),
                "echo B".to_string(),
                PathBuf::from(&workspace_b_root),
            )
            .expect("register B task");

        state
            .mutate_registry(|registry| {
                if registry.switch_workspace(&workspace_b_id) {
                    Ok(())
                } else {
                    Err(format!("workspace not found: {workspace_b_id}"))
                }
            })
            .expect("switch workspace");

        let pack_b = state
            .create_context_pack(
                workspace_b_root.as_str(),
                "Workspace B Pack".to_string(),
                vec!["B.md".to_string()],
            )
            .expect("create pack in workspace b");

        let reject_workspace =
            state.link_context_pack(pack_b.id.clone(), &task_state, Some(run_a.id), None);
        assert!(reject_workspace
            .unwrap_err()
            .contains("task run does not belong to active workspace"));

        let reject_missing = state.link_context_pack(
            pack_b.id.clone(),
            &task_state,
            Some("workspace-a:task-999".to_string()),
            None,
        );
        assert!(reject_missing.unwrap_err().contains("missing task run"));

        let link_ok = state.link_context_pack(pack_b.id.clone(), &task_state, Some(run_b.id), None);
        assert!(link_ok.is_ok());
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
