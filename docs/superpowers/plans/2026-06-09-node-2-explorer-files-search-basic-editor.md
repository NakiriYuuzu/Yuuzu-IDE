# Node 2 Explorer Files Search Basic Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workbench useful for browsing, opening, editing, saving, searching, and safely tracking project files inside the existing single-WebView Tauri shell.

**Architecture:** Rust owns filesystem reads, writes, search traversal, file operations, and watcher events. React owns bounded UI state: expanded tree nodes, open tabs, active tab, dirty indicators, draft persistence metadata, and presentation. Monaco remains lazy-loaded and editor buffers live in Monaco plus focused per-workspace editor state, not in a global workspace registry.

**Tech Stack:** Tauri 2, Rust 1.96 stable, Vite 8, React 19, TypeScript 6, Bun 1.3, Monaco Editor, lucide-react, Zustand, latest Rust crates added via `cargo add` when needed.

---

## Design Sources And Constraints

- UI source of truth: `docs/ui-design/app.jsx`, `docs/ui-design/panels.jsx`, `docs/ui-design/scenes.jsx`, and `docs/ui-design/ide.css`.
- Explorer rows follow the existing compact `.row`, `.tw`, `.nm`, `.meta`, `.panel-head`, and `.panel-body` patterns.
- Tabs follow the design tab strip with file icon, mono label, dirty italic/dot, and close button.
- Search panel follows `docs/ui-design/panels.jsx` SearchPanel: compact input, grouped file rows, hit rows with line numbers.
- Icons use lucide-react. No generated bitmap icons are needed for Node 2.
- React must not own complete file contents as global workspace state. File contents are loaded into the active editor surface and Monaco model.
- Large files are not loaded into editable Monaco models. Node 2 caps editable text reads at 1 MiB and search reads at 1 MiB per file.
- Every behavior change needs red, green, and refactor evidence.

## File Map

- Create `src-tauri/src/file_system.rs`: bounded filesystem domain functions, file metadata, read/write/create/rename/delete/list, path containment checks.
- Create `src-tauri/src/search.rs`: bounded filename and full-text search over a workspace.
- Create `src-tauri/src/file_watcher.rs`: notify-based workspace watcher manager and event normalization.
- Modify `src-tauri/src/commands.rs`: Tauri commands for file domain, search, and watcher start/stop.
- Modify `src-tauri/src/lib.rs`: module registration, watcher state, and command handler registration.
- Modify `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`: add latest `ignore` and `notify` crates with `cargo add`.
- Create `src/features/files/file-api.ts`: typed frontend wrappers for file commands.
- Create `src/features/files/file-model.ts` and `src/features/files/file-model.test.ts`: pure editor tab/draft/file state helpers.
- Create `src/features/files/search-model.ts` and `src/features/files/search-model.test.ts`: pure search result grouping helpers.
- Modify `src/features/workspace/FileTreePanel.tsx`: expandable explorer, file open, file operations, active reveal styling.
- Create `src/features/workspace/SearchPanel.tsx`: filename and full-text search UI.
- Modify `src/features/editor/EditorTab.tsx`: Monaco file buffer editor, dirty state, save, read-only large-file view, find-in-file controls.
- Modify `src/app/workspace-view-state.ts` and tests: persist per-workspace open file tabs and active file shell state.
- Modify `src/app/AppShell.tsx`: wire Explorer, Search, file tabs, editor commands, status bar, and watcher event handling.
- Modify `src/app/command-palette-model.ts` and tests: add file/search commands that Node 2 exposes.
- Modify `src/features/workspace/workspace-api.ts`: keep workspace scan compatibility or route to new file API.
- Modify `src/index.css`: compact explorer, search, editor toolbar, dirty tab, and external-change styles.
- Create `docs/architecture/node-2-editor-results.md`: Node 2 verification and measurements.
- Modify `docs/architecture/progress.md` and `roadmap.md`: Node 2 status and progress after verification.

---

## Task 1: Rust File System Domain And Commands

**Files:**
- Create: `src-tauri/src/file_system.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml file_system`

- [ ] **Step 1: Write failing file system tests**

Create `src-tauri/src/file_system.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::tempdir;

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
    fn file_operations_create_rename_delete_inside_workspace() {
        let root = tempdir().expect("tempdir");
        let created = super::create_text_file(root.path(), "src/main.ts").expect("create");
        assert!(created.path.ends_with("src/main.ts"));

        let renamed = super::rename_path(root.path(), &created.path, "app.ts").expect("rename");
        assert!(renamed.path.ends_with("src/app.ts"));

        super::delete_path(root.path(), &renamed.path).expect("delete");
        assert!(!renamed.path.exists());
    }
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml file_system
```

Expected: FAIL because `read_text_file`, `write_text_file`, `create_text_file`, `rename_path`, and `delete_path` are missing.

- [ ] **Step 3: Implement minimal file system domain**

Implement `src-tauri/src/file_system.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
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

fn workspace_child(workspace_root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = workspace_root.canonicalize().map_err(|err| err.to_string())?;
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let normalized = normalize_path(&candidate)?;

    if !normalized.starts_with(&root) {
        return Err(format!("path outside workspace: {}", candidate.display()));
    }

    if candidate.exists() {
        let canonical = candidate.canonicalize().map_err(|err| err.to_string())?;
        if !canonical.starts_with(&root) {
            return Err(format!("path outside workspace: {}", candidate.display()));
        }
        return Ok(canonical);
    }

    let existing_parent = nearest_existing_parent(&candidate)?
        .canonicalize()
        .map_err(|err| err.to_string())?;
    if !existing_parent.starts_with(&root) {
        return Err(format!("path outside workspace: {}", candidate.display()));
    }

    Ok(normalized)
}

pub fn read_text_file(
    workspace_root: &Path,
    path: &Path,
    max_bytes: u64,
) -> Result<TextFileRead, String> {
    let path = workspace_child(workspace_root, path)?;
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
    let path = workspace_child(workspace_root, path)?;
    if let Some(expected) = expected_version {
        let current = file_version(&path)?;
        if current != expected {
            return Err(format!("file changed on disk: {}", path.display()));
        }
    }

    let mut temp_path = path.clone();
    temp_path.set_extension(format!(
        "{}tmp",
        path.extension().and_then(|value| value.to_str()).unwrap_or("")
    ));
    {
        let mut temp = fs::File::create(&temp_path).map_err(|err| err.to_string())?;
        temp.write_all(content.as_bytes())
            .map_err(|err| err.to_string())?;
        temp.sync_all().map_err(|err| err.to_string())?;
    }
    fs::rename(&temp_path, &path).map_err(|err| err.to_string())?;

    Ok(FileOperationResult {
        version: Some(file_version(&path)?),
        path,
    })
}

pub fn create_text_file(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<FileOperationResult, String> {
    let path = workspace_child(workspace_root, Path::new(relative_path))?;
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
    let path = workspace_child(workspace_root, path)?;
    let target = path
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?
        .join(new_name);
    let target = workspace_child(workspace_root, &target)?;
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
    let path = workspace_child(workspace_root, path)?;
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|err| err.to_string())
    } else {
        fs::remove_file(&path).map_err(|err| err.to_string())
    }
}
```

