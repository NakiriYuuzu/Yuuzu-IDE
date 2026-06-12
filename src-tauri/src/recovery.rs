use std::{
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::file_system::FileVersion;

const MAX_INLINE_STORAGE_ID_LEN: usize = 180;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct UnsavedBackup {
    pub id: String,
    pub workspace_id: String,
    pub workspace_root: String,
    pub path: String,
    pub content: String,
    pub version: Option<FileVersion>,
    pub updated_ms: u64,
}

#[derive(Clone, Debug)]
pub struct RecoveryStore {
    root: PathBuf,
}

impl RecoveryStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn save_backup(&self, mut backup: UnsavedBackup) -> Result<UnsavedBackup, String> {
        fs::create_dir_all(&self.root).map_err(|err| err.to_string())?;

        backup.id = backup_id(&backup.workspace_id, &backup.path);
        let path = self.backup_path(&backup.id)?;
        let value = serde_json::to_string_pretty(&backup).map_err(|err| err.to_string())?;
        let (mut file, temp_path) = create_unique_temp_file(&path)?;

        let result = (|| {
            file.write_all(value.as_bytes())
                .map_err(|err| err.to_string())?;
            file.sync_all().map_err(|err| err.to_string())?;
            drop(file);
            fs::rename(&temp_path, &path).map_err(|err| err.to_string())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }

        result.map(|_| backup)
    }

    pub fn list_backups(
        &self,
        workspace_id: &str,
        workspace_root: &str,
    ) -> Result<Vec<UnsavedBackup>, String> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }

        let mut backups = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }

            let Ok(value) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(backup) = serde_json::from_str::<UnsavedBackup>(&value) else {
                continue;
            };
            if backup.workspace_id == workspace_id && backup.workspace_root == workspace_root {
                backups.push(backup);
            }
        }

        backups.sort_by(|a, b| {
            b.updated_ms
                .cmp(&a.updated_ms)
                .then_with(|| a.path.cmp(&b.path))
        });
        Ok(backups)
    }

    pub fn discard_backup(
        &self,
        workspace_id: &str,
        workspace_root: &str,
        id: &str,
    ) -> Result<(), String> {
        let path = self.backup_path(id)?;
        let value = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        let backup: UnsavedBackup = serde_json::from_str(&value).map_err(|err| err.to_string())?;
        if backup.workspace_id != workspace_id || backup.workspace_root != workspace_root {
            return Err("backup does not belong to workspace".to_string());
        }

        fs::remove_file(path).map_err(|err| err.to_string())
    }

    fn backup_path(&self, id: &str) -> Result<PathBuf, String> {
        Ok(self.root.join(format!("{}.json", storage_file_stem(id)?)))
    }
}

