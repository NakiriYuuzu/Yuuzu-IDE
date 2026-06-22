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

const { ensureLanguageDocument, requestLanguageHover } = await import("./language-api");

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

  test("invokes document ensure with flat LSP arguments", async () => {
    hoverPayload = {
      workspace_id: "workspace",
      workspace_root: "/workspace",
      path: "src/main.rs",
      language: "Rust",
      readiness: "Ready",
      command: "rust-analyzer",
      last_error: null,
      server: {
        workspace_id: "workspace",
        workspace_root: "/workspace",
        language: "Rust",
        display_name: "Rust Analyzer",
        command: "rust-analyzer",
        state: "Running",
        pid: 42,
        memory_bytes: null,
        open_documents: 1,
        last_error: null,
      },
    };

    const result = await ensureLanguageDocument({
      workspaceId: "workspace",
      workspaceRoot: "/workspace",
      path: "src/main.rs",
      content: "fn main() {}\n",
      version: 12,
    });

    expect(result).toEqual(hoverPayload as Awaited<ReturnType<typeof ensureLanguageDocument>>);
    expect(calls).toEqual([
      {
        command: "lsp_ensure_document",
        args: {
          workspaceId: "workspace",
          workspaceRoot: "/workspace",
          path: "src/main.rs",
          content: "fn main() {}\n",
          version: 12,
        },
      },
    ]);
  });
});