- [ ] **Step 4: Wire Tauri commands**

Modify `src-tauri/src/lib.rs`:

```rust
mod file_system;
```

Add these command handler entries:

```rust
commands::read_text_file,
commands::write_text_file,
commands::create_text_file,
commands::rename_path,
commands::delete_path,
```

Modify `src-tauri/src/commands.rs` imports:

```rust
use crate::file_system::{self, FileOperationResult, FileVersion, TextFileRead};
```

Add commands:

```rust
#[tauri::command]
pub fn read_text_file(workspace_root: String, path: String) -> Result<TextFileRead, String> {
    file_system::read_text_file(
        Path::new(&workspace_root),
        Path::new(&path),
        file_system::EDITABLE_TEXT_LIMIT_BYTES,
    )
}

#[tauri::command]
pub fn write_text_file(
    workspace_root: String,
    path: String,
    content: String,
    expected_version: Option<FileVersion>,
) -> Result<FileOperationResult, String> {
    file_system::write_text_file(
        Path::new(&workspace_root),
        Path::new(&path),
        &content,
        expected_version,
    )
}

#[tauri::command]
pub fn create_text_file(
    workspace_root: String,
    relative_path: String,
) -> Result<FileOperationResult, String> {
    file_system::create_text_file(Path::new(&workspace_root), &relative_path)
}

#[tauri::command]
pub fn rename_path(
    workspace_root: String,
    path: String,
    new_name: String,
) -> Result<FileOperationResult, String> {
    file_system::rename_path(Path::new(&workspace_root), Path::new(&path), &new_name)
}

#[tauri::command]
pub fn delete_path(workspace_root: String, path: String) -> Result<(), String> {
    file_system::delete_path(Path::new(&workspace_root), Path::new(&path))
}
```

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml file_system
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml commands
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src-tauri/src/file_system.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add bounded file system commands"
```

Expected: commit succeeds after review gates.

---

## Task 2: Rust Project Search

**Files:**
- Create: `src-tauri/src/search.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml search`

- [ ] **Step 1: Install latest search traversal crate**

Run:

```bash
. "$HOME/.cargo/env" && cargo add ignore --manifest-path src-tauri/Cargo.toml
```

Expected: latest compatible `ignore` crate is added to `Cargo.toml` and `Cargo.lock`.

- [ ] **Step 2: Write failing search tests**

Create `src-tauri/src/search.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn filename_search_matches_paths_and_limits_results() {
        let root = tempdir().expect("tempdir");
        fs::create_dir(root.path().join("src")).expect("src");
        fs::write(root.path().join("src/server.ts"), "server").expect("server");
        fs::write(root.path().join("src/client.ts"), "client").expect("client");

        let results = super::search_workspace(root.path(), "server", 10, 1024).expect("search");

        assert_eq!(results.filename_matches.len(), 1);
        assert!(results.filename_matches[0].path.ends_with("src/server.ts"));
    }

    #[test]
    fn text_search_reports_line_hits() {
        let root = tempdir().expect("tempdir");
        fs::write(root.path().join("main.rs"), "fn main() {}\nprintln!(\"hi\");\n")
            .expect("write");

        let results = super::search_workspace(root.path(), "println", 10, 1024).expect("search");

        assert_eq!(results.text_matches.len(), 1);
        assert_eq!(results.text_matches[0].hits[0].line_number, 2);
        assert_eq!(results.text_matches[0].hits[0].line.trim(), "println!(\"hi\");");
    }

    #[test]
    fn text_search_skips_large_files() {
        let root = tempdir().expect("tempdir");
        fs::write(root.path().join("large.txt"), "x".repeat(2048)).expect("write");

        let results = super::search_workspace(root.path(), "x", 10, 1024).expect("search");

        assert!(results.text_matches.is_empty());
    }
}
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml search
```

Expected: FAIL because `search_workspace` is missing.

- [ ] **Step 4: Implement search domain**

Implement `src-tauri/src/search.rs`:

```rust
use ignore::WalkBuilder;
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FilenameMatch {
    pub path: PathBuf,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TextHit {
    pub line_number: usize,
    pub line: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TextFileMatch {
    pub path: PathBuf,
    pub hits: Vec<TextHit>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct WorkspaceSearchResult {
    pub filename_matches: Vec<FilenameMatch>,
    pub text_matches: Vec<TextFileMatch>,
    pub truncated: bool,
}

pub fn search_workspace(
    workspace_root: &Path,
    query: &str,
    max_results: usize,
    max_file_bytes: u64,
) -> Result<WorkspaceSearchResult, String> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(WorkspaceSearchResult::default());
    }

    let mut result = WorkspaceSearchResult::default();
    let walker = WalkBuilder::new(workspace_root)
        .hidden(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true)
        .build();

    for entry in walker {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type();
        if file_type.map(|value| value.is_dir()).unwrap_or(false) {
            continue;
        }
        if result.filename_matches.len() + result.text_matches.len() >= max_results {
            result.truncated = true;
            break;
        }

        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        if name.to_lowercase().contains(&query) {
            result.filename_matches.push(FilenameMatch {
                path: path.to_path_buf(),
                name,
            });
        }

        let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
        if metadata.len() > max_file_bytes {
            continue;
        }
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        let hits = content
            .lines()
            .enumerate()
            .filter_map(|(index, line)| {
                if line.to_lowercase().contains(&query) {
                    Some(TextHit {
                        line_number: index + 1,
                        line: line.to_string(),
                    })
                } else {
                    None
                }
            })
            .take(5)
            .collect::<Vec<_>>();
        if !hits.is_empty() {
            result.text_matches.push(TextFileMatch {
                path: path.to_path_buf(),
                hits,
            });
        }
    }

    Ok(result)
}
```

- [ ] **Step 5: Wire search command**

Modify `src-tauri/src/lib.rs`:

```rust
mod search;
```

Add command handler:

```rust
commands::search_workspace,
```

Modify `src-tauri/src/commands.rs`:

```rust
use crate::search::WorkspaceSearchResult;

#[tauri::command]
pub fn search_workspace(
    workspace_root: String,
    query: String,
) -> Result<WorkspaceSearchResult, String> {
    crate::search::search_workspace(
        Path::new(&workspace_root),
        &query,
        100,
        file_system::EDITABLE_TEXT_LIMIT_BYTES,
    )
}
```

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml search
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/search.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add bounded workspace search"
```

Expected: commit succeeds after review gates.

---

## Task 3: Frontend File API And Editor State Model

**Files:**
- Create: `src/features/files/file-api.ts`
- Create: `src/features/files/file-model.ts`
- Create: `src/features/files/file-model.test.ts`
- Modify: `src/app/workspace-view-state.ts`
- Modify: `src/app/workspace-view-state.test.ts`
- Test: `bun test src/features/files/file-model.test.ts src/app/workspace-view-state.test.ts`

- [ ] **Step 1: Write failing file model tests**

Create `src/features/files/file-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activateFileTab,
  applySavedVersion,
  closeFileTab,
  markFileDirty,
  openFileTab,
  type EditorFileTab,
} from "./file-model";

const tab: EditorFileTab = {
  path: "/workspace/src/main.ts",
  name: "main.ts",
  dirty: false,
  tooLarge: false,
  version: { modified_ms: 1, len: 10 },
  externalChange: false,
};

describe("file model", () => {
  test("opens a file once and activates it", () => {
    const state = openFileTab({ tabs: [], activePath: null }, tab);
    const next = openFileTab(state, { ...tab, name: "duplicate.ts" });

    expect(next.tabs).toHaveLength(1);
    expect(next.activePath).toBe(tab.path);
  });

  test("marks dirty and clears dirty when saved version is applied", () => {
    const dirty = markFileDirty({ tabs: [tab], activePath: tab.path }, tab.path, true);
    const saved = applySavedVersion(dirty, tab.path, { modified_ms: 2, len: 12 });

    expect(saved.tabs[0].dirty).toBe(false);
    expect(saved.tabs[0].version).toEqual({ modified_ms: 2, len: 12 });
  });

  test("closing active tab activates the previous remaining tab", () => {
    const second = { ...tab, path: "/workspace/src/lib.ts", name: "lib.ts" };
    const state = { tabs: [tab, second], activePath: second.path };

    const next = closeFileTab(state, second.path);

    expect(next.activePath).toBe(tab.path);
    expect(next.tabs.map((item) => item.path)).toEqual([tab.path]);
  });

  test("activateFileTab ignores missing paths", () => {
    const state = { tabs: [tab], activePath: tab.path };

    expect(activateFileTab(state, "/workspace/missing.ts")).toEqual(state);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/files/file-model.test.ts
```

Expected: FAIL because `file-model` is missing.

- [ ] **Step 3: Implement file model**

Create `src/features/files/file-model.ts`:

```ts
export type FileVersion = {
  modified_ms: number;
  len: number;
};

export type EditorFileTab = {
  path: string;
  name: string;
  dirty: boolean;
  tooLarge: boolean;
  version: FileVersion | null;
  externalChange: boolean;
};

export type EditorFileState = {
  tabs: EditorFileTab[];
  activePath: string | null;
};

export function openFileTab(
  state: EditorFileState,
  tab: EditorFileTab,
): EditorFileState {
  const exists = state.tabs.some((item) => item.path === tab.path);
  return {
    tabs: exists ? state.tabs : [...state.tabs, tab],
    activePath: tab.path,
  };
}

export function activateFileTab(
  state: EditorFileState,
  path: string,
): EditorFileState {
  return state.tabs.some((item) => item.path === path)
    ? { ...state, activePath: path }
    : state;
}

export function closeFileTab(
  state: EditorFileState,
  path: string,
): EditorFileState {
  const index = state.tabs.findIndex((item) => item.path === path);
  if (index < 0) {
    return state;
  }
  const tabs = state.tabs.filter((item) => item.path !== path);
  const activePath =
    state.activePath === path
      ? tabs[Math.max(0, index - 1)]?.path ?? null
      : state.activePath;
  return { tabs, activePath };
}

export function markFileDirty(
  state: EditorFileState,
  path: string,
  dirty: boolean,
): EditorFileState {
  return {
    ...state,
    tabs: state.tabs.map((item) =>
      item.path === path ? { ...item, dirty } : item,
    ),
  };
}

export function applySavedVersion(
  state: EditorFileState,
  path: string,
  version: FileVersion,
): EditorFileState {
  return {
    ...state,
    tabs: state.tabs.map((item) =>
      item.path === path
        ? { ...item, dirty: false, externalChange: false, version }
        : item,
    ),
  };
}
```

- [ ] **Step 4: Add typed file API wrappers**

Create `src/features/files/file-api.ts`:

```ts
import { call } from "../../lib/tauri";
import type { FileVersion } from "./file-model";

export type TextFileRead = {
  path: string;
  content: string | null;
  version: FileVersion;
  too_large: boolean;
};

export type FileOperationResult = {
  path: string;
  version: FileVersion | null;
};

export function readTextFile(
  workspaceRoot: string,
  path: string,
): Promise<TextFileRead> {
  return call<TextFileRead>("read_text_file", { workspaceRoot, path });
}

export function writeTextFile(
  workspaceRoot: string,
  path: string,
  content: string,
  expectedVersion: FileVersion | null,
): Promise<FileOperationResult> {
  return call<FileOperationResult>("write_text_file", {
    workspaceRoot,
    path,
    content,
    expectedVersion,
  });
}

export function createTextFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<FileOperationResult> {
  return call<FileOperationResult>("create_text_file", {
    workspaceRoot,
    relativePath,
  });
}

export function renamePath(
  workspaceRoot: string,
  path: string,
  newName: string,
): Promise<FileOperationResult> {
  return call<FileOperationResult>("rename_path", {
    workspaceRoot,
    path,
    newName,
  });
}

export function deletePath(
  workspaceRoot: string,
  path: string,
): Promise<void> {
  return call<void>("delete_path", { workspaceRoot, path });
}
```

- [ ] **Step 5: Extend per-workspace view state**

Modify `src/app/workspace-view-state.ts`:

```ts
import type { EditorFileState } from "../features/files/file-model";

export type Surface = "empty" | "editor" | "terminal";

export type WorkspaceViewState = {
  activeActivity: ActivityId;
  panelOpen: boolean;
  surface: Surface;
  editor: EditorFileState;
};

function defaultWorkspaceView(): WorkspaceViewState {
  return {
    activeActivity: "explorer",
    panelOpen: true,
    surface: "empty",
    editor: { tabs: [], activePath: null },
  };
}
```

Add `updateEditor` to the store:

```ts
updateEditor: (
  workspaceId: string | null,
  update: (editor: EditorFileState) => EditorFileState,
) => void;
```

Implementation:

```ts
updateEditor: (workspaceId, update) =>
  set((state) => {
    const key = workspaceId ?? shellKey;
    const current = state.views[key] ?? defaultView;
    return {
      views: {
        ...state.views,
        [key]: { ...current, editor: update(current.editor) },
      },
    };
  }),
```

Update `src/app/workspace-view-state.test.ts` with:

```ts
test("editor tabs are restored per workspace", () => {
  const store = createWorkspaceViewStore();

  store.getState().updateEditor("a", () => ({
    tabs: [{
      path: "/a/src/main.ts",
      name: "main.ts",
      dirty: false,
      tooLarge: false,
      version: { modified_ms: 1, len: 1 },
      externalChange: false,
    }],
    activePath: "/a/src/main.ts",
  }));

  expect(store.getState().viewFor("a").editor.activePath).toBe("/a/src/main.ts");
  expect(store.getState().viewFor("b").editor.activePath).toBeNull();
});
```

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
bun test src/features/files/file-model.test.ts src/app/workspace-view-state.test.ts
bun run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/features/files/file-api.ts src/features/files/file-model.ts src/features/files/file-model.test.ts src/app/workspace-view-state.ts src/app/workspace-view-state.test.ts
git commit -m "feat: add editor file state model"
```

Expected: commit succeeds after review gates.

---

## Task 4: Interactive Explorer Tree And File Operations

**Files:**
- Modify: `src-tauri/src/workspace_scan.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/features/workspace/FileTreePanel.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml workspace_scan`
- Test: `bun run build`

- [ ] **Step 1: Write failing nested directory scan tests**

Add to `src-tauri/src/workspace_scan.rs` tests:

```rust
#[test]
fn scan_directory_accepts_nested_workspace_child() {
    let root = tempdir().expect("tempdir");
    fs::create_dir(root.path().join("src")).expect("src dir");
    File::create(root.path().join("src/main.ts")).expect("main file");

    let entries = super::scan_directory(root.path(), &root.path().join("src")).expect("scan");

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "main.ts");
}