pub fn backup_id(workspace_id: &str, path: &str) -> String {
    let mut id = String::from("b");
    for byte in format!("{workspace_id}\n{path}").bytes() {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}

fn storage_file_stem(id: &str) -> Result<String, String> {
    validate_backup_id(id)?;
    if id.len() <= MAX_INLINE_STORAGE_ID_LEN {
        Ok(id.to_string())
    } else {
        Ok(format!(
            "b{:016x}{:016x}",
            stable_storage_hash(id.as_bytes()),
            id.len()
        ))
    }
}

fn validate_backup_id(id: &str) -> Result<(), String> {
    if id.len() < 2 || !id.starts_with('b') || !id[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        Err("invalid backup id".to_string())
    } else {
        Ok(())
    }
}

fn stable_storage_hash(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn create_unique_temp_file(path: &Path) -> Result<(fs::File, PathBuf), String> {
    let parent = path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .unwrap_or_else(|| OsStr::new("backup.json"));

    for counter in 0..1000 {
        let mut temp_file_name = OsString::from(".");
        temp_file_name.push(file_name);
        temp_file_name.push(format!(".{}.{}.tmp", std::process::id(), counter));
        let temp_path = parent.join(temp_file_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((file, temp_path)),
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {}
            Err(err) => return Err(err.to_string()),
        }
    }

    Err(format!(
        "could not create temp file for backup: {}",
        path.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_system::FileVersion;

    fn backup(path: &str, content: &str) -> UnsavedBackup {
        UnsavedBackup {
            id: String::new(),
            workspace_id: "workspace-a".to_string(),
            workspace_root: "/repo-a".to_string(),
            path: path.to_string(),
            content: content.to_string(),
            version: Some(FileVersion {
                modified_ms: 7,
                len: 11,
            }),
            updated_ms: 10,
        }
    }

    #[test]
    fn backup_store_round_trips_unsaved_edits_by_workspace_and_path() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = RecoveryStore::new(temp.path().join("recovery"));

        let saved = store
            .save_backup(backup("src/main.ts", "dirty text"))
            .expect("save");
        let listed = store
            .list_backups("workspace-a", "/repo-a")
            .expect("list backups");

        assert_eq!(listed, vec![saved]);
        assert_eq!(listed[0].id, backup_id("workspace-a", "src/main.ts"));
        assert_eq!(listed[0].content, "dirty text");
    }

    #[test]
    fn backup_store_replaces_existing_path_without_duplicates() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = RecoveryStore::new(temp.path().join("recovery"));

        store
            .save_backup(backup("src/main.ts", "first"))
            .expect("first");
        store
            .save_backup(backup("src/main.ts", "second"))
            .expect("second");

        let listed = store
            .list_backups("workspace-a", "/repo-a")
            .expect("list backups");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].content, "second");
    }

    #[test]
    fn backup_store_discards_only_matching_workspace_backup() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = RecoveryStore::new(temp.path().join("recovery"));
        let saved = store
            .save_backup(backup("src/main.ts", "dirty"))
            .expect("save");

        assert!(store
            .discard_backup("workspace-b", "/repo-b", &saved.id)
            .is_err());
        assert_eq!(
            store
                .list_backups("workspace-a", "/repo-a")
                .expect("list backups")
                .len(),
            1
        );

        store
            .discard_backup("workspace-a", "/repo-a", &saved.id)
            .expect("discard");
        assert!(store
            .list_backups("workspace-a", "/repo-a")
            .expect("list backups")
            .is_empty());
    }

    #[test]
    fn backup_store_does_not_remove_existing_temp_file_for_same_backup() {
        let temp = tempfile::tempdir().expect("temp dir");
        let recovery_root = temp.path().join("recovery");
        std::fs::create_dir_all(&recovery_root).expect("recovery dir");
        let store = RecoveryStore::new(recovery_root.clone());
        let id = backup_id("workspace-a", "src/main.ts");
        let existing_temp = recovery_root.join(format!(".{id}.json.tmp"));
        std::fs::write(&existing_temp, "in-flight").expect("existing temp");

        store
            .save_backup(backup("src/main.ts", "dirty"))
            .expect("save");

        assert_eq!(
            std::fs::read_to_string(existing_temp).expect("existing temp retained"),
            "in-flight"
        );
    }

    #[test]
    fn backup_store_rejects_malformed_discard_id_before_path_access() {
        let temp = tempfile::tempdir().expect("temp dir");
        let recovery_root = temp.path().join("recovery");
        std::fs::create_dir_all(&recovery_root).expect("recovery dir");
        let store = RecoveryStore::new(recovery_root);
        let outside = temp.path().join("outside.json");
        let outside_backup = UnsavedBackup {
            id: "../outside".to_string(),
            ..backup("src/main.ts", "outside")
        };
        std::fs::write(
            &outside,
            serde_json::to_string_pretty(&outside_backup).expect("outside json"),
        )
        .expect("write outside");

        let result = store.discard_backup("workspace-a", "/repo-a", "../outside");

        assert!(result.is_err());
        assert!(outside.exists(), "outside backup must not be removed");
    }

    #[test]
    fn backup_store_saves_long_paths_without_exceeding_filename_limit() {
        let temp = tempfile::tempdir().expect("temp dir");
        let store = RecoveryStore::new(temp.path().join("recovery"));
        let long_path = (0..80)
            .map(|index| format!("nested-{index:02}"))
            .collect::<Vec<_>>()
            .join("/");

        let saved = store
            .save_backup(backup(&long_path, "dirty long path"))
            .expect("save long path");
        let listed = store
            .list_backups("workspace-a", "/repo-a")
            .expect("list backups");

        assert_eq!(saved.id, backup_id("workspace-a", &long_path));
        assert_eq!(listed, vec![saved]);
    }

    #[test]
    fn backup_store_skips_corrupt_json_when_listing_workspace() {
        let temp = tempfile::tempdir().expect("temp dir");
        let recovery_root = temp.path().join("recovery");
        let store = RecoveryStore::new(recovery_root.clone());
        let saved = store
            .save_backup(backup("src/main.ts", "dirty"))
            .expect("save");
        std::fs::write(recovery_root.join("corrupt.json"), "{").expect("corrupt json");

        let listed = store
            .list_backups("workspace-a", "/repo-a")
            .expect("list backups");

        assert_eq!(listed, vec![saved]);
    }
}
