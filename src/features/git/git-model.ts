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

export type GitRepositoryStatus = {
  workspace_root: string;
  repository_root: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  has_conflicts: boolean;
  changes: GitFileStatus[];
};

export type GitDiff = {
  path: string;
  original_path: string | null;
  staged: boolean;
  binary: boolean;
  truncated: boolean;
  raw: string;
};

export type GitBranch = {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
};

export type GitCommitSummary = {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  when: string;
  refs: string[];
  lane: number;
  merge: boolean;
};

export type GitDiffSelection = {
  path: string;
  staged: boolean;
};

export type GitDecorationMap = Record<string, "A" | "D" | "M" | "U">;

export type GitGroupedChanges = {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  conflicts: GitFileStatus[];
};

export type GitConfirmationAction =
  | { kind: "discard"; paths: string[] }
  | { kind: "checkout"; branch: string }
  | { kind: "reset-hard" }
  | { kind: "rebase"; target: string };

export type GitAction = "commit" | "commit-push" | "amend" | "stash";

export type GitFileEventRefreshCheck = {
  activeWorkspaceId: string | null;
  eventWorkspaceId: string | null;
  path: string;
};

export type GitTaskRefreshCheck = {
  activeWorkspaceId: string | null;
  runWorkspaceId: string | null;
  exitCode: number | null;
};

export type GitViewState = {
  status: GitRepositoryStatus | null;
  loading: boolean;
  error: string | null;
  commitMessage: string;
  selectedDiff: GitDiffSelection | null;
  diffByKey: Record<string, GitDiff>;
  branches: GitBranch[];
  graph: GitCommitSummary[];
};

const MAX_GRAPH_COMMITS = 120;

export function createGitState(): GitViewState {
  return {
    status: null,
    loading: false,
    error: null,
    commitMessage: "",
    selectedDiff: null,
    diffByKey: {},
    branches: [],
    graph: [],
  };
}

export function replaceGitStatus(
  state: GitViewState,
  status: GitRepositoryStatus,
): GitViewState {
  return { ...state, status, loading: false, error: null };
}

export function setGitLoading(
  state: GitViewState,
  loading: boolean,
): GitViewState {
  return { ...state, loading };
}

export function setGitError(
  state: GitViewState,
  error: string | null,
): GitViewState {
  return { ...state, error, loading: false };
}

export function setCommitMessage(
  state: GitViewState,
  commitMessage: string,
): GitViewState {
  return { ...state, commitMessage };
}

export function updateGitCommitMessage(
  state: GitViewState,
  commitMessage: string,
): GitViewState {
  return setCommitMessage(state, commitMessage);
}

export function selectDiff(
  state: GitViewState,
  selectedDiff: GitDiffSelection | null,
): GitViewState {
  return { ...state, selectedDiff };
}

export function storeDiff(state: GitViewState, diff: GitDiff): GitViewState {
  return {
    ...state,
    diffByKey: {
      ...state.diffByKey,
      [diffKey(diff.path, diff.staged)]: diff,
    },
  };
}

export function storeBranches(
  state: GitViewState,
  branches: GitBranch[],
): GitViewState {
  return {
    ...state,
    branches: [...branches].sort((left, right) => {
      if (left.current === right.current) {
        return 0;
      }

      return left.current ? -1 : 1;
    }),
  };
}

export function storeGraph(
  state: GitViewState,
  graph: GitCommitSummary[],
): GitViewState {
  return { ...state, graph: boundedGraph(graph) };
}

export function boundedGraph(
  graph: GitCommitSummary[],
): GitCommitSummary[] {
  return graph.slice(0, MAX_GRAPH_COMMITS);
}

export function groupGitChanges(changes: GitFileStatus[]): GitGroupedChanges {
  return changes.reduce<GitGroupedChanges>(
    (grouped, change) => {
      if (isStagedChange(change)) {
        grouped.staged.push(change);
      }

      if (isUnstagedChange(change)) {
        grouped.unstaged.push(change);
      }

      if (change.kind === "conflict") {
        grouped.conflicts.push(change);
      }

      return grouped;
    },
    { staged: [], unstaged: [], conflicts: [] },
  );
}

