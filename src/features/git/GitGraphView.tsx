import { Download, GitBranch, GitGraph, History } from "lucide-react";

import type { GitCommitSummary } from "./git-model";

export type GitGraphViewProps = {
  graph: GitCommitSummary[];
  branchLabel: string;
  loading: boolean;
  error: string | null;
  onFetch: () => void;
  onRefresh: () => void;
};

export function GitGraphView({
  graph,
  branchLabel,
  loading,
  error,
  onFetch,
  onRefresh,
}: GitGraphViewProps) {
  return (
    <div className="git-graph-view">
      <div className="git-graph-toolbar">
        <GitGraph aria-hidden="true" />
        <span className="git-graph-title">Commit Graph</span>
        <span className="badge2 git-graph-branch" title={branchLabel}>
          <GitBranch aria-hidden="true" />
          {branchLabel || "Detached HEAD"}
        </span>
        <div className="git-graph-toolbar-spacer" />
        <button
          type="button"
          className="btn sm"
          disabled={loading}
          onClick={onFetch}
        >
          <Download aria-hidden="true" />
          Fetch
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={loading}
          onClick={onRefresh}
        >
          <History aria-hidden="true" />
          All branches
        </button>
      </div>

      {error ? (
        <div className="git-graph-alert" role="alert">
          {error}
        </div>
      ) : null}

      {loading && graph.length === 0 ? (
        <div className="git-graph-empty">Loading commit graph</div>
      ) : null}

      {!loading && graph.length === 0 ? (
        <div className="git-graph-empty">No commit graph available</div>
      ) : null}

      {graph.length > 0 ? (
        <div className="git-graph-table-wrap">
          <table className="dbgrid gitgraph">
            <thead>
              <tr>
                <th>Graph</th>
                <th>Description</th>
                <th>Author</th>
                <th>When</th>
                <th>Commit</th>
              </tr>
            </thead>
            <tbody>
              {graph.map((commit) => (
                <tr key={commit.hash}>
                  <td>
                    <GraphLane lane={commit.lane} merge={commit.merge} />
                  </td>
                  <td>
                    <div className="git-graph-description">
                      {commit.refs.map((ref) => (
                        <span
                          className={`badge2 git-ref${
                            ref.includes("HEAD") ? " head" : ""
                          }${ref.startsWith("v") ? " tag" : ""}`}
                          key={`${commit.hash}:${ref}`}
                        >
                          <GitBranch aria-hidden="true" />
                          {ref}
                        </span>
                      ))}
                      <span className="git-graph-subject" title={commit.subject}>
                        {commit.subject}
                      </span>
                    </div>
                  </td>
                  <td className="git-graph-muted" title={commit.author}>
                    {commit.author}
                  </td>
                  <td className="git-graph-when mono" title={commit.when}>
                    {commit.when}
                  </td>
                  <td className="git-graph-hash mono" title={commit.hash}>
                    {commit.short_hash}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function GraphLane({ lane, merge }: { lane: number; merge: boolean }) {
  const clampedLane = Math.max(0, Math.min(lane, 2));
  const x = 14 + clampedLane * 20;
  const secondaryX = 34;
  const laneColor = clampedLane === 0 ? "var(--yuzu)" : "#82aaff";

  return (
    <svg
      className="git-graph-lane"
      width="80"
      height="36"
      viewBox="0 0 80 36"
      aria-hidden="true"
    >
      <line x1="14" y1="-4" x2="14" y2="40" />
      {clampedLane > 0 ? (
        <line
          className="git-graph-lane-secondary"
          x1={secondaryX}
          y1="-4"
          x2={secondaryX}
          y2="40"
        />
      ) : null}
      {merge ? (
        <path
          className="git-graph-lane-secondary"
          d={`M14 18 q 0 -14 ${x - 14} -16`}
          fill="none"
        />
      ) : null}
      <circle cx={x} cy="18" r="5" fill="var(--editor)" stroke={laneColor} />
    </svg>
  );
}
