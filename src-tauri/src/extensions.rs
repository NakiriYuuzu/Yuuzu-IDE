use serde::{Deserialize, Serialize};
use std::{
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ExtensionHookEvent {
    WorkspaceOpened,
    WorkspaceClosed,
    FileSaved,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionCommandContribution {
    pub id: String,
    pub label: String,
    pub group: String,
    pub description: String,
    pub owner_extension_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionThemeContribution {
    pub id: String,
    pub label: String,
    pub mode: String,
    pub accent: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionKeybindingContribution {
    pub command: String,
    pub key: String,
    pub when: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionSnippetContribution {
    pub id: String,
    pub language: String,
    pub prefix: String,
    pub body: Vec<String>,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionWorkspaceHookContribution {
    pub id: String,
    pub event: ExtensionHookEvent,
    pub command: String,
    pub budget_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionContributions {
    pub commands: Vec<ExtensionCommandContribution>,
    pub themes: Vec<ExtensionThemeContribution>,
    pub keybindings: Vec<ExtensionKeybindingContribution>,
    pub snippets: Vec<ExtensionSnippetContribution>,
    pub workspace_hooks: Vec<ExtensionWorkspaceHookContribution>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: String,
    pub description: String,
    pub builtin: bool,
    pub contributes: ExtensionContributions,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionWorkspaceStatus {
    pub manifest: ExtensionManifest,
    pub enabled: bool,
    pub disabled_by_workspace: bool,
    pub performance: ExtensionPerformanceSummary,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionPerformanceBudget {
    pub activation_warn_ms: u64,
    pub command_warn_ms: u64,
    pub hook_warn_ms: u64,
}

impl Default for ExtensionPerformanceBudget {
    fn default() -> Self {
        Self {
            activation_warn_ms: 200,
            command_warn_ms: 50,
            hook_warn_ms: 75,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ExtensionPerformanceClass {
    Ok,
    Slow,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionPerformanceSample {
    pub extension_id: String,
    pub workspace_root: String,
    pub operation: String,
    pub duration_ms: u64,
    pub budget_ms: u64,
    pub recorded_ms: u64,
}

impl ExtensionPerformanceSample {
    pub fn is_slow(&self) -> bool {
        self.duration_ms > self.budget_ms
    }

    pub fn classification(&self) -> ExtensionPerformanceClass {
        if self.is_slow() {
            ExtensionPerformanceClass::Slow
        } else {
            ExtensionPerformanceClass::Ok
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExtensionPerformanceSummary {
    pub last_duration_ms: Option<u64>,
    pub slow_operation_count: usize,
    pub sample_count: usize,
    pub class: ExtensionPerformanceClass,
}

impl Default for ExtensionPerformanceSummary {
    fn default() -> Self {
        Self {
            last_duration_ms: None,
            slow_operation_count: 0,
            sample_count: 0,
            class: ExtensionPerformanceClass::Ok,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionCatalog {
    manifests: Vec<ExtensionManifest>,
}

impl ExtensionCatalog {
    pub fn builtin() -> Self {
        Self {
            manifests: vec![
                core_manifest(),
                debug_tools_manifest(),
                yuzu_theme_manifest(),
            ],
        }
    }

    pub fn manifest(&self, id: &str) -> Option<&ExtensionManifest> {
        self.manifests.iter().find(|manifest| manifest.id == id)
    }

    pub fn manifests(&self) -> &[ExtensionManifest] {
        &self.manifests
    }
}

#[derive(Clone, Debug)]
pub struct ExtensionWorkspaceStore {
    path: PathBuf,
}

impl ExtensionWorkspaceStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn is_enabled(&self, workspace_root: &str, extension_id: &str) -> Result<bool, String> {
        let data = self.load()?;
        let disabled = data
            .workspace(workspace_root)
            .map(|workspace| {
                workspace
                    .disabled_extensions
                    .iter()
                    .any(|id| id == extension_id)
            })
            .unwrap_or(false);

        Ok(!disabled)
    }

    pub fn set_enabled(
        &self,
        workspace_root: &str,
        extension_id: &str,
        enabled: bool,
        current_time_ms: impl FnOnce() -> Result<u64, String>,
    ) -> Result<(), String> {
        let mut data = self.load()?;
        let updated_ms = current_time_ms()?;
        let workspace = data.workspace_mut(workspace_root);

        if enabled {
            workspace
                .disabled_extensions
                .retain(|disabled_id| disabled_id != extension_id);
        } else if !workspace
            .disabled_extensions
            .iter()
            .any(|disabled_id| disabled_id == extension_id)
        {
            workspace.disabled_extensions.push(extension_id.to_string());
            workspace.disabled_extensions.sort();
        }

        workspace.updated_ms = updated_ms;
        self.save(&data)
    }

    pub fn record_performance(
        &self,
        workspace_root: &str,
        mut sample: ExtensionPerformanceSample,
    ) -> Result<(), String> {
        let mut data = self.load()?;
        sample.workspace_root = workspace_root.to_string();
        let workspace = data.workspace_mut(workspace_root);
        workspace.updated_ms = sample.recorded_ms;
        workspace.performance_samples.push(sample);
        self.save(&data)
    }

    fn performance_summary(
        &self,
        workspace_root: &str,
        extension_id: &str,
    ) -> Result<ExtensionPerformanceSummary, String> {
        let data = self.load()?;
        let Some(workspace) = data.workspace(workspace_root) else {
            return Ok(ExtensionPerformanceSummary::default());
        };

        let mut summary = ExtensionPerformanceSummary::default();
        for sample in workspace
            .performance_samples
            .iter()
            .filter(|sample| sample.extension_id == extension_id)
        {
            summary.sample_count += 1;
            summary.last_duration_ms = Some(sample.duration_ms);
            if sample.is_slow() {
                summary.slow_operation_count += 1;
            }
        }
        if summary.slow_operation_count > 0 {
            summary.class = ExtensionPerformanceClass::Slow;
        }

        Ok(summary)
    }

    fn load(&self) -> Result<ExtensionWorkspaceStoreData, String> {
        if !self.path.exists() {
            return Ok(ExtensionWorkspaceStoreData::default());
        }

        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    fn save(&self, data: &ExtensionWorkspaceStoreData) -> Result<(), String> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let value = serde_json::to_string_pretty(data).map_err(|err| err.to_string())?;
        let parent = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let file_name = self
            .path
            .file_name()
            .unwrap_or_else(|| OsStr::new("extensions-workspace.json"));
        let mut temp_file_name = OsString::from(".");
        temp_file_name.push(file_name);
        temp_file_name.push(".tmp");
        let temp_path = parent.join(temp_file_name);

        let result = (|| {
            match fs::remove_file(&temp_path) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(err.to_string()),
            }

            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&temp_path)
                .map_err(|err| err.to_string())?;
            file.write_all(value.as_bytes())
                .map_err(|err| err.to_string())?;
            file.sync_all().map_err(|err| err.to_string())?;
            drop(file);
            fs::rename(&temp_path, &self.path).map_err(|err| err.to_string())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }

        result
    }
}

pub fn extension_statuses(
    catalog: &ExtensionCatalog,
    store: &ExtensionWorkspaceStore,
    workspace_root: &str,
) -> Result<Vec<ExtensionWorkspaceStatus>, String> {
    catalog
        .manifests()
        .iter()
        .map(|manifest| {
            let enabled = store.is_enabled(workspace_root, &manifest.id)?;
            Ok(ExtensionWorkspaceStatus {
                manifest: manifest.clone(),
                enabled,
                disabled_by_workspace: !enabled,
                performance: store.performance_summary(workspace_root, &manifest.id)?,
            })
        })
        .collect()
}

pub fn enabled_command_contributions(
    statuses: &[ExtensionWorkspaceStatus],
) -> Vec<ExtensionCommandContribution> {
    statuses
        .iter()
        .filter(|status| status.enabled)
        .flat_map(|status| status.manifest.contributes.commands.iter().cloned())
        .collect()
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
struct ExtensionWorkspaceStoreData {
    workspaces: Vec<ExtensionWorkspaceRecord>,
}

impl ExtensionWorkspaceStoreData {
    fn workspace(&self, workspace_root: &str) -> Option<&ExtensionWorkspaceRecord> {
        self.workspaces
            .iter()
            .find(|workspace| workspace.workspace_root == workspace_root)
    }

    fn workspace_mut(&mut self, workspace_root: &str) -> &mut ExtensionWorkspaceRecord {
        if let Some(index) = self
            .workspaces
            .iter()
            .position(|workspace| workspace.workspace_root == workspace_root)
        {
            return &mut self.workspaces[index];
        }

        self.workspaces.push(ExtensionWorkspaceRecord {
            workspace_root: workspace_root.to_string(),
            ..ExtensionWorkspaceRecord::default()
        });
        self.workspaces
            .last_mut()
            .expect("workspace record was just inserted")
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
struct ExtensionWorkspaceRecord {
    workspace_root: String,
    disabled_extensions: Vec<String>,
    performance_samples: Vec<ExtensionPerformanceSample>,
    updated_ms: u64,
}

fn core_manifest() -> ExtensionManifest {
    ExtensionManifest {
        id: "yuuzu.core".to_string(),
        name: "Yuuzu Core".to_string(),
        version: "0.1.0".to_string(),
        api_version: "0.1".to_string(),
        description: "Core editor command registry and workspace lifecycle contributions."
            .to_string(),
        builtin: true,
        contributes: ExtensionContributions {
            commands: command_contributions(
                "yuuzu.core",
                &[
                    (
                        "open-editor",
                        "Open Editor",
                        "navigation",
                        "Focus the editor workspace.",
                    ),
                    (
                        "open-terminal",
                        "Open Terminal",
                        "terminal",
                        "Open an integrated terminal.",
                    ),
                    (
                        "toggle-sidebar",
                        "Toggle Sidebar",
                        "layout",
                        "Toggle the primary sidebar.",
                    ),
                    ("save-file", "Save File", "file", "Save the active file."),
                    (
                        "search-workspace",
                        "Search Workspace",
                        "search",
                        "Search files in the active workspace.",
                    ),
                    (
                        "open-settings",
                        "Open Settings",
                        "settings",
                        "Open user and workspace settings.",
                    ),
                    (
                        "open-command-palette",
                        "Open Command Palette",
                        "navigation",
                        "Open the command palette.",
                    ),
                ],
            ),
            themes: vec![ExtensionThemeContribution {
                id: "yuuzu-dark".to_string(),
                label: "Yuuzu Dark".to_string(),
                mode: "dark".to_string(),
                accent: "#ff7aa2".to_string(),
            }],
            keybindings: vec![ExtensionKeybindingContribution {
                command: "open-command-palette".to_string(),
                key: "mod+shift+p".to_string(),
                when: "editorFocus || terminalFocus".to_string(),
            }],
            snippets: vec![debug_snippet()],
            workspace_hooks: vec![ExtensionWorkspaceHookContribution {
                id: "core.workspace-opened".to_string(),
                event: ExtensionHookEvent::WorkspaceOpened,
                command: "open-editor".to_string(),
                budget_ms: ExtensionPerformanceBudget::default().activation_warn_ms,
            }],
        },
    }
}

fn debug_tools_manifest() -> ExtensionManifest {
    ExtensionManifest {
        id: "yuuzu.debug-tools".to_string(),
        name: "Yuuzu Debug Tools".to_string(),
        version: "0.1.0".to_string(),
        api_version: "0.1".to_string(),
        description: "Builtin debug commands and snippets.".to_string(),
        builtin: true,
        contributes: ExtensionContributions {
            commands: command_contributions(
                "yuuzu.debug-tools",
                &[
                    (
                        "open-debug",
                        "Open Debug",
                        "debug",
                        "Open the debug workspace.",
                    ),
                    (
                        "debug-start-session",
                        "Start Debug Session",
                        "debug",
                        "Start a debug session from a launch configuration.",
                    ),
                ],
            ),
            themes: Vec::new(),
            keybindings: Vec::new(),
            snippets: vec![debug_snippet()],
            workspace_hooks: vec![ExtensionWorkspaceHookContribution {
                id: "debug.workspace-closed".to_string(),
                event: ExtensionHookEvent::WorkspaceClosed,
                command: "debug-disconnect".to_string(),
                budget_ms: ExtensionPerformanceBudget::default().hook_warn_ms,
            }],
        },
    }
}

fn yuzu_theme_manifest() -> ExtensionManifest {
    ExtensionManifest {
        id: "yuuzu.theme-yuzu".to_string(),
        name: "Yuuzu Theme".to_string(),
        version: "0.1.0".to_string(),
        api_version: "0.1".to_string(),
        description: "Builtin Yuuzu light and dark themes.".to_string(),
        builtin: true,
        contributes: ExtensionContributions {
            commands: Vec::new(),
            themes: vec![
                ExtensionThemeContribution {
                    id: "yuuzu-dark".to_string(),
                    label: "Yuuzu Dark".to_string(),
                    mode: "dark".to_string(),
                    accent: "#ff7aa2".to_string(),
                },
                ExtensionThemeContribution {
                    id: "yuuzu-light".to_string(),
                    label: "Yuuzu Light".to_string(),
                    mode: "light".to_string(),
                    accent: "#d64f7f".to_string(),
                },
            ],
            keybindings: vec![ExtensionKeybindingContribution {
                command: "open-command-palette".to_string(),
                key: "mod+shift+p".to_string(),
                when: "editorFocus || terminalFocus".to_string(),
            }],
            snippets: Vec::new(),
            workspace_hooks: Vec::new(),
        },
    }
}

fn command_contributions(
    owner_extension_id: &str,
    commands: &[(&str, &str, &str, &str)],
) -> Vec<ExtensionCommandContribution> {
    commands
        .iter()
        .map(
            |(id, label, group, description)| ExtensionCommandContribution {
                id: (*id).to_string(),
                label: (*label).to_string(),
                group: (*group).to_string(),
                description: (*description).to_string(),
                owner_extension_id: owner_extension_id.to_string(),
            },
        )
        .collect()
}

fn debug_snippet() -> ExtensionSnippetContribution {
    ExtensionSnippetContribution {
        id: "debug-log".to_string(),
        language: "typescript".to_string(),
        prefix: "dbg".to_string(),
        body: vec!["console.debug(${1:value});".to_string()],
        description: "Insert a debug log statement.".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_catalog_exposes_command_theme_keybinding_snippet_and_hook_contributions() {
        let catalog = ExtensionCatalog::builtin();
        let core = catalog
            .manifest("yuuzu.core")
            .expect("core extension manifest");
        assert!(core.builtin);
        assert!(core
            .contributes
            .commands
            .iter()
            .any(|command| command.id == "open-editor"));
        assert!(core
            .contributes
            .themes
            .iter()
            .any(|theme| theme.id == "yuuzu-dark"));
        assert!(core
            .contributes
            .keybindings
            .iter()
            .any(|binding| binding.command == "open-command-palette"));
        assert!(core
            .contributes
            .snippets
            .iter()
            .any(|snippet| snippet.prefix == "dbg"));
        assert!(core
            .contributes
            .workspace_hooks
            .iter()
            .any(|hook| hook.event == ExtensionHookEvent::WorkspaceOpened));
    }

    #[test]
    fn workspace_store_disables_extension_without_affecting_other_workspaces() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = ExtensionWorkspaceStore::new(temp.path().join("extensions.json"));

        store
            .set_enabled("/repo-a", "yuuzu.debug-tools", false, || Ok(10))
            .expect("disable");

        assert!(!store
            .is_enabled("/repo-a", "yuuzu.debug-tools")
            .expect("repo-a enabled"));
        assert!(store
            .is_enabled("/repo-b", "yuuzu.debug-tools")
            .expect("repo-b enabled"));
    }

    #[test]
    fn extension_status_marks_disabled_extensions_and_filters_commands() {
        let catalog = ExtensionCatalog::builtin();
        let temp = tempfile::tempdir().expect("tempdir");
        let store = ExtensionWorkspaceStore::new(temp.path().join("extensions.json"));
        store
            .set_enabled("/repo-a", "yuuzu.debug-tools", false, || Ok(10))
            .expect("disable");

        let statuses = extension_statuses(&catalog, &store, "/repo-a").expect("statuses");
        let debug = statuses
            .iter()
            .find(|status| status.manifest.id == "yuuzu.debug-tools")
            .expect("debug tools status");
        assert!(!debug.enabled);

        let commands = enabled_command_contributions(&statuses);
        assert!(!commands
            .iter()
            .any(|command| command.owner_extension_id == "yuuzu.debug-tools"));
        assert!(commands.iter().any(|command| command.id == "open-editor"));
    }

    #[test]
    fn performance_budget_identifies_slow_extensions() {
        let budget = ExtensionPerformanceBudget::default();
        let sample = ExtensionPerformanceSample {
            extension_id: "yuuzu.debug-tools".to_string(),
            workspace_root: "/repo-a".to_string(),
            operation: "command:debug-start-session".to_string(),
            duration_ms: budget.command_warn_ms + 10,
            budget_ms: budget.command_warn_ms,
            recorded_ms: 20,
        };

        assert!(sample.is_slow());
        assert_eq!(sample.classification(), ExtensionPerformanceClass::Slow);
    }
}
