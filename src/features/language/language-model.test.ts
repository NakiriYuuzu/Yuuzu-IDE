import { describe, expect, test } from "bun:test";

import {
  createLanguageState,
  replaceDiagnostics,
  replaceServerStatuses,
  selectDiagnosticBadge,
  storeHover,
  storeServerLogs,
  normalizeLanguageHover,
  nextLanguageRefreshRequest,
  isCurrentLanguageRefreshRequest,
} from "./language-model";

describe("language model", () => {
  test("stores diagnostics per workspace path and counts errors", () => {
    const state = replaceDiagnostics(createLanguageState(), [
      {
        path: "src/main.rs",
        range: {
          start_line: 1,
          start_character: 0,
          end_line: 1,
          end_character: 4,
        },
        severity: "error",
        message: "expected item",
        source: "rust-analyzer",
      },
      {
        path: "src/app.ts",
        range: {
          start_line: 2,
          start_character: 1,
          end_line: 2,
          end_character: 5,
        },
        severity: "warning",
        message: "unused",
        source: "typescript-language-server",
      },
    ]);

    expect(selectDiagnosticBadge(state)).toBe("2");
    expect(state.diagnosticsByPath["src/main.rs"][0].message).toBe(
      "expected item",
    );
  });

  test("stores server status, hover, and logs without mutating defaults", () => {
    const state = storeServerLogs(
      storeHover(
        replaceServerStatuses(createLanguageState(), [
          {
            workspace_id: "workspace",
            workspace_root: "/workspace",
            language: "Rust",
            display_name: "Rust Analyzer",
            state: "Running",
            pid: 10,
            memory_bytes: 1024,
            open_documents: 1,
            last_error: null,
          },
        ]),
        {
          path: "src/main.rs",
          line: 1,
          character: 1,
          contents: "fn main",
        },
      ),
      ["initialized", "diagnostics updated"],
    );

    expect(state.serverStatuses[0].display_name).toBe("Rust Analyzer");
    expect(state.activeHover?.contents).toBe("fn main");
    expect(state.serverLogs).toEqual(["initialized", "diagnostics updated"]);
  });

  test("normalizes empty backend hover payloads to null", () => {
    expect(normalizeLanguageHover({})).toBeNull();
    expect(
      normalizeLanguageHover({
        path: "src/main.rs",
        line: 1,
        character: 1,
        contents: "fn main",
      }),
    ).toEqual({
      path: "src/main.rs",
      line: 1,
      character: 1,
      contents: "fn main",
    });
  });

  test("scopes language refresh request freshness by workspace root", () => {
    const first = nextLanguageRefreshRequest({}, "workspace-a", "/workspace-a");
    const second = nextLanguageRefreshRequest(
      first.state,
      "workspace-a",
      "/workspace-a",
    );
    const third = nextLanguageRefreshRequest(
      second.state,
      "workspace-a",
      "/workspace-b",
    );

    expect(first.requestId).toBe(1);
    expect(second.requestId).toBe(2);
    expect(third.requestId).toBe(3);
    expect(
      isCurrentLanguageRefreshRequest(
        second.state,
        "workspace-a",
        "/workspace-a",
        1,
      ),
    ).toBe(false);
    expect(
      isCurrentLanguageRefreshRequest(
        second.state,
        "workspace-a",
        "/workspace-a",
        2,
      ),
    ).toBe(true);
    expect(
      isCurrentLanguageRefreshRequest(
        third.state,
        "workspace-a",
        "/workspace-a",
        2,
      ),
    ).toBe(false);
    expect(
      isCurrentLanguageRefreshRequest(
        third.state,
        "workspace-a",
        "/workspace-b",
        3,
      ),
    ).toBe(true);
  });
});
