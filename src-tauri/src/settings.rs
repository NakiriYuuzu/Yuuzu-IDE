use std::{
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct AppSettings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_density")]
    pub density: String,
    #[serde(default = "default_color_theme")]
    pub color_theme: String,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default = "default_update_channel")]
    pub update_channel: String,
    #[serde(default)]
    pub keybindings: Vec<KeybindingSetting>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct KeybindingSetting {
    pub command_id: String,
    pub key: String,
    pub source: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            density: default_density(),
            color_theme: default_color_theme(),
            accent_color: default_accent_color(),
            update_channel: default_update_channel(),
            keybindings: Vec::new(),
        }
    }
}

impl AppSettings {
    pub fn normalized(mut self) -> Self {
        self.schema_version = default_schema_version();
        self
    }
}

fn default_schema_version() -> u32 {
    2
}

fn default_density() -> String {
    "compact".to_string()
}

fn default_color_theme() -> String {
    "dark".to_string()
}

fn default_accent_color() -> String {
    "yuzu".to_string()
}

fn default_update_channel() -> String {
    "manual".to_string()
}

#[derive(Deserialize)]
struct VscodeKeybinding {
    command: Option<String>,
    key: Option<String>,
}

pub fn import_vscode_keybindings(
    settings: AppSettings,
    content: &str,
) -> Result<AppSettings, String> {
    let keybindings: Vec<VscodeKeybinding> =
        serde_json::from_str(content).map_err(|err| err.to_string())?;
    let mut imported = settings.normalized();

    imported
        .keybindings
        .retain(|keybinding| keybinding.source != "vscode");
    imported
        .keybindings
        .extend(keybindings.into_iter().filter_map(|keybinding| {
            let command_id = vscode_command_id(keybinding.command.as_deref()?)?;
            Some(KeybindingSetting {
                command_id: command_id.to_string(),
                key: keybinding.key?,
                source: "vscode".to_string(),
            })
        }));

    Ok(imported)
}

fn vscode_command_id(command: &str) -> Option<&'static str> {
    match command {
        "workbench.action.showCommands" => Some("open-command-palette"),
        "workbench.action.files.save" => Some("save-file"),
        "workbench.action.terminal.new" => Some("new-terminal"),
        "workbench.action.quickOpen" => Some("open-workspace"),
        _ => None,
    }
}

