use crate::file_system::{self, FileVersion};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct WatchWorkspaceHandle {
    pub workspace_root: PathBuf,
    pub watch_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FileChangedEvent {
    pub workspace_root: PathBuf,
    pub path: PathBuf,
    pub version: Option<FileVersion>,
}

pub struct FileWatcherState {
    registry: Mutex<WatcherRegistry>,
}

struct WatcherEntry {
    _watcher: Option<RecommendedWatcher>,
    claims: HashSet<String>,
}

struct WatcherRegistry {
    entries: HashMap<PathBuf, WatcherEntry>,
}

impl WatcherRegistry {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    fn has_entry(&self, root: &Path) -> bool {
        self.entries.contains_key(root)
    }

    fn insert_watcher(&mut self, root: PathBuf, watcher: RecommendedWatcher) {
        self.entries.insert(
            root,
            WatcherEntry {
                _watcher: Some(watcher),
                claims: HashSet::new(),
            },
        );
    }

    #[cfg(test)]
    fn insert_test_watcher(&mut self, root: PathBuf) {
        self.entries.insert(
            root,
            WatcherEntry {
                _watcher: None,
                claims: HashSet::new(),
            },
        );
    }

    fn claim(&mut self, root: PathBuf) -> Result<WatchWorkspaceHandle, String> {
        let entry = self
            .entries
            .get_mut(&root)
            .ok_or_else(|| format!("workspace watcher not active: {}", root.display()))?;
        let mut watch_id = uuid::Uuid::new_v4().to_string();
        while entry.claims.contains(&watch_id) {
            watch_id = uuid::Uuid::new_v4().to_string();
        }
        entry.claims.insert(watch_id.clone());

        Ok(WatchWorkspaceHandle {
            workspace_root: root,
            watch_id,
        })
    }

    fn release(&mut self, handle: &WatchWorkspaceHandle) -> Result<bool, String> {
        let remove_entry = {
            let entry = self
                .entries
                .get_mut(&handle.workspace_root)
                .ok_or_else(|| {
                    format!(
                        "workspace watcher not active: {}",
                        handle.workspace_root.display()
                    )
                })?;

            if !entry.claims.remove(&handle.watch_id) {
                return Err(format!("watch claim not active: {}", handle.watch_id));
            }

            entry.claims.is_empty()
        };

        if remove_entry {
            self.entries.remove(&handle.workspace_root);
        }

        Ok(remove_entry)
    }

    #[cfg(test)]
    fn claim_count(&self, root: &Path) -> usize {
        self.entries
            .get(root)
            .map(|entry| entry.claims.len())
            .unwrap_or(0)
    }

    #[cfg(test)]
    fn has_active_watcher(&self, root: &Path) -> bool {
        self.entries.contains_key(root)
    }
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            registry: Mutex::new(WatcherRegistry::new()),
        }
    }

    pub fn watch_workspace(
        &self,
        app: AppHandle,
        workspace_root: PathBuf,
    ) -> Result<WatchWorkspaceHandle, String> {
        let root = canonical_workspace_root(&workspace_root)?;
        let mut registry = self.registry.lock().map_err(|err| err.to_string())?;

        if !registry.has_entry(&root) {
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
            registry.insert_watcher(root.clone(), watcher);
        }

        registry.claim(root)
    }

    pub fn unwatch_workspace(&self, handle: WatchWorkspaceHandle) -> Result<(), String> {
        let mut registry = self.registry.lock().map_err(|err| err.to_string())?;
        registry.release(&handle).map(|_| ())
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

    #[test]
    fn releasing_one_of_two_watch_handles_keeps_root_active_until_second_release() {
        let root = tempdir().expect("tempdir");
        let root_path = root.path().canonicalize().expect("canonical");
        let mut registry = super::WatcherRegistry::new();
        registry.insert_test_watcher(root_path.clone());
        let first = registry.claim(root_path.clone()).expect("first claim");
        let second = registry.claim(root_path.clone()).expect("second claim");

        assert_eq!(registry.claim_count(&root_path), 2);
        assert!(!registry.release(&first).expect("release first"));
        assert!(registry.has_active_watcher(&root_path));
        assert_eq!(registry.claim_count(&root_path), 1);

        assert!(registry.release(&second).expect("release second"));
        assert!(!registry.has_active_watcher(&root_path));
    }

    #[test]
    fn release_by_watch_token_does_not_require_root_to_still_exist() {
        let root = tempdir().expect("tempdir");
        let root_path = root.path().canonicalize().expect("canonical");
        let mut registry = super::WatcherRegistry::new();
        registry.insert_test_watcher(root_path.clone());
        let handle = registry.claim(root_path.clone()).expect("claim");
        drop(root);

        assert!(registry.release(&handle).expect("release"));
        assert!(!registry.has_active_watcher(&root_path));
    }

    #[test]
    fn forged_sequential_watch_id_cannot_release_active_claim() {
        let root = tempdir().expect("tempdir");
        let root_path = root.path().canonicalize().expect("canonical");
        let mut registry = super::WatcherRegistry::new();
        registry.insert_test_watcher(root_path.clone());
        let handle = registry.claim(root_path.clone()).expect("claim");
        let forged = super::WatchWorkspaceHandle {
            workspace_root: root_path.clone(),
            watch_id: "1".to_string(),
        };

        assert!(registry.release(&forged).is_err());
        assert_eq!(registry.claim_count(&root_path), 1);

        registry.release(&handle).expect("release issued handle");
        assert!(!registry.has_active_watcher(&root_path));
    }

    #[test]
    fn issued_watch_ids_are_uuid_v4_tokens() {
        let root = tempdir().expect("tempdir");
        let root_path = root.path().canonicalize().expect("canonical");
        let mut registry = super::WatcherRegistry::new();
        registry.insert_test_watcher(root_path.clone());

        let first = registry.claim(root_path.clone()).expect("first claim");
        let second = registry.claim(root_path).expect("second claim");
        let first_uuid = uuid::Uuid::parse_str(&first.watch_id).expect("first uuid");
        let second_uuid = uuid::Uuid::parse_str(&second.watch_id).expect("second uuid");

        assert_eq!(first_uuid.get_version_num(), 4);
        assert_eq!(second_uuid.get_version_num(), 4);
        assert_ne!(first.watch_id, second.watch_id);
    }
}
