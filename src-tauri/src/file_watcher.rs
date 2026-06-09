use crate::file_system::{self, FileVersion};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FileChangedEvent {
    pub workspace_root: PathBuf,
    pub path: PathBuf,
    pub version: Option<FileVersion>,
}

pub struct FileWatcherState {
    watchers: Mutex<HashMap<PathBuf, RecommendedWatcher>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub fn watch_workspace(
        &self,
        app: AppHandle,
        workspace_root: PathBuf,
    ) -> Result<PathBuf, String> {
        let root = canonical_workspace_root(&workspace_root)?;
        let mut watchers = self.watchers.lock().map_err(|err| err.to_string())?;
        if watchers.contains_key(&root) {
            return Ok(root);
        }

        let emit_root = root.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let Ok(event) = event else {
                    return;
                };

                for path in event.paths {
                    if let Some(path) = normalize_event_path(&emit_root, &path) {
                        let _ = app.emit(
                            "workspace://file-changed",
                            file_changed_event(emit_root.clone(), path),
                        );
                    }
                }
            })
            .map_err(|err| err.to_string())?;

        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|err| err.to_string())?;
        watchers.insert(root.clone(), watcher);
        Ok(root)
    }

    pub fn unwatch_workspace(&self, workspace_root: PathBuf) -> Result<(), String> {
        let root = canonical_workspace_root(&workspace_root)?;
        let mut watchers = self.watchers.lock().map_err(|err| err.to_string())?;
        watchers.remove(&root);
        Ok(())
    }
}

pub fn canonical_workspace_root(workspace_root: &Path) -> Result<PathBuf, String> {
    workspace_root.canonicalize().map_err(|err| err.to_string())
}

pub fn file_changed_event(workspace_root: PathBuf, path: PathBuf) -> FileChangedEvent {
    let version = file_system::file_version(&path).ok();

    FileChangedEvent {
        workspace_root,
        path,
        version,
    }
}

fn normalize_lexical(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(value) => normalized.push(value),
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
        }
    }

    Some(normalized)
}

fn nearest_existing_parent(path: &Path) -> Option<PathBuf> {
    let mut current = path.parent()?.to_path_buf();
    while !current.exists() {
        current = current.parent()?.to_path_buf();
    }
    Some(current)
}

pub fn normalize_event_path(root: &Path, path: &Path) -> Option<PathBuf> {
    let root = root
        .canonicalize()
        .ok()
        .or_else(|| normalize_lexical(root))?;
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let normalized = normalize_lexical(&candidate)?;

    if !normalized.starts_with(&root) {
        return None;
    }

    if let Ok(canonical) = candidate.canonicalize() {
        return canonical.starts_with(&root).then_some(canonical);
    }

    if root.exists() {
        let parent = nearest_existing_parent(&normalized)?;
        let parent = parent.canonicalize().ok()?;
        if !parent.starts_with(&root) {
            return None;
        }
    }

    Some(normalized)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn canonical_workspace_root_normalizes_lexical_root() {
        let root = tempdir().expect("tempdir");
        let lexical = root.path().join(".");

        let canonical = super::canonical_workspace_root(&lexical).expect("canonical");

        assert_eq!(canonical, root.path().canonicalize().expect("root"));
    }

    #[test]
    fn event_path_inside_root_is_normalized() {
        let root = PathBuf::from("/workspace");
        let path = PathBuf::from("/workspace/src/main.ts");

        let normalized = super::normalize_event_path(&root, &path).expect("normalized");

        assert_eq!(normalized, path);
    }

    #[test]
    fn event_path_outside_root_is_ignored() {
        let root = PathBuf::from("/workspace");
        let path = PathBuf::from("/other/src/main.ts");

        assert!(super::normalize_event_path(&root, &path).is_none());
    }

    #[test]
    fn file_changed_event_includes_file_version_when_path_exists() {
        let root = tempdir().expect("tempdir");
        let path = root.path().join("note.txt");
        fs::write(&path, "saved").expect("write");

        let event = super::file_changed_event(root.path().to_path_buf(), path.clone());

        assert_eq!(
            event.version,
            Some(crate::file_system::file_version(&path).expect("version"))
        );
    }
}
