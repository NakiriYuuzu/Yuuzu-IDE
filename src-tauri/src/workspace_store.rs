use std::{
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use crate::workspace::WorkspaceRegistry;

#[derive(Clone, Debug)]
pub struct WorkspaceRegistryStore {
    path: PathBuf,
}

impl WorkspaceRegistryStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<WorkspaceRegistry, String> {
        if !self.path.exists() {
            return Ok(WorkspaceRegistry::default());
        }

        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    pub fn save(&self, registry: &WorkspaceRegistry) -> Result<(), String> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let value = serde_json::to_string_pretty(registry).map_err(|err| err.to_string())?;
        let parent = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let file_name = self
            .path
            .file_name()
            .unwrap_or_else(|| OsStr::new("workspace-registry.json"));
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
    use crate::workspace::Workspace;

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

    fn workspace(id: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: format!("Workspace {id}"),
            path: PathBuf::from(format!("/tmp/{id}")),
            pinned: false,
        }
    }

    #[test]
    fn store_returns_default_registry_when_file_is_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = WorkspaceRegistryStore::new(temp.path().join("workspaces.json"));

        let registry = store.load().expect("load registry");

        assert_eq!(registry, WorkspaceRegistry::default());
    }

    #[test]
    fn store_round_trips_registry_json() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = WorkspaceRegistryStore::new(temp.path().join("nested/workspaces.json"));
        let mut registry = WorkspaceRegistry::default();
        registry.add_workspace(workspace("first"));
        registry.add_workspace(workspace("second"));
        registry.switch_workspace("second");

        store.save(&registry).expect("save registry");
        let loaded = store.load().expect("load registry");

        assert_eq!(loaded, registry);
    }

    #[cfg(unix)]
    #[test]
    fn failed_save_keeps_existing_registry_when_parent_is_not_writable() {
        let temp = tempfile::tempdir().expect("temp dir");
        let registry_path = temp.path().join("workspaces.json");
        let store = WorkspaceRegistryStore::new(registry_path.clone());
        let mut original = WorkspaceRegistry::default();
        original.add_workspace(workspace("first"));
        let mut changed = WorkspaceRegistry::default();
        changed.add_workspace(workspace("second"));

        store.save(&original).expect("initial save");
        fs::set_permissions(&registry_path, fs::Permissions::from_mode(0o600))
            .expect("registry file writable");
        let parent_permissions = PermissionGuard::set(temp.path(), 0o500);

        let result = store.save(&changed);

        assert!(result.is_err(), "save should fail without parent write");
        drop(parent_permissions);
        let loaded = store.load().expect("load registry");
        assert_eq!(loaded, original);
    }
}
