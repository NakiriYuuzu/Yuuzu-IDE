# Git Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Node 4 daily Git workflow so a workspace can stage, unstage, diff, commit, amend, stash, switch branches, fetch, pull, push, inspect commit history, and see Git decorations without leaving Yuuzu-IDE.

**Architecture:** Rust owns Git CLI execution, repository trust checks, path containment, destructive-command guards, and bounded payloads. React owns source-control presentation, small view state, command dispatch, confirmation dialogs, and rendering of bounded status, diff, and graph data from Rust. The implementation follows `docs/ui-design/` for Source Control, Git graph, status colors, rail badge, and compact workbench density.

**Tech Stack:** Tauri 2 Rust commands, `std::process::Command` with `git`, Vite 8, React 19, TypeScript 6, Zustand, lucide-react, Bun tests, Cargo tests.

---

## Source Material

- `roadmap.md` Node 4: source-control loop, stage, unstage, commit, amend, stash, diff, branch, fetch, pull, push, graph, decorations, destructive guardrails.
- `docs/architecture/tech-stack.md`: Git orchestration lives in Rust and uses the Git CLI first.
- `docs/ui-design/panels.jsx`: Source Control panel layout, commit message textarea, staged and unstaged rows, commit and refresh actions.
- `docs/ui-design/scenes.jsx`: Git graph surface, branch badge, fetch and all-branches actions, compact table.
- `docs/ui-design/ide.css`: Git status colors `git-M`, `git-A`, `git-D`, `git-U`, `dbgrid gitgraph`, and diff styling.
- `docs/ui-design/app.jsx`: Source Control activity item and command palette Git graph command.

## File Structure

- Create `src-tauri/src/git.rs`: Git data types, CLI runner, status parsing, diff parsing, staging, committing, stash, branch, fetch, pull, push, graph, destructive-operation confirmation, and Rust tests.
- Modify `src-tauri/src/commands.rs`: Tauri command wrappers that validate registered workspaces through `AppState::trusted_workspace_root` and delegate to `git.rs`.
- Modify `src-tauri/src/lib.rs`: register the Node 4 Git commands.
- Create `src/features/git/git-api.ts`: typed Tauri calls and event-free async API boundary.
- Create `src/features/git/git-model.ts`: pure state transitions, grouping, badge counts, branch labels, diff selection, confirmation descriptors, decoration maps, and bounded graph helpers.
- Create `src/features/git/git-model.test.ts`: Bun tests for the pure frontend Git model.
- Create `src/features/git/GitPanel.tsx`: Source Control panel matching `docs/ui-design/panels.jsx`.
- Create `src/features/git/GitDiffView.tsx`: unified diff surface for selected file changes.
- Create `src/features/git/GitGraphView.tsx`: commit graph surface matching `docs/ui-design/scenes.jsx`.
- Modify `src/app/workspace-view-state.ts`: add `git: GitViewState` and surfaces `git-diff` and `git-graph`.
- Modify `src/app/activity-rail.tsx`: accept dynamic badge counts and render Git count from state.
- Modify `src/app/AppShell.tsx`: wire Git state loading, file watcher refresh, source-control panel, diff and graph surfaces, command palette action, status bar branch, tab decorations, and confirmation flows.
- Modify `src/features/workspace/FileTreePanel.tsx`: accept a Git decoration map and show compact status tokens beside files.
- Modify `src/features/workspace/file-tree-model.ts`: add pure decoration helpers for file-tree rows.
- Modify `src/index.css`: add compact Git panel, diff, graph, confirmation, and decoration styles that align with `docs/ui-design/ide.css`.
- Create `docs/architecture/node-4-git-results.md`: evidence and measurements after implementation.
- Modify `docs/architecture/progress.md`: append Node 4 status and verification.
- Modify `roadmap.md`: mark Node 4 complete and move current priority to Node 5 after verification.

## Shared Command Contract

Rust command payloads must use these names so frontend and backend tasks stay aligned:

```rust
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GitRepositoryStatus {
    pub workspace_root: String,
    pub repository_root: String,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub clean: bool,
    pub has_conflicts: bool,
    pub changes: Vec<GitFileStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GitFileStatus {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub kind: GitChangeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GitDiff {
    pub path: String,
    pub original_path: Option<String>,
    pub staged: bool,
    pub binary: bool,
    pub truncated: bool,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GitCommitSummary {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub when: String,
    pub refs: Vec<String>,
    pub lane: u8,
    pub merge: bool,
}
```

Tauri command names:

```text
git_status
git_diff_file
git_stage_paths
git_unstage_paths
git_discard_paths
git_commit
git_stash
git_list_branches
git_create_branch
git_checkout_branch
git_fetch
git_pull
git_push
git_commit_graph
git_reset_hard
git_rebase_onto
```

Destructive commands must reject calls unless the exact confirmation string is present:

```text
git_discard_paths: DISCARD
git_checkout_branch: CHECKOUT <branch-name>
git_reset_hard: RESET HARD
git_rebase_onto: REBASE <target-branch>
```

## Execution Rules