#[test]
fn scan_directory_rejects_outside_workspace() {
    let root = tempdir().expect("tempdir");
    let outside = tempdir().expect("outside");

    let result = super::scan_directory(root.path(), outside.path());

    assert!(result.unwrap_err().contains("outside workspace"));
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml workspace_scan
```

Expected: FAIL because `scan_directory` is missing.

- [ ] **Step 3: Implement nested scan**

Add to `src-tauri/src/workspace_scan.rs`:

```rust
pub fn scan_directory(workspace_root: &Path, path: &Path) -> Result<Vec<FileTreeEntry>, String> {
    let root = workspace_root.canonicalize().map_err(|err| err.to_string())?;
    let path = path.canonicalize().map_err(|err| err.to_string())?;
    if !path.starts_with(&root) {
        return Err(format!("path outside workspace: {}", path.display()));
    }
    scan_top_level(&path)
}
```

Modify `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn scan_directory(
    workspace_root: String,
    path: String,
) -> Result<Vec<FileTreeEntry>, String> {
    workspace_scan::scan_directory(Path::new(&workspace_root), Path::new(&path))
}
```

Add command handler in `src-tauri/src/lib.rs`:

```rust
commands::scan_directory,
```

- [ ] **Step 4: Add frontend scan wrapper**

Modify `src/features/workspace/workspace-api.ts`:

```ts
export function scanDirectory(
  workspaceRoot: string,
  path: string,
): Promise<FileTreeEntry[]> {
  return call<FileTreeEntry[]>("scan_directory", { workspaceRoot, path });
}
```

- [ ] **Step 5: Wire explorer open, expand, create, rename, delete, and reveal**

Change `FileTreePanel` props:

```ts
type FileTreePanelProps = {
  refreshKey?: number;
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
  onCreateFile: (relativePath: string) => Promise<void>;
  onRenamePath: (path: string, newName: string) => Promise<void>;
  onDeletePath: (path: string) => Promise<void>;
};
```

Use `expandedPaths: Record<string, FileTreeEntry[]>` local state and load child entries with `scanDirectory(activeWorkspace.path, entry.path)`. Render child rows recursively with the existing design row classes:

```tsx
<button
  type="button"
  className={`row tree-row${entry.path === activeFilePath ? " sel" : ""}`}
  style={{ paddingLeft: 12 + depth * 14 }}
  title={entry.path}
  onClick={() => entry.is_dir ? toggleDirectory(entry) : onOpenFile(entry.path)}
>
  <span className="tw">
    {entry.is_dir ? (
      isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />
    ) : null}
  </span>
  <Icon className={className} aria-hidden="true" />
  <span className="nm mono">{entry.name}</span>
</button>
```

Add small action buttons to `panel-head` in `AppShell` for New file and Refresh. Use `window.prompt` for Node 2 create/rename names and `window.confirm` for delete so the behavior is functional without adding modal complexity:

```ts
async function createFileFromExplorer(relativePath: string) {
  if (!activeWorkspace) return;
  const result = await createTextFile(activeWorkspace.path, relativePath);
  openFile(result.path);
  setFileTreeRefreshKey((value) => value + 1);
}
```

- [ ] **Step 6: Add compact CSS**

Add to `src/index.css`:

```css
.tree-row {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.tree-row.external {
  color: var(--c-attr);
}

.panel-error-inline {
  padding: 7px 10px;
  color: var(--c-tag);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 7: Run GREEN verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml workspace_scan
bun run build
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add src-tauri/src/workspace_scan.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/features/workspace/workspace-api.ts src/features/workspace/FileTreePanel.tsx src/app/AppShell.tsx src/index.css
git commit -m "feat: add interactive workspace explorer"
```

Expected: commit succeeds after review gates.

---

## Task 5: Monaco File Tabs, Dirty State, Drafts, And Save

**Files:**
- Modify: `src/features/editor/EditorTab.tsx`
- Create: `src/features/files/draft-store.ts`
- Create: `src/features/files/draft-store.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Test: `bun test src/features/files/draft-store.test.ts src/features/files/file-model.test.ts`
- Test: `bun run build`

- [ ] **Step 1: Write failing draft tests**

Create `src/features/files/draft-store.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { createDraftKey, loadDraft, saveDraft, clearDraft } from "./draft-store";

describe("draft store", () => {
  test("round trips draft content by workspace and path", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    const key = createDraftKey("workspace-a", "/workspace-a/src/main.ts");

    saveDraft(adapter, key, "draft text");

    expect(loadDraft(adapter, key)).toBe("draft text");
    clearDraft(adapter, key);
    expect(loadDraft(adapter, key)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/files/draft-store.test.ts
```

Expected: FAIL because `draft-store` is missing.

- [ ] **Step 3: Implement draft store**

Create `src/features/files/draft-store.ts`:

```ts
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createDraftKey(workspaceId: string, path: string): string {
  return `yuuzu:draft:${workspaceId}:${path}`;
}

export function loadDraft(storage: DraftStorage, key: string): string | null {
  return storage.getItem(key);
}

export function saveDraft(
  storage: DraftStorage,
  key: string,
  content: string,
): void {
  storage.setItem(key, content);
}

export function clearDraft(storage: DraftStorage, key: string): void {
  storage.removeItem(key);
}
```

- [ ] **Step 4: Replace sample editor with file editor**

Change `EditorTab` props:

```ts
type EditorTabProps = {
  workspaceId: string;
  filePath: string;
  content: string;
  language: string;
  readOnly: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onContentChange: (content: string) => void;
};
```

Create Monaco with file content:

```ts
editorRef.current = monaco.editor.create(hostRef.current, {
  value: content,
  language,
  readOnly,
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 13,
});

const model = editorRef.current.getModel();
const disposable = model?.onDidChangeContent(() => {
  const next = editorRef.current?.getValue() ?? "";
  onContentChange(next);
  onDirtyChange(next !== content);
});
```

Dispose listener and editor in cleanup.

- [ ] **Step 5: Wire file load, save, dirty tabs, and large file view in AppShell**

In `AppShell`, add local state for loaded file contents:

```ts
type LoadedFile = {
  path: string;
  content: string;
  language: string;
  readOnly: boolean;
};

const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
const [editorError, setEditorError] = useState<string | null>(null);
```

Add extension language mapping:

```ts
function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  return "plaintext";
}
```

Implement `openFile(path)`:

```ts
async function openFile(path: string) {
  if (!activeWorkspace || !activeWorkspaceId) return;
  const read = await readTextFile(activeWorkspace.path, path);
  const name = path.split(/[\\/]/).pop() ?? path;
  updateEditor(activeWorkspaceId, (editor) =>
    openFileTab(editor, {
      path,
      name,
      dirty: false,
      tooLarge: read.too_large,
      version: read.version,
      externalChange: false,
    }),
  );
  setLoadedFile({
    path,
    content: read.content ?? "",
    language: languageForPath(path),
    readOnly: read.too_large,
  });
  setSurface("editor");
}
```

Implement `saveActiveFile()`:

```ts
async function saveActiveFile(content: string) {
  const activePath = view.editor.activePath;
  const activeTab = view.editor.tabs.find((tab) => tab.path === activePath);
  if (!activeWorkspace || !activeWorkspaceId || !activePath || !activeTab) return;
  const result = await writeTextFile(
    activeWorkspace.path,
    activePath,
    content,
    activeTab.version,
  );
  if (result.version) {
    updateEditor(activeWorkspaceId, (editor) =>
      applySavedVersion(editor, activePath, result.version!),
    );
    clearDraft(window.localStorage, createDraftKey(activeWorkspaceId, activePath));
  }
}
```

Render tabs from `view.editor.tabs`; dirty tabs use `.dirtydot` and `.tlabel.dirty`.

- [ ] **Step 6: Add editor toolbar CSS**

Add to `src/index.css`:

```css
.editor-toolbar {
  height: 34px;
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
  background: var(--chrome);
}

.editor-toolbar .path-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--txt-dim);
}

.large-file-note {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--txt-faint);
}
```

- [ ] **Step 7: Run GREEN verification**

Run:

```bash
bun test src/features/files/draft-store.test.ts src/features/files/file-model.test.ts src/app/workspace-view-state.test.ts
bun run build
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/features/editor/EditorTab.tsx src/features/files/draft-store.ts src/features/files/draft-store.test.ts src/app/AppShell.tsx src/index.css
git commit -m "feat: add monaco file editing and drafts"
```

Expected: commit succeeds after review gates.

---

## Task 6: Find In File And Command Palette File Actions

**Files:**
- Create: `src/features/files/find-model.ts`
- Create: `src/features/files/find-model.test.ts`
- Modify: `src/features/editor/EditorTab.tsx`
- Modify: `src/app/command-palette-model.ts`
- Modify: `src/app/command-palette-model.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Test: `bun test src/features/files/find-model.test.ts src/app/command-palette-model.test.ts`

- [ ] **Step 1: Write failing find tests**

Create `src/features/files/find-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { findInText } from "./find-model";

describe("findInText", () => {
  test("returns line and column matches", () => {
    expect(findInText("alpha\nbeta alpha\n", "alpha")).toEqual([
      { lineNumber: 1, column: 1, preview: "alpha" },
      { lineNumber: 2, column: 6, preview: "beta alpha" },
    ]);
  });

  test("returns no matches for empty query", () => {
    expect(findInText("alpha", "")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/files/find-model.test.ts
```

Expected: FAIL because `find-model` is missing.

- [ ] **Step 3: Implement find model**

Create `src/features/files/find-model.ts`:

```ts
export type FindMatch = {
  lineNumber: number;
  column: number;
  preview: string;
};

export function findInText(content: string, query: string): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return content.split(/\r?\n/).flatMap((line, index) => {
    const column = line.toLowerCase().indexOf(needle);
    return column >= 0
      ? [{ lineNumber: index + 1, column: column + 1, preview: line }]
      : [];
  });
}
```

- [ ] **Step 4: Add find controls to EditorTab**

Add props:

```ts
findQuery: string;
onFindQueryChange: (query: string) => void;
```

Render compact toolbar input before Monaco host:

```tsx
<div className="editor-find">
  <Search aria-hidden="true" />
  <input
    value={findQuery}
    aria-label="Find in file"
    placeholder="Find in file"
    onChange={(event) => onFindQueryChange(event.target.value)}
  />
</div>
```

When `findQuery` changes, use Monaco decorations:

```ts
useEffect(() => {
  const editor = editorRef.current;
  const model = editor?.getModel();
  if (!editor || !model || !findQuery.trim()) return;
  const matches = model.findMatches(findQuery, false, false, false, null, true);
  if (matches[0]) {
    editor.revealRangeInCenter(matches[0].range);
    editor.setSelection(matches[0].range);
  }
}, [findQuery]);
```

- [ ] **Step 5: Add command palette file actions**

Update `src/app/command-palette-model.test.ts`:

```ts
test("includes node 2 file commands", () => {
  expect(node1Commands.map((item) => item.id)).toContain("save-file");
  expect(node1Commands.map((item) => item.id)).toContain("find-in-file");
  expect(node1Commands.map((item) => item.id)).toContain("search-workspace");
});
```

Update command list:

```ts
{ id: "save-file", label: "Save active file", group: "File" },
{ id: "find-in-file", label: "Find in file", group: "File" },
{ id: "search-workspace", label: "Search workspace", group: "Search" },
```

Wire `runCommand` in `AppShell`:

```ts
case "save-file":
  void saveLoadedFile();
  break;
case "find-in-file":
  setSurface("editor");
  setFindOpen(true);
  break;
case "search-workspace":
  setActiveActivity("search");
  setPanelOpen(true);
  break;
```

- [ ] **Step 6: Add CSS**

Add:

```css
.editor-find {
  height: 32px;
  flex: 0 0 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
  background: var(--editor);
}

.editor-find input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--txt);
  font-family: var(--font-mono);
  font-size: 12px;
}
```

- [ ] **Step 7: Run GREEN verification**

Run:

```bash
bun test src/features/files/find-model.test.ts src/app/command-palette-model.test.ts
bun run build
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

Run:

```bash
git add src/features/files/find-model.ts src/features/files/find-model.test.ts src/features/editor/EditorTab.tsx src/app/command-palette-model.ts src/app/command-palette-model.test.ts src/app/AppShell.tsx src/index.css
git commit -m "feat: add find in file commands"
```

Expected: commit succeeds after review gates.

---

## Task 7: Search Panel UI

**Files:**
- Create: `src/features/files/search-model.ts`
- Create: `src/features/files/search-model.test.ts`
- Modify: `src/features/files/file-api.ts`
- Create: `src/features/workspace/SearchPanel.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`
- Test: `bun test src/features/files/search-model.test.ts`

- [ ] **Step 1: Write failing search model tests**

Create `src/features/files/search-model.test.ts`:

```ts
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { searchSummary } from "./search-model";

describe("searchSummary", () => {
  test("counts filename and text hits", () => {
    expect(
      searchSummary({
        filename_matches: [{ path: "/w/src/main.ts", name: "main.ts" }],
        text_matches: [
          { path: "/w/src/lib.ts", hits: [{ line_number: 4, line: "main()" }] },
        ],
        truncated: false,
      }),
    ).toBe("2 matches in 2 files");
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
bun test src/features/files/search-model.test.ts
```

Expected: FAIL because `search-model` is missing.

- [ ] **Step 3: Implement search model and API wrapper**

Create `src/features/files/search-model.ts`:

```ts
export type FilenameMatch = {
  path: string;
  name: string;
};

export type TextHit = {
  line_number: number;
  line: string;
};

export type TextFileMatch = {
  path: string;
  hits: TextHit[];
};

export type WorkspaceSearchResult = {
  filename_matches: FilenameMatch[];
  text_matches: TextFileMatch[];
  truncated: boolean;
};

export function searchSummary(result: WorkspaceSearchResult): string {
  const fileCount =
    new Set([
      ...result.filename_matches.map((item) => item.path),
      ...result.text_matches.map((item) => item.path),
    ]).size;
  const hitCount =
    result.filename_matches.length +
    result.text_matches.reduce((sum, item) => sum + item.hits.length, 0);
  return `${hitCount} ${hitCount === 1 ? "match" : "matches"} in ${fileCount} ${
    fileCount === 1 ? "file" : "files"
  }`;
}
```

Add to `src/features/files/file-api.ts`:

```ts
import type { WorkspaceSearchResult } from "./search-model";

export function searchWorkspace(
  workspaceRoot: string,
  query: string,
): Promise<WorkspaceSearchResult> {
  return call<WorkspaceSearchResult>("search_workspace", {
    workspaceRoot,
    query,
  });
}
```

- [ ] **Step 4: Implement SearchPanel**

Create `src/features/workspace/SearchPanel.tsx`:

```tsx
import { FileCode2, Search } from "lucide-react";
import { useState } from "react";

import { useWorkspaceStore } from "../../app/workspace-store";
import { searchWorkspace } from "../files/file-api";
import {
  searchSummary,
  type WorkspaceSearchResult,
} from "../files/search-model";

type SearchPanelProps = {
  onOpenFile: (path: string) => void;
};

export function SearchPanel({ onOpenFile }: SearchPanelProps) {
  const registry = useWorkspaceStore((state) => state.registry);
  const activeWorkspace = registry.workspaces.find(
    (workspace) => workspace.id === registry.active_workspace_id,
  );
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<WorkspaceSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(nextQuery = query) {
    if (!activeWorkspace || !nextQuery.trim()) {
      setResult(null);
      return;
    }
    try {
      setResult(await searchWorkspace(activeWorkspace.path, nextQuery));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="panel-body search-panel">
      <label className="search-box">
        <Search aria-hidden="true" />
        <input
          value={query}
          aria-label="Search workspace"
          placeholder="Search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runSearch();
          }}
        />
      </label>
      {result ? <div className="search-summary">{searchSummary(result)}</div> : null}
      {error ? <div className="panel-error-inline">{error}</div> : null}
      {result?.filename_matches.map((item) => (
        <button type="button" className="row tree-row" key={`file-${item.path}`} onClick={() => onOpenFile(item.path)}>
          <FileCode2 aria-hidden="true" />
          <span className="nm mono">{item.name}</span>
          <span className="meta">filename</span>
        </button>
      ))}
      {result?.text_matches.map((file) => (
        <div key={`text-${file.path}`}>
          <button type="button" className="row tree-row" onClick={() => onOpenFile(file.path)}>
            <FileCode2 aria-hidden="true" />
            <span className="nm mono">{file.path.split(/[\\/]/).pop()}</span>
            <span className="meta">{file.hits.length}</span>
          </button>
          {file.hits.map((hit) => (
            <button
              type="button"
              className="row tree-row search-hit"
              key={`${file.path}:${hit.line_number}:${hit.line}`}
              onClick={() => onOpenFile(file.path)}
            >
              <span className="tw mono">{hit.line_number}</span>
              <span className="nm mono">{hit.line.trim()}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Wire SearchPanel in AppShell**

Change `PanelBody` to accept `onOpenFile` and render:

```tsx
if (active === "search") {
  return <SearchPanel onOpenFile={onOpenFile} />;
}
```

- [ ] **Step 6: Add CSS**

Add:

```css
.search-panel {
  padding: 8px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--editor);
}

.search-box input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--txt);
  font-family: var(--font-mono);
  font-size: 12px;
}

.search-summary {
  padding: 8px 2px;
  color: var(--txt-faint);
  font-family: var(--font-mono);
  font-size: 11px;
}

.search-hit {
  color: var(--txt-dim);
}
```

- [ ] **Step 7: Run GREEN verification**

Run:

```bash
bun test src/features/files/search-model.test.ts
bun run build
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

Run:

```bash
git add src/features/files/search-model.ts src/features/files/search-model.test.ts src/features/files/file-api.ts src/features/workspace/SearchPanel.tsx src/app/AppShell.tsx src/index.css
git commit -m "feat: add workspace search panel"
```

Expected: commit succeeds after review gates.

---

## Task 8: File Watcher And External Change Detection

**Files:**
- Create: `src-tauri/src/file_watcher.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src/features/files/file-api.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/features/files/file-model.ts`
- Modify: `src/features/files/file-model.test.ts`
- Modify: `src/index.css`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml file_watcher`
- Test: `bun test src/features/files/file-model.test.ts`

- [ ] **Step 1: Install latest watcher crate**

Run:

```bash
. "$HOME/.cargo/env" && cargo add notify --manifest-path src-tauri/Cargo.toml
```

Expected: latest compatible `notify` crate is added.

- [ ] **Step 2: Write failing watcher tests**

Create `src-tauri/src/file_watcher.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use std::path::PathBuf;

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
}
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml file_watcher
```

Expected: FAIL because `normalize_event_path` is missing.

- [ ] **Step 4: Implement watcher manager**

Create `src-tauri/src/file_watcher.rs`:

```rust
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{collections::HashMap, path::{Path, PathBuf}, sync::Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FileChangedEvent {
    pub workspace_root: PathBuf,
    pub path: PathBuf,
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
    ) -> Result<(), String> {
        let root = workspace_root.canonicalize().map_err(|err| err.to_string())?;
        let mut watchers = self.watchers.lock().map_err(|err| err.to_string())?;
        if watchers.contains_key(&root) {
            return Ok(());
        }

        let emit_root = root.clone();
        let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            let Ok(event) = event else { return; };
            for path in event.paths {
                if let Some(path) = normalize_event_path(&emit_root, &path) {
                    let _ = app.emit(
                        "workspace://file-changed",
                        FileChangedEvent {
                            workspace_root: emit_root.clone(),
                            path,
                        },
                    );
                }
            }
        })
        .map_err(|err| err.to_string())?;

        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|err| err.to_string())?;
        watchers.insert(root, watcher);
        Ok(())
    }

    pub fn unwatch_workspace(&self, workspace_root: PathBuf) -> Result<(), String> {
        let root = workspace_root.canonicalize().map_err(|err| err.to_string())?;
        let mut watchers = self.watchers.lock().map_err(|err| err.to_string())?;
        watchers.remove(&root);
        Ok(())
    }
}

