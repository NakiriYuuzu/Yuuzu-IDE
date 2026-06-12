import {
  Archive,
  Check,
  Download,
  GitBranch,
  GitGraph,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  canAmend,
  canCommit,
  canRunRepositoryAction,
  canStash,
  gitActionLabel,
  groupGitChanges,
  statusBranchLabel,
  type GitFileStatus,
  type GitViewState,
} from "./git-model";

export type GitPanelProps = {
  state: GitViewState;
  onRefresh: () => void;
  onCommitMessageChange: (message: string) => void;
  onCommit: (options: { amend: boolean; pushAfter: boolean }) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  onOpenDiff: (path: string, staged: boolean) => void;
  onStash: () => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onCheckoutBranch: (branch: string) => void;
  onCreateBranch: (name: string) => void;
  onOpenGraph: () => void;
};

type GitChangeRowProps = {
  change: GitFileStatus;
  staged: boolean;
  disabled: boolean;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  onOpenDiff: (path: string, staged: boolean) => void;
};

export function GitPanel({
  state,
  onRefresh,
  onCommitMessageChange,
  onCommit,
  onStage,
  onUnstage,
  onDiscard,
  onOpenDiff,
  onStash,
  onFetch,
  onPull,
  onPush,
  onCheckoutBranch,
  onCreateBranch,
  onOpenGraph,
}: GitPanelProps) {
  const [newBranchName, setNewBranchName] = useState("");
  const grouped = state.status
    ? groupGitChanges(state.status.changes)
    : { staged: [], unstaged: [], conflicts: [] };
  const branchLabel = statusBranchLabel(state.status) || "No repository";
  const currentBranch =
    state.branches.find((branch) => branch.current)?.name ??
    state.status?.branch ??
    "";
  const branchSelectValue = state.branches.some(
    (branch) => branch.name === currentBranch,
  )
    ? currentBranch
    : "";
  const commitEnabled = canCommit(state) && !state.loading;
  const amendEnabled = canAmend(state) && !state.loading;
  const stashEnabled = canStash(state) && !state.loading;
  const repositoryActionEnabled = canRunRepositoryAction(state) && !state.loading;
  const canCreateBranch =
    newBranchName.trim().length > 0 && repositoryActionEnabled;

  function submitCreateBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const branchName = newBranchName.trim();

    if (!branchName || !repositoryActionEnabled) {
      return;
    }

    onCreateBranch(branchName);
    setNewBranchName("");
  }

  return (
    <div className="git-panel">
      <div className="git-panel-header">
        <span>Source Control</span>
        <div className="git-panel-actions">
          <button
            type="button"
            className="iconbtn"
            title={gitActionLabel("commit")}
            aria-label={gitActionLabel("commit")}
            disabled={!commitEnabled}
            onClick={() => onCommit({ amend: false, pushAfter: false })}
          >
            <Check aria-hidden="true" />
          </button>
          <button
            type="button"
            className="iconbtn"
            title="Refresh"
            aria-label="Refresh"
            disabled={state.loading}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </button>
          <button
            type="button"
            className="iconbtn"
            title="View log"
            aria-label="View log"
            disabled={!repositoryActionEnabled}
            onClick={onOpenGraph}
          >
            <GitGraph aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="git-branch-region">
        <label className="git-branch-select">
          <GitBranch aria-hidden="true" />
          <select
            className="input2"
            aria-label="Checkout branch"
            value={branchSelectValue}
            disabled={!repositoryActionEnabled || state.branches.length === 0}
            onChange={(event) => {
              const nextBranch = event.currentTarget.value;

              if (nextBranch && nextBranch !== currentBranch) {
                onCheckoutBranch(nextBranch);
              }
            }}
          >
            {branchSelectValue === "" ? (
              <option value="">{currentBranch || "Select branch"}</option>
            ) : null}
            {state.branches.length > 0 ? (
              state.branches.map((branch) => (
                <option value={branch.name} key={branch.name}>
                  {branch.name}
                  {branch.remote ? " (remote)" : ""}
                </option>
              ))
            ) : (
              <option value={currentBranch}>{currentBranch || "No branch"}</option>
            )}
          </select>
        </label>

        <form className="git-create-branch" onSubmit={submitCreateBranch}>
          <input
            className="input2"
            type="text"
            value={newBranchName}
            placeholder="New branch"
            aria-label="New branch name"
            disabled={!repositoryActionEnabled}
            onChange={(event) => setNewBranchName(event.currentTarget.value)}
          />
          <button
            type="submit"
            className="iconbtn"
            title="Create branch"
            aria-label="Create branch"
            disabled={!canCreateBranch}
          >
            <Plus aria-hidden="true" />
          </button>
        </form>

        <div className="git-remote-actions">
          <button
            type="button"
            className="btn"
            disabled={!repositoryActionEnabled}
            onClick={onFetch}
          >
            <RefreshCw aria-hidden="true" />
            Fetch
          </button>
          <button
            type="button"
            className="btn"
            disabled={!repositoryActionEnabled}
            onClick={onPull}
          >
            <Download aria-hidden="true" />
            Pull
          </button>
          <button
            type="button"
            className="btn"
            disabled={!repositoryActionEnabled}
            onClick={onPush}
          >
            <Upload aria-hidden="true" />
            Push
          </button>
        </div>
      </div>

      <div className="git-commit-region">
        <textarea
          className="input2 git-message"
          aria-label="Commit message"
          placeholder="Message"
          value={state.commitMessage}
          onChange={(event) => onCommitMessageChange(event.currentTarget.value)}
        />
        <button
          type="button"
          className="btn primary git-commit-push"
          disabled={!commitEnabled}
          onClick={() => onCommit({ amend: false, pushAfter: true })}
        >
          <Upload aria-hidden="true" />
          <span>{gitActionLabel("commit-push")}</span>
          <span className="mono git-branch-label">{branchLabel}</span>
        </button>
        <div className="git-secondary-actions">
          <button
            type="button"
            className="btn"
            disabled={!amendEnabled}
            onClick={() => onCommit({ amend: true, pushAfter: false })}
          >
            <Check aria-hidden="true" />
            {gitActionLabel("amend")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!stashEnabled}
            onClick={onStash}
          >
            <Archive aria-hidden="true" />
            {gitActionLabel("stash")}
          </button>
        </div>
        {state.error ? (
          <div className="git-error" role="alert">
            {state.error}
          </div>
        ) : null}
      </div>

      {state.loading && !state.status ? (
        <div className="git-empty">Loading source control</div>
      ) : null}
      {!state.loading && !state.status ? (
        <div className="git-empty">No Git status available</div>
      ) : null}

      <section aria-label="Staged Changes">
        <div className="section-label">
          <span>Staged Changes</span>
          <span className="git-count">{grouped.staged.length}</span>
        </div>
        {grouped.staged.length > 0 ? (
          grouped.staged.map((change) => (
            <GitChangeRow
              key={`staged:${change.path}`}
              change={change}
              staged={true}
              disabled={state.loading}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={onDiscard}
              onOpenDiff={onOpenDiff}
            />
          ))
        ) : (
          <div className="git-empty-row">No staged changes</div>
        )}
      </section>

      <section aria-label="Changes">
        <div className="section-label">
          <span>Changes</span>
          <span className="git-count">{grouped.unstaged.length}</span>
        </div>
        {grouped.unstaged.length > 0 ? (
          grouped.unstaged.map((change) => (
            <GitChangeRow
              key={`unstaged:${change.path}`}
              change={change}
              staged={false}
              disabled={state.loading}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={onDiscard}
              onOpenDiff={onOpenDiff}
            />
          ))
        ) : (
          <div className="git-empty-row">No changes</div>
        )}
      </section>
    </div>
  );
}

