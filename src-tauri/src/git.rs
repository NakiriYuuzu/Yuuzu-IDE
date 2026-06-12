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

pub fn stage_paths(workspace_root: &Path, paths: &[String]) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let paths = normalize_required_paths(&repository_root, paths)?;

    let mut command = git_command(&repository_root);
    command
        .env("GIT_LITERAL_PATHSPECS", "1")
        .arg("add")
        .arg("--")
        .args(paths.iter());
    run_git_command("git add", &mut command)?;

    repository_status(workspace_root)
}

pub fn unstage_paths(
    workspace_root: &Path,
    paths: &[String],
) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let paths = normalize_required_paths(&repository_root, paths)?;

    let mut command = git_command(&repository_root);
    command
        .env("GIT_LITERAL_PATHSPECS", "1")
        .arg("restore")
        .arg("--staged")
        .arg("--")
        .args(paths.iter());
    run_git_command("git restore --staged", &mut command)?;

    repository_status(workspace_root)
}

pub fn discard_paths(
    workspace_root: &Path,
    paths: &[String],
    confirmation: &str,
) -> Result<GitRepositoryStatus, String> {
    require_confirmation(confirmation, "DISCARD")?;
    let repository_root = repository_root(workspace_root)?;
    let paths = normalize_required_paths(&repository_root, paths)?;

    let mut command = git_command(&repository_root);
    command
        .env("GIT_LITERAL_PATHSPECS", "1")
        .arg("restore")
        .arg("--")
        .args(paths.iter());
    run_git_command("git restore", &mut command)?;

    repository_status(workspace_root)
}

pub fn commit(
    workspace_root: &Path,
    message: &str,
    amend: bool,
    push_after: bool,
) -> Result<GitRepositoryStatus, String> {
    let message = required_trimmed(message, "commit message")?;
    let repository_root = repository_root(workspace_root)?;

    let mut command = git_command(&repository_root);
    command.arg("commit");
    if amend {
        command.arg("--amend");
    }
    command.arg("-m").arg(message);
    run_git_command("git commit", &mut command)?;

    if push_after {
        let mut push = git_command(&repository_root);
        push.arg("push");
        run_git_command("git push", &mut push)?;
    }

    repository_status(workspace_root)
}

pub fn stash(
    workspace_root: &Path,
    message: &str,
    include_untracked: bool,
) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;

    let mut command = git_command(&repository_root);
    command.arg("stash").arg("push");
    if include_untracked {
        command.arg("-u");
    }
    command.arg("-m").arg(message);
    run_git_command("git stash", &mut command)?;

    repository_status(workspace_root)
}

pub fn list_branches(workspace_root: &Path) -> Result<Vec<GitBranch>, String> {
    let repository_root = repository_root(workspace_root)?;
    let output = run_git(
        &repository_root,
        [
            "branch",
            "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(objectname:short)",
        ]
        .iter(),
    )?;

    Ok(parse_branches(&output))
}

pub fn create_branch(workspace_root: &Path, name: &str) -> Result<Vec<GitBranch>, String> {
    let name = required_trimmed(name, "branch name")?;
    let repository_root = repository_root(workspace_root)?;

    let mut command = git_command(&repository_root);
    command.arg("branch").arg(name);
    run_git_command("git branch", &mut command)?;

    list_branches(workspace_root)
}

pub fn checkout_branch(
    workspace_root: &Path,
    name: &str,
    confirmation: &str,
) -> Result<GitRepositoryStatus, String> {
    let name = required_trimmed(name, "branch name")?;
    require_confirmation(confirmation, &format!("CHECKOUT {name}"))?;
    let repository_root = repository_root(workspace_root)?;

    let mut command = git_command(&repository_root);
    command.arg("checkout").arg(name);
    run_git_command("git checkout", &mut command)?;

    repository_status(workspace_root)
}

pub fn fetch(workspace_root: &Path) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("fetch").arg("--prune");
    run_git_command("git fetch", &mut command)?;

    repository_status(workspace_root)
}

pub fn pull(workspace_root: &Path) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("pull").arg("--ff-only");
    run_git_command("git pull", &mut command)?;

    repository_status(workspace_root)
}

pub fn push(workspace_root: &Path) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("push");
    run_git_command("git push", &mut command)?;

    repository_status(workspace_root)
}