pub fn normalize_event_path(root: &Path, path: &Path) -> Option<PathBuf> {
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    path.starts_with(root).then_some(path)
}
```

- [ ] **Step 5: Wire watcher commands**

Modify `src-tauri/src/lib.rs`:

```rust
mod file_watcher;
```

In setup:

```rust
app.manage(file_watcher::FileWatcherState::new());
```

Add command handlers:

```rust
commands::watch_workspace,
commands::unwatch_workspace,
```

Modify `src-tauri/src/commands.rs`:

```rust
use crate::file_watcher::FileWatcherState;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn watch_workspace(
    app: AppHandle,
    state: State<'_, FileWatcherState>,
    workspace_root: String,
) -> Result<(), String> {
    state.watch_workspace(app, PathBuf::from(workspace_root))
}

#[tauri::command]
pub fn unwatch_workspace(
    state: State<'_, FileWatcherState>,
    workspace_root: String,
) -> Result<(), String> {
    state.unwatch_workspace(PathBuf::from(workspace_root))
}
```

- [ ] **Step 6: Extend frontend dirty model for external changes**

Add test to `src/features/files/file-model.test.ts`:

```ts
test("marks open file as externally changed", () => {
  const state = { tabs: [tab], activePath: tab.path };

  const next = markExternalChange(state, tab.path);

  expect(next.tabs[0].externalChange).toBe(true);
});
```

Add to `file-model.ts`:

```ts
export function markExternalChange(
  state: EditorFileState,
  path: string,
): EditorFileState {
  return {
    ...state,
    tabs: state.tabs.map((item) =>
      item.path === path ? { ...item, externalChange: true } : item,
    ),
  };
}
```

- [ ] **Step 7: Wire frontend watcher**

Add to `src/features/files/file-api.ts`:

```ts
export function watchWorkspace(workspaceRoot: string): Promise<void> {
  return call<void>("watch_workspace", { workspaceRoot });
}