function GitChangeRow({
  change,
  staged,
  disabled,
  onStage,
  onUnstage,
  onDiscard,
  onOpenDiff,
}: GitChangeRowProps) {
  const token = gitStatusToken(change);

  return (
    <div className="git-change-row">
      <span className={`git-token git-token-${token}`}>{token}</span>
      <button
        type="button"
        className="git-change-path mono"
        title={change.path}
        onClick={() => onOpenDiff(change.path, staged)}
      >
        {change.path}
      </button>
      <div className="git-row-actions">
        {staged ? (
          <button
            type="button"
            className="iconbtn"
            title={`Unstage ${change.path}`}
            aria-label={`Unstage ${change.path}`}
            disabled={disabled}
            onClick={() => onUnstage(change.path)}
          >
            <Minus aria-hidden="true" />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="iconbtn"
              title={`Stage ${change.path}`}
              aria-label={`Stage ${change.path}`}
              disabled={disabled}
              onClick={() => onStage(change.path)}
            >
              <Plus aria-hidden="true" />
            </button>
            <button
              type="button"
              className="iconbtn"
              title={`Discard ${change.path}`}
              aria-label={`Discard ${change.path}`}
              disabled={disabled}
              onClick={() => onDiscard(change.path)}
            >
              <RotateCcw aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function gitStatusToken(change: GitFileStatus): "A" | "D" | "M" | "U" {
  switch (change.kind) {
    case "added":
    case "untracked":
      return "A";
    case "deleted":
      return "D";
    case "conflict":
      return "U";
    case "modified":
    case "renamed":
    case "copied":
      return "M";
  }
}
