import { describe, expect, test } from "bun:test";

import {
  type ContextPack,
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
  function pack(id: string, name: string): ContextPack {
    return {
      id,
      workspace_root: "/workspace",
      name,
      doc_paths: ["README.md"],
      linked_task_run_ids: [],
      linked_agent_session_ids: [],
      created_ms: 1,
      updated_ms: 1,
    };
  }

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
      pack("pack-1", "Architecture pack"),
    );

    expect(state.packDraftName).toBe("");
    expect(state.contextPacks[0].name).toBe("Architecture pack");
  });

  test("updates existing context packs without reordering the list", () => {
    const state = {
      ...createDocsState(),
      contextPacks: [pack("pack-1", "First"), pack("pack-2", "Second")],
    };

    const updated = storeContextPack(state, {
      ...pack("pack-1", "First linked"),
      linked_task_run_ids: ["workspace:task-1"],
    });

    expect(updated.contextPacks.map((item) => item.id)).toEqual([
      "pack-1",
      "pack-2",
    ]);
    expect(updated.contextPacks[0].name).toBe("First linked");
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
