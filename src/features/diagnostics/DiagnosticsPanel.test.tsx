/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { ensureTestDom } from "../../test/test-dom";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import {
  createDiagnosticsState,
  storeDiagnosticEvents,
  storeMetricSnapshot,
  type AppMetricSnapshot,
  type DiagnosticEvent,
} from "./diagnostics-model";

ensureTestDom();

afterEach(() => {
  cleanup();
});

function metric(
  overrides: Partial<AppMetricSnapshot> = {},
): AppMetricSnapshot {
  return {
    timestamp_ms: 1_700_000_000_000,
    process_id: 42,
    memory_bytes: 104_857_600,
    uptime_ms: 120_000,
    workspace_count: 2,
    active_workspace_id: "workspace-a",
    docs_index_entries: 17,
    file_tree_entries: 240,
    ...overrides,
  };
}

function event(id: string, timestamp_ms: number): DiagnosticEvent {
  return {
    id,
    timestamp_ms,
    level: timestamp_ms % 2 === 0 ? "info" : "warn",
    source: "app",
    message: `Diagnostic ${id}`,
  };
}

describe("DiagnosticsPanel", () => {
  test("renders compact performance rows and refresh action", () => {
    const onRefresh = mock(() => {});
    const state = storeMetricSnapshot(createDiagnosticsState(), metric());
    const result = render(
      <DiagnosticsPanel state={state} onRefresh={onRefresh} />,
    );

    expect(result.container.querySelector(".panel-head + .panel-body.diagnostics-panel")).toBeTruthy();
    expect(result.getByText("Performance")).toBeTruthy();
    expect(result.getByText("100.0 MB")).toBeTruthy();
    expect(result.getByText("2m 0s")).toBeTruthy();
    expect(result.getByText("17")).toBeTruthy();

    fireEvent.click(result.getByRole("button", { name: "Refresh diagnostics" }));

    expect(onRefresh).toHaveBeenCalled();
  });

  test("renders logs as a bounded newest-first event list", () => {
    const state = storeDiagnosticEvents(
      createDiagnosticsState(),
      Array.from({ length: 60 }, (_, index) => event(`event-${index}`, index)),
    );
    const result = render(
      <DiagnosticsPanel state={state} onRefresh={() => {}} />,
    );

    const rows = result.container.querySelectorAll(".diagnostics-event-row");

    expect(result.getByText("Logs")).toBeTruthy();
    expect(rows).toHaveLength(50);
    expect(result.getByText("Diagnostic event-59")).toBeTruthy();
    expect(result.queryByText("Diagnostic event-0")).toBeNull();
  });
});
