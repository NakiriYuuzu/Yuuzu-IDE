/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  isLoadedEditorForActiveFile,
  shouldLoadActiveEditor,
  updateLoadedFileContent,
  type LoadedFile,
} from "./editor-buffer-state";

function loadedFile(overrides: Partial<LoadedFile> = {}): LoadedFile {
  return {
    workspaceId: "workspace-a",
    path: "/repo/src/main.ts",
    content: "disk text",
    language: "typescript",
    readOnly: false,
    ...overrides,
  };
}

describe("editor buffer state", () => {
  test("updates current buffer content for the matching workspace and path", () => {
    const loaded = loadedFile({ content: "draft v1" });

    const next = updateLoadedFileContent(
      loaded,
      "workspace-a",
      "/repo/src/main.ts",
      "draft v2",
    );

    expect(next).toEqual({ ...loaded, content: "draft v2" });
    expect(
      updateLoadedFileContent(
        loaded,
        "workspace-b",
        "/repo/src/main.ts",
        "wrong workspace",
      ),
    ).toBe(loaded);
  });

  test("requires reload when the active workspace changes with the same path", () => {
    const loaded = loadedFile({ path: "/shared/src/main.ts" });

    expect(
      isLoadedEditorForActiveFile({
        surface: "editor",
        activeWorkspaceId: "workspace-b",
        activePath: "/shared/src/main.ts",
        loadedFile: loaded,
      }),
    ).toBe(false);
    expect(
      shouldLoadActiveEditor({
        surface: "editor",
        activeWorkspaceId: "workspace-b",
        activePath: "/shared/src/main.ts",
        loadedFile: loaded,
      }),
    ).toBe(true);
  });

  test("does not reload when loaded file matches active workspace and path", () => {
    const loaded = loadedFile();

    expect(
      isLoadedEditorForActiveFile({
        surface: "editor",
        activeWorkspaceId: "workspace-a",
        activePath: "/repo/src/main.ts",
        loadedFile: loaded,
      }),
    ).toBe(true);
    expect(
      shouldLoadActiveEditor({
        surface: "editor",
        activeWorkspaceId: "workspace-a",
        activePath: "/repo/src/main.ts",
        loadedFile: loaded,
      }),
    ).toBe(false);
  });
});
