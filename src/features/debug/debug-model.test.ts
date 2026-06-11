/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  addDebugWatch,
  appendDebugConsole,
  createDebugState,
  markDebugSessionEvent,
  removeDebugWatch,
  replaceDebugLaunchConfigs,
  setDebugBreakpoints,
  setDebugStack,
  storeDebugVariables,
  toggleDebugBreakpoint,
  updateDebugWatchResult,
} from "./debug-model";

describe("debug model", () => {
  test("stores launch configs and selects the first config", () => {
    const state = replaceDebugLaunchConfigs(createDebugState(), [
      {
        id: "cfg-python",
        workspace_root: "/repo",
        name: "Python",
        adapter: "Python",
        request: "Launch",
        program: "app.py",
        cwd: ".",
        args: [],
        env: [],
        stop_on_entry: true,
        attach: null,
        created_ms: 1,
        updated_ms: 1,
      },
    ]);

    expect(state.activeConfigId).toBe("cfg-python");
  });

  test("toggles breakpoints per source path", () => {
    const withFirst = toggleDebugBreakpoint(createDebugState(), "src/main.rs", 7);
    const withSecond = toggleDebugBreakpoint(withFirst, "src/main.rs", 11);
    const removedFirst = toggleDebugBreakpoint(withSecond, "src/main.rs", 7);

    expect(removedFirst.breakpointsByPath["src/main.rs"].map((bp) => bp.line)).toEqual([11]);
  });

  test("buffers console output and keeps it bounded", () => {
    const large = "x".repeat(130_000);
    const state = appendDebugConsole(createDebugState(), "session-1", large);

    expect(state.consoleBySessionId["session-1"].length).toBe(120_000);
  });

  test("late lower-sequence events for sessions do not reactivate the session", () => {
    const disconnected = markDebugSessionEvent(createDebugState(), {
      session_id: "session-1",
      workspace_id: "workspace",
      workspace_root: "/repo",
      sequence: 4,
      status: "Disconnected",
      reason: null,
    });
    const state = markDebugSessionEvent(disconnected, {
      session_id: "session-1",
      workspace_id: "workspace",
      workspace_root: "/repo",
      sequence: 3,
      status: "Stopped",
      reason: "breakpoint",
    });

    expect(state.sessions[0].status).toBe("Disconnected");
    expect(state.sessionSequenceById["session-1"]).toBe(4);
  });

  test("stores stack frames and variables by active session", () => {
    const state = storeDebugVariables(
      setDebugStack(createDebugState(), "session-1", [
        { id: 1, name: "main", source_path: "src/main.rs", line: 8, column: 1 },
      ]),
      "session-1",
      100,
      [{ name: "counter", value: "8", type: "i32", variables_reference: 0 }],
    );

    expect(state.stackBySessionId["session-1"][0].name).toBe("main");
    expect(state.variablesByReference["session-1:100"][0].value).toBe("8");
  });

  test("stores and removes watch expressions with evaluated values and errors", () => {
    const withWatch = addDebugWatch(createDebugState(), "counter");
    const evaluated = updateDebugWatchResult(withWatch, "counter", {
      name: "counter",
      value: "8",
      type: "i32",
      variables_reference: 0,
    });
    const failed = updateDebugWatchResult(evaluated, "counter", "not available");
    const removed = removeDebugWatch(failed, "counter");

    expect(evaluated.watches[0]).toMatchObject({
      expression: "counter",
      value: "8",
      error: null,
    });
    expect(failed.watches[0]).toMatchObject({
      expression: "counter",
      value: null,
      error: "not available",
    });
    expect(removed.watches).toEqual([]);
  });

  test("ignores empty console chunks", () => {
    const state = appendDebugConsole(createDebugState(), "session-1", "");

    expect(state.consoleBySessionId["session-1"]).toBeUndefined();
  });

  test("replaces backend verified breakpoints per source path", () => {
    const local = toggleDebugBreakpoint(createDebugState(), "src/main.rs", 7);
    const state = setDebugBreakpoints(local, "src/main.rs", [
      {
        line: 9,
        condition: "counter > 3",
        log_message: null,
        verified: true,
      },
    ]);

    expect(state.breakpointsByPath["src/main.rs"]).toEqual([
      {
        line: 9,
        condition: "counter > 3",
        log_message: null,
        verified: true,
      },
    ]);
  });

  test("ignores lower-sequence console events", () => {
    const current = appendDebugConsole(createDebugState(), {
      session_id: "session-1",
      workspace_id: "workspace",
      workspace_root: "/repo",
      sequence: 5,
      chunk: "current",
    });
    const stale = appendDebugConsole(current, {
      session_id: "session-1",
      workspace_id: "workspace",
      workspace_root: "/repo",
      sequence: 4,
      chunk: "stale",
    });

    expect(stale.consoleBySessionId["session-1"]).toBe("current");
    expect(stale.consoleSequenceById["session-1"]).toBe(5);
  });
});
