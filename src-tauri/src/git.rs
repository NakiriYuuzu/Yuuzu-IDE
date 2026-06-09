use std::{
    path::{Component, Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

pub const GIT_DIFF_LIMIT_BYTES: usize = 240 * 1024;
const DIFF_TRUNCATED_MARKER: &str = "... diff truncated ...\n";

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitFileStatus {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub kind: GitChangeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitDiff {
    pub path: String,
    pub original_path: Option<String>,
    pub staged: bool,
    pub binary: bool,
    pub truncated: bool,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

pub fn repository_status(workspace_root: &Path) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let output = run_git(
        &repository_root,
        ["status", "--porcelain=v1", "-z", "-b"].iter(),
    )?;

    parse_status_output(
        &workspace_root.to_string_lossy(),
        &repository_root.to_string_lossy(),
        &output,
    )
}

pub fn diff_file(workspace_root: &Path, path: &str, staged: bool) -> Result<GitDiff, String> {
    let repository_root = repository_root(workspace_root)?;
    let paths = normalize_repo_relative_paths(&repository_root, &[path.to_string()])?;
    let normalized_path = paths
        .first()
        .ok_or_else(|| "git diff path is required".to_string())?;

    let mut command = Command::new("git");
    command.env("GIT_LITERAL_PATHSPECS", "1");
    command.arg("-C").arg(&repository_root).arg("diff");
    if staged {
        command.arg("--cached");
    }
    command
        .arg("--no-ext-diff")
        .arg("--no-color")
        .arg("--")
        .arg(normalized_path);

    let output = command.output().map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err(command_error("git diff", &output.stderr));
    }

    Ok(bounded_diff(
        &path_to_git_string(normalized_path),
        None,
        staged,
        &output.stdout,
        GIT_DIFF_LIMIT_BYTES,
    ))
}

pub(crate) fn parse_status_output(
    workspace_root: &str,
    repository_root: &str,
    output: &[u8],
) -> Result<GitRepositoryStatus, String> {
    let entries = output
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .map(|entry| String::from_utf8_lossy(entry).into_owned())
        .collect::<Vec<_>>();

    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changes = Vec::new();
    let mut index = 0;

    if let Some(first) = entries.first().filter(|entry| entry.starts_with("## ")) {
        (branch, upstream, ahead, behind) = parse_branch_status(first);
        index = 1;
    }

    while index < entries.len() {
        let entry = &entries[index];
        let Some((index_status, worktree_status, path)) = split_status_entry(entry) else {
            return Err(format!("invalid git status entry: {entry}"));
        };
        let kind = change_kind(index_status, worktree_status);
        let mut original_path = None;
        let current_path = path.to_string();

        if matches!(kind, GitChangeKind::Renamed | GitChangeKind::Copied) {
            index += 1;
            let Some(next_path) = entries.get(index) else {
                return Err(format!("missing original path for renamed file: {path}"));
            };
            original_path = Some(next_path.to_string());
        }

        changes.push(GitFileStatus {
            path: current_path,
            original_path,
            index_status: index_status.to_string(),
            worktree_status: worktree_status.to_string(),
            kind,
        });
        index += 1;
    }

    let has_conflicts = changes
        .iter()
        .any(|change| matches!(change.kind, GitChangeKind::Conflict));

    Ok(GitRepositoryStatus {
        workspace_root: workspace_root.to_string(),
        repository_root: repository_root.to_string(),
        branch,
        upstream,
        ahead,
        behind,
        clean: changes.is_empty(),
        has_conflicts,
        changes,
    })
}

pub(crate) fn normalize_repo_relative_paths(
    _repository_root: &Path,
    paths: &[String],
) -> Result<Vec<PathBuf>, String> {
    paths
        .iter()
        .map(|path| {
            if path.is_empty() {
                return Err("git path cannot be empty".to_string());
            }

            let path_ref = Path::new(path);
            if path_ref.is_absolute() {
                return Err(format!("git path is outside repository: {path}"));
            }

            let mut normalized = PathBuf::new();
            for component in path_ref.components() {
                match component {
                    Component::Normal(segment) => normalized.push(segment),
                    Component::CurDir => {}
                    Component::ParentDir => {
                        if !normalized.pop() {
                            return Err(format!("git path is outside repository: {path}"));
                        }
                    }
                    Component::RootDir | Component::Prefix(_) => {
                        return Err(format!("git path is outside repository: {path}"));
                    }
                }
            }

            if normalized.as_os_str().is_empty() {
                return Err("git path cannot be empty".to_string());
            }

            Ok(normalized)
        })
        .collect()
}

pub(crate) fn bounded_diff(
    path: &str,
    original_path: Option<String>,
    staged: bool,
    output: &[u8],
    limit: usize,
) -> GitDiff {
    let truncated = output.len() > limit;
    let visible_output = if truncated { &output[..limit] } else { output };
    let mut raw = String::from_utf8_lossy(visible_output).into_owned();
    if truncated {
        raw.push_str(DIFF_TRUNCATED_MARKER);
    }
    let binary = is_binary_diff(&raw);

    GitDiff {
        path: path.to_string(),
        original_path,
        staged,
        binary,
        truncated,
        raw,
    }
}

fn repository_root(workspace_root: &Path) -> Result<PathBuf, String> {
    let output = run_git(workspace_root, ["rev-parse", "--show-toplevel"].iter())?;
    let root = String::from_utf8_lossy(&output).trim().to_string();
    if root.is_empty() {
        return Err("git repository root was empty".to_string());
    }

    Ok(PathBuf::from(root))
}

fn run_git<'a, I>(working_dir: &Path, args: I) -> Result<Vec<u8>, String>
where
    I: IntoIterator<Item = &'a &'a str>,
{
    let output = Command::new("git")
        .arg("-C")
        .arg(working_dir)
        .args(args)
        .output()
        .map_err(|err| err.to_string())?;

    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(command_error("git", &output.stderr))
    }
}

fn command_error(command: &str, stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        format!("{command} failed")
    } else {
        message
    }
}