export function unwatchWorkspace(workspaceRoot: string): Promise<void> {
  return call<void>("unwatch_workspace", { workspaceRoot });
}
```

In `AppShell`, listen for the event:

```ts
useEffect(() => {
  if (!activeWorkspace) return;
  void watchWorkspace(activeWorkspace.path);
  const unlisten = listen<{ path: string; workspace_root: string }>(
    "workspace://file-changed",
    (event) => {
      const changedPath = event.payload.path;
      updateEditor(activeWorkspaceId, (editor) =>
        markExternalChange(editor, changedPath),
      );
    },
  );
  return () => {
    void unlisten.then((dispose) => dispose());
    void unwatchWorkspace(activeWorkspace.path);
  };
}, [activeWorkspace, activeWorkspaceId, updateEditor]);
```

Import `listen` from `@tauri-apps/api/event`.

Render external changed tabs with:

```tsx
{tab.externalChange ? <span className="meta">changed</span> : null}
```

- [ ] **Step 8: Add CSS**

Add:

```css
.tab.external .tlabel {
  color: var(--c-attr);
}
```

- [ ] **Step 9: Run GREEN verification**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml file_watcher
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
bun test src/features/files/file-model.test.ts
bun run build
git diff --check
```

Expected: PASS.

- [ ] **Step 10: Commit Task 8**