- Execute tasks in order.
- Each task uses a fresh implementer subagent, then a spec-compliance reviewer, then a code-quality reviewer.
- Every behavior change needs red, green, and refactor evidence in the implementer final report.
- Each task commits only its scoped files after verification.
- Run `git status --short` before each subagent task and after each task commit.
- Do not use `git2` or `gix` in Node 4; the stack decision is Git CLI first.
- Keep payloads bounded: status uses all changed paths, diff raw output is capped at 240 KiB, graph is capped at 120 commits.
- Normal browser smoke cannot execute Tauri IPC; browser checks must be reported as UI rendering smoke only unless a Tauri runtime is used.

---

### Task 1: Rust Git Status And Diff Domain

**Files:**
- Create: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/git.rs`

- [ ] **Step 1: Write failing Rust tests for repository status, path containment, and diff bounds**

Add these tests inside `#[cfg(test)] mod tests` in `src-tauri/src/git.rs`:

```rust
#[test]
fn parses_porcelain_status_with_staged_unstaged_untracked_and_renamed_paths() {
    let raw = b"## main...origin/main [ahead 2, behind 1]\0M  src/lib.rs\0 M README.md\0?? notes/new.md\0R  old.rs\0new.rs\0";
    let status = parse_status_output("/workspace", "/workspace", raw).expect("status parses");

    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.upstream.as_deref(), Some("origin/main"));
    assert_eq!(status.ahead, 2);
    assert_eq!(status.behind, 1);
    assert!(!status.clean);
    assert_eq!(status.changes.len(), 4);
    assert_eq!(status.changes[0].path, "src/lib.rs");
    assert_eq!(status.changes[0].kind, GitChangeKind::Modified);
    assert_eq!(status.changes[2].kind, GitChangeKind::Untracked);
    assert_eq!(status.changes[3].original_path.as_deref(), Some("old.rs"));
}

#[test]
fn rejects_paths_that_escape_repository_root() {
    let repo = std::path::PathBuf::from("/workspace/project");

    let error = normalize_repo_relative_paths(&repo, &["../secret.txt".to_string()])
        .expect_err("escaping path is rejected");

    assert!(error.contains("outside repository"));
}

#[test]
fn caps_text_diff_payloads_and_marks_truncated() {
    let raw = format!("diff --git a/a.txt b/a.txt\n{}", "+line\n".repeat(80_000));
    let diff = bounded_diff("a.txt", None, false, raw.as_bytes(), 240 * 1024);

    assert!(diff.truncated);
    assert!(diff.raw.len() <= 240 * 1024 + "... diff truncated ...\n".len());
}
```

