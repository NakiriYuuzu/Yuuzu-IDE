import { describe, expect, test } from "bun:test";

import {
  boundedGraph,
  branchCheckoutConfirmation,
  canAmend,
  canCommit,
  canRunRepositoryAction,
  canStash,
  changeBadgeCount,
  confirmationTextForGitAction,
  createGitState,
  decorationMapFromStatus,
  gitActionLabel,
  groupGitChanges,
  replaceGitStatus,
  selectDiff,
  storeBranches,
  statusBranchLabel,
  storeDiff,
  storeGraph,
  updateGitCommitMessage,
} from "./git-model";
import type { GitRepositoryStatus } from "./git-model";

const status: GitRepositoryStatus = {
  workspace_root: "/workspace",
  repository_root: "/workspace",
  branch: "main",
  upstream: "origin/main",
  ahead: 2,
  behind: 1,
  clean: false,
  has_conflicts: true,
  changes: [
    {
      path: "src/app.ts",
      original_path: null,
      index_status: "M",
      worktree_status: " ",
      kind: "modified",
    },
    {
      path: "README.md",
      original_path: null,
      index_status: " ",
      worktree_status: "M",
      kind: "modified",
    },
    {
      path: "new.md",
      original_path: null,
      index_status: "?",
      worktree_status: "?",
      kind: "untracked",
    },
    {
      path: "conflict.ts",
      original_path: null,
      index_status: "U",
      worktree_status: "U",
      kind: "conflict",
    },
  ],
};

const statusWithoutConflicts: GitRepositoryStatus = {
  ...status,
  has_conflicts: false,
  changes: status.changes.filter((change) => change.kind !== "conflict"),
};

