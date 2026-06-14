/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../test/test-dom";
import {
  createGitLogState,
  openExportDialog,
  setExportField,
  storeCommitDetail,
  storeLogPage,
  selectLogCommit,
  type GitCommitDetail,
  type GitLogRow,
  type GitLogState,
} from "./git-log-model";
import { GitLogView } from "./GitLogView";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

const row = (
  hash: string,
  lane = 0,
  edges: GitLogRow["edges"] = [],
  refs: GitLogRow["refs"] = [],
): GitLogRow => ({
  hash,
  short_hash: hash.slice(0, 7),
  subject: `subject ${hash}`,
  author: "mina",
  when_unix: 1_700_000_000,
  refs,
  parents: [],
  lane,
  lane_overflow: false,
  merge: false,
  edges,
});

const detail = (hash: string): GitCommitDetail => ({
  hash,
  short_hash: hash.slice(0, 7),
  subject: `subject ${hash}`,
  body: "",
  author: "mina",
  author_email: "mina@example.test",
  when_unix: 1_700_000_000,
  parents: [],
  refs: [],
  files: [
    {
      status: "M",
      path: "src/deep/f.ts",
      old_path: null,
      additions: 2,
      deletions: 1,
    },
  ],
  files_truncated: false,
});

function renderView(state: GitLogState, overrides: Record<string, unknown> = {}) {
  const handlers = {
    onSelectCommit: mock(() => {}),
    onOpenContextMenu: mock(() => {}),
    onLoadMore: mock(() => {}),
    onSetFilter: mock(() => {}),
    onOpenFileDiff: mock(() => {}),
    onOpenExport: mock(() => {}),
    onExportFieldChange: mock(() => {}),
    onCloseExport: mock(() => {}),
    onConfirmExport: mock(() => {}),
    onBrowseDestination: mock(() => {}),
    ...overrides,
  };
  const result = render(
    <GitLogView state={state} nowUnix={1_700_000_300} {...handlers} />,
  );
  return { result, handlers };
}

describe("GitLogView", () => {
  test("renders filter bar with search input and rows with lane svg", () => {
    const state = storeLogPage(createGitLogState(), {
      rows: [
        row("aaaaaaa1", 0, [{ from_lane: 0, to_lane: 0, kind: "through" }], [
          { name: "main", kind: "head" },
        ]),
        row("bbbbbbb2", 1, [{ from_lane: 0, to_lane: 1, kind: "fork" }]),
      ],
      has_more: false,
      total_loaded: 2,
      truncated: false,
    });
    const { result } = renderView(state);

    expect(result.getByPlaceholderText(/search/i)).toBeTruthy();
    const tableRows = result.container.querySelectorAll("tbody tr");
    expect(tableRows.length).toBe(2);
    expect(
      result.container.querySelectorAll("svg path, svg circle").length,
    ).toBeGreaterThan(0);
    expect(result.getByText("main")).toBeTruthy();
  });

  test("clicking a row selects it and right-click opens the context menu", () => {
    const state = storeLogPage(createGitLogState(), {
      rows: [row("aaaaaaa1")],
      has_more: false,
      total_loaded: 1,
      truncated: false,
    });
    const { result, handlers } = renderView(state);
    const tr = result.container.querySelector("tbody tr");
    if (!tr) throw new Error("row missing");

    fireEvent.click(tr);
    expect(handlers.onSelectCommit).toHaveBeenCalledWith("aaaaaaa1");

    fireEvent.contextMenu(tr, { clientX: 11, clientY: 22 });
    expect(handlers.onOpenContextMenu).toHaveBeenCalledWith("aaaaaaa1", 11, 22);
  });

  test("load more appears only when has_more", () => {
    const more = storeLogPage(createGitLogState(), {
      rows: [row("aaaaaaa1")],
      has_more: true,
      total_loaded: 1,
      truncated: false,
    });
    const { result, handlers } = renderView(more);
    const button = result.getByText("Load more");
    fireEvent.click(button);
    expect(handlers.onLoadMore).toHaveBeenCalled();

    cleanup();

    const done = storeLogPage(createGitLogState(), {
      rows: [row("aaaaaaa1")],
      has_more: false,
      total_loaded: 1,
      truncated: false,
    });
    const { result: second } = renderView(done);
    expect(second.queryByText("Load more")).toBeNull();
  });

  test("detail pane lists changed files and fires export", () => {
    let state = storeLogPage(createGitLogState(), {
      rows: [row("abc1234def")],
      has_more: false,
      total_loaded: 1,
      truncated: false,
    });
    state = selectLogCommit(state, "abc1234def");
    state = storeCommitDetail(state, detail("abc1234def"));
    const { result, handlers } = renderView(state);

    const file = result.getByText("src/deep/f.ts");
    fireEvent.click(file);
    expect(handlers.onOpenFileDiff).toHaveBeenCalledWith(
      "abc1234def",
      "src/deep/f.ts",
    );

    fireEvent.click(result.getByText("Export…"));
    expect(handlers.onOpenExport).toHaveBeenCalledWith("abc1234def");
  });

  test("export dialog disables Export until destination set", () => {
    let state = storeLogPage(createGitLogState(), {
      rows: [row("abc1234def")],
      has_more: false,
      total_loaded: 1,
      truncated: false,
    });
    state = storeCommitDetail(state, detail("abc1234def"));
    state = openExportDialog(state, "abc1234def");
    const { result, handlers } = renderView(state);

    expect(result.getByText("Changed files")).toBeTruthy();
    expect(result.getByText("Snapshot")).toBeTruthy();
    const exportButton = result.getByText("Export") as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);

    fireEvent.click(result.getByText("Snapshot"));
    expect(handlers.onExportFieldChange).toHaveBeenCalledWith(
      "scope",
      "snapshot",
    );

    cleanup();

    const ready = setExportField(state, "destination", "/tmp/out");
    const { result: second, handlers: secondHandlers } = renderView(ready);
    const enabled = second.getByText("Export") as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);
    expect(secondHandlers.onConfirmExport).toHaveBeenCalled();
  });
});
