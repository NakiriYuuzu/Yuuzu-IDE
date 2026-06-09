import { FileCode2, RefreshCw } from "lucide-react";

import type { GitDiff } from "./git-model";

export type GitDiffViewProps = {
  diff: GitDiff | null;
  selectedPath: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

export function GitDiffView({
  diff,
  selectedPath,
  loading,
  error,
  onRefresh,
}: GitDiffViewProps) {
  const pathLabel = selectedPath ?? diff?.path ?? "No file selected";
  const diffMode = diff ? (diff.staged ? "Staged" : "Unstaged") : null;

  return (
    <div className="git-diff-view">
      <div className="git-diff-toolbar">
        <FileCode2 aria-hidden="true" />
        <span className="git-diff-title">Diff</span>
        <span className="mono git-diff-path" title={pathLabel}>
          {pathLabel}
        </span>
        {diffMode ? <span className="badge2">{diffMode}</span> : null}
        <button
          type="button"
          className="btn sm"
          disabled={loading || !selectedPath}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="git-diff-alert" role="alert">
          {error}
        </div>
      ) : null}

      {!diff && !loading ? (
        <div className="git-diff-empty">Select a changed file to inspect diff</div>
      ) : null}

      {loading && !diff ? (
        <div className="git-diff-empty">Loading diff</div>
      ) : null}

      {diff?.binary ? (
        <div className="git-diff-empty">Binary file diff is not displayed</div>
      ) : null}

      {diff?.truncated ? (
        <div className="git-diff-truncated">
          Diff output was truncated by the Git backend.
        </div>
      ) : null}

      {diff && !diff.binary ? <DiffLines raw={diff.raw} /> : null}
    </div>
  );
}

function DiffLines({ raw }: { raw: string }) {
  const lines = raw.length > 0 ? raw.split("\n") : [];

  if (lines.length === 0) {
    return <div className="git-diff-empty">No textual diff output</div>;
  }

  return (
    <pre className="git-diff-code" aria-label="Unified diff">
      {lines.map((line, index) => (
        <code
          className={`git-diff-line ${diffLineClass(line)}`}
          key={`${index}:${line}`}
        >
          {line.length > 0 ? line : " "}
        </code>
      ))}
    </pre>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) {
    return "git-diff-line-hunk";
  }

  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "git-diff-line-add";
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    return "git-diff-line-del";
  }

  return "git-diff-line-context";
}