describe("git-model", () => {
  test("splits staged and unstaged changes without dropping conflicts", () => {
    const grouped = groupGitChanges(status.changes);

    expect(grouped.staged.map((change) => change.path)).toEqual(["src/app.ts"]);
    expect(grouped.unstaged.map((change) => change.path)).toEqual([
      "README.md",
      "new.md",
      "conflict.ts",
    ]);
    expect(grouped.conflicts.map((change) => change.path)).toEqual([
      "conflict.ts",
    ]);
  });

  test("counts rail badge from all status changes", () => {
    expect(changeBadgeCount(status)).toBe("4");
    expect(changeBadgeCount({ ...status, clean: true, changes: [] })).toBeNull();
  });

  test("formats branch label with upstream divergence", () => {
    expect(statusBranchLabel(status)).toBe("main ahead 2 behind 1");
  });

  test("creates confirmation text for destructive git actions", () => {
    expect(
      confirmationTextForGitAction({ kind: "discard", paths: ["README.md"] }),
    ).toBe("DISCARD");
    expect(
      confirmationTextForGitAction({ kind: "checkout", branch: "topic" }),
    ).toBe("CHECKOUT topic");
    expect(confirmationTextForGitAction({ kind: "reset-hard" })).toBe(
      "RESET HARD",
    );
    expect(confirmationTextForGitAction({ kind: "rebase", target: "main" })).toBe(
      "REBASE main",
    );
  });

  test("creates file decoration map using compact status tokens", () => {
    expect(decorationMapFromStatus(status)).toEqual({
      "src/app.ts": "M",
      "README.md": "M",
      "new.md": "A",
      "conflict.ts": "U",
    });
  });

  test("stores selected diff state", () => {
    const state = selectDiff(createGitState(), {
      path: "README.md",
      staged: false,
    });

    expect(state.selectedDiff).toEqual({ path: "README.md", staged: false });
  });

  test("stores diff content by public diff cache key", () => {
    const state = storeDiff(createGitState(), {
      path: "README.md",
      original_path: null,
      staged: false,
      binary: false,
      truncated: false,
      raw: "diff --git a/README.md b/README.md\n+hello\n",
    });

    expect(state.diffByKey["unstaged:README.md"]?.raw).toContain("+hello");
  });

  test("replaces status and preserves commit message", () => {
    const state = replaceGitStatus(
      { ...createGitState(), commitMessage: "feat: ui" },
      status,
    );

    expect(state.status?.branch).toBe("main");
    expect(state.commitMessage).toBe("feat: ui");
  });

  test("commit is enabled only when staged changes and a message exist", () => {
    const withStatus = replaceGitStatus(createGitState(), statusWithoutConflicts);

    expect(canCommit(withStatus)).toBe(false);
    expect(
      canCommit(updateGitCommitMessage(withStatus, "feat: git panel")),
    ).toBe(true);
    expect(
      canCommit(
        updateGitCommitMessage(
          replaceGitStatus(createGitState(), { ...status, changes: [] }),
          "feat: none",
        ),
      ),
    ).toBe(false);
  });

  test("commit is disabled when status has unresolved conflicts", () => {
    const withConflicts = updateGitCommitMessage(
      replaceGitStatus(createGitState(), status),
      "feat: conflict guard",
    );

    expect(canCommit(withConflicts)).toBe(false);
  });

  test("amend is unavailable when status has unresolved conflicts", () => {
    const readyState = updateGitCommitMessage(
      replaceGitStatus(createGitState(), statusWithoutConflicts),
      "feat: amend",
    );
    const conflictState = updateGitCommitMessage(
      replaceGitStatus(createGitState(), status),
      "feat: amend",
    );

    expect(canAmend(readyState)).toBe(true);
    expect(canAmend(conflictState)).toBe(false);
  });

  test("stash is unavailable when status has unresolved conflicts", () => {
    const readyState = replaceGitStatus(createGitState(), statusWithoutConflicts);
    const conflictState = replaceGitStatus(createGitState(), status);
    const cleanState = replaceGitStatus(createGitState(), {
      ...statusWithoutConflicts,
      changes: [],
    });

    expect(canStash(readyState)).toBe(true);
    expect(canStash(conflictState)).toBe(false);
    expect(canStash(cleanState)).toBe(false);
  });

  test("repository actions require loaded status without conflict gating", () => {
    expect(canRunRepositoryAction(createGitState())).toBe(false);
    expect(canRunRepositoryAction(replaceGitStatus(createGitState(), status))).toBe(
      true,
    );
    expect(
      canRunRepositoryAction(
        replaceGitStatus(createGitState(), statusWithoutConflicts),
      ),
    ).toBe(true);
  });

  test("git action labels match the Source Control panel commands", () => {
    expect(gitActionLabel("commit")).toBe("Commit");
    expect(gitActionLabel("commit-push")).toBe("Commit & Push");
    expect(gitActionLabel("amend")).toBe("Amend");
    expect(gitActionLabel("stash")).toBe("Stash");
  });

  test("stores loaded diff by path and staged flag", () => {
    const state = storeDiff(createGitState(), {
      path: "README.md",
      original_path: null,
      staged: false,
      binary: false,
      truncated: false,
      raw: "diff --git a/README.md b/README.md\n+changed\n",
    });

    expect(state.diffByKey["unstaged:README.md"]?.raw).toContain("+changed");
  });

  test("keeps current branch first in branch controls", () => {
    const branches = [
      { name: "topic", current: false, remote: false, upstream: null },
      { name: "main", current: true, remote: false, upstream: "origin/main" },
    ];
    const state = storeBranches(createGitState(), branches);

    expect(state.branches.map((branch) => branch.name)).toEqual([
      "main",
      "topic",
    ]);
    expect(branches.map((branch) => branch.name)).toEqual(["topic", "main"]);
  });

  test("bounds graph rows to 120 commits", () => {
    const graph = Array.from({ length: 125 }, (_, index) => ({
      hash: `${index}`,
      short_hash: `${index}`,
      subject: `commit ${index}`,
      author: "Yuuzu",
      when: "1 minute ago",
      refs: [],
      lane: 0,
      merge: false,
    }));

    expect(boundedGraph(graph)).toHaveLength(120);
    expect(storeGraph(createGitState(), graph).graph).toHaveLength(120);
  });

  test("formats checkout confirmation text from target branch", () => {
    expect(branchCheckoutConfirmation("feature/git")).toBe(
      "CHECKOUT feature/git",
    );
  });
});
