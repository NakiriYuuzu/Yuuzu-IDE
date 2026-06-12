import { describe, expect, test } from "bun:test";
import {
  alignSideBySide,
  createDiffSelection,
  hunksToUnifiedText,
  toggleHunk,
  toggleLine,
  selectionsForApi,
} from "./git-diff-model";
import type { GitHunk } from "./git-diff-model";

const hunk: GitHunk = {
  header: "@@ -1,3 +1,3 @@",
  old_start: 1,
  old_lines: 3,
  new_start: 1,
  new_lines: 3,
  lines: [
    { kind: "context", old_no: 1, new_no: 1, text: "ctx", word_ranges: [] },
    { kind: "del", old_no: 2, new_no: null, text: "old", word_ranges: [[0, 3]] },
    { kind: "add", old_no: null, new_no: 2, text: "new", word_ranges: [[0, 3]] },
  ],
};

describe("git diff model", () => {
  test("alignSideBySide pairs del/add and pads with fill", () => {
    const rows = alignSideBySide([hunk]);
    expect(rows[0]).toEqual({
      left: hunk.lines[0],
      right: hunk.lines[0],
      hunkIndex: 0,
      kind: "context",
    });
    expect(rows[1].left).toBe(hunk.lines[1]);
    expect(rows[1].right).toBe(hunk.lines[2]);
  });

  test("alignSideBySide fills unpaired sides", () => {
    const addOnly: GitHunk = {
      ...hunk,
      lines: [
        { kind: "context", old_no: 1, new_no: 1, text: "ctx", word_ranges: [] },
        { kind: "add", old_no: null, new_no: 2, text: "n1", word_ranges: [] },
        { kind: "add", old_no: null, new_no: 3, text: "n2", word_ranges: [] },
      ],
    };
    const rows = alignSideBySide([addOnly]);
    expect(rows.length).toBe(3);
    expect(rows[1].left).toBeNull();
    expect(rows[1].right).toBe(addOnly.lines[1]);
    expect(rows[2].left).toBeNull();
    expect(rows[2].right).toBe(addOnly.lines[2]);
  });

  test("toggleHunk selects all lines; toggleLine flips one; selectionsForApi serializes", () => {
    let sel = toggleHunk(createDiffSelection(), 0, hunk);
    expect(selectionsForApi(sel)).toEqual([{ hunk_index: 0, line_indices: null }]);
    sel = toggleLine(sel, 0, 2, hunk);
    expect(selectionsForApi(sel)).toEqual([{ hunk_index: 0, line_indices: [1] }]);
  });

  test("toggleHunk twice clears the selection", () => {
    let sel = toggleHunk(createDiffSelection(), 0, hunk);
    sel = toggleHunk(sel, 0, hunk);
    expect(selectionsForApi(sel)).toEqual([]);
  });

  test("toggleLine from empty selects just that line", () => {
    const sel = toggleLine(createDiffSelection(), 0, 1, hunk);
    expect(selectionsForApi(sel)).toEqual([{ hunk_index: 0, line_indices: [1] }]);
  });
});

describe("hunksToUnifiedText", () => {
  test("reconstructs unified text with prefixes", () => {
    const text = hunksToUnifiedText({
      path: "f.ts",
      staged: false,
      binary: false,
      truncated: false,
      hunks: [hunk],
    });
    expect(text).toBe("@@ -1,3 +1,3 @@\n ctx\n-old\n+new");
  });

  test("describes binary diffs", () => {
    const text = hunksToUnifiedText({
      path: "img.png",
      staged: false,
      binary: true,
      truncated: false,
      hunks: [],
    });
    expect(text).toContain("Binary file img.png");
  });
});
