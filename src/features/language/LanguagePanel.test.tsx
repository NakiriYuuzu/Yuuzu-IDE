/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { Window as HappyWindow } from "happy-dom";

import {
  createLanguageState,
  replaceDiagnostics,
  replaceServerStatuses,
} from "./language-model";
import { LanguagePanel } from "./LanguagePanel";

const testWindow = new HappyWindow({ url: "http://localhost/" });
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement as unknown as typeof HTMLElement;
globalThis.HTMLInputElement =
  testWindow.HTMLInputElement as unknown as typeof HTMLInputElement;
globalThis.Event = testWindow.Event as unknown as typeof Event;
globalThis.MouseEvent = testWindow.MouseEvent as unknown as typeof MouseEvent;

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

    render(
      <LanguagePanel
        state={state}
        onOpenDiagnostic={() => calls.push("open")}
        onRefresh={() => calls.push("refresh")}
        onRestartServer={() => calls.push("restart")}
      />,
    );

    expect(screen.getByText("expected item")).toBeTruthy();
    expect(screen.getByText("Rust Analyzer")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Restart Rust Analyzer"));

    expect(calls).toEqual(["restart"]);
  });

  afterEach(() => {
    cleanup();
  });
});
