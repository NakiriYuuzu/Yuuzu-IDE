/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { createEditorIdentity } from "./EditorTab";

describe("createEditorIdentity", () => {
  test("ignores live content so Monaco is not recreated on every edit", () => {
    const first = createEditorIdentity({
      workspaceId: "workspace-a",
      filePath: "/repo/src/main.ts",
      language: "typescript",
      readOnly: false,
      content: "draft v1",
    });
    const next = createEditorIdentity({
      workspaceId: "workspace-a",
      filePath: "/repo/src/main.ts",
      language: "typescript",
      readOnly: false,
      content: "draft v2",
    });

    expect(next).toBe(first);
  });

  test("changes when file identity changes", () => {
    const first = createEditorIdentity({
      workspaceId: "workspace-a",
      filePath: "/repo/src/main.ts",
      language: "typescript",
      readOnly: false,
      content: "draft v1",
    });
    const next = createEditorIdentity({
      workspaceId: "workspace-b",
      filePath: "/repo/src/main.ts",
      language: "typescript",
      readOnly: false,
      content: "draft v1",
    });

    expect(next).not.toBe(first);
  });
});
