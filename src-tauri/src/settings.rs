use std::{
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct AppSettings {
    pub density: String,
    pub color_theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            density: "compact".to_string(),
            color_theme: "dark".to_string(),
        }
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
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    pub fn save(&self, settings: &AppSettings) -> Result<(), String> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let value = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
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
