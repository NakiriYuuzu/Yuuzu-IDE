import { describe, expect, test } from "bun:test";

import {
  changeBadgeCount,
  confirmationTextForGitAction,
  createGitState,
  decorationMapFromStatus,
  groupGitChanges,
  replaceGitStatus,
  selectDiff,
  statusBranchLabel,
  storeDiff,
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
});