#[derive(Clone, Debug)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<AppSettings, String> {
        if !self.path.exists() {
            return Ok(AppSettings::default());
        }

        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        let settings: AppSettings = serde_json::from_str(&value).map_err(|err| err.to_string())?;
        Ok(settings.normalized())
    }

    pub fn save(&self, settings: &AppSettings) -> Result<(), String> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let value = serde_json::to_string_pretty(&settings.clone().normalized())
            .map_err(|err| err.to_string())?;
        let parent = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let file_name = self
            .path
            .file_name()
            .unwrap_or_else(|| OsStr::new("settings.json"));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[cfg(unix)]
    struct PermissionGuard {
        path: PathBuf,
        mode: u32,
    }

    #[cfg(unix)]
    impl PermissionGuard {
        fn set(path: impl AsRef<std::path::Path>, mode: u32) -> Self {
            let path = path.as_ref().to_path_buf();
            let previous = fs::metadata(&path).expect("metadata").permissions().mode();
            fs::set_permissions(&path, fs::Permissions::from_mode(mode)).expect("set permissions");

            Self {
                path,
                mode: previous,
            }
        }
    }

    #[cfg(unix)]
    impl Drop for PermissionGuard {
        fn drop(&mut self) {
            let _ = fs::set_permissions(&self.path, fs::Permissions::from_mode(self.mode));
        }
    }

    fn settings(density: &str, color_theme: &str) -> AppSettings {
        AppSettings {
            density: density.to_string(),
            color_theme: color_theme.to_string(),
            ..AppSettings::default()
        }
    }

    #[test]
    fn default_settings_are_compact_dark() {
        assert_eq!(AppSettings::default(), settings("compact", "dark"));
    }

    #[test]
    fn store_returns_default_settings_when_file_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = SettingsStore::new(temp.path().join("settings.json"));

        let loaded = store.load().expect("load settings");

        assert_eq!(loaded, AppSettings::default());
    }

    #[test]
    fn settings_store_round_trips_json() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = SettingsStore::new(temp.path().join("settings.json"));
        let settings = settings("comfortable", "dark");

        store.save(&settings).expect("save");

        assert_eq!(store.load().expect("load"), settings);
    }

    #[test]
    fn settings_store_migrates_v1_compact_dark_settings_to_schema_v2() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("settings.json");
        std::fs::write(&path, r#"{"density":"compact","color_theme":"dark"}"#)
            .expect("write old settings");

        let loaded = SettingsStore::new(path).load().expect("load settings");

        assert_eq!(loaded.schema_version, 2);
        assert_eq!(loaded.density, "compact");
        assert_eq!(loaded.color_theme, "dark");
        assert_eq!(loaded.accent_color, "yuzu");
        assert_eq!(loaded.update_channel, "manual");
        assert!(loaded.keybindings.is_empty());
    }

    #[test]
    fn settings_imports_vscode_keybindings_for_known_commands() {
        let settings = AppSettings::default();
        let imported = import_vscode_keybindings(
            settings,
            r#"[{"key":"cmd+k","command":"workbench.action.showCommands"},{"key":"cmd+s","command":"workbench.action.files.save"}]"#,
        )
        .expect("import");

        assert_eq!(
            imported.keybindings,
            vec![
                KeybindingSetting {
                    command_id: "open-command-palette".to_string(),
                    key: "cmd+k".to_string(),
                    source: "vscode".to_string(),
                },
                KeybindingSetting {
                    command_id: "save-file".to_string(),
                    key: "cmd+s".to_string(),
                    source: "vscode".to_string(),
                },
            ]
        );
    }

    #[test]
    fn settings_import_replaces_vscode_keybindings_and_preserves_custom_keybindings() {
        let settings = AppSettings {
            keybindings: vec![
                KeybindingSetting {
                    command_id: "custom-command".to_string(),
                    key: "cmd+shift+x".to_string(),
                    source: "custom".to_string(),
                },
                KeybindingSetting {
                    command_id: "save-file".to_string(),
                    key: "cmd+alt+s".to_string(),
                    source: "vscode".to_string(),
                },
            ],
            ..AppSettings::default()
        };

        let imported = import_vscode_keybindings(
            settings,
            r#"[{"key":"cmd+`","command":"workbench.action.terminal.new"}]"#,
        )
        .expect("import");

        assert_eq!(
            imported.keybindings,
            vec![
                KeybindingSetting {
                    command_id: "custom-command".to_string(),
                    key: "cmd+shift+x".to_string(),
                    source: "custom".to_string(),
                },
                KeybindingSetting {
                    command_id: "new-terminal".to_string(),
                    key: "cmd+`".to_string(),
                    source: "vscode".to_string(),
                },
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn failed_save_keeps_existing_settings_when_parent_is_not_writable() {
        let temp = tempfile::tempdir().expect("temp dir");
        let settings_path = temp.path().join("settings.json");
        let store = SettingsStore::new(settings_path.clone());
        let original = settings("compact", "dark");
        let changed = settings("comfortable", "light");

        store.save(&original).expect("initial save");
        fs::set_permissions(&settings_path, fs::Permissions::from_mode(0o600))
            .expect("settings file writable");
        let parent_permissions = PermissionGuard::set(temp.path(), 0o500);

        let result = store.save(&changed);

        assert!(result.is_err(), "save should fail without parent write");
        drop(parent_permissions);
        let loaded = store.load().expect("load settings");
        assert_eq!(loaded, original);
    }
}