pub fn commit_graph(workspace_root: &Path, limit: usize) -> Result<Vec<GitCommitSummary>, String> {
    let repository_root = repository_root(workspace_root)?;
    let limit = limit.min(120).to_string();

    let mut command = git_command(&repository_root);
    command
        .arg("log")
        .arg("--graph")
        .arg("--decorate=short")
        .arg("--date=relative")
        .arg("--pretty=format:%H%x00%h%x00%s%x00%an%x00%ar%x00%D")
        .arg("-n")
        .arg(limit);
    let output = run_git_command("git log", &mut command)?;

    Ok(parse_commit_graph(&output))
}

pub fn reset_hard(
    workspace_root: &Path,
    confirmation: &str,
) -> Result<GitRepositoryStatus, String> {
    require_confirmation(confirmation, "RESET HARD")?;
    let repository_root = repository_root(workspace_root)?;

    let mut command = git_command(&repository_root);
    command.arg("reset").arg("--hard");
    run_git_command("git reset --hard", &mut command)?;

    repository_status(workspace_root)
}

pub fn rebase_onto(
    workspace_root: &Path,
    target: &str,
    confirmation: &str,
) -> Result<GitRepositoryStatus, String> {
    let target = required_trimmed(target, "rebase target")?;
    require_confirmation(confirmation, &format!("REBASE {target}"))?;
    let repository_root = repository_root(workspace_root)?;

    let mut command = git_command(&repository_root);
    command.arg("rebase").arg(target);
    run_git_command("git rebase", &mut command)?;

    repository_status(workspace_root)
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

fn normalize_required_paths(
    repository_root: &Path,
    paths: &[String],
) -> Result<Vec<PathBuf>, String> {
    let paths = normalize_repo_relative_paths(repository_root, paths)?;
    if paths.is_empty() {
        Err("git path is required".to_string())
    } else {
        Ok(paths)
    }
}

fn required_trimmed<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(value)
    }
}

pub(crate) fn require_confirmation(actual: &str, expected: &str) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err(format!("confirmation must be exactly: {expected}"))
    }
}

fn git_command(repository_root: &Path) -> Command {
    let mut command = Command::new("git");
    command.arg("-C").arg(repository_root);
    command
}

fn run_git_command(label: &str, command: &mut Command) -> Result<Vec<u8>, String> {
    let output = command.output().map_err(|err| err.to_string())?;

    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(command_error(label, &output.stderr))
    }
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

pub(crate) fn run_git_in(working_dir: &Path, args: &[String]) -> Result<Vec<u8>, String> {
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

fn parse_branches(output: &[u8]) -> Vec<GitBranch> {
    String::from_utf8_lossy(output)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\0');
            let head = fields.next()?;
            let name = fields.next()?.trim();
            let upstream = fields.next().and_then(non_empty);

            if name.is_empty() {
                return None;
            }

            Some(GitBranch {
                name: name.to_string(),
                current: head.trim() == "*",
                remote: name.starts_with("remotes/"),
                upstream,
            })
        })
        .collect()
}

fn parse_commit_graph(output: &[u8]) -> Vec<GitCommitSummary> {
    String::from_utf8_lossy(output)
        .lines()
        .filter_map(parse_commit_graph_line)
        .collect()
}

fn parse_commit_graph_line(line: &str) -> Option<GitCommitSummary> {
    let fields = line.split('\0').collect::<Vec<_>>();
    if fields.len() < 6 {
        return None;
    }

    let (graph_prefix, hash) = split_graph_hash(fields[0])?;
    let refs = fields[5]
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let subject = fields[2].to_string();
    let merge = subject.starts_with("Merge ");

    Some(GitCommitSummary {
        hash: hash.to_string(),
        short_hash: fields[1].to_string(),
        subject,
        author: fields[3].to_string(),
        when: fields[4].to_string(),
        refs,
        lane: graph_lane(graph_prefix),
        merge,
    })
}

fn split_graph_hash(value: &str) -> Option<(&str, &str)> {
    let hash = value.split_whitespace().last()?;
    let hash_start = value.rfind(hash)?;
    Some((&value[..hash_start], hash))
}