- [ ] **Step 2: Run the Rust test and capture red evidence**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests::parses_porcelain_status_with_staged_unstaged_untracked_and_renamed_paths -- --exact
```

Expected: FAIL because `src-tauri/src/git.rs` and `parse_status_output` do not exist.

- [ ] **Step 3: Implement the minimal Git status and diff domain**

Create `src-tauri/src/git.rs` with:

```rust
use std::{
    ffi::OsStr,
    path::{Component, Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

pub const GIT_DIFF_LIMIT_BYTES: usize = 240 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitRepositoryStatus {
    pub workspace_root: String,
    pub repository_root: String,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub clean: bool,
    pub has_conflicts: bool,
    pub changes: Vec<GitFileStatus>,
}
```

Add the full shared command contract types from this plan, then implement:

```rust
pub fn repository_status(workspace_root: &Path) -> Result<GitRepositoryStatus, String>;
pub fn diff_file(workspace_root: &Path, path: &str, staged: bool) -> Result<GitDiff, String>;
pub(crate) fn parse_status_output(
    workspace_root: &str,
    repository_root: &str,
    output: &[u8],
) -> Result<GitRepositoryStatus, String>;
pub(crate) fn normalize_repo_relative_paths(
    repository_root: &Path,
    paths: &[String],
) -> Result<Vec<PathBuf>, String>;
pub(crate) fn bounded_diff(
    path: &str,
    original_path: Option<String>,
    staged: bool,
    output: &[u8],
    limit: usize,
) -> GitDiff;
```

`repository_status` must run:

```text
git -C <workspace_root> rev-parse --show-toplevel
git -C <repo_root> status --porcelain=v1 -z -b
```

`diff_file` must run:

```text
git -C <repo_root> diff --no-ext-diff --no-color -- <path>
git -C <repo_root> diff --cached --no-ext-diff --no-color -- <path>
```

Add `pub mod git;` to `src-tauri/src/lib.rs`.

Add command wrappers in `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn git_status(
    state: State<'_, AppState>,
    workspace_root: String,
) -> Result<crate::git::GitRepositoryStatus, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::repository_status(&workspace_root)
}

#[tauri::command]
pub fn git_diff_file(
    state: State<'_, AppState>,
    workspace_root: String,
    path: String,
    staged: bool,
) -> Result<crate::git::GitDiff, String> {
    let workspace_root = state.trusted_workspace_root(&workspace_root)?;
    crate::git::diff_file(&workspace_root, &path, staged)
}
```

Register `git_status` and `git_diff_file` in the Tauri invoke handler in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Run focused Rust tests and capture green evidence**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests -- --nocapture
```

Expected: PASS for the new `git::tests`.

- [ ] **Step 5: Refactor and run formatting**

Run:

```bash
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: PASS. If it fails, run `cargo fmt --manifest-path src-tauri/Cargo.toml`, then rerun the check and include both commands in evidence.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src-tauri/src/git.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add git status and diff core"
```

Expected: commit succeeds and `git status --short` is clean.

---

### Task 2: Rust Git Mutations, Branches, Graph, And Guardrails

**Files:**
- Modify: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/git.rs`

- [ ] **Step 1: Write failing Rust tests for mutation commands and confirmations**

Add tests that create a real temporary Git repository:

```rust
#[test]
fn stages_unstages_commits_and_lists_graph_in_temp_repository() {
    let repo = TempGitRepo::new();
    repo.write_file("README.md", "initial\n");
    repo.run(["add", "README.md"]);
    repo.run(["commit", "-m", "initial"]);
    repo.write_file("README.md", "changed\n");

    stage_paths(repo.path(), &["README.md".to_string()]).expect("stage succeeds");
    let status = repository_status(repo.path()).expect("status after stage");
    assert_eq!(status.changes[0].index_status, "M");

    unstage_paths(repo.path(), &["README.md".to_string()]).expect("unstage succeeds");
    let status = repository_status(repo.path()).expect("status after unstage");
    assert_eq!(status.changes[0].worktree_status, "M");

    stage_paths(repo.path(), &["README.md".to_string()]).expect("restage succeeds");
    commit(repo.path(), "feat: update readme", false, false).expect("commit succeeds");
    let graph = commit_graph(repo.path(), 20).expect("graph loads");
    assert_eq!(graph[0].subject, "feat: update readme");
}

#[test]
fn destructive_commands_require_exact_confirmation() {
    let repo = TempGitRepo::new();
    repo.write_file("README.md", "initial\n");
    repo.run(["add", "README.md"]);
    repo.run(["commit", "-m", "initial"]);
    repo.write_file("README.md", "changed\n");

    let error = discard_paths(repo.path(), &["README.md".to_string()], "")
        .expect_err("missing confirmation is rejected");
    assert!(error.contains("confirmation"));

    discard_paths(repo.path(), &["README.md".to_string()], "DISCARD")
        .expect("confirmed discard succeeds");
    assert_eq!(repo.read_file("README.md"), "initial\n");
}

#[test]
fn checkout_reset_and_rebase_require_confirmation_text() {
    let repo = TempGitRepo::new();
    repo.write_file("README.md", "initial\n");
    repo.run(["add", "README.md"]);
    repo.run(["commit", "-m", "initial"]);
    create_branch(repo.path(), "topic").expect("branch creates");

    assert!(checkout_branch(repo.path(), "topic", "CHECKOUT main").is_err());
    assert!(reset_hard(repo.path(), "").is_err());
    assert!(rebase_onto(repo.path(), "main", "REBASE topic").is_err());
}
```

Use this helper inside the test module:

```rust
struct TempGitRepo {
    dir: tempfile::TempDir,
}

impl TempGitRepo {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Self { dir };
        repo.run(["init"]);
        repo.run(["config", "user.email", "yuuzu@example.test"]);
        repo.run(["config", "user.name", "Yuuzu Test"]);
        repo
    }

    fn path(&self) -> &std::path::Path {
        self.dir.path()
    }

    fn run<const N: usize>(&self, args: [&str; N]) {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(self.path())
            .args(args)
            .output()
            .expect("git runs");
        assert!(output.status.success(), "git failed: {}", String::from_utf8_lossy(&output.stderr));
    }

    fn write_file(&self, path: &str, content: &str) {
        std::fs::write(self.path().join(path), content).expect("write file");
    }

    fn read_file(&self, path: &str) -> String {
        std::fs::read_to_string(self.path().join(path)).expect("read file")
    }
}
```

- [ ] **Step 2: Run mutation tests and capture red evidence**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests::stages_unstages_commits_and_lists_graph_in_temp_repository -- --exact
```

Expected: FAIL because `stage_paths`, `commit`, and `commit_graph` are missing.

- [ ] **Step 3: Implement Git mutations and graph**

Add these functions to `src-tauri/src/git.rs`:

```rust
pub fn stage_paths(workspace_root: &Path, paths: &[String]) -> Result<GitRepositoryStatus, String>;
pub fn unstage_paths(workspace_root: &Path, paths: &[String]) -> Result<GitRepositoryStatus, String>;
pub fn discard_paths(workspace_root: &Path, paths: &[String], confirmation: &str) -> Result<GitRepositoryStatus, String>;
pub fn commit(workspace_root: &Path, message: &str, amend: bool, push_after: bool) -> Result<GitRepositoryStatus, String>;
pub fn stash(workspace_root: &Path, message: &str, include_untracked: bool) -> Result<GitRepositoryStatus, String>;
pub fn list_branches(workspace_root: &Path) -> Result<Vec<GitBranch>, String>;
pub fn create_branch(workspace_root: &Path, name: &str) -> Result<Vec<GitBranch>, String>;
pub fn checkout_branch(workspace_root: &Path, name: &str, confirmation: &str) -> Result<GitRepositoryStatus, String>;
pub fn fetch(workspace_root: &Path) -> Result<GitRepositoryStatus, String>;
pub fn pull(workspace_root: &Path) -> Result<GitRepositoryStatus, String>;
pub fn push(workspace_root: &Path) -> Result<GitRepositoryStatus, String>;
pub fn commit_graph(workspace_root: &Path, limit: usize) -> Result<Vec<GitCommitSummary>, String>;
pub fn reset_hard(workspace_root: &Path, confirmation: &str) -> Result<GitRepositoryStatus, String>;
pub fn rebase_onto(workspace_root: &Path, target: &str, confirmation: &str) -> Result<GitRepositoryStatus, String>;
```

