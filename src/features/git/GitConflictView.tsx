import { GitMerge } from "lucide-react";

import type { GitConflictFile } from "./git-model";

export type GitConflictViewProps = {
  conflict: GitConflictFile;
  resolvedBlocks: number[];
  onAcceptOurs: (blockIndex: number) => void;
  onAcceptTheirs: (blockIndex: number) => void;
  onResolveBlock: (blockIndex: number) => void;
  onAcceptAllOurs: () => void;
  onAcceptAllTheirs: () => void;
  onMarkResolved: () => void;
};

export function GitConflictView({
  conflict,
  resolvedBlocks,
  onAcceptOurs,
  onAcceptTheirs,
  onResolveBlock,
  onAcceptAllOurs,
  onAcceptAllTheirs,
  onMarkResolved,
}: GitConflictViewProps) {
  const total = conflict.blocks.length;
  const remaining = conflict.blocks.filter(
    (_, index) => !resolvedBlocks.includes(index),
  ).length;
  const allResolved = remaining === 0;

  return (
    <div className="git-conflict-view">
      <div className="git-diff-toolbar">
        <GitMerge aria-hidden="true" />
        <span className="git-diff-title">Conflict</span>
        <span className="mono git-diff-path" title={conflict.path}>
          {conflict.path}
        </span>
        <span className="badge2">
          {remaining} of {total} remaining
        </span>
        <button type="button" className="btn sm" onClick={onAcceptAllOurs}>
          Accept All Ours
        </button>
        <button type="button" className="btn sm" onClick={onAcceptAllTheirs}>
          Accept All Theirs
        </button>
        <button
          type="button"
          className="btn sm primary"
          disabled={!allResolved}
          onClick={onMarkResolved}
        >
          Mark Resolved
        </button>
      </div>
      {conflict.truncated ? (
        <div className="git-diff-truncated">
          Conflict payload was truncated by the Git backend.
        </div>
      ) : null}
      <div className="conflict3">
        <div className="ccol">
          <div className="ccol-head">Ours</div>
          {conflict.blocks.map((block, index) => (
            <div
              key={`ours-${block.start_line}-${index}`}
              className={`cblock ours${resolvedBlocks.includes(index) ? " resolved" : ""}`}
            >
              <pre className="cblock-text">{block.ours.join("\n") || " "}</pre>
              <div className="cacts">
                <button type="button" onClick={() => onAcceptOurs(index)}>
                  Accept Ours
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="ccol">
          <div className="ccol-head">Result</div>
          {conflict.blocks.map((block, index) => {
            const resolved = resolvedBlocks.includes(index);
            return (
              <div
                key={`result-${block.start_line}-${index}`}
                className={`cblock result${resolved ? " resolved" : ""}`}
              >
                <pre className="cblock-text">
                  {resolved ? "✓ resolved" : "unresolved"}
                </pre>
                <div className="cacts">
                  <button
                    type="button"
                    disabled={resolved}
                    onClick={() => onResolveBlock(index)}
                  >
                    Resolve Block
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="ccol">
          <div className="ccol-head">Theirs</div>
          {conflict.blocks.map((block, index) => (
            <div
              key={`theirs-${block.start_line}-${index}`}
              className={`cblock theirs${resolvedBlocks.includes(index) ? " resolved" : ""}`}
            >
              <pre className="cblock-text">{block.theirs.join("\n") || " "}</pre>
              <div className="cacts">
                <button type="button" onClick={() => onAcceptTheirs(index)}>
                  Accept Theirs
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