fn parse_branch_status(line: &str) -> (Option<String>, Option<String>, u32, u32) {
    let status = line.trim_start_matches("## ");
    let (head, tracking) = status.split_once(" [").unwrap_or((status, ""));
    let tracking = tracking.trim_end_matches(']');
    let (branch, upstream) = if let Some(branch) = head.strip_prefix("No commits yet on ") {
        (Some(branch.to_string()), None)
    } else if let Some((branch, upstream)) = head.split_once("...") {
        (non_empty(branch), non_empty(upstream))
    } else {
        (non_empty(head), None)
    };
    let (ahead, behind) = parse_tracking_counts(tracking);

    (branch, upstream, ahead, behind)
}

fn parse_tracking_counts(tracking: &str) -> (u32, u32) {
    let mut ahead = 0;
    let mut behind = 0;

    for part in tracking.split(',').map(str::trim) {
        if let Some(value) = part.strip_prefix("ahead ") {
            ahead = value.parse().unwrap_or(0);
        } else if let Some(value) = part.strip_prefix("behind ") {
            behind = value.parse().unwrap_or(0);
        }
    }

    (ahead, behind)
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn split_status_entry(entry: &str) -> Option<(char, char, &str)> {
    if entry.len() < 3 {
        return None;
    }

    let mut chars = entry.chars();
    let index_status = chars.next()?;
    let worktree_status = chars.next()?;
    let path = entry.get(3..)?;

    Some((index_status, worktree_status, path))
}

fn change_kind(index_status: char, worktree_status: char) -> GitChangeKind {
    if is_conflict_status(index_status, worktree_status) {
        GitChangeKind::Conflict
    } else if index_status == '?' && worktree_status == '?' {
        GitChangeKind::Untracked
    } else if index_status == 'R' || worktree_status == 'R' {
        GitChangeKind::Renamed
    } else if index_status == 'C' || worktree_status == 'C' {
        GitChangeKind::Copied
    } else if index_status == 'A' || worktree_status == 'A' {
        GitChangeKind::Added
    } else if index_status == 'D' || worktree_status == 'D' {
        GitChangeKind::Deleted
    } else {
        GitChangeKind::Modified
    }
}

fn is_conflict_status(index_status: char, worktree_status: char) -> bool {
    matches!(
        (index_status, worktree_status),
        ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U')
    )
}

fn is_binary_diff(raw: &str) -> bool {
    raw.contains("Binary files ") || raw.contains("GIT binary patch")
}

fn path_to_git_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(segment) => Some(segment.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parses_porcelain_status_with_staged_unstaged_untracked_and_renamed_paths() {
        let raw = b"## main...origin/main [ahead 2, behind 1]\0M  src/lib.rs\0 M README.md\0?? notes/new.md\0R  new.rs\0old.rs\0";
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
        assert_eq!(status.changes[3].path, "new.rs");
        assert_eq!(status.changes[3].original_path.as_deref(), Some("old.rs"));
    }

    #[test]
    fn diffs_literal_wildcard_filename_without_expanding_pathspec() {
        let repo = tempdir().expect("temp repo");
        run_git_test_command(repo.path(), &["init"]);
        run_git_test_command(repo.path(), &["config", "user.email", "test@example.com"]);
        run_git_test_command(repo.path(), &["config", "user.name", "Test User"]);
        fs::write(repo.path().join("*.txt"), "literal before\n").expect("literal file");
        fs::write(repo.path().join("other.txt"), "other before\n").expect("other file");
        run_git_test_command(repo.path(), &["add", "*.txt", "other.txt"]);
        run_git_test_command(repo.path(), &["commit", "-m", "initial"]);
        fs::write(repo.path().join("*.txt"), "literal after\n").expect("modify literal file");
        fs::write(repo.path().join("other.txt"), "other after\n").expect("modify other file");

        let diff = diff_file(repo.path(), "*.txt", false).expect("diff literal wildcard");

        assert!(diff.raw.contains("*.txt"));
        assert!(!diff.raw.contains("other.txt"), "{}", diff.raw);
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

    fn run_git_test_command(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("git command runs");

        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
