import { call } from "../../lib/tauri";
import type {
  GitBranch,
  GitCommitSummary,
  GitDiff,
  GitRepositoryStatus,
} from "./git-model";
import type {
  GitCommitDetail,
  GitExportFormat,
  GitExportReport,
  GitExportScope,
  GitLogFilter,
  GitLogPage,
  GitResetMode,
} from "./git-log-model";

export function getGitStatus(
  workspaceRoot: string,
): Promise<GitRepositoryStatus> {
  return call("git_status", { workspaceRoot });
}

export function getGitDiffFile(
  workspaceRoot: string,
  path: string,
  staged: boolean,
): Promise<GitDiff> {
  return call("git_diff_file", { workspaceRoot, path, staged });
}

export function stageGitPaths(
  workspaceRoot: string,
  paths: string[],
): Promise<GitRepositoryStatus> {
  return call("git_stage_paths", { workspaceRoot, paths });
}

export function unstageGitPaths(
  workspaceRoot: string,
  paths: string[],
): Promise<GitRepositoryStatus> {
  return call("git_unstage_paths", { workspaceRoot, paths });
}

export function discardGitPaths(
  workspaceRoot: string,
  paths: string[],
  confirmation: string,
): Promise<GitRepositoryStatus> {
  return call("git_discard_paths", { workspaceRoot, paths, confirmation });
}

export function commitGit(
  workspaceRoot: string,
  message: string,
  amend: boolean,
  pushAfter: boolean,
): Promise<GitRepositoryStatus> {
  return call("git_commit", { workspaceRoot, message, amend, pushAfter });
}

export function stashGit(
  workspaceRoot: string,
  message: string,
  includeUntracked: boolean,
): Promise<GitRepositoryStatus> {
  return call("git_stash", { workspaceRoot, message, includeUntracked });
}

export function listGitBranches(
  workspaceRoot: string,
): Promise<GitBranch[]> {
  return call("git_list_branches", { workspaceRoot });
}

export function createGitBranch(
  workspaceRoot: string,
  name: string,
): Promise<GitBranch[]> {
  return call("git_create_branch", { workspaceRoot, name });
}

export function checkoutGitBranch(
  workspaceRoot: string,
  name: string,
  confirmation: string,
): Promise<GitRepositoryStatus> {
  return call("git_checkout_branch", { workspaceRoot, name, confirmation });
}

export function fetchGit(workspaceRoot: string): Promise<GitRepositoryStatus> {
  return call("git_fetch", { workspaceRoot });
}

export function pullGit(workspaceRoot: string): Promise<GitRepositoryStatus> {
  return call("git_pull", { workspaceRoot });
}

export function pushGit(workspaceRoot: string): Promise<GitRepositoryStatus> {
  return call("git_push", { workspaceRoot });
}

export function getGitCommitGraph(
  workspaceRoot: string,
  limit: number,
): Promise<GitCommitSummary[]> {
  return call("git_commit_graph", { workspaceRoot, limit });
}

export function resetGitHard(
  workspaceRoot: string,
  confirmation: string,
): Promise<GitRepositoryStatus> {
  return call("git_reset_hard", { workspaceRoot, confirmation });
}

export function rebaseGitOnto(
  workspaceRoot: string,
  target: string,
  confirmation: string,
): Promise<GitRepositoryStatus> {
  return call("git_rebase_onto", { workspaceRoot, target, confirmation });
}

export function getGitLogPage(
  workspaceRoot: string,
  filter: GitLogFilter,
  limit: number,
): Promise<GitLogPage> {
  return call("git_log_page", { workspaceRoot, filter, limit });
}

export function getGitCommitDetail(
  workspaceRoot: string,
  hash: string,
): Promise<GitCommitDetail> {
  return call("git_commit_detail", { workspaceRoot, hash });
}

export function cherryPickGit(
  workspaceRoot: string,
  hash: string,
): Promise<GitRepositoryStatus> {
  return call("git_cherry_pick", { workspaceRoot, hash });
}

export function revertGitCommit(
  workspaceRoot: string,
  hash: string,
  confirmation: string,
): Promise<GitRepositoryStatus> {
  return call("git_revert_commit", { workspaceRoot, hash, confirmation });
}

export function resetGitTo(
  workspaceRoot: string,
  hash: string,
  mode: GitResetMode,
  confirmation: string,
): Promise<GitRepositoryStatus> {
  return call("git_reset_to", { workspaceRoot, hash, mode, confirmation });
}

export function exportGitCommit(
  workspaceRoot: string,
  hash: string,
  scope: GitExportScope,
  format: GitExportFormat,
  destDir: string,
  overwrite: boolean,
): Promise<GitExportReport> {
  return call("git_export_commit", {
    workspaceRoot,
    hash,
    scope,
    format,
    destDir,
    overwrite,
  });
}
