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

impl Workspace {
    pub fn from_path(path: PathBuf) -> Self {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("workspace")
            .to_string();
        let id = path
            .components()
            .filter_map(|component| component.as_os_str().to_str())
            .filter(|part| !part.is_empty())
            .map(slug_part)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("-");

        Self {
            id: if id.is_empty() {
                "workspace".to_string()
            } else {
                id
            },
            name,
            path,
            pinned: false,
        }
    }

    #[allow(dead_code)]
    pub fn path_exists(&self) -> bool {
        self.path.is_dir()
    }
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
        self.sort_workspaces();
    }

    pub fn switch_workspace(&mut self, id: &str) -> bool {
        if !self.workspaces.iter().any(|workspace| workspace.id == id) {
            return false;
        }

        self.active_workspace_id = Some(id.to_string());
        true
    }

    pub fn remove_workspace(&mut self, id: &str) -> bool {
        let previous_active = self.active_workspace_id.clone();
        let before = self.workspaces.len();
        self.workspaces.retain(|workspace| workspace.id != id);

        if self.workspaces.len() == before {
            return false;
        }

        if previous_active.as_deref() == Some(id) {
            self.active_workspace_id = self
                .workspaces
                .first()
                .map(|workspace| workspace.id.clone());
        }

        true
    }

    pub fn set_workspace_pinned(&mut self, id: &str, pinned: bool) -> bool {
        let Some(workspace) = self
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == id)
        else {
            return false;
        };
        workspace.pinned = pinned;
        self.sort_workspaces();
        true
    }

    pub fn sort_workspaces(&mut self) {
        self.workspaces.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.id.cmp(&b.id))
        });
    }
}

fn slug_part(value: &str) -> String {
    value
        .chars()
        .map(|item| {
            if item.is_ascii_alphanumeric() {
                item.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
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

    #[test]
    fn remove_active_workspace_promotes_pinned_then_recent() {
        let mut registry = WorkspaceRegistry::default();
        registry.add_workspace(workspace("first"));
        registry.add_workspace(Workspace {
            pinned: true,
            ..workspace("second")
        });
        registry.add_workspace(workspace("third"));
        registry.switch_workspace("third");

        assert!(registry.remove_workspace("third"));

        assert_eq!(registry.active_workspace_id, Some("second".to_string()));
        assert_eq!(
            registry
                .workspaces
                .iter()
                .map(|workspace| workspace.id.as_str())
                .collect::<Vec<_>>(),
            vec!["second", "first"]
        );
    }

    #[test]
    fn pin_workspace_updates_flag_and_orders_pinned_first() {
        let mut registry = WorkspaceRegistry::default();
        registry.add_workspace(workspace("first"));
        registry.add_workspace(workspace("second"));

        assert!(registry.set_workspace_pinned("second", true));

        assert!(registry.workspaces[0].pinned);
        assert_eq!(registry.workspaces[0].id, "second");
    }

    #[test]
    fn workspace_from_path_uses_folder_name_and_stable_id() {
        let item = Workspace::from_path(PathBuf::from("/tmp/my-project"));

        assert_eq!(item.id, "tmp-my-project");
        assert_eq!(item.name, "my-project");
        assert_eq!(item.path, PathBuf::from("/tmp/my-project"));
        assert!(!item.pinned);
    }
}