fn graph_lane(graph_prefix: &str) -> u8 {
    graph_prefix
        .chars()
        .position(|value| value == '*')
        .unwrap_or(0)
        .min(u8::MAX as usize) as u8
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

pub const MAX_DIFF_HUNKS: usize = 200;
pub const MAX_DIFF_TOTAL_LINES: usize = 8_000;
const MAX_WORD_DIFF_CHARS: usize = 400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitLineKind {
    Context,
    Add,
    Del,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHunkLine {
    pub kind: GitLineKind,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
    pub word_ranges: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<GitHunkLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitDiffHunks {
    pub path: String,
    pub staged: bool,
    pub binary: bool,
    pub truncated: bool,
    pub hunks: Vec<GitHunk>,
}

pub fn diff_file_hunks(
    workspace_root: &Path,
    path: &str,
    staged: bool,
) -> Result<GitDiffHunks, String> {
    let diff = diff_file(workspace_root, path, staged)?;
    let mut parsed = if diff.binary {
        GitDiffHunks {
            path: diff.path.clone(),
            staged,
            binary: true,
            truncated: false,
            hunks: Vec::new(),
        }
    } else {
        parse_unified_diff(&diff.raw, MAX_DIFF_HUNKS, MAX_DIFF_TOTAL_LINES)?
    };
    parsed.path = diff.path;
    parsed.staged = staged;
    parsed.truncated = parsed.truncated || diff.truncated;
    parsed.binary = diff.binary;
    attach_word_ranges(&mut parsed);
    Ok(parsed)
}

pub(crate) fn parse_unified_diff(
    raw: &str,
    max_hunks: usize,
    max_lines: usize,
) -> Result<GitDiffHunks, String> {
    let mut hunks = Vec::new();
    let mut truncated = false;
    let mut total_lines = 0usize;
    let mut current: Option<GitHunk> = None;
    let (mut old_no, mut new_no) = (0u32, 0u32);

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("@@ ") {
            if let Some(h) = current.take() {
                hunks.push(h);
            }
            if hunks.len() >= max_hunks {
                truncated = true;
                break;
            }
            let (os, ol, ns, nl) = parse_hunk_header(rest)?;
            old_no = os;
            new_no = ns;
            current = Some(GitHunk {
                header: line.to_string(),
                old_start: os,
                old_lines: ol,
                new_start: ns,
                new_lines: nl,
                lines: Vec::new(),
            });
        } else if let Some(h) = current.as_mut() {
            if total_lines >= max_lines {
                truncated = true;
                break;
            }
            let entry = match line.bytes().next() {
                Some(b'+') => {
                    let l = GitHunkLine {
                        kind: GitLineKind::Add,
                        old_no: None,
                        new_no: Some(new_no),
                        text: line[1..].to_string(),
                        word_ranges: Vec::new(),
                    };
                    new_no += 1;
                    Some(l)
                }
                Some(b'-') => {
                    let l = GitHunkLine {
                        kind: GitLineKind::Del,
                        old_no: Some(old_no),
                        new_no: None,
                        text: line[1..].to_string(),
                        word_ranges: Vec::new(),
                    };
                    old_no += 1;
                    Some(l)
                }
                Some(b' ') | None => {
                    let l = GitHunkLine {
                        kind: GitLineKind::Context,
                        old_no: Some(old_no),
                        new_no: Some(new_no),
                        text: line.get(1..).unwrap_or("").to_string(),
                        word_ranges: Vec::new(),
                    };
                    old_no += 1;
                    new_no += 1;
                    Some(l)
                }
                // "\ No newline at end of file" and diff headers
                _ => None,
            };
            if let Some(l) = entry {
                h.lines.push(l);
                total_lines += 1;
            }
        }
    }
    if let Some(h) = current.take() {
        hunks.push(h);
    }

    Ok(GitDiffHunks {
        path: String::new(),
        staged: false,
        binary: false,
        truncated,
        hunks,
    })
}

fn parse_hunk_header(rest: &str) -> Result<(u32, u32, u32, u32), String> {
    // "-4,3 +4,4 @@ optional context"
    let body = rest.split(" @@").next().unwrap_or(rest);
    let mut parts = body.split_whitespace();
    let old = parts
        .next()
        .and_then(|s| s.strip_prefix('-'))
        .ok_or("invalid hunk header")?;
    let new = parts
        .next()
        .and_then(|s| s.strip_prefix('+'))
        .ok_or("invalid hunk header")?;
    let parse_pair = |s: &str| -> (u32, u32) {
        match s.split_once(',') {
            Some((a, b)) => (a.parse().unwrap_or(0), b.parse().unwrap_or(1)),
            None => (s.parse().unwrap_or(0), 1),
        }
    };
    let (os, ol) = parse_pair(old);
    let (ns, nl) = parse_pair(new);
    Ok((os, ol, ns, nl))
}

pub(crate) fn word_diff_ranges(del: &str, add: &str) -> (Vec<[u32; 2]>, Vec<[u32; 2]>) {
    if del.len() > MAX_WORD_DIFF_CHARS || add.len() > MAX_WORD_DIFF_CHARS {
        // fall back to whole-line tint
        return (Vec::new(), Vec::new());
    }
    let d: Vec<char> = del.chars().collect();
    let a: Vec<char> = add.chars().collect();
    let mut prefix = 0usize;
    while prefix < d.len() && prefix < a.len() && d[prefix] == a[prefix] {
        prefix += 1;
    }
    let mut suffix = 0usize;
    while suffix < d.len() - prefix
        && suffix < a.len() - prefix
        && d[d.len() - 1 - suffix] == a[a.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let dr = if prefix < d.len() - suffix {
        vec![[prefix as u32, (d.len() - suffix) as u32]]
    } else {
        Vec::new()
    };
    let ar = if prefix < a.len() - suffix {
        vec![[prefix as u32, (a.len() - suffix) as u32]]
    } else {
        Vec::new()
    };
    (dr, ar)
}

pub const MAX_PATCH_BYTES: usize = 1_024 * 1_024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HunkSelection {
    pub hunk_index: usize,
    /// None = whole hunk. Some(indices) = only these positions inside `hunk.lines`
    /// (unselected Add lines are dropped; unselected Del lines become Context).
    pub line_indices: Option<Vec<usize>>,
}

pub(crate) fn build_selection_patch(
    path: &str,
    hunks: &[GitHunk],
    selections: &[HunkSelection],
) -> Result<String, String> {
    if selections.is_empty() {
        return Err("no hunks selected".to_string());
    }
    let mut out = format!("diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n");

    for sel in selections {
        let hunk = hunks.get(sel.hunk_index).ok_or("hunk index out of range")?;
        let selected: Option<std::collections::HashSet<usize>> = sel
            .line_indices
            .as_ref()
            .map(|v| v.iter().copied().collect());

        let mut body = String::new();
        let mut has_changes = false;
        let (mut old_count, mut new_count) = (0u32, 0u32);
        for (i, line) in hunk.lines.iter().enumerate() {
            let picked = selected.as_ref().is_none_or(|s| s.contains(&i));
            match (&line.kind, picked) {
                (GitLineKind::Context, _) => {
                    body.push(' ');
                    body.push_str(&line.text);
                    body.push('\n');
                    old_count += 1;
                    new_count += 1;
                }
                (GitLineKind::Del, true) => {
                    body.push('-');
                    body.push_str(&line.text);
                    body.push('\n');
                    old_count += 1;
                    has_changes = true;
                }
                (GitLineKind::Del, false) => {
                    body.push(' ');
                    body.push_str(&line.text);
                    body.push('\n');
                    old_count += 1;
                    new_count += 1;
                }
                (GitLineKind::Add, true) => {
                    body.push('+');
                    body.push_str(&line.text);
                    body.push('\n');
                    new_count += 1;
                    has_changes = true;
                }
                // unselected additions are dropped entirely
                (GitLineKind::Add, false) => {}
            }
        }
        if !has_changes {
            continue;
        }
        out.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            hunk.old_start, old_count, hunk.new_start, new_count
        ));
        out.push_str(&body);
    }

    if out.len() > MAX_PATCH_BYTES {
        return Err("selection patch exceeds 1 MB bound".to_string());
    }
    Ok(out)
}

fn apply_patch(repository_root: &Path, patch: &str, args: &[&str]) -> Result<(), String> {
    use std::io::Write;
    let mut command = git_command(repository_root);
    command
        .arg("apply")
        .args(args)
        .arg("--whitespace=nowarn")
        .arg("-");
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    let mut child = command.spawn().map_err(|err| err.to_string())?;
    child
        .stdin
        .as_mut()
        .ok_or("no stdin")?
        .write_all(patch.as_bytes())
        .map_err(|err| err.to_string())?;
    let output = child.wait_with_output().map_err(|err| err.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error("git apply", &output.stderr))
    }
}

