/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  addDebugWatch,
  appendDebugConsole,
  createDebugState,
  type DebugLaunchConfig,
  type DebugLaunchConfigInput,
  type DebugSessionEvent,
  type DebugSessionInfo,
  markDebugSessionEvent,
  removeDebugWatch,
  replaceDebugLaunchConfigs,
  replaceDebugSessions,
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

  test("clones launch configs so caller mutations do not mutate state", () => {
    const config: DebugLaunchConfig = {
      id: "cfg-python",
      workspace_root: "/repo",
      name: "Python",
      adapter: "Python",
      request: "Launch",
      program: "app.py",
      cwd: ".",
      args: ["--port", "3000"],
      env: [{ key: "RUST_LOG", value: "debug" }],
      stop_on_entry: true,
      attach: { pid: 42, host: "127.0.0.1", port: 5678 },
      created_ms: 1,
      updated_ms: 1,
    };
    const configs = [config];
    const state = replaceDebugLaunchConfigs(createDebugState(), configs);

    configs.push({ ...config, id: "cfg-other", name: "Other" });
    config.name = "Mutated";
    config.args.push("--mutated");
    config.env[0].value = "trace";
    config.attach!.host = "changed";

    expect(state.launchConfigs).toHaveLength(1);
    expect(state.launchConfigs[0].name).toBe("Python");
    expect(state.launchConfigs[0].args).toEqual(["--port", "3000"]);
    expect(state.launchConfigs[0].env[0].value).toBe("debug");
    expect(state.launchConfigs[0].attach?.host).toBe("127.0.0.1");
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

  test("replaceDebugSessions preserves newer listener sessions from stale snapshots", () => {
    const current = replaceDebugSessions(createDebugState(), [
      debugSession({
        id: "session-1",
        status: "Running",
        sequence: 5,
      }),
      debugSession({
        id: "session-2",
        status: "Stopped",
        sequence: 3,
      }),
    ]);
    const staleSnapshot = replaceDebugSessions(current, [
      debugSession({
        id: "session-1",
        status: "Stopped",
        sequence: 4,
      }),
      debugSession({
        id: "session-3",
        status: "Running",
        sequence: 1,
      }),
    ]);

    expect(staleSnapshot.sessions.map((session) => session.id).sort()).toEqual([
      "session-1",
      "session-2",
      "session-3",
    ]);
    expect(
      staleSnapshot.sessions.find((session) => session.id === "session-1"),
    ).toMatchObject({
      status: "Running",
      sequence: 5,
    });
    expect(
      staleSnapshot.sessions.find((session) => session.id === "session-2"),
    ).toMatchObject({
      status: "Stopped",
      sequence: 3,
    });
    expect(staleSnapshot.sessionSequenceById["session-1"]).toBe(5);
  });

  test("replaceDebugSessions clones sessions so caller mutations do not mutate state", () => {
    const session = debugSession({
      id: "session-1",
      status: "Stopped",
      sequence: 2,
    });
    const sessions = [session];
    const state = replaceDebugSessions(createDebugState(), sessions);

    sessions.push(debugSession({ id: "session-2", sequence: 1 }));
    session.status = "Running";
    session.sequence = 3;

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      id: "session-1",
      status: "Stopped",
      sequence: 2,
    });
  });

  test("late events for ignored sessions do not reactivate the session", () => {
    const ignored = {
      ...createDebugState(),
      ignoredSessionIds: { "session-1": true as const },
    };
    const stopped = markDebugSessionEvent(ignored, {
      session_id: "session-1",
      workspace_id: "workspace",
      workspace_root: "/repo",
      sequence: 5,
      status: "Stopped",
      reason: "breakpoint",
    });
    const running = markDebugSessionEvent(stopped, {
      session_id: "session-1",
      workspace_id: "workspace",
      workspace_root: "/repo",
      sequence: 6,
      status: "Running",
      reason: null,
    });

    expect(running.sessions).toEqual([]);
    expect(running.activeSessionId).toBeNull();
    expect(running.sessionSequenceById["session-1"]).toBeUndefined();
    expect(running.ignoredSessionIds["session-1"]).toBe(true);
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

  test("ignores duplicate same-sequence console events", () => {
    const current = appendDebugConsole(createDebugState(), {
      session_id: "session-1",
      workspace_id: "workspace",
      workspace_root: "/repo",
      sequence: 5,
      chunk: "current",
    });
    const duplicate = appendDebugConsole(current, {
      session_id: "session-1",
      workspace_id: "workspace",
      workspace_root: "/repo",
      sequence: 5,
      chunk: "duplicate",
    });

    expect(duplicate.consoleBySessionId["session-1"]).toBe("current");
    expect(duplicate.consoleSequenceById["session-1"]).toBe(5);
  });

  test("debug command input types reject unsupported backend variants", () => {
    const input: DebugLaunchConfigInput = {
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
    };
    const event: DebugSessionEvent = {
      session_id: "session-1",
      workspace_id: "workspace",
      workspace_root: "/repo",
      sequence: 1,
      status: "Running",
      reason: null,
    };

    // @ts-expect-error Debug adapter command input must match backend variants.
    input.adapter = "Node";
    // @ts-expect-error Debug request command input must match backend variants.
    input.request = "Restart";
    // @ts-expect-error Debug session status must match backend variants.
    event.status = "Paused";

    expect(String(input.adapter)).toBe("Node");
    expect(String(input.request)).toBe("Restart");
    expect(String(event.status)).toBe("Paused");
  });
});

function debugSession(overrides: Partial<DebugSessionInfo> = {}): DebugSessionInfo {
  return {
    id: "session-1",
    workspace_id: "workspace",
    workspace_root: "/repo",
    config_id: "cfg-python",
    name: "Python",
    adapter: "Python",
    status: "Running",
    active_thread_id: null,
    stopped_reason: null,
    last_error: null,
    sequence: 1,
    ...overrides,
  };
}