Use these Git invocations:

```text
git -C <repo_root> add -- <paths>
git -C <repo_root> restore --staged -- <paths>
git -C <repo_root> restore -- <paths>
git -C <repo_root> commit -m <message>
git -C <repo_root> commit --amend -m <message>
git -C <repo_root> stash push -m <message>
git -C <repo_root> stash push -u -m <message>
git -C <repo_root> branch --format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(objectname:short)
git -C <repo_root> branch <name>
git -C <repo_root> checkout <name>
git -C <repo_root> fetch --prune
git -C <repo_root> pull --ff-only
git -C <repo_root> push
git -C <repo_root> log --graph --decorate=short --date=relative --pretty=format:%H%x00%h%x00%s%x00%an%x00%ar%x00%D -n <limit>
git -C <repo_root> reset --hard
git -C <repo_root> rebase <target>
```

Add command wrappers for all Task 2 functions in `src-tauri/src/commands.rs` and register them in `src-tauri/src/lib.rs`.

Reject blank commit messages before running Git:

```rust
if message.trim().is_empty() {
    return Err("commit message is required".to_string());
}
```

- [ ] **Step 4: Run focused mutation tests and capture green evidence**

Run:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests -- --nocapture
```

Expected: PASS for all Git tests.

- [ ] **Step 5: Run Rust command-suite checks**

Run:

```bash
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Expected: both commands PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src-tauri/src/git.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add git workflow commands"
```

Expected: commit succeeds and `git status --short` is clean.

---

### Task 3: Frontend Git API And Pure Model

**Files:**
- Create: `src/features/git/git-api.ts`
- Create: `src/features/git/git-model.ts`
- Create: `src/features/git/git-model.test.ts`
- Modify: `src/app/workspace-view-state.ts`

- [ ] **Step 1: Write failing Bun tests for grouping, badges, confirmations, branch labels, and decorations**

Create `src/features/git/git-model.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  changeBadgeCount,
  confirmationTextForGitAction,
  createGitState,
  decorationMapFromStatus,
  groupGitChanges,
  replaceGitStatus,
  selectDiff,
  statusBranchLabel,
} from "./git-model";
import type { GitRepositoryStatus } from "./git-model";

const status: GitRepositoryStatus = {
  workspace_root: "/workspace",
  repository_root: "/workspace",
  branch: "main",
  upstream: "origin/main",
  ahead: 2,
  behind: 1,
  clean: false,
  has_conflicts: true,
  changes: [
    { path: "src/app.ts", original_path: null, index_status: "M", worktree_status: " ", kind: "modified" },
    { path: "README.md", original_path: null, index_status: " ", worktree_status: "M", kind: "modified" },
    { path: "new.md", original_path: null, index_status: "?", worktree_status: "?", kind: "untracked" },
    { path: "conflict.ts", original_path: null, index_status: "U", worktree_status: "U", kind: "conflict" },
  ],
};

describe("git-model", () => {
  test("splits staged and unstaged changes without dropping conflicts", () => {
    const grouped = groupGitChanges(status.changes);

    expect(grouped.staged.map((change) => change.path)).toEqual(["src/app.ts"]);
    expect(grouped.unstaged.map((change) => change.path)).toEqual(["README.md", "new.md", "conflict.ts"]);
    expect(grouped.conflicts.map((change) => change.path)).toEqual(["conflict.ts"]);
  });

  test("counts rail badge from all status changes", () => {
    expect(changeBadgeCount(status)).toBe("4");
    expect(changeBadgeCount({ ...status, clean: true, changes: [] })).toBeNull();
  });

  test("formats branch label with upstream divergence", () => {
    expect(statusBranchLabel(status)).toBe("main ahead 2 behind 1");
  });

  test("creates confirmation text for destructive git actions", () => {
    expect(confirmationTextForGitAction({ kind: "discard", paths: ["README.md"] })).toBe("DISCARD");
    expect(confirmationTextForGitAction({ kind: "checkout", branch: "topic" })).toBe("CHECKOUT topic");
    expect(confirmationTextForGitAction({ kind: "reset-hard" })).toBe("RESET HARD");
    expect(confirmationTextForGitAction({ kind: "rebase", target: "main" })).toBe("REBASE main");
  });

  test("creates file decoration map using compact status tokens", () => {
    expect(decorationMapFromStatus(status)).toEqual({
      "src/app.ts": "M",
      "README.md": "M",
      "new.md": "A",
      "conflict.ts": "U",
    });
  });

  test("stores selected diff state", () => {
    const state = selectDiff(createGitState(), { path: "README.md", staged: false });

    expect(state.selectedDiff).toEqual({ path: "README.md", staged: false });
  });

  test("replaces status and preserves commit message", () => {
    const state = replaceGitStatus({ ...createGitState(), commitMessage: "feat: ui" }, status);

    expect(state.status?.branch).toBe("main");
    expect(state.commitMessage).toBe("feat: ui");
  });
});
```

- [ ] **Step 2: Run Bun model tests and capture red evidence**

Run:

```bash
bun test src/features/git/git-model.test.ts
```

Expected: FAIL because `git-model.ts` does not exist.

- [ ] **Step 3: Implement typed API and pure model**

Create `src/features/git/git-api.ts`:

```ts
import { call } from "../../lib/tauri";
import type {
  GitBranch,
  GitCommitSummary,
  GitDiff,
  GitRepositoryStatus,
} from "./git-model";

