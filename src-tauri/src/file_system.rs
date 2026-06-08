use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs,
    fs::OpenOptions,
    io::{ErrorKind, Write},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const EDITABLE_TEXT_LIMIT_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct FileVersion {
    pub modified_ms: u128,
    pub len: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TextFileRead {
    pub path: PathBuf,
    pub content: Option<String>,
    pub version: FileVersion,
    pub too_large: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FileOperationResult {
    pub path: PathBuf,
    pub version: Option<FileVersion>,
}

pub fn file_version(path: &Path) -> Result<FileVersion, String> {
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    let modified_ms = metadata
        .modified()
        .map_err(|err| err.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();

    Ok(FileVersion {
        modified_ms,
        len: metadata.len(),
    })
}

enum PathResolution {
    CanonicalExisting,
    LexicalContained,
}

fn normalize_path(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(value) => normalized.push(value),
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("path outside workspace: {}", path.display()));
                }
            }
        }
    }
    Ok(normalized)
}

fn nearest_existing_parent(path: &Path) -> Result<PathBuf, String> {
    let mut current = path
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?
        .to_path_buf();
    while !current.exists() {
        current = current
            .parent()
            .ok_or_else(|| "path has no existing parent".to_string())?
            .to_path_buf();
    }
    Ok(current)
}

fn workspace_child(
    workspace_root: &Path,
    path: &Path,
    resolution: PathResolution,
) -> Result<PathBuf, String> {
    let root = workspace_root
        .canonicalize()
        .map_err(|err| err.to_string())?;
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };

    if candidate.exists() {
        let canonical = candidate.canonicalize().map_err(|err| err.to_string())?;
        if !canonical.starts_with(&root) {
            return Err(format!("path outside workspace: {}", candidate.display()));
        }
        return Ok(match resolution {
            PathResolution::CanonicalExisting => canonical,
            PathResolution::LexicalContained => normalize_path(&candidate)?,
        });
    }

    let normalized = normalize_path(&candidate)?;
    let existing_parent = nearest_existing_parent(&candidate)?
        .canonicalize()
        .map_err(|err| err.to_string())?;
    if !existing_parent.starts_with(&root) {
        return Err(format!("path outside workspace: {}", candidate.display()));
    }

    Ok(normalized)
}

fn create_unique_temp_file(path: &Path) -> Result<(fs::File, PathBuf), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "path has no file name".to_string())?;
    for counter in 0..100 {
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
        "could not create temporary file for {}",
        path.display()
    ))
}

pub fn read_text_file(
    workspace_root: &Path,
    path: &Path,
    max_bytes: u64,
) -> Result<TextFileRead, String> {
    let path = workspace_child(workspace_root, path, PathResolution::CanonicalExisting)?;
    let version = file_version(&path)?;
    let too_large = version.len > max_bytes;
    let content = if too_large {
        None
    } else {
        Some(fs::read_to_string(&path).map_err(|err| err.to_string())?)
    };

    Ok(TextFileRead {
        path,
        content,
        version,
        too_large,
    })
}

