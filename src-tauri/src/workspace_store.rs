use std::{fs, path::PathBuf};

use crate::workspace::WorkspaceRegistry;

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct WorkspaceRegistryStore {
    path: PathBuf,
}

impl WorkspaceRegistryStore {
    #[allow(dead_code)]
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    #[allow(dead_code)]
    pub fn load(&self) -> Result<WorkspaceRegistry, String> {
        if !self.path.exists() {
            return Ok(WorkspaceRegistry::default());
        }

        let value = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    #[allow(dead_code)]
    pub fn save(&self, registry: &WorkspaceRegistry) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let value = serde_json::to_string_pretty(registry).map_err(|err| err.to_string())?;
        fs::write(&self.path, value).map_err(|err| err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::Workspace;

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
}