export function getGitStatus(workspaceRoot: string): Promise<GitRepositoryStatus> {
  return call("git_status", { workspaceRoot });
}
```

Add wrappers for all command names from the shared command contract. Use camelCase argument names matching Tauri's JavaScript side:

```ts
export function getGitDiffFile(workspaceRoot: string, path: string, staged: boolean): Promise<GitDiff> {
  return call("git_diff_file", { workspaceRoot, path, staged });
}

export function stageGitPaths(workspaceRoot: string, paths: string[]): Promise<GitRepositoryStatus> {
  return call("git_stage_paths", { workspaceRoot, paths });
}
```

Create `src/features/git/git-model.ts` with exported types matching Rust snake-case JSON fields:

```ts
export type GitChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflict";

export type GitFileStatus = {
  path: string;
  original_path: string | null;
  index_status: string;
  worktree_status: string;
  kind: GitChangeKind;
};
```

Implement `GitViewState`, `createGitState`, `replaceGitStatus`, `setGitLoading`, `setGitError`, `setCommitMessage`, `selectDiff`, `storeDiff`, `storeBranches`, `storeGraph`, `groupGitChanges`, `changeBadgeCount`, `statusBranchLabel`, `confirmationTextForGitAction`, and `decorationMapFromStatus`.

Modify `src/app/workspace-view-state.ts`:

```ts
import { createGitState, type GitViewState } from "../features/git/git-model";

export type Surface = "empty" | "editor" | "terminal" | "git-diff" | "git-graph";

export type WorkspaceViewState = {
  activeActivity: ActivityId;
  panelOpen: boolean;
  surface: Surface;
  editor: EditorFileState;
  terminal: TerminalViewState;
  task: TaskViewState;
  git: GitViewState;
};
```

Add `git: createGitState()` to `defaultWorkspaceView`, freeze the Git arrays and maps in `freezeWorkspaceView`, and add `updateGit(workspaceId, update)` to the store API.

- [ ] **Step 4: Run frontend model tests and capture green evidence**

Run:

```bash
bun test src/features/git/git-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript build check**

Run:

```bash
bun run build
```

Expected: PASS. A Vite chunk-size warning is acceptable if build exits 0.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/features/git/git-api.ts src/features/git/git-model.ts src/features/git/git-model.test.ts src/app/workspace-view-state.ts
git commit -m "feat: add git frontend state model"
```

Expected: commit succeeds and `git status --short` is clean.

---

### Task 4: Source Control Panel UI And Daily Commit Flow

**Files:**
- Create: `src/features/git/GitPanel.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/activity-rail.tsx`
- Modify: `src/index.css`
- Test: `src/features/git/git-model.test.ts`

- [ ] **Step 1: Write failing frontend tests for commit flow enablement and action labels**

Append tests to `src/features/git/git-model.test.ts`:

```ts
import {
  canCommit,
  gitActionLabel,
  updateGitCommitMessage,
} from "./git-model";

test("commit is enabled only when staged changes and a message exist", () => {
  const withStatus = replaceGitStatus(createGitState(), status);

  expect(canCommit(withStatus)).toBe(false);
  expect(canCommit(updateGitCommitMessage(withStatus, "feat: git panel"))).toBe(true);
  expect(canCommit(updateGitCommitMessage(replaceGitStatus(createGitState(), { ...status, changes: [] }), "feat: none"))).toBe(false);
});

test("git action labels match the Source Control panel commands", () => {
  expect(gitActionLabel("commit")).toBe("Commit");
  expect(gitActionLabel("commit-push")).toBe("Commit & Push");
  expect(gitActionLabel("amend")).toBe("Amend");
  expect(gitActionLabel("stash")).toBe("Stash");
});
```

- [ ] **Step 2: Run the focused frontend test and capture red evidence**

Run:

```bash
bun test src/features/git/git-model.test.ts
```

Expected: FAIL because `canCommit`, `updateGitCommitMessage`, and `gitActionLabel` are missing.

- [ ] **Step 3: Implement the Git panel and wire Source Control actions**

Create `src/features/git/GitPanel.tsx` with props:

```ts
type GitPanelProps = {
  state: GitViewState;
  onRefresh: () => void;
  onCommitMessageChange: (message: string) => void;
  onCommit: (options: { amend: boolean; pushAfter: boolean }) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  onOpenDiff: (path: string, staged: boolean) => void;
  onStash: () => void;
  onOpenGraph: () => void;
};
```

The rendered structure must include:

```tsx
<div className="git-panel">
  <div className="git-panel-header">
    <span>Source Control</span>
    <button type="button" title="Commit">...</button>
    <button type="button" title="Refresh">...</button>
    <button type="button" title="View graph">...</button>
  </div>
  <textarea aria-label="Commit message" />
  <button type="button">Commit &amp; Push</button>
  <section aria-label="Staged Changes">...</section>
  <section aria-label="Changes">...</section>
