import { describe, expect, test } from "bun:test";

import {
  createDocsState,
  docsBadgeCount,
  replaceDocsIndex,
  selectDocSource,
  selectedDocPaths,
  shouldApplyDocsResult,
  storeContextPack,
  updateContextPackDraftName,
} from "./docs-model";

describe("docs model", () => {
  test("stores docs index and reports stale badge count", () => {
    const state = replaceDocsIndex(createDocsState(), [
      {
        path: "README.md",
        title: "Readme",
        section: "workspace",
        modified_ms: 1,
        size_bytes: 10,
        stale: false,
      },
      {
        path: "docs/architecture.md",
        title: "Architecture",
        section: "docs",
        modified_ms: 2,
        size_bytes: 20,
        stale: true,
      },
    ]);

    expect(state.index.map((entry) => entry.path)).toEqual([
      "README.md",
      "docs/architecture.md",
    ]);
    expect(docsBadgeCount(state)).toBe("1");
  });

  test("tracks selected docs for context pack creation", () => {
    const state = selectDocSource(
      selectDocSource(createDocsState(), "README.md", true),
      "docs/architecture.md",
      true,
    );

    expect(selectedDocPaths(state)).toEqual([
      "README.md",
      "docs/architecture.md",
    ]);
  });

  test("stores context pack draft and persisted packs", () => {
    const state = storeContextPack(
      updateContextPackDraftName(createDocsState(), "Architecture pack"),
      {
        id: "pack-1",
        workspace_root: "/workspace",
        name: "Architecture pack",
        doc_paths: ["README.md"],
        linked_task_run_ids: [],
        linked_agent_session_ids: [],
        created_ms: 1,
        updated_ms: 1,
      },
    );

    expect(state.packDraftName).toBe("");
    expect(state.contextPacks[0].name).toBe("Architecture pack");
  });

  test("rejects stale async docs results", () => {
    expect(
      shouldApplyDocsResult(
        { requestId: 2, workspaceId: "a", workspacePath: "/a", query: "docs" },
        { requestId: 3, workspaceId: "a", workspacePath: "/a", query: "docs" },
      ),
    ).toBe(false);
  });
});
