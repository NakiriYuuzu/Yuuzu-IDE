/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  createDiagnosticsState,
  formatBytes,
  storeDiagnosticEvents,
  storeMetricSnapshot,
  type AppMetricSnapshot,
  type DiagnosticEvent,
} from "./diagnostics-model";

function metricSnapshot(
  overrides: Partial<AppMetricSnapshot> = {},
): AppMetricSnapshot {
  return {
    timestamp_ms: 1_700_000_000_000,
    process_id: 42,
    memory_bytes: 104_857_600,
    uptime_ms: 12_000,
    workspace_count: 2,
    active_workspace_id: "workspace-a",
    docs_index_entries: 17,
    file_tree_entries: 240,
    ...overrides,
  };
}

function diagnosticEvent(
  id: string,
  timestamp_ms: number,
): DiagnosticEvent {
  return {
    id,
    timestamp_ms,
    level: "info",
    source: "app",
    message: `event ${id}`,
  };
}

describe("diagnostics model", () => {
  test("storeMetricSnapshot stores metric", () => {
    const snapshot = metricSnapshot();
    const state = storeMetricSnapshot(createDiagnosticsState(), snapshot);

    expect(state.metric).toEqual(snapshot);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  test("formatBytes formats megabytes with one decimal", () => {
    expect(formatBytes(104857600)).toBe("100.0 MB");
  });

  test("storeDiagnosticEvents sorts newest first and limits to 50", () => {
    const events = Array.from({ length: 60 }, (_, index) =>
      diagnosticEvent(`event-${index}`, index),
    );

    const state = storeDiagnosticEvents(createDiagnosticsState(), events);

    expect(state.events).toHaveLength(50);
    expect(state.events[0]?.id).toBe("event-59");
    expect(state.events[49]?.id).toBe("event-10");
  });
});