</div>
```

Use lucide icons from the existing dependency: `Check`, `GitGraph`, `RefreshCw`, `Plus`, `Minus`, `RotateCcw`, `Archive`, `Upload`. Do not generate raster icons for this panel because the existing icon system covers these commands.

Modify `src/app/activity-rail.tsx` so `ActivityRail` accepts `badges?: Partial<Record<ActivityId, string | null>>` and uses the dynamic Git badge.

Modify `src/app/AppShell.tsx`:

- Load Git status when an active workspace is present.
- Render `GitPanel` when `active === "git"`.
- Map panel actions to `git-api.ts` calls.
- After stage, unstage, discard, commit, amend, stash, fetch, pull, and push, replace Git status with the command result.
- Commit with `pushAfter: true` when the main button is clicked.
- Keep a secondary amend action visible in the panel toolbar or row action menu.
- Show errors in a compact `.git-error` region.

Modify `src/index.css` with compact panel styles using existing tokens:

```css
.git-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.git-panel-header { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border-bottom: 1px solid var(--border); }
.git-change-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 26px; padding: 0 10px; }
.git-token-M { color: #e2b341; }
.git-token-A { color: #57ab5a; }
.git-token-D { color: #e5534b; }
.git-token-U { color: #6cb6ff; }
```

- [ ] **Step 4: Run frontend tests and build**

Run:

```bash
bun test src/features/git/git-model.test.ts
bun run build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/features/git/GitPanel.tsx src/app/AppShell.tsx src/app/activity-rail.tsx src/index.css src/features/git/git-model.ts src/features/git/git-model.test.ts
git commit -m "feat: add source control panel"
```

Expected: commit succeeds and `git status --short` is clean.

---

### Task 5: Diff View, Branch Controls, And Commit Graph Surface

**Files:**
- Create: `src/features/git/GitDiffView.tsx`
- Create: `src/features/git/GitGraphView.tsx`
- Modify: `src/features/git/GitPanel.tsx`
- Modify: `src/features/git/git-model.ts`
- Modify: `src/features/git/git-model.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing frontend tests for diff storage, branch lists, and graph bounds**

Append tests to `src/features/git/git-model.test.ts`:

```ts
import {
  boundedGraph,
  branchCheckoutConfirmation,
  storeBranches,
  storeDiff,
  storeGraph,
} from "./git-model";

test("stores loaded diff by path and staged flag", () => {
  const state = storeDiff(createGitState(), {
    path: "README.md",
    original_path: null,
    staged: false,
    binary: false,
    truncated: false,
    raw: "diff --git a/README.md b/README.md\n+changed\n",
  });

  expect(state.diffByKey["unstaged:README.md"]?.raw).toContain("+changed");
});

test("keeps current branch first in branch controls", () => {
  const state = storeBranches(createGitState(), [
    { name: "topic", current: false, remote: false, upstream: null },
    { name: "main", current: true, remote: false, upstream: "origin/main" },
  ]);

  expect(state.branches.map((branch) => branch.name)).toEqual(["main", "topic"]);
});

test("bounds graph rows to 120 commits", () => {
  const graph = Array.from({ length: 125 }, (_, index) => ({
    hash: `${index}`,
    short_hash: `${index}`,
    subject: `commit ${index}`,
    author: "Yuuzu",
    when: "1 minute ago",
    refs: [],
    lane: 0,
    merge: false,
  }));

  expect(boundedGraph(graph)).toHaveLength(120);
});

test("formats checkout confirmation text from target branch", () => {
  expect(branchCheckoutConfirmation("feature/git")).toBe("CHECKOUT feature/git");
});
```

- [ ] **Step 2: Run focused test and capture red evidence**

Run:

```bash
bun test src/features/git/git-model.test.ts
```

Expected: FAIL because diff, branch, and graph helpers are missing.

- [ ] **Step 3: Implement diff and graph surfaces**

Create `src/features/git/GitDiffView.tsx`:

```tsx
type GitDiffViewProps = {
  diff: GitDiff | null;
  selectedPath: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};
```

Render a compact toolbar, path, staged or unstaged badge, binary message for `binary`, truncated notice for `truncated`, and line-oriented unified diff with classes:

```css
.git-diff-line-add
.git-diff-line-del
.git-diff-line-hunk
.git-diff-line-context
```

Create `src/features/git/GitGraphView.tsx`:

```tsx
type GitGraphViewProps = {
  graph: GitCommitSummary[];
  branchLabel: string;
  loading: boolean;
  error: string | null;
  onFetch: () => void;
  onRefresh: () => void;
};
```

Use a table structure with graph, description, author, when, and commit columns. Use `GitGraph`, `GitBranch`, `Download`, and `History` lucide icons.

Modify `src/features/git/GitPanel.tsx`:

- Add branch select populated from `state.branches`.
- Add create branch input.
- Add buttons for fetch, pull, push, and stash.
- Checkout branch calls the confirmation flow when target branch differs from current branch.

Modify `src/app/AppShell.tsx`:

- Add surfaces `git-diff` and `git-graph`.
- Load diffs through `getGitDiffFile` when selected.
- Load branches through `listGitBranches` after status refresh.
- Load graph through `getGitCommitGraph` when graph opens.
- Add command palette entry `Git: Open Commit Graph`.

- [ ] **Step 4: Run tests and build**

Run:

```bash
bun test src/features/git/git-model.test.ts
bun run build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add src/features/git/GitDiffView.tsx src/features/git/GitGraphView.tsx src/features/git/GitPanel.tsx src/features/git/git-model.ts src/features/git/git-model.test.ts src/app/AppShell.tsx src/index.css
git commit -m "feat: add git diff and graph views"
```

Expected: commit succeeds and `git status --short` is clean.

---

### Task 6: Git Decorations, External Refresh, And Destructive Confirmations

**Files:**
- Modify: `src/features/workspace/file-tree-model.ts`
- Modify: `src/features/workspace/file-tree-model.test.ts`
- Modify: `src/features/workspace/FileTreePanel.tsx`
- Modify: `src/features/git/git-model.ts`
- Modify: `src/features/git/git-model.test.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing tests for decoration lookup and refresh decisions**

Append tests to `src/features/workspace/file-tree-model.test.ts`:

```ts
import { gitDecorationForPath } from "./file-tree-model";

test("returns git decoration for exact file path", () => {
  expect(gitDecorationForPath({ "src/main.ts": "M" }, "src/main.ts")).toBe("M");
});

test("returns no git decoration for undecorated path", () => {
  expect(gitDecorationForPath({ "src/main.ts": "M" }, "src/other.ts")).toBeNull();
});
```

Append tests to `src/features/git/git-model.test.ts`:

```ts
import {
  shouldRefreshGitAfterFileEvent,
  shouldRefreshGitAfterTask,
} from "./git-model";

test("refreshes git after file watcher events in active workspace", () => {
  expect(shouldRefreshGitAfterFileEvent({
    activeWorkspaceId: "w1",
    eventWorkspaceId: "w1",
    path: "README.md",
  })).toBe(true);
});

test("does not refresh git for ignored internal git files", () => {
  expect(shouldRefreshGitAfterFileEvent({
    activeWorkspaceId: "w1",
    eventWorkspaceId: "w1",
    path: ".git/index.lock",
  })).toBe(false);
});

test("refreshes git after completed task runs because external commands may change repository state", () => {
  expect(shouldRefreshGitAfterTask({ activeWorkspaceId: "w1", runWorkspaceId: "w1", exitCode: 0 })).toBe(true);
});
```

- [ ] **Step 2: Run focused tests and capture red evidence**

Run:

```bash
bun test src/features/workspace/file-tree-model.test.ts src/features/git/git-model.test.ts
```

Expected: FAIL because decoration and refresh helpers are missing.

- [ ] **Step 3: Implement decorations, refresh triggers, and confirmation dialog**

Modify `src/features/workspace/file-tree-model.ts`:

```ts
export type GitDecorationMap = Record<string, "M" | "A" | "D" | "U">;

export function gitDecorationForPath(
  decorations: GitDecorationMap,
  path: string,
): GitDecorationMap[string] | null {
  return decorations[path] ?? null;
}
```

Modify `src/features/workspace/FileTreePanel.tsx`:

- Add prop `gitDecorations?: GitDecorationMap`.
- Render a compact status token at the end of file rows when `gitDecorationForPath` returns a token.
- Keep row height stable at the current file-tree density.

Modify `src/app/AppShell.tsx`:

- Pass `decorationMapFromStatus(view.git.status)` into `FileTreePanel`.
- Render Git token on editor tabs when a tab path has a decoration.
- Refresh Git status after file watcher events for the active workspace.
- Refresh Git status after task completion in the active workspace.
- Add an explicit confirmation dialog for discard, checkout, reset hard, and rebase actions. The dialog requires typing the exact confirmation text from `confirmationTextForGitAction` before enabling the action button.

Modify `src/index.css`:

```css
.git-decoration-token { font: 700 11px/1 var(--font-mono); min-width: 14px; text-align: center; }
.git-confirm-dialog { display: grid; gap: 10px; }
.git-confirm-danger { color: #e5534b; }
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
bun test src/features/workspace/file-tree-model.test.ts src/features/git/git-model.test.ts
bun run build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit Task 6**

Run:

```bash
git add src/features/workspace/file-tree-model.ts src/features/workspace/file-tree-model.test.ts src/features/workspace/FileTreePanel.tsx src/features/git/git-model.ts src/features/git/git-model.test.ts src/app/AppShell.tsx src/index.css
git commit -m "feat: add git decorations and safeguards"
```

Expected: commit succeeds and `git status --short` is clean.

---

### Task 7: Node 4 Verification, Measurements, And Documentation

**Files:**
- Create: `docs/architecture/node-4-git-results.md`
- Modify: `docs/architecture/progress.md`
- Modify: `roadmap.md`

- [ ] **Step 1: Run full automated verification**

Run:

```bash
bun test
bun run build
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml
. "$HOME/.cargo/env" && cargo fmt --manifest-path src-tauri/Cargo.toml --check
. "$HOME/.cargo/env" && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
. "$HOME/.cargo/env" && bun run tauri build --debug
```

Expected: all commands PASS. A Vite large chunk warning is acceptable only when the exit code is 0.

- [ ] **Step 2: Measure Git command behavior in a temporary repository**

Run focused Rust tests with visible timing:

```bash
. "$HOME/.cargo/env" && cargo test --manifest-path src-tauri/Cargo.toml git::tests -- --nocapture
```

Record:

```text
git status parse behavior: exact test names and pass count
git mutation behavior: exact test names and pass count
git destructive guard behavior: exact test names and pass count
diff cap: 240 KiB cap verified by test name
graph cap: 120 commits verified by frontend test name
```

- [ ] **Step 3: Run browser UI smoke for the Source Control panel**

Start the Vite dev server:

```bash
bun run dev --host 127.0.0.1 --port 1420
```

Use Playwright or the in-app Browser if available to load:

```text
http://127.0.0.1:1420/
```

Check:

```text
Source Control rail item is visible.
Source Control panel renders a commit message input.
Staged Changes and Changes sections render without overlapping text.
Git graph command opens the graph surface.
No visible Git control has width or height below 8 CSS pixels.
Normal browser Tauri IPC errors are reported separately from UI rendering.
```

Stop the dev server after smoke testing.

- [ ] **Step 4: Write Node 4 result documentation**

Create `docs/architecture/node-4-git-results.md` with:

```markdown
# Node 4 Git Workflows Results

## Scope Delivered

- Git status panel for staged, unstaged, untracked, deleted, renamed, and conflict changes.
- Stage, unstage, discard, commit, amend, stash, branch create, branch checkout, fetch, pull, push, diff, and commit graph commands.
- Git decorations in the explorer and editor tabs.
- Source-control refresh after file watcher events and completed task runs.
- Explicit confirmation for discard, checkout, reset hard, and rebase.

## Verification

| Check | Result |
| --- | --- |
| bun test | PASS |
| bun run build | PASS |
| cargo test | PASS |
| cargo fmt --check | PASS |
| cargo clippy -D warnings | PASS |
| tauri build --debug | PASS |
| browser UI smoke | PASS |

## TDD Evidence

- Task 1 red: include the exact command, the failing test name, and the missing symbol or file that caused the failure.
- Task 1 green: include the exact command, pass count, and elapsed time from the focused Git status tests.
- Task 2 red: include the exact command, the failing test name, and the missing mutation function that caused the failure.
- Task 2 green: include the exact command, pass count, and elapsed time from the focused Git mutation tests.
- Task 3 red: include the exact command, the failing import or missing export, and the test file name.
- Task 3 green: include the exact command, pass count, and elapsed time from the Git model tests.
- Task 4 red: include the exact command, the missing commit-flow helper, and the test file name.
- Task 4 green: include the exact command, pass count, and build result.
- Task 5 red: include the exact command, the missing diff, branch, or graph helper, and the test file name.
- Task 5 green: include the exact command, pass count, and build result.
- Task 6 red: include the exact command, the missing decoration or refresh helper, and the test file name.
- Task 6 green: include the exact command, pass count, and build result.

## Measurements

| Measurement | Result |
| --- | --- |
| Git status temp repository test | Use the elapsed time from the focused Rust Git test command. |
| Git diff cap | 240 KiB |
| Commit graph cap | 120 commits |
| Browser Source Control smoke | Record the rendered Source Control, diff, and graph observations from Step 3. |

## Residual Risks

- Normal browser smoke cannot execute Tauri IPC commands.
- Pull, push, fetch, and rebase behavior is covered by command construction and guard tests; remote network behavior depends on the user's configured remotes.
```

- [ ] **Step 5: Update progress and roadmap**

Modify `docs/architecture/progress.md`:

```markdown
## Node 4: Git Workflows

Status: Complete.

Evidence:
- `docs/architecture/node-4-git-results.md`
- `bun test`
- `bun run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- `bun run tauri build --debug`
```

Modify `roadmap.md` current priority:

```markdown
Node 0, Node 1, Node 2, Node 3, and Node 4 are complete. The next active priority is
Node 5: ...
```

Use the Node 5 title from the roadmap and do not alter Node 5 scope.

- [ ] **Step 6: Scan docs and commit Task 7**

Run:

```bash
rg -n 'T[B]D|T[O]DO|F[I]XME|<[^>]+>' docs/architecture/node-4-git-results.md docs/architecture/progress.md roadmap.md
git diff --check
```

Expected: `rg` returns no output and `git diff --check` returns no output.

Commit:

```bash
git add docs/architecture/node-4-git-results.md docs/architecture/progress.md roadmap.md
git commit -m "docs: record node 4 git results"
```

Expected: commit succeeds and `git status --short` is clean.

---

## Acceptance Mapping

- Normal edit-test-commit-push cycle inside app: Tasks 2, 3, 4, and 7.
- Diff and source-control state update after file edits and external Git commands: Tasks 1, 5, 6, and 7.
- Destructive operations require explicit confirmation: Tasks 2, 3, 6, and 7.
- Commit graph: Tasks 2, 5, and 7.
- Git decorations in explorer and tabs: Task 6.
- Non-goal boundary for complex merge UI and PR integration: no task adds merge editor UI, PR APIs, or provider integration.

## Plan Self-Review

- Spec coverage: every Node 4 scope item maps to at least one task in Acceptance Mapping.
- Red flag scan command:

```bash
python - <<'PY'
from pathlib import Path
patterns = ["T" + "BD", "T" + "ODO", "F" + "IXME", "place" + "holder", "similar" + " to", "add " + "appropriate", "write tests for the " + "above"]
text = Path("docs/superpowers/plans/2026-06-09-node-4-git-workflows.md").read_text()
for pattern in patterns:
    if pattern in text:
        print(pattern)
PY
```

- Type consistency: Rust and TypeScript both use snake-case JSON fields from the shared command contract; Tauri wrapper arguments use camelCase on the JavaScript side.
