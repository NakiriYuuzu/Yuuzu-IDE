/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";

import {
  createLanguageState,
  replaceDiagnostics,
  replaceServerStatuses,
} from "./language-model";
import { LanguagePanel } from "./LanguagePanel";
import { ensureTestDom } from "../../test/test-dom";

ensureTestDom();

const { cleanup, fireEvent, render, screen } = await import(
  "@testing-library/react",
);

describe("LanguagePanel", () => {
  test("renders diagnostics and restarts a server", () => {
    const calls: string[] = [];

    const state = replaceServerStatuses(
      replaceDiagnostics(createLanguageState(), [
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
      ]),
      [
        {
          workspace_id: "workspace",
          workspace_root: "/workspace",
          language: "Rust",
          display_name: "Rust Analyzer",
          state: "Running",
          pid: 10,
          memory_bytes: 2048,
          open_documents: 1,
          last_error: null,
        },
      ],
    );

    const { container } = render(
      <LanguagePanel
        state={state}
        onOpenDiagnostic={() => calls.push("open")}
        onRefresh={() => calls.push("refresh")}
        onRestartServer={() => calls.push("restart")}
      />,
    );

    expect(screen.getByText("expected item")).toBeTruthy();
    expect(screen.getByText("Rust Analyzer")).toBeTruthy();
    expect(container.querySelector(".panel-head + .panel-body.language-panel")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Restart Rust Analyzer"));

    expect(calls).toEqual(["restart"]);
  });

  afterEach(() => {
    cleanup();
  });
});
