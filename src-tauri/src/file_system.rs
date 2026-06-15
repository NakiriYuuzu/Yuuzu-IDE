use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs,
    fs::OpenOptions,
    io::{ErrorKind, Read, Write},
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
    // `dunce::canonicalize` avoids the Windows `\\?\` verbatim prefix that
    // `std::fs::canonicalize` emits. Without this, an already-canonical
    // verbatim root compared against a non-verbatim absolute candidate fails
    // `starts_with`, rejecting valid paths as "outside workspace" on Windows.
    let root = dunce::canonicalize(workspace_root).map_err(|err| err.to_string())?;
    let lexical_root = if workspace_root.is_absolute() {
        normalize_path(dunce::simplified(workspace_root))?
    } else {
        root.clone()
    };
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };

    if candidate.exists() {
        let normalized = normalize_path(&candidate)?;
        if !normalized.starts_with(&root) && !normalized.starts_with(&lexical_root) {
            return Err(format!("path outside workspace: {}", candidate.display()));
        }

        let canonical = dunce::canonicalize(&candidate).map_err(|err| err.to_string())?;
        if !canonical.starts_with(&root) {
            return Err(format!("path outside workspace: {}", candidate.display()));
        }
        return Ok(match resolution {
            PathResolution::CanonicalExisting => canonical,
            PathResolution::LexicalContained => normalized,
        });
    }

    let normalized = normalize_path(&candidate)?;
    if matches!(resolution, PathResolution::LexicalContained)
        && !normalized.starts_with(&root)
        && !normalized.starts_with(&lexical_root)
    {
        return Err(format!("path outside workspace: {}", candidate.display()));
    }

    let existing_parent = dunce::canonicalize(nearest_existing_parent(&normalized)?)
        .map_err(|err| err.to_string())?;
    if !existing_parent.starts_with(&root) {
        return Err(format!("path outside workspace: {}", candidate.display()));
    }

    Ok(normalized)
}

pub fn workspace_child_for_existing_dir(
    workspace_root: &Path,
    path: &Path,
) -> Result<PathBuf, String> {
    let path = workspace_child(workspace_root, path, PathResolution::CanonicalExisting)?;
    let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
    if !metadata.is_dir() {
        return Err(format!("not a directory: {}", path.display()));
    }

    Ok(path)
}