pub fn stage_hunks(
    workspace_root: &Path,
    path: &str,
    selections: &[HunkSelection],
) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let current = diff_file_hunks(workspace_root, path, false)?;
    let patch = build_selection_patch(&current.path, &current.hunks, selections)?;
    apply_patch(&repository_root, &patch, &["--cached"])?;
    repository_status(workspace_root)
}

pub fn unstage_hunks(
    workspace_root: &Path,
    path: &str,
    selections: &[HunkSelection],
) -> Result<GitRepositoryStatus, String> {
    let repository_root = repository_root(workspace_root)?;
    let current = diff_file_hunks(workspace_root, path, true)?;
    let patch = build_selection_patch(&current.path, &current.hunks, selections)?;
    apply_patch(&repository_root, &patch, &["--cached", "-R"])?;
    repository_status(workspace_root)
}

pub fn revert_hunks(
    workspace_root: &Path,
    path: &str,
    selections: &[HunkSelection],
    confirmation: &str,
) -> Result<GitRepositoryStatus, String> {
    require_confirmation(confirmation, "DISCARD")?;
    let repository_root = repository_root(workspace_root)?;
    let current = diff_file_hunks(workspace_root, path, false)?;
    let patch = build_selection_patch(&current.path, &current.hunks, selections)?;
    apply_patch(&repository_root, &patch, &["-R"])?;
    repository_status(workspace_root)
}

