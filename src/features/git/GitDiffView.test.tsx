/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../test/test-dom";
import type { GitDiffHunks } from "./git-diff-model";
import { GitDiffView } from "./GitDiffView";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

const hunks: GitDiffHunks = {
  path: "src/users.ts",
  staged: false,
  binary: false,
  truncated: false,
  hunks: [
    {
      header: "@@ -1,3 +1,3 @@",
      old_start: 1,
      old_lines: 3,
      new_start: 1,
      new_lines: 3,
      lines: [
        { kind: "context", old_no: 1, new_no: 1, text: "ctx", word_ranges: [] },
        {
          kind: "del",
          old_no: 2,
          new_no: null,
          text: "const a = old();",
          word_ranges: [[10, 13]],
        },
        {
          kind: "add",
          old_no: null,
          new_no: 2,
          text: "const a = new();",
          word_ranges: [[10, 13]],
        },
      ],
    },
  ],
};

function renderView(
  data: GitDiffHunks | null,
  overrides: Record<string, unknown> = {},
) {
  const handlers = {
    onRefresh: mock(() => {}),
    onStageSelections: mock(() => {}),
    onUnstageSelections: mock(() => {}),
    onRevertSelections: mock(() => {}),
    ...overrides,
  };
  const result = render(
    <GitDiffView
      hunks={data}
      selectedPath={data?.path ?? null}
      loading={false}
      error={null}
      {...handlers}
    />,
  );
  return { result, handlers };
}

describe("GitDiffView", () => {
  test("renders unified mode with word-level marks and switches to side-by-side", () => {
    const { result } = renderView(hunks);

    expect(result.getByText("@@ -1,3 +1,3 @@")).toBeTruthy();
    const marks = result.container.querySelectorAll("mark");
    expect(marks.length).toBe(2);
    expect(marks[0]?.textContent).toBe("old");

    fireEvent.click(result.getByText("Side by side"));
    const sbs = result.container.querySelector(".sbs");
    expect(sbs).toBeTruthy();

    fireEvent.click(result.getByText("Unified"));
    expect(result.container.querySelector(".sbs")).toBeNull();
  });

  test("hunk bar stages a whole hunk and revert flows through callback", () => {
    const { result, handlers } = renderView(hunks);

    const hunkbar = result.container.querySelector(".hunkbar");
    expect(hunkbar).toBeTruthy();

    fireEvent.click(result.getByText("Stage Hunk"));
    expect(handlers.onStageSelections).toHaveBeenCalledWith([
      { hunk_index: 0, line_indices: null },
    ]);

    fireEvent.click(result.getByText("Revert…"));
    expect(handlers.onRevertSelections).toHaveBeenCalledWith([
      { hunk_index: 0, line_indices: null },
    ]);
  });

  test("staged diff offers Unstage Hunk instead", () => {
    const { result, handlers } = renderView({ ...hunks, staged: true });

    fireEvent.click(result.getByText("Unstage Hunk"));
    expect(handlers.onUnstageSelections).toHaveBeenCalledWith([
      { hunk_index: 0, line_indices: null },
    ]);
    expect(result.queryByText("Stage Hunk")).toBeNull();
  });

  test("line checkboxes appear only on add/del lines and stage selected lines", () => {
    const { result, handlers } = renderView(hunks);

    const checkboxes = result.container.querySelectorAll(
      ".git-diff-linecheck input[type=checkbox]",
    );
    expect(checkboxes.length).toBe(2);

    fireEvent.click(checkboxes[0] as Element);
    const stageSelected = result.getByText("Stage Selected Lines") as HTMLButtonElement;
    expect(stageSelected.disabled).toBe(false);
    fireEvent.click(stageSelected);
    expect(handlers.onStageSelections).toHaveBeenCalledWith([
      { hunk_index: 0, line_indices: [1] },
    ]);
  });

  test("binary and truncated notices keep rendering", () => {
    const { result } = renderView({
      ...hunks,
      binary: true,
      truncated: true,
      hunks: [],
    });
    expect(result.getByText("Binary file diff is not displayed")).toBeTruthy();
    expect(
      result.getByText("Diff output was truncated by the Git backend."),
    ).toBeTruthy();
  });

  test("empty state renders without hunks", () => {
    const { result } = renderView(null);
    expect(
      result.getByText("Select a changed file to inspect diff"),
    ).toBeTruthy();
  });
});
