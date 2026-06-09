import { describe, expect, test } from "bun:test";

import {
  activeDocPreview,
  beginDocPreview,
  type ContextPack,
  contextPackByLinkedTaskRunId,
  contextPackSummary,
  createDocsState,
  isCurrentDocsLoadRequest,
  nextDocsLoadRequest,
  docsBadgeCount,
  docsPreviewPathLabel,
  docsSearchSummary,
  replaceDocsIndex,
  selectDocSource,
  selectedDocPaths,
  shouldApplyDocsResult,
  shouldApplyDocPreview,
  staleReferenceCount,
  storeDocPreview,
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

  test("updates linked context pack metadata in place", () => {
    const state = storeContextPack(createDocsState(), {
      id: "pack-1",
      workspace_root: "/workspace",
      name: "Pack",
      doc_paths: ["README.md"],
      linked_task_run_ids: [],
      linked_agent_session_ids: [],
      created_ms: 1,
      updated_ms: 1,
    });

    const updated = storeContextPack(state, {
      ...state.contextPacks[0],
      linked_task_run_ids: ["workspace:task-1"],
      linked_agent_session_ids: ["agent-1"],
      updated_ms: 2,
    });

    expect(updated.contextPacks.map((item) => item.id)).toEqual(["pack-1"]);
    expect(updated.contextPacks[0].linked_task_run_ids).toEqual([
      "workspace:task-1",
    ]);
    expect(updated.contextPacks[0].linked_agent_session_ids).toEqual([
      "agent-1",
    ]);
  });

  test("successful context pack updates clear previous docs errors", () => {
    const state = {
      ...createDocsState(),
      error: "Link agent failed: boom",
    };

    const updated = storeContextPack(state, pack("pack-1", "Recovered"));

    expect(updated.error).toBeNull();
  });

  test("summarizes context pack docs, task links, and agent links", () => {
    expect(
      contextPackSummary({
        ...pack("pack-1", "Linked"),
        doc_paths: ["README.md", "docs/architecture.md"],
        linked_task_run_ids: ["workspace:task-1"],
        linked_agent_session_ids: ["agent-1", "agent-2"],
      }),
    ).toBe("2 docs | 1 task link | 2 agent links");
  });

  test("maps linked task runs to their context packs", () => {
    expect(
      contextPackByLinkedTaskRunId([
        {
          ...pack("pack-1", "First"),
          linked_task_run_ids: ["workspace:task-1"],
        },
        {
          ...pack("pack-2", "Second"),
          linked_task_run_ids: ["workspace:task-2", "workspace:task-3"],
        },
      ]),
    ).toEqual({
      "workspace:task-1": "pack-1",
      "workspace:task-2": "pack-2",
      "workspace:task-3": "pack-2",
    });
  });

  test("scopes docs load request freshness by workspace", () => {
    const first = nextDocsLoadRequest({}, "workspace-a");
    const second = nextDocsLoadRequest(first.state, "workspace-b");
    const third = nextDocsLoadRequest(second.state, "workspace-a");

    expect(first.requestId).toBe(1);
    expect(second.requestId).toBe(1);
    expect(third.requestId).toBe(2);
    expect(isCurrentDocsLoadRequest(third.state, "workspace-a", 1)).toBe(false);
    expect(isCurrentDocsLoadRequest(third.state, "workspace-a", 2)).toBe(true);
    expect(isCurrentDocsLoadRequest(third.state, "workspace-b", 1)).toBe(true);
  });

  test("tracks active docs preview independently from cached preview order", () => {
    const previewA = {
      path: "docs/a.md",
      title: "Doc A",
      content: "# A",
      modified_ms: 1,
      references: [],
    };
    const previewB = {
      path: "docs/b.md",
      title: "Doc B",
      content: "# B",
      modified_ms: 2,
      references: [],
    };
    const withA = storeDocPreview(
      beginDocPreview(createDocsState(), previewA.path),
      previewA,
    );
    const selectingB = beginDocPreview(withA, previewB.path);

    expect(activeDocPreview(selectingB)).toBeNull();
    expect(shouldApplyDocPreview(selectingB, previewA.path)).toBe(false);

    const withB = storeDocPreview(selectingB, previewB);
    const refocusedA = beginDocPreview(withB, previewA.path);

    expect(activeDocPreview(refocusedA)?.path).toBe(previewA.path);
  });

  test("labels an uncached active docs preview by its selected path", () => {
    const state = beginDocPreview(createDocsState(), "docs/queued.md");

    expect(docsPreviewPathLabel(state, "Preview")).toBe("docs/queued.md");
  });

  test("stores markdown preview by path and counts stale references", () => {
    const state = storeDocPreview(createDocsState(), {
      path: "docs/architecture.md",
      title: "Architecture",
      content: "# Architecture",
      modified_ms: 1,
      references: [
        {
          target_path: "src/app.ts",
          exists: true,
          stale: true,
          reason: "Referenced file changed after this doc.",
        },
        {
          target_path: "missing.ts",
          exists: false,
          stale: false,
          reason: "Referenced file is missing.",
        },
      ],
    });

    expect(state.previewByPath["docs/architecture.md"]?.title).toBe(
      "Architecture",
    );
    expect(
      staleReferenceCount(state.previewByPath["docs/architecture.md"]),
    ).toBe(1);
  });

  test("rejects stale async docs results", () => {
    expect(
      shouldApplyDocsResult(
        { requestId: 2, workspaceId: "a", workspacePath: "/a", query: "docs" },
        { requestId: 3, workspaceId: "a", workspacePath: "/a", query: "docs" },
      ),
    ).toBe(false);
  });

  test("summarizes docs search matches by unique docs", () => {
    expect(
      docsSearchSummary({
        truncated: false,
        matches: [
          {
            path: "README.md",
            title: "Readme",
            line_number: 1,
            line: "agent context",
          },
          {
            path: "docs/architecture.md",
            title: "Architecture",
            line_number: 4,
            line: "agent context",
          },
        ],
      }),
    ).toBe("2 matches in 2 docs");
  });
});
