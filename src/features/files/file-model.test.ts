/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activateFileTab,
  applySavedVersion,
  closeFileTab,
  markFileDirty,
  openFileTab,
  type EditorFileTab,
} from "./file-model";

const tab: EditorFileTab = {
  path: "/workspace/src/main.ts",
  name: "main.ts",
  dirty: false,
  tooLarge: false,
  version: { modified_ms: 1, len: 10 },
  externalChange: false,
};

describe("file model", () => {
  test("opens a file once and activates it", () => {
    const state = openFileTab({ tabs: [], activePath: null }, tab);
    const next = openFileTab(state, { ...tab, name: "duplicate.ts" });

    expect(next.tabs).toHaveLength(1);
    expect(next.activePath).toBe(tab.path);
  });

  test("marks dirty and clears dirty when saved version is applied", () => {
    const dirty = markFileDirty(
      { tabs: [tab], activePath: tab.path },
      tab.path,
      true,
    );
    const saved = applySavedVersion(dirty, tab.path, {
      modified_ms: 2,
      len: 12,
    });

    expect(saved.tabs[0].dirty).toBe(false);
    expect(saved.tabs[0].version).toEqual({ modified_ms: 2, len: 12 });
  });

  test("closing active tab activates the previous remaining tab", () => {
    const second = { ...tab, path: "/workspace/src/lib.ts", name: "lib.ts" };
    const state = { tabs: [tab, second], activePath: second.path };

    const next = closeFileTab(state, second.path);

    expect(next.activePath).toBe(tab.path);
    expect(next.tabs.map((item) => item.path)).toEqual([tab.path]);
  });

  test("activateFileTab ignores missing paths", () => {
    const state = { tabs: [tab], activePath: tab.path };

    expect(activateFileTab(state, "/workspace/missing.ts")).toEqual(state);
  });
});