pub fn write_text_file(
    workspace_root: &Path,
    path: &Path,
    content: &str,
    expected_version: Option<FileVersion>,
) -> Result<FileOperationResult, String> {
    if content.as_bytes().len() as u64 > EDITABLE_TEXT_LIMIT_BYTES {
        return Err(format!(
            "content exceeds editable limit: {} bytes",
            content.as_bytes().len()
        ));
    }

    let path = workspace_child(workspace_root, path, PathResolution::LexicalContained)?;
    if let Some(expected) = expected_version {
        let current = file_version(&path)?;
        if current != expected {
            return Err(format!("file changed on disk: {}", path.display()));
        }
    }

    let (mut temp, temp_path) = create_unique_temp_file(&path)?;
    let result = (|| {
        temp.write_all(content.as_bytes())
            .map_err(|err| err.to_string())?;
        temp.sync_all().map_err(|err| err.to_string())?;
        drop(temp);
        fs::rename(&temp_path, &path).map_err(|err| err.to_string())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result?;

    Ok(FileOperationResult {
        version: Some(file_version(&path)?),
        path,
    })
}

pub fn create_text_file(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<FileOperationResult, String> {
    let path = workspace_child(
        workspace_root,
        Path::new(relative_path),
        PathResolution::LexicalContained,
    )?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|err| err.to_string())?;

    Ok(FileOperationResult {
        version: Some(file_version(&path)?),
        path,
    })
}

pub fn rename_path(
    workspace_root: &Path,
    path: &Path,
    new_name: &str,
) -> Result<FileOperationResult, String> {
    if new_name.contains('/') || new_name.contains('\\') || new_name.trim().is_empty() {
        return Err("new name must be a single path segment".to_string());
    }
    let path = workspace_child(workspace_root, path, PathResolution::LexicalContained)?;
    let target = path
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?
        .join(new_name);
    let target = workspace_child(workspace_root, &target, PathResolution::LexicalContained)?;
    fs::rename(&path, &target).map_err(|err| err.to_string())?;

    Ok(FileOperationResult {
        version: if target.is_file() {
            Some(file_version(&target)?)
        } else {
            None
        },
        path: target,
    })
}

pub fn delete_path(workspace_root: &Path, path: &Path) -> Result<(), String> {
    let path = workspace_child(workspace_root, path, PathResolution::LexicalContained)?;
    if path.is_dir()
        && !fs::symlink_metadata(&path)
            .map_err(|err| err.to_string())?
            .file_type()
            .is_symlink()
    {
        fs::remove_dir_all(&path).map_err(|err| err.to_string())
    } else {
        fs::remove_file(&path).map_err(|err| err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::tempdir;

    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    #[test]
    fn read_text_file_returns_content_and_version() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("src.rs");
        fs::write(&file, "fn main() {}\n").expect("write");

        let result = super::read_text_file(root.path(), &file, 1024).expect("read");

        assert_eq!(result.content.as_deref(), Some("fn main() {}\n"));
        assert!(!result.too_large);
        assert!(result.version.modified_ms > 0);
        assert_eq!(result.version.len, 13);
    }

    #[test]
    fn read_text_file_rejects_path_outside_workspace() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        let file = outside.path().join("secret.txt");
        fs::write(&file, "secret").expect("write");

        let result = super::read_text_file(root.path(), &file, 1024);

        assert!(result.unwrap_err().contains("outside workspace"));
    }

    #[test]
    fn read_text_file_marks_large_files_without_loading_content() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("large.txt");
        fs::write(&file, "too large").expect("write");

        let result = super::read_text_file(root.path(), &file, 4).expect("read");

        assert!(result.too_large);
        assert_eq!(result.content, None);
    }

    #[test]
    fn write_text_file_rejects_stale_version() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("note.txt");
        fs::write(&file, "old").expect("write");
        let stale = super::file_version(&file).expect("version");
        fs::write(&file, "external").expect("external");

        let result = super::write_text_file(root.path(), &file, "mine", Some(stale));

        assert!(result.unwrap_err().contains("changed on disk"));
        assert_eq!(fs::read_to_string(file).expect("read"), "external");
    }

    #[test]
    fn write_text_file_rejects_content_over_editable_limit() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("note.txt");
        fs::write(&file, "old").expect("write");
        let content = "x".repeat(super::EDITABLE_TEXT_LIMIT_BYTES as usize + 1);

        let result = super::write_text_file(root.path(), &file, &content, None);

        assert!(result.unwrap_err().contains("exceeds editable limit"));
        assert_eq!(fs::read_to_string(file).expect("read"), "old");
    }

    #[test]
    fn write_text_file_does_not_truncate_existing_temp_sibling() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("note.txt");
        let temp_sibling = root.path().join("note.txttmp");
        fs::write(&file, "old").expect("write");
        fs::write(&temp_sibling, "do not touch").expect("write temp sibling");

        super::write_text_file(root.path(), &file, "new", None).expect("write");

        assert_eq!(fs::read_to_string(&file).expect("read file"), "new");
        assert_eq!(
            fs::read_to_string(&temp_sibling).expect("read temp sibling"),
            "do not touch"
        );
    }

    #[test]
    fn file_operations_create_rename_delete_inside_workspace() {
        let root = tempdir().expect("tempdir");
        let created = super::create_text_file(root.path(), "src/main.ts").expect("create");
        assert!(created.path.ends_with("src/main.ts"));

        let renamed = super::rename_path(root.path(), &created.path, "app.ts").expect("rename");
        assert!(renamed.path.ends_with("src/app.ts"));

        super::delete_path(root.path(), &renamed.path).expect("delete");
        assert!(!renamed.path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn delete_path_removes_symlink_without_deleting_target() {
        let root = tempdir().expect("tempdir");
        let target = root.path().join("target.txt");
        let link = root.path().join("link.txt");
        fs::write(&target, "target").expect("write target");
        symlink(&target, &link).expect("symlink");

        super::delete_path(root.path(), &link).expect("delete symlink");

        assert_eq!(fs::read_to_string(&target).expect("read target"), "target");
        assert!(
            fs::symlink_metadata(&link).is_err(),
            "symlink path should be removed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rename_path_renames_symlink_without_renaming_target() {
        let root = tempdir().expect("tempdir");
        let target = root.path().join("target.txt");
        let link = root.path().join("link.txt");
        let renamed = root.path().join("renamed.txt");
        fs::write(&target, "target").expect("write target");
        symlink(&target, &link).expect("symlink");

        let result = super::rename_path(root.path(), &link, "renamed.txt").expect("rename symlink");

        assert_eq!(result.path, renamed);
        assert_eq!(fs::read_to_string(&target).expect("read target"), "target");
        assert!(
            fs::symlink_metadata(&link).is_err(),
            "old symlink path should be removed"
        );
        assert!(
            fs::symlink_metadata(&renamed)
                .expect("renamed metadata")
                .file_type()
                .is_symlink(),
            "renamed path should still be a symlink"
        );
    }
}
