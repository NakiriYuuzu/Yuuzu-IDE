import { useState } from "react";
import { Star } from "lucide-react";

import type { GitBranchFull, GitStashEntry } from "./git-model";

export type GitBranchPopupProps = {
  branches: GitBranchFull[];
  stashes: GitStashEntry[];
  favoriteBranches: string[];
  onClose: () => void;
  onCheckoutBranch: (name: string) => void;
  onNewBranch: () => void;
  onMergeBranch: (name: string) => void;
  onRenameBranch: (name: string) => void;
  onDeleteBranch: (name: string) => void;
  onToggleFavorite: (name: string) => void;
  onStashApply: (index: number) => void;
  onStashPop: (index: number) => void;
  onStashBranch: (index: number) => void;
  onStashDrop: (index: number) => void;
  onRebaseBranch?: (name: string) => void;
};

function trackingLabel(branch: GitBranchFull): string {
  const parts: string[] = [];
  if (branch.ahead > 0) {
    parts.push(`↑${branch.ahead}`);
  }
  if (branch.behind > 0) {
    parts.push(`↓${branch.behind}`);
  }
  return parts.join(" ");
}

export function GitBranchPopup({
  branches,
  stashes,
  favoriteBranches,
  onClose,
  onCheckoutBranch,
  onNewBranch,
  onMergeBranch,
  onRenameBranch,
  onDeleteBranch,
  onToggleFavorite,
  onStashApply,
  onStashPop,
  onStashBranch,
  onStashDrop,
  onRebaseBranch,
}: GitBranchPopupProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const matches = (branch: GitBranchFull) =>
    query.length === 0 || branch.name.toLowerCase().includes(query);

  const favorite = (branch: GitBranchFull) =>
    favoriteBranches.includes(branch.name);
  const byFavoriteFirst = (left: GitBranchFull, right: GitBranchFull) => {
    if (favorite(left) !== favorite(right)) {
      return favorite(left) ? -1 : 1;
    }
    return 0;
  };

  const locals = branches
    .filter((branch) => !branch.remote && matches(branch))
    .sort(byFavoriteFirst);
  const remotes = branches.filter((branch) => branch.remote && matches(branch));

  const renderBranchRow = (branch: GitBranchFull) => (
    <div key={branch.name}>
      <div
        className={`branch-row${branch.current ? " current" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() =>
          setExpanded((current) => (current === branch.name ? null : branch.name))
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            setExpanded((current) =>
              current === branch.name ? null : branch.name,
            );
          }
        }}
      >
        {!branch.remote && (
          <button
            type="button"
            className={`branch-fav${favorite(branch) ? " on" : ""}`}
            aria-label={`Toggle favorite ${branch.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(branch.name);
            }}
          >
            <Star aria-hidden="true" />
          </button>
        )}
        <span className="branch-name mono">{branch.name}</span>
        {branch.upstream ? (
          <span className="branch-tracking">{trackingLabel(branch)}</span>
        ) : null}
        <span className="branch-head mono">{branch.head_short}</span>
      </div>
      {expanded === branch.name && (
        <div className="branch-actions">
          {!branch.current && (
            <button
              type="button"
              className="mi"
              onClick={() => onCheckoutBranch(branch.name)}
            >
              Checkout
            </button>
          )}
          {!branch.current && (
            <button
              type="button"
              className="mi"
              onClick={() => onMergeBranch(branch.name)}
            >
              Merge into current
            </button>
          )}
          {!branch.current && onRebaseBranch && (
            <button
              type="button"
              className="mi"
              onClick={() => onRebaseBranch(branch.name)}
            >
              Rebase current onto this…
            </button>
          )}
          {!branch.remote && (
            <button
              type="button"
              className="mi"
              onClick={() => onRenameBranch(branch.name)}
            >
              Rename…
            </button>
          )}
          {!branch.remote && !branch.current && (
            <button
              type="button"
              className="mi danger"
              onClick={() => onDeleteBranch(branch.name)}
            >
              Delete…
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="branch-popup menu" role="dialog" aria-label="Branches">
      <div className="branch-popup-head">
        <input
          className="input2"
          placeholder="Search branches…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="btn sm" onClick={onNewBranch}>
          New Branch…
        </button>
        <button
          type="button"
          className="btn sm"
          aria-label="Close branches"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="branch-popup-body">
        <div className="mlabel">Local</div>
        {locals.map(renderBranchRow)}
        {locals.length === 0 && (
          <p className="branch-empty">No local branches match.</p>
        )}
        <div className="msep" />
        <div className="mlabel">Remote</div>
        {remotes.map(renderBranchRow)}
        {remotes.length === 0 && (
          <p className="branch-empty">No remote branches match.</p>
        )}
        <div className="msep" />
        <div className="mlabel">Stashes</div>
        {stashes.map((stash) => (
          <div key={stash.index} className="stashrow">
            <span className="stash-message">{stash.message}</span>
            <span className="stash-actions">
              <button type="button" onClick={() => onStashApply(stash.index)}>
                Apply
              </button>
              <button type="button" onClick={() => onStashPop(stash.index)}>
                Pop
              </button>
              <button type="button" onClick={() => onStashBranch(stash.index)}>
                Branch…
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => onStashDrop(stash.index)}
              >
                Drop…
              </button>
            </span>
          </div>
        ))}
        {stashes.length === 0 && <p className="branch-empty">No stashes.</p>}
      </div>
    </div>
  );
}