export function changeBadgeCount(
  status: GitRepositoryStatus | null,
): string | null {
  const count = status?.changes.length ?? 0;
  return count > 0 ? String(count) : null;
}

export function canCommit(state: GitViewState): boolean {
  if (
    !state.status ||
    state.status.has_conflicts ||
    state.commitMessage.trim().length === 0
  ) {
    return false;
  }

  return groupGitChanges(state.status.changes).staged.length > 0;
}

export function canAmend(state: GitViewState): boolean {
  return Boolean(
    state.status &&
      !state.status.has_conflicts &&
      state.commitMessage.trim().length > 0,
  );
}

export function canStash(state: GitViewState): boolean {
  return Boolean(
    state.status &&
      !state.status.has_conflicts &&
      state.status.changes.length > 0,
  );
}

export function canRunRepositoryAction(state: GitViewState): boolean {
  return state.status !== null;
}

export function gitActionLabel(action: GitAction): string {
  switch (action) {
    case "commit":
      return "Commit";
    case "commit-push":
      return "Commit & Push";
    case "amend":
      return "Amend";
    case "stash":
      return "Stash";
  }
}

export function statusBranchLabel(status: GitRepositoryStatus | null): string {
  if (!status) {
    return "";
  }

  const label = status.branch ?? "Detached HEAD";
  const divergence = [
    status.ahead > 0 ? `ahead ${status.ahead}` : null,
    status.behind > 0 ? `behind ${status.behind}` : null,
  ].filter((value): value is string => value !== null);

  return [label, ...divergence].join(" ");
}

export function confirmationTextForGitAction(
  action: GitConfirmationAction,
): string {
  switch (action.kind) {
    case "discard":
      return "DISCARD";
    case "checkout":
      return `CHECKOUT ${action.branch}`;
    case "reset-hard":
      return "RESET HARD";
    case "rebase":
      return `REBASE ${action.target}`;
  }
}

export function branchCheckoutConfirmation(branch: string): string {
  return confirmationTextForGitAction({ kind: "checkout", branch });
}

export function shouldRefreshGitAfterFileEvent({
  activeWorkspaceId,
  eventWorkspaceId,
  path,
}: GitFileEventRefreshCheck): boolean {
  if (!activeWorkspaceId || activeWorkspaceId !== eventWorkspaceId) {
    return false;
  }

  const normalizedPath = normalizeGitEventPath(path);
  return normalizedPath !== ".git" && !normalizedPath.startsWith(".git/");
}

export function shouldRefreshGitAfterTask({
  activeWorkspaceId,
  runWorkspaceId,
  exitCode,
}: GitTaskRefreshCheck): boolean {
  return Boolean(
    activeWorkspaceId &&
      activeWorkspaceId === runWorkspaceId &&
      exitCode !== null,
  );
}

export function decorationMapFromStatus(
  status: GitRepositoryStatus | null,
): GitDecorationMap {
  if (!status) {
    return {};
  }

  return status.changes.reduce<GitDecorationMap>((decorations, change) => {
    decorations[change.path] = decorationForChange(change);
    return decorations;
  }, {});
}

function diffKey(path: string, staged: boolean): string {
  return `${staged ? "staged" : "unstaged"}:${path}`;
}

function normalizeGitEventPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isBlankStatus(status: string): boolean {
  return status.trim().length === 0;
}

function isStagedChange(change: GitFileStatus): boolean {
  return (
    change.kind !== "conflict" &&
    !isBlankStatus(change.index_status) &&
    change.index_status !== "?"
  );
}

function isUnstagedChange(change: GitFileStatus): boolean {
  return (
    !isBlankStatus(change.worktree_status) ||
    change.kind === "untracked" ||
    change.kind === "conflict"
  );
}

function decorationForChange(change: GitFileStatus): GitDecorationMap[string] {
  switch (change.kind) {
    case "added":
    case "untracked":
      return "A";
    case "modified":
    case "renamed":
    case "copied":
      return "M";
    case "deleted":
      return "D";
    case "conflict":
      return "U";
  }
}
