/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import type { EditorFileState } from "../files/file-model";
import {
  createRevealState,
  gitDecorationForPath,
  nextAutoRevealPaths,
  removeEditorPath,
  rememberManualCollapse,
  shouldApplyDirectoryLoadResult,
  surfaceAfterEditorRemoval,
} from "./file-tree-model";

describe("workspace file tree model", () => {
  test("manual collapse suppresses auto reveal until reveal context changes", () => {
    const root = "/workspace";
    const activeFile = "/workspace/src/components/App.tsx";
    const ancestors = ["/workspace/src", "/workspace/src/components"];
    const revealState = createRevealState(root, activeFile, 0);

    expect(nextAutoRevealPaths(revealState, {}, {})).toEqual(ancestors);

    const collapsed = rememberManualCollapse(revealState, "/workspace/src");

    expect(nextAutoRevealPaths(collapsed, {}, {})).toEqual([]);
    expect(nextAutoRevealPaths(createRevealState(root, activeFile, 1), {}, {}))
      .toEqual(ancestors);
  });

  test("directory scan results apply only while the original intent is current", () => {
    expect(
      shouldApplyDirectoryLoadResult({
        currentGeneration: 2,
        intendedGeneration: 2,
        requestGeneration: 2,
      }),
    ).toBe(true);
    expect(
      shouldApplyDirectoryLoadResult({
        currentGeneration: 2,
        intendedGeneration: undefined,
        requestGeneration: 2,
      }),
    ).toBe(false);
    expect(
      shouldApplyDirectoryLoadResult({
        currentGeneration: 3,
        intendedGeneration: 2,
        requestGeneration: 2,
      }),
    ).toBe(false);
  });

  test("removeEditorPath removes descendants from the current editor state", () => {
    const editor: EditorFileState = {
      activePath: "/workspace/src/newer.ts",
      tabs: [
        {
          dirty: false,
          externalChange: false,
          name: "older.ts",
          path: "/workspace/src/older.ts",
          tooLarge: false,
          version: null,
        },
        {
          dirty: false,
          externalChange: false,
          name: "newer.ts",
          path: "/workspace/src/newer.ts",
          tooLarge: false,
          version: null,
        },
        {
          dirty: false,
          externalChange: false,
          name: "README.md",
          path: "/workspace/README.md",
          tooLarge: false,
          version: null,
        },
      ],
    };

    const next = removeEditorPath(editor, "/workspace/src");

    expect(next.tabs.map((tab) => tab.path)).toEqual(["/workspace/README.md"]);
    expect(next.activePath).toBe("/workspace/README.md");
  });

  test("surfaceAfterEditorRemoval empties editor when the last active tab is removed", () => {
    const previous: EditorFileState = {
      activePath: "/workspace/src/main.ts",
      tabs: [
        {
          dirty: false,
          externalChange: false,
          name: "main.ts",
          path: "/workspace/src/main.ts",
          tooLarge: false,
          version: null,
        },
      ],
    };
    const next: EditorFileState = { activePath: null, tabs: [] };

    expect(surfaceAfterEditorRemoval("editor", previous, next)).toBe("empty");
    expect(surfaceAfterEditorRemoval("terminal", previous, next)).toBe(
      "terminal",
    );
    expect(surfaceAfterEditorRemoval("editor", previous, previous)).toBe(
      "editor",
    );
  });

  test("returns git decoration for exact file path", () => {
    expect(gitDecorationForPath({ "src/main.ts": "M" }, "src/main.ts")).toBe(
      "M",
    );
  });

  test("returns no git decoration for undecorated path", () => {
    expect(
      gitDecorationForPath({ "src/main.ts": "M" }, "src/other.ts"),
    ).toBeNull();
  });
});