pub(crate) fn attach_word_ranges(diff: &mut GitDiffHunks) {
    for hunk in &mut diff.hunks {
        let mut i = 0;
        while i + 1 < hunk.lines.len() {
            let paired = hunk.lines[i].kind == GitLineKind::Del
                && hunk.lines[i + 1].kind == GitLineKind::Add;
            if paired {
                let (dr, ar) = word_diff_ranges(&hunk.lines[i].text, &hunk.lines[i + 1].text);
                hunk.lines[i].word_ranges = dr;
                hunk.lines[i + 1].word_ranges = ar;
                i += 2;
            } else {
                i += 1;
            }
        }
    }
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitBranchFull {
    pub name: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub head_short: String,
}

const BRANCH_REF_FORMAT: &str =
    "%(HEAD)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(objectname:short)";

fn parse_branch_full_lines(output: &[u8], remote: bool) -> Vec<GitBranchFull> {
    String::from_utf8_lossy(output)
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\u{1f}').collect();
            if f.len() < 5 || f[1].is_empty() || f[1].ends_with("/HEAD") {
                return None;
            }
            let (ahead, behind) =
                parse_tracking_counts(f[3].trim_start_matches('[').trim_end_matches(']'));
            Some(GitBranchFull {
                name: f[1].to_string(),
                current: f[0].trim() == "*",
                remote,
                upstream: non_empty(f[2]),
                ahead,
                behind,
                head_short: f[4].to_string(),
            })
        })
        .collect()
}

pub fn branches_full(workspace_root: &Path) -> Result<Vec<GitBranchFull>, String> {
    let repository_root = repository_root(workspace_root)?;
    let local = run_git(
        &repository_root,
        [
            "for-each-ref",
            "refs/heads",
            "--count=500",
            "--format",
            BRANCH_REF_FORMAT,
        ]
        .iter(),
    )?;
    let remote = run_git(
        &repository_root,
        [
            "for-each-ref",
            "refs/remotes",
            "--count=500",
            "--format",
            BRANCH_REF_FORMAT,
        ]
        .iter(),
    )?;
    let mut branches = parse_branch_full_lines(&local, false);
    branches.extend(parse_branch_full_lines(&remote, true));
    Ok(branches)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitStashEntry {
    pub index: usize,
    pub message: String,
    pub when_unix: i64,
}

const MAX_STASH_ENTRIES: usize = 50;

pub fn stash_list(workspace_root: &Path) -> Result<Vec<GitStashEntry>, String> {
    let repository_root = repository_root(workspace_root)?;
    let output = run_git(
        &repository_root,
        [
            "stash",
            "list",
            // stash list uses log pretty-format syntax: hex literals are %x1f
            "--format=%gd%x1f%at%x1f%gs",
            "-n",
            "50",
        ]
        .iter(),
    )?;
    Ok(String::from_utf8_lossy(&output)
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\u{1f}').collect();
            if f.len() < 3 {
                return None;
            }
            let index = f[0]
                .trim_start_matches("stash@{")
                .trim_end_matches('}')
                .parse()
                .ok()?;
            Some(GitStashEntry {
                index,
                message: f[2].to_string(),
                when_unix: f[1].parse().unwrap_or(0),
            })
        })
        .collect())
}