pub fn workspace_child_for_write(workspace_root: &Path, path: &Path) -> Result<PathBuf, String> {
    let path = workspace_child(workspace_root, path, PathResolution::LexicalContained)?;
    if path.exists() {
        let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
        if !metadata.is_file() {
            return Err(format!("not a regular file: {}", path.display()));
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    Ok(path)
}

pub fn workspace_child_for_existing_file(
    workspace_root: &Path,
    path: &Path,
) -> Result<PathBuf, String> {
    let path = workspace_child(workspace_root, path, PathResolution::CanonicalExisting)?;
    let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err(format!("not a regular file: {}", path.display()));
    }

    Ok(path)
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
    let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err(format!("not a regular file: {}", path.display()));
    }

    let version = file_version(&path)?;
    let mut file = fs::File::open(&path).map_err(|err| err.to_string())?;
    let mut buffer = Vec::new();
    Read::by_ref(&mut file)
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut buffer)
        .map_err(|err| err.to_string())?;
    let too_large = buffer.len() as u64 > max_bytes;
    let content = if too_large {
        None
    } else {
        Some(String::from_utf8(buffer).map_err(|err| err.to_string())?)
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
    if content.len() as u64 > EDITABLE_TEXT_LIMIT_BYTES {
        return Err(format!(
            "content exceeds editable limit: {} bytes",
            content.len()
        ));
    }

    let path = workspace_child(workspace_root, path, PathResolution::LexicalContained)?;
    if let Some(expected) = expected_version {
        let current = file_version(&path)?;
        if current != expected {
            return Err(format!("file changed on disk: {}", path.display()));
        }
    }

    let existing_permissions = fs::metadata(&path)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.permissions());
    let (mut temp, temp_path) = create_unique_temp_file(&path)?;
    let result = (|| {
        if let Some(permissions) = existing_permissions {
            temp.set_permissions(permissions)
                .map_err(|err| err.to_string())?;
        }
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
    match fs::symlink_metadata(&target) {
        Ok(_) => {
            return Err(format!("target already exists: {}", target.display()));
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(err) => return Err(err.to_string()),
    }
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
    use std::{fs, path::Path};
    use tempfile::tempdir;

    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};

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

    #[cfg(unix)]
    #[test]
    fn read_text_file_rejects_outside_lexical_symlink_to_workspace() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        let file = root.path().join("note.txt");
        let link = outside.path().join("workspace-link");
        fs::write(&file, "inside").expect("write");
        symlink(root.path(), &link).expect("symlink");

        let result = super::read_text_file(root.path(), &link.join("note.txt"), 1024);

        assert!(result.unwrap_err().contains("outside workspace"));
    }

    #[test]
    fn read_text_file_rejects_directories() {
        let root = tempdir().expect("tempdir");
        let dir = root.path().join("src");
        fs::create_dir(&dir).expect("create dir");

        let result = super::read_text_file(root.path(), &dir, 1024);

        assert!(result.unwrap_err().contains("not a regular file"));
    }

    #[test]
    fn workspace_child_for_existing_dir_accepts_nested_directory() {
        let root = tempdir().expect("tempdir");
        fs::create_dir(root.path().join("src")).expect("src");

        let result =
            super::workspace_child_for_existing_dir(root.path(), Path::new("src")).expect("dir");

        assert_eq!(
            result,
            root.path().join("src").canonicalize().expect("canonical")
        );
    }

    #[test]
    fn workspace_child_for_existing_dir_rejects_outside_directory() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");

        let result = super::workspace_child_for_existing_dir(root.path(), outside.path());

        assert!(result.unwrap_err().contains("outside workspace"));
    }

    #[test]
    fn workspace_child_for_existing_dir_accepts_absolute_cwd_under_canonical_root() {
        // Mirrors the terminal/task spawn path: `trusted_workspace_root` returns a
        // canonicalized root, and the frontend passes an absolute cwd (cwd == root).
        let root = tempdir().expect("tempdir");
        let canonical_root = dunce::canonicalize(root.path()).expect("canonical root");

        let result = super::workspace_child_for_existing_dir(&canonical_root, &canonical_root);

        assert!(
            result.is_ok(),
            "absolute cwd equal to the workspace root must be accepted: {result:?}"
        );
        assert_eq!(result.expect("cwd"), canonical_root);
    }

    #[cfg(windows)]
    #[test]
    fn workspace_child_for_existing_dir_accepts_absolute_cwd_under_verbatim_root() {
        // Regression for Windows: `std::fs::canonicalize` yields a `\\?\` verbatim
        // root, while the frontend passes a non-verbatim absolute cwd. The prefix
        // mismatch previously rejected the workspace's own directory as "outside".
        let root = tempdir().expect("tempdir");
        let verbatim_root = std::fs::canonicalize(root.path()).expect("verbatim root");
        assert!(
            verbatim_root.to_string_lossy().starts_with(r"\\?\"),
            "precondition: std canonicalize must produce a verbatim prefix on Windows"
        );

        let result = super::workspace_child_for_existing_dir(&verbatim_root, root.path());

        assert!(
            result.is_ok(),
            "absolute cwd inside a verbatim root must be accepted: {result:?}"
        );
    }

    #[test]
    fn workspace_child_for_write_rejects_outside_workspace() {
        let root = tempdir().expect("tempdir");
        let outside = root
            .path()
            .parent()
            .expect("tempdir parent")
            .join("outside-write-target.txt");

        let result = super::workspace_child_for_write(root.path(), &outside);

        assert!(result.unwrap_err().contains("outside workspace"));
        assert!(
            !outside.exists(),
            "outside write target should not be created"
        );
    }

    #[test]
    fn workspace_child_for_write_creates_parent_directories_for_inside_target() {
        let root = tempdir().expect("tempdir");
        let target = Path::new("downloads/releases/app.js");
        let canonical_root = root.path().canonicalize().expect("canonical root");

        let result = super::workspace_child_for_write(root.path(), target).expect("write target");

        assert_eq!(result, canonical_root.join(target));
        assert!(
            canonical_root.join("downloads/releases").is_dir(),
            "missing parent directories should be created"
        );
        assert!(
            !result.exists(),
            "write target helper should not create the target file"
        );
    }

    #[test]
    fn workspace_child_for_write_canonicalizes_workspace_root() {
        let root = tempdir().expect("tempdir");
        fs::create_dir(root.path().join("nested")).expect("nested");
        let noncanonical_root = root.path().join("nested/..");
        let canonical_root = root.path().canonicalize().expect("canonical root");

        let result = super::workspace_child_for_write(&noncanonical_root, Path::new("out/app.js"))
            .expect("write target");

        assert_eq!(result, canonical_root.join("out/app.js"));
    }

    #[test]
    fn workspace_child_for_write_rejects_parent_directory_escape() {
        let root = tempdir().expect("tempdir");
        let canonical_root = root.path().canonicalize().expect("canonical root");
        let outside_name = format!("escaped-write-{}.txt", std::process::id());
        let outside = canonical_root
            .parent()
            .expect("tempdir parent")
            .join(&outside_name);

        let result = super::workspace_child_for_write(
            root.path(),
            Path::new(&format!("nested/../../{outside_name}")),
        );

        assert!(result.unwrap_err().contains("outside workspace"));
        assert!(
            !outside.exists(),
            "outside write target should not be created"
        );
    }

    #[test]
    fn workspace_child_for_write_rejects_existing_directory_target() {
        let root = tempdir().expect("tempdir");
        fs::create_dir(root.path().join("downloads")).expect("downloads dir");

        let result = super::workspace_child_for_write(root.path(), Path::new("downloads"));

        assert!(result.unwrap_err().contains("not a regular file"));
    }

    #[test]
    fn workspace_child_for_existing_file_rejects_missing_or_outside_file() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        let outside_file = outside.path().join("secret.txt");
        fs::write(&outside_file, "secret").expect("outside file");

        let missing =
            super::workspace_child_for_existing_file(root.path(), Path::new("missing.txt"))
                .expect_err("missing file");
        let escaped = super::workspace_child_for_existing_file(root.path(), &outside_file)
            .expect_err("outside file");

        assert!(!missing.is_empty());
        assert!(escaped.contains("outside workspace"));
    }

    #[test]
    fn workspace_child_for_existing_file_rejects_existing_directory() {
        let root = tempdir().expect("tempdir");
        fs::create_dir(root.path().join("dist")).expect("dist dir");

        let result = super::workspace_child_for_existing_file(root.path(), Path::new("dist"));

        assert!(result.unwrap_err().contains("not a regular file"));
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
        let temp_sibling = root
            .path()
            .join(format!(".note.txt.{}.0.tmp", std::process::id()));
        fs::write(&file, "old").expect("write");
        fs::write(&temp_sibling, "do not touch").expect("write temp sibling");

        super::write_text_file(root.path(), &file, "new", None).expect("write");

        assert_eq!(fs::read_to_string(&file).expect("read file"), "new");
        assert_eq!(
            fs::read_to_string(&temp_sibling).expect("read temp sibling"),
            "do not touch"
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_text_file_preserves_existing_permissions() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("script.sh");
        fs::write(&file, "#!/bin/sh\n").expect("write");
        let mut permissions = fs::metadata(&file).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&file, permissions).expect("set permissions");

        super::write_text_file(root.path(), &file, "echo updated\n", None).expect("write");

        let mode = fs::metadata(&file).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o755);
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

    #[test]
    fn rename_path_rejects_existing_target_without_overwriting() {
        let root = tempdir().expect("tempdir");
        let src = root.path().join("src");
        fs::create_dir(&src).expect("src dir");
        let source = src.join("a.ts");
        let target = src.join("b.ts");
        fs::write(&source, "source").expect("write source");
        fs::write(&target, "target").expect("write target");

        let result = super::rename_path(root.path(), &source, "b.ts");

        assert!(result.unwrap_err().contains("target already exists"));
        assert_eq!(fs::read_to_string(&source).expect("read source"), "source");
        assert_eq!(fs::read_to_string(&target).expect("read target"), "target");
    }

    #[test]
    fn create_text_file_rejects_normalized_path_outside_workspace() {
        let root = tempdir().expect("tempdir");
        let outside_name = format!(
            "outside-{}.txt",
            root.path()
                .file_name()
                .and_then(|value| value.to_str())
                .expect("tempdir name")
        );
        let outside = root
            .path()
            .parent()
            .expect("tempdir parent")
            .join(&outside_name);
        assert!(!outside.exists(), "test outside file should not preexist");

        let result = super::create_text_file(root.path(), &format!("missing/../../{outside_name}"));

        let err = match result {
            Ok(value) => {
                let _ = fs::remove_file(&outside);
                panic!("expected outside workspace error, got {value:?}");
            }
            Err(err) => err,
        };
        assert!(err.contains("outside workspace"));
        assert!(!outside.exists(), "outside file should not be created");
    }

    #[cfg(unix)]
    #[test]
    fn create_text_file_rejects_outside_lexical_symlink_to_workspace() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        let link = outside.path().join("workspace-link");
        let outside_lexical_file = link.join("note.txt");
        let workspace_file = root.path().join("note.txt");
        symlink(root.path(), &link).expect("symlink");

        let result = super::create_text_file(
            root.path(),
            outside_lexical_file.to_str().expect("outside lexical path"),
        );

        let err = match result {
            Ok(value) => {
                let _ = fs::remove_file(&workspace_file);
                panic!("expected outside workspace error, got {value:?}");
            }
            Err(err) => err,
        };
        assert!(err.contains("outside workspace"));
        assert!(
            !outside_lexical_file.exists(),
            "outside lexical path should not be created"
        );
        assert!(
            !workspace_file.exists(),
            "workspace target should not be created through outside symlink"
        );
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
