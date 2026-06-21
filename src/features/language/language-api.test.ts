/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
let hoverPayload: unknown = { contents: "fn main() -> ()" };

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return hoverPayload;
  },
}));

const { requestLanguageHover } = await import("./language-api");

describe("language api", () => {
  beforeEach(() => {
    calls.length = 0;
    hoverPayload = { contents: "fn main() -> ()" };
  });

  test("adapts raw backend hover payloads into editor hover data", async () => {
    const result = await requestLanguageHover({
      workspaceId: "workspace",
      workspaceRoot: "/workspace",
      path: "src/main.rs",
      line: 4,
      character: 9,
    });

    expect(result).toEqual({
      path: "src/main.rs",
      line: 4,
      character: 9,
      contents: "fn main() -> ()",
    });
    expect(calls).toEqual([
      {
        command: "lsp_hover",
        args: {
          workspaceId: "workspace",
          workspaceRoot: "/workspace",
          path: "src/main.rs",
          line: 4,
          character: 9,
        },
      },
    ]);
  });
});