Run:

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/file_watcher.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/features/files/file-api.ts src/features/files/file-model.ts src/features/files/file-model.test.ts src/app/AppShell.tsx src/index.css
git commit -m "feat: detect external file changes"
```

Expected: commit succeeds after review gates.

---

## Task 9: Node 2 Verification, Measurements, And Docs

**Files:**
- Create: `docs/architecture/node-2-editor-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`
- Test: node-level verification commands

- [ ] **Step 1: Run node-level verification**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
bun run tauri build --debug
```

Expected: PASS. Vite chunk-size warnings are acceptable if exit code is 0 and Monaco remains lazy-loaded.

- [ ] **Step 2: Run focused manual/browser smoke**

Use the debug app or Vite with Tauri limitation noted:

```txt
Open workspace /Users/yuuzu/HanaokaYuuzu/Ai/yuuzu-ide.
Expand src/features.
Open a text file.
Edit content and observe dirty dot.
Save file in a temporary test workspace.
Run filename search and full-text search.
Create, rename, delete a temporary file.
Modify an open file externally and observe changed indicator.
Open a file above 1 MiB and verify read-only large-file view.
```

Expected: all flows pass in a temporary workspace or equivalent command-level tests if WebView automation cannot interact.

- [ ] **Step 3: Measure editor/search behavior**

