use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub pinned: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct WorkspaceRegistry {
    pub active_workspace_id: Option<String>,
    pub workspaces: Vec<Workspace>,
}

impl WorkspaceRegistry {
    pub fn add_workspace(&mut self, workspace: Workspace) {
        if self.workspaces.iter().any(|item| item.id == workspace.id) {
            return;
        }

        if self.active_workspace_id.is_none() {
            self.active_workspace_id = Some(workspace.id.clone());
        }

        self.workspaces.push(workspace);
    }

    pub fn switch_workspace(&mut self, id: &str) -> bool {
        if !self.workspaces.iter().any(|workspace| workspace.id == id) {
            return false;
        }

        self.active_workspace_id = Some(id.to_string());
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn workspace(id: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: format!("Workspace {id}"),
            path: PathBuf::from(format!("/tmp/{id}")),
            pinned: false,
        }
    }

    #[test]
    fn first_workspace_becomes_active() {
        let mut registry = WorkspaceRegistry::default();

        registry.add_workspace(workspace("first"));

        assert_eq!(registry.active_workspace_id, Some("first".to_string()));
        assert_eq!(registry.workspaces.len(), 1);
    }

    #[test]
    fn duplicate_workspace_id_is_ignored() {
        let mut registry = WorkspaceRegistry::default();

        registry.add_workspace(workspace("same"));
        registry.add_workspace(Workspace {
            name: "Duplicate".to_string(),
            ..workspace("same")
        });

        assert_eq!(registry.workspaces.len(), 1);
        assert_eq!(registry.workspaces[0].name, "Workspace same");
    }

    #[test]
    fn switch_existing_workspace_updates_active_id() {
        let mut registry = WorkspaceRegistry::default();
        registry.add_workspace(workspace("first"));
        registry.add_workspace(workspace("second"));

        let switched = registry.switch_workspace("second");

        assert!(switched);
        assert_eq!(registry.active_workspace_id, Some("second".to_string()));
    }

    #[test]
    fn switch_missing_workspace_keeps_active_id() {
        let mut registry = WorkspaceRegistry::default();
        registry.add_workspace(workspace("first"));

        let switched = registry.switch_workspace("missing");

        assert!(!switched);
        assert_eq!(registry.active_workspace_id, Some("first".to_string()));
    }
}