fn stash_ref(index: usize) -> Result<String, String> {
    if index >= MAX_STASH_ENTRIES {
        return Err("stash index out of range".into());
    }
    Ok(format!("stash@{{{index}}}"))
}

pub fn stash_apply(workspace_root: &Path, index: usize) -> Result<GitRepositoryStatus, String> {
    let reference = stash_ref(index)?;
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("stash").arg("apply").arg(&reference);
    run_git_command("git stash apply", &mut command)?;
    repository_status(workspace_root)
}

pub fn stash_pop(workspace_root: &Path, index: usize) -> Result<GitRepositoryStatus, String> {
    let reference = stash_ref(index)?;
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("stash").arg("pop").arg(&reference);
    run_git_command("git stash pop", &mut command)?;
    repository_status(workspace_root)
}

pub fn stash_drop(
    workspace_root: &Path,
    index: usize,
    confirmation: &str,
) -> Result<GitRepositoryStatus, String> {
    let reference = stash_ref(index)?;
    require_confirmation(confirmation, &format!("DROP {reference}"))?;
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("stash").arg("drop").arg(&reference);
    run_git_command("git stash drop", &mut command)?;
    repository_status(workspace_root)
}

pub fn stash_branch(
    workspace_root: &Path,
    index: usize,
    name: &str,
) -> Result<GitRepositoryStatus, String> {
    let name = required_trimmed(name, "branch name")?;
    let reference = stash_ref(index)?;
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("stash").arg("branch").arg(name).arg(&reference);
    run_git_command("git stash branch", &mut command)?;
    repository_status(workspace_root)
}

pub fn merge_branch(workspace_root: &Path, name: &str) -> Result<GitRepositoryStatus, String> {
    let name = required_trimmed(name, "branch name")?;
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("merge").arg("--no-edit").arg(name);
    let merge_result = run_git_command("git merge", &mut command);
    let status = repository_status(workspace_root)?;
    match merge_result {
        Ok(_) => Ok(status),
        // a conflicted merge is a valid outcome: has_conflicts drives the UI
        Err(_) if status.has_conflicts => Ok(status),
        Err(err) => Err(err),
    }
}

pub fn delete_branch(
    workspace_root: &Path,
    name: &str,
    confirmation: &str,
) -> Result<Vec<GitBranchFull>, String> {
    let name = required_trimmed(name, "branch name")?;
    require_confirmation(confirmation, &format!("DELETE {name}"))?;
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("branch").arg("-D").arg(name);
    run_git_command("git branch -D", &mut command)?;
    branches_full(workspace_root)
}