Record:

```txt
file_tree_nested_scan_ms
read_small_text_file_ms
save_small_text_file_ms
filename_search_medium_workspace_ms
full_text_search_medium_workspace_ms
large_file_open_behavior
monaco_loaded_only_after_open_file
memory_after_first_file_open_mb
```

Use a temporary workspace for destructive file operation measurements.

- [ ] **Step 4: Create Node 2 results doc**

Create `docs/architecture/node-2-editor-results.md` using the verification counts and measurements recorded in Step 1. Do not write symbolic fields or angle-bracket values into the file.

Use this exact structure, replacing the sample numeric values below with the measured values from this run:

```markdown
# Node 2 Editor Results

## Scope

- Interactive file explorer.
- File open, edit, save, dirty state, and draft survival.
- Find in file.
- Filename and full-text project search.
- File create, rename, delete, and reveal.
- File watcher and external-change detection.
- Large-file handling.

## Verification

| Command | Result |
| --- | --- |
| `bun test` | PASS: 32 tests |
| `bun run build` | PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS: 44 tests |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `bun run tauri build --debug` | PASS |

## Measurements

| Measurement | Result | Pass Target |
| --- | ---: | ---: |
| Nested file tree scan | 8 ms | responsive for medium workspace |
| Small file read | 2 ms | responsive |
| Small file save | 3 ms | responsive |
| Filename search | 12 ms | responsive for medium workspace |
| Full-text search | 39 ms | responsive for medium workspace |
| Memory after first file open | 132 MB | measured and acceptable |

## Result

Node 2 passes when the user can browse, open, edit, save, and search files, with
external changes detected and large files kept out of editable Monaco buffers.
```

