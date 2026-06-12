import type { GitDiffHunks } from "./git-diff-model";

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
  | { kind: "rebase"; target: string }
  | { kind: "revert-commit"; short: string }
  | { kind: "reset-to"; short: string; mode: "soft" | "mixed" | "hard" }
  | { kind: "drop-stash"; index: number }
  | { kind: "delete-branch"; branch: string }
  | { kind: "accept-side"; side: "ours" | "theirs" };

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

export type GitBranchFull = {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  head_short: string;
};

export type GitStashEntry = {
  index: number;
  message: string;
  when_unix: number;
};

export type BlameSegment = {
  hash: string;
  short_hash: string;
  author: string;
  when_unix: number;
  line_start: number;
  line_count: number;
};

export type GitBlameFile = {
  path: string;
  segments: BlameSegment[];
  truncated: boolean;
};

export type ConflictBlock = {
  start_line: number;
  ours: string[];
  theirs: string[];
};

export type GitConflictFile = {
  path: string;
  base: string | null;
  ours: string;
  theirs: string;
  working: string;
  blocks: ConflictBlock[];
  truncated: boolean;
};

export type GitViewState = {
  status: GitRepositoryStatus | null;
  loading: boolean;
  error: string | null;
  commitMessage: string;
  selectedDiff: GitDiffSelection | null;
  diffByKey: Record<string, GitDiffHunks>;
  branches: GitBranch[];
  graph: GitCommitSummary[];
  branchesFull: GitBranchFull[];
  stashes: GitStashEntry[];
  blame: GitBlameFile | null;
  blameOn: boolean;
  favoriteBranches: string[];
  conflict: GitConflictFile | null;
  conflictChoices: Record<number, "ours" | "theirs">;
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
    branchesFull: [],
    stashes: [],
    blame: null,
    blameOn: false,
    favoriteBranches: [],
    conflict: null,
    conflictChoices: {},
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

export function storeDiff(
  state: GitViewState,
  diff: GitDiffHunks,
): GitViewState {
  return {
    ...state,
    diffByKey: {
      ...state.diffByKey,
      [diffKey(diff.path, diff.staged)]: diff,
    },
  };
}

export function storeBranchesFull(
  state: GitViewState,
  branchesFull: GitBranchFull[],
): GitViewState {
  return {
    ...state,
    branchesFull: [...branchesFull].sort((left, right) => {
      if (left.remote !== right.remote) {
        return left.remote ? 1 : -1;
      }
      if (left.current !== right.current) {
        return left.current ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    }),
  };
}

export function storeStashes(
  state: GitViewState,
  stashes: GitStashEntry[],
): GitViewState {
  return { ...state, stashes };
}

export function storeBlame(
  state: GitViewState,
  blame: GitBlameFile | null,
): GitViewState {
  return { ...state, blame };
}

export function storeConflict(
  state: GitViewState,
  conflict: GitConflictFile | null,
): GitViewState {
  return { ...state, conflict, conflictChoices: {} };
}

export function chooseConflictBlock(
  state: GitViewState,
  blockIndex: number,
  side: "ours" | "theirs",
): GitViewState {
  return {
    ...state,
    conflictChoices: { ...state.conflictChoices, [blockIndex]: side },
  };
}

/// Rebuild the file content by replacing each conflict marker region with the
/// chosen side's lines. Blocks without a choice keep their markers.
export function resolveConflictText(
  working: string,
  blocks: ConflictBlock[],
  choices: Record<number, "ours" | "theirs">,
): string {
  const lines = working.split("\n");
  const output: string[] = [];
  let blockIndex = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("<<<<<<<") && blockIndex < blocks.length) {
      const block = blocks[blockIndex];
      const choice = choices[blockIndex];
      // find the end of this marker region
      let end = i;
      while (end < lines.length && !lines[end].startsWith(">>>>>>>")) {
        end += 1;
      }
      if (choice) {
        output.push(...(choice === "ours" ? block.ours : block.theirs));
      } else {
        output.push(...lines.slice(i, end + 1));
      }
      i = end + 1;
      blockIndex += 1;
      continue;
    }
    output.push(line);
    i += 1;
  }
  return output.join("\n");
}

export function toggleFavoriteBranch(
  state: GitViewState,
  name: string,
): GitViewState {
  const favoriteBranches = state.favoriteBranches.includes(name)
    ? state.favoriteBranches.filter((branch) => branch !== name)
    : [...state.favoriteBranches, name];
  return { ...state, favoriteBranches };
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
    case "revert-commit":
      return `REVERT ${action.short}`;
    case "reset-to":
      return action.mode === "hard"
        ? `RESET HARD ${action.short}`
        : `RESET ${action.short}`;
    case "drop-stash":
      return `DROP stash@{${action.index}}`;
    case "delete-branch":
      return `DELETE ${action.branch}`;
    case "accept-side":
      return action.side === "ours" ? "ACCEPT OURS" : "ACCEPT THEIRS";
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