pub fn rename_branch(
    workspace_root: &Path,
    from: &str,
    to: &str,
) -> Result<Vec<GitBranchFull>, String> {
    let from = required_trimmed(from, "branch name")?;
    let to = required_trimmed(to, "branch name")?;
    let repository_root = repository_root(workspace_root)?;
    let mut command = git_command(&repository_root);
    command.arg("branch").arg("-m").arg(from).arg(to);
    run_git_command("git branch -m", &mut command)?;
    branches_full(workspace_root)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::fs;
    use tempfile::{tempdir, TempDir};

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

    #[test]
    fn rejects_blank_commit_messages_and_empty_branch_targets() {
        let repo = TempGitRepo::new();

        let error = commit(repo.path(), "  ", false, false).expect_err("blank commit rejects");
        assert!(error.contains("commit message"));

        assert!(create_branch(repo.path(), "  ").is_err());
        assert!(checkout_branch(repo.path(), "  ", "CHECKOUT ").is_err());
        assert!(rebase_onto(repo.path(), "  ", "REBASE ").is_err());
    }

    #[test]
    fn stages_and_discards_literal_wildcard_paths() {
        let repo = TempGitRepo::new();
        repo.write_file("*.txt", "literal before\n");
        repo.write_file("other.txt", "other before\n");
        repo.run(["add", "*.txt", "other.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write_file("*.txt", "literal after\n");
        repo.write_file("other.txt", "other after\n");

        stage_paths(repo.path(), &["*.txt".to_string()]).expect("stage literal wildcard");
        let status = repository_status(repo.path()).expect("status after literal stage");

        let literal = status
            .changes
            .iter()
            .find(|change| change.path == "*.txt")
            .expect("literal wildcard status");
        assert_eq!(literal.index_status, "M");
        let other = status
            .changes
            .iter()
            .find(|change| change.path == "other.txt")
            .expect("other status");
        assert_eq!(other.index_status, " ");

        unstage_paths(repo.path(), &["*.txt".to_string()]).expect("unstage literal wildcard");
        discard_paths(repo.path(), &["*.txt".to_string()], "DISCARD")
            .expect("discard literal wildcard");
        assert_eq!(repo.read_file("*.txt"), "literal before\n");
        assert_eq!(repo.read_file("other.txt"), "other after\n");
    }

    #[test]
    fn parses_unified_diff_into_structured_hunks_with_line_numbers() {
        let raw = "diff --git a/users.ts b/users.ts\nindex 1111111..2222222 100644\n--- a/users.ts\n+++ b/users.ts\n@@ -4,3 +4,4 @@ router.get\n ctx line\n-  const rows = await db.query(\"SELECT * FROM users\");\n+  const rows = await db.query(USERS_PAGE_SQL, [PAGE_SIZE]);\n+  const page = Number(req.query.page ?? 1);\n ctx tail\n";
        let hunks = parse_unified_diff(raw, MAX_DIFF_HUNKS, MAX_DIFF_TOTAL_LINES).expect("parses");

        assert_eq!(hunks.hunks.len(), 1);
        let h = &hunks.hunks[0];
        assert_eq!(
            (h.old_start, h.old_lines, h.new_start, h.new_lines),
            (4, 3, 4, 4)
        );
        assert_eq!(h.lines[0].kind, GitLineKind::Context);
        assert_eq!(h.lines[0].old_no, Some(4));
        assert_eq!(h.lines[0].new_no, Some(4));
        assert_eq!(h.lines[1].kind, GitLineKind::Del);
        assert_eq!(h.lines[1].old_no, Some(5));
        assert_eq!(h.lines[1].new_no, None);
        assert_eq!(h.lines[2].kind, GitLineKind::Add);
        assert_eq!(h.lines[2].new_no, Some(5));
        assert!(!hunks.truncated);
    }

    #[test]
    fn word_ranges_mark_changed_middle_of_paired_lines() {
        let (del_r, add_r) = word_diff_ranges(
            "  const rows = await db.query(\"SELECT * FROM users\");",
            "  const rows = await db.query(USERS_PAGE_SQL, [PAGE_SIZE]);",
        );
        // common prefix `  const rows = await db.query(` (30 chars) and suffix `);` are excluded
        assert_eq!(del_r, vec![[30, 51]]);
        assert_eq!(add_r, vec![[30, 57]]);
    }

    #[test]
    fn hunk_parsing_clips_at_bounds_and_flags_truncated() {
        let mut raw = String::from("diff --git a/a b/a\n--- a/a\n+++ b/a\n");
        for i in 0..300 {
            raw.push_str(&format!("@@ -{0},1 +{0},1 @@\n-x{0}\n+y{0}\n", i + 1));
        }
        let hunks = parse_unified_diff(&raw, MAX_DIFF_HUNKS, MAX_DIFF_TOTAL_LINES).expect("parses");
        assert_eq!(hunks.hunks.len(), MAX_DIFF_HUNKS);
        assert!(hunks.truncated);
    }

    #[test]
    fn rebuilds_patch_for_selected_lines_with_recounted_header() {
        let raw = "diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,2 +1,3 @@\n ctx\n-old\n+new1\n+new2\n";
        let hunks = parse_unified_diff(raw, MAX_DIFF_HUNKS, MAX_DIFF_TOTAL_LINES).expect("parses");
        // select only the del line (idx 1) and first add line (idx 2); drop "+new2"
        let patch = build_selection_patch(
            "f.ts",
            &hunks.hunks,
            &[HunkSelection {
                hunk_index: 0,
                line_indices: Some(vec![1, 2]),
            }],
        )
        .expect("patch");

        assert!(patch.contains("--- a/f.ts"));
        assert!(patch.contains("+++ b/f.ts"));
        // recounted: ctx (1 old + 1 new) + picked del (1 old) + picked add (1 new)
        assert!(patch.contains("@@ -1,2 +1,2 @@"));
        assert!(patch.contains("-old"));
        assert!(patch.contains("+new1"));
        assert!(!patch.contains("+new2"));
    }

    #[test]
    fn stages_single_hunk_via_apply_cached_in_temp_repo() {
        let repo = TempGitRepo::new();
        repo.write_file("f.ts", "a\nb\nc\n");
        repo.run(["add", "f.ts"]);
        repo.run(["commit", "-m", "init"]);
        repo.write_file("f.ts", "a\nB\nc\nd\n");

        let hunks = diff_file_hunks(repo.path(), "f.ts", false).expect("hunks");
        assert!(!hunks.hunks.is_empty());

        stage_hunks(
            repo.path(),
            "f.ts",
            &[HunkSelection {
                hunk_index: 0,
                line_indices: None,
            }],
        )
        .expect("stage hunk");

        let staged = diff_file_hunks(repo.path(), "f.ts", true).expect("staged hunks");
        assert!(!staged.hunks.is_empty(), "index now contains the hunk");
    }

    #[test]
    fn revert_hunk_requires_discard_confirmation() {
        let repo = TempGitRepo::new();
        repo.write_file("f.ts", "a\n");
        repo.run(["add", "f.ts"]);
        repo.run(["commit", "-m", "init"]);
        repo.write_file("f.ts", "a\nb\n");

        let err = revert_hunks(
            repo.path(),
            "f.ts",
            &[HunkSelection {
                hunk_index: 0,
                line_indices: None,
            }],
            "",
        )
        .expect_err("missing confirmation rejected");
        assert!(err.contains("confirmation"));

        revert_hunks(
            repo.path(),
            "f.ts",
            &[HunkSelection {
                hunk_index: 0,
                line_indices: None,
            }],
            "DISCARD",
        )
        .expect("confirmed revert succeeds");
        assert_eq!(repo.read_file("f.ts"), "a\n");
    }

    #[test]
    fn branches_full_reports_ahead_behind_and_current() {
        let repo = TempGitRepo::new();
        repo.write_file("a", "1\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "c1"]);
        repo.run(["branch", "feat"]);
        let branches = branches_full(repo.path()).expect("branches");
        let main = branches
            .iter()
            .find(|b| b.current)
            .expect("current branch present");
        assert!(!main.name.is_empty());
        assert!(branches.iter().any(|b| b.name == "feat" && !b.current));
    }

    #[test]
    fn stash_list_apply_pop_drop_round_trip_with_confirmation() {
        let repo = TempGitRepo::new();
        repo.write_file("a", "1\n");
        repo.run(["add", "."]);
        repo.run(["commit", "-m", "c1"]);
        repo.write_file("a", "2\n");
        stash(repo.path(), "wip-1", false).expect("stash push");

        let stashes = stash_list(repo.path()).expect("list");
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].index, 0);
        assert!(stashes[0].message.contains("wip-1"));

        stash_apply(repo.path(), 0).expect("apply keeps stash");
        assert_eq!(stash_list(repo.path()).unwrap().len(), 1);
        assert_eq!(repo.read_file("a"), "2\n");

        repo.run(["checkout", "--", "a"]);
        assert!(
            stash_drop(repo.path(), 0, "").is_err(),
            "drop needs confirmation"
        );
        stash_drop(repo.path(), 0, "DROP stash@{0}").expect("confirmed drop");
        assert!(stash_list(repo.path()).unwrap().is_empty());
    }

    pub(crate) struct TempGitRepo {
        dir: TempDir,
    }

    impl TempGitRepo {
        pub(crate) fn new() -> Self {
            let dir = tempfile::tempdir().expect("tempdir");
            let repo = Self { dir };
            repo.run(["init"]);
            repo.run(["config", "user.email", "yuuzu@example.test"]);
            repo.run(["config", "user.name", "Yuuzu Test"]);
            repo
        }

        pub(crate) fn path(&self) -> &std::path::Path {
            self.dir.path()
        }

        pub(crate) fn run<const N: usize>(&self, args: [&str; N]) {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(self.path())
                .args(args)
                .output()
                .expect("git runs");
            assert!(
                output.status.success(),
                "git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        pub(crate) fn write_file(&self, path: &str, content: &str) {
            std::fs::write(self.path().join(path), content).expect("write file");
        }

        pub(crate) fn read_file(&self, path: &str) -> String {
            std::fs::read_to_string(self.path().join(path)).expect("read file")
        }
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