- [ ] **Step 5: Update roadmap**

In `roadmap.md`, update Node 2 status to completed/passed and reference `docs/architecture/node-2-editor-results.md`.

- [ ] **Step 6: Update progress**

In `docs/architecture/progress.md`, extend `## 2026-06-09` with Node 2:

- tasks completed,
- important files changed,
- verification commands and pass results,
- measurement values,
- residual risks.

- [ ] **Step 7: Run docs checks**

Run:

```bash
rg -n 'T[B]D|T[O]DO|F[I]XME|place[ ]holder|<''actual>|\\| 0 (ms|MB) \\|' docs/architecture/node-2-editor-results.md roadmap.md docs/architecture/progress.md
git diff --check
```

Expected: no matches and no whitespace errors.

- [ ] **Step 8: Commit Task 9**

Run:

```bash
git add docs/architecture/node-2-editor-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 2 editor results"
```

Expected: commit succeeds after review gates.

---

## Self-Review

### Spec Coverage

- File explorer: Task 4.
- Open file into tabs: Tasks 3, 4, and 5.
- Basic text editor: Task 5.
- Save and dirty state: Task 5.
- Syntax highlighting for the first language set: Task 5 language mapping.
- Find in file: Task 6.
- Project filename search: Tasks 2 and 7.
- Full-text search: Tasks 2 and 7.
- File create, rename, delete, and reveal: Task 4.
- File watcher and external-change detection: Task 8.
- Large-file handling: Tasks 1 and 5.
- Browse, open, edit, and save source files: Tasks 4 and 5.
- Search across a medium workspace: Tasks 2, 7, and 9.
- External changes detected without corrupting open buffers: Task 8.
- Unsaved edits survive accidental tab close or app restart where practical: Task 5 localStorage drafts.

### Unfilled Marker Scan

The plan avoids unfilled implementation markers in executable steps. The Node 2 results step provides sample numeric values only to show the required shape; the executor must replace them with measured values before committing the result file. The docs check rejects symbolic angle-bracket fields.

### Type Consistency

- Rust command names use snake_case Tauri commands.
- TypeScript wrappers use camelCase while sending snake_case command names.
- `FileVersion.modified_ms` and `FileVersion.len` mirror Rust serialization.
- `TextFileRead.too_large` mirrors Rust serialization.
- `EditorFileState.tabs` and `EditorFileState.activePath` are added to per-workspace view state and updated through `updateEditor`.
- Search payloads use `filename_matches`, `text_matches`, `line_number`, and `truncated` to mirror Rust serialization.
