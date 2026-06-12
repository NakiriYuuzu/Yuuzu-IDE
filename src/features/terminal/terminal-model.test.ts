/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activateTerminal,
  bufferTerminalExit,
  closeTerminal,
  createTerminalState,
  markTerminalExited,
  upsertTerminal,
} from "./terminal-model";

describe("terminal model", () => {
  test("terminal view state no longer owns scrollback output", () => {
    expect(Object.keys(createTerminalState()).sort()).toEqual([
      "activeTerminalId",
      "cwdInput",
      "ignoredSessionIds",
      "pendingExitBySessionId",
      "sessions",
    ]);
  });

  test("upserts the first session and makes it active", () => {
    const state = upsertTerminal(createTerminalState(), {
      id: "w:terminal-1",
      workspace_id: "w",
      name: "zsh 1",
      cwd: "/repo",
      shell: "/bin/zsh",
      running: true,
    });

    expect(state.activeTerminalId).toBe("w:terminal-1");
    expect(state.sessions).toHaveLength(1);
  });

  test("closing the active terminal promotes the previous remaining session", () => {
    const state = upsertTerminal(
      upsertTerminal(createTerminalState(), {
        id: "w:terminal-1",
        workspace_id: "w",
        name: "zsh 1",
        cwd: "/repo",
        shell: "/bin/zsh",
        running: true,
      }),
      {
        id: "w:terminal-2",
        workspace_id: "w",
        name: "server",
        cwd: "/repo",
        shell: "/bin/zsh",
        running: true,
      },
    );

    const next = closeTerminal(
      activateTerminal(state, "w:terminal-2"),
      "w:terminal-2",
    );

    expect(next.activeTerminalId).toBe("w:terminal-1");
    expect(next.sessions.map((session) => session.id)).toEqual([
      "w:terminal-1",
    ]);
  });

  test("terminal exit marks the session stopped", () => {
    const state = upsertTerminal(createTerminalState(), {
      id: "w:terminal-1",
      workspace_id: "w",
      name: "zsh 1",
      cwd: "/repo",
      shell: "/bin/zsh",
      running: true,
    });

    const next = markTerminalExited(state, "w:terminal-1");

    expect(next.sessions[0]?.running).toBe(false);
  });

  test("exit before upsert marks the later upserted session stopped", () => {
    const buffered = bufferTerminalExit(createTerminalState(), "w:terminal-1");

    const state = upsertTerminal(buffered, {
      id: "w:terminal-1",
      workspace_id: "w",
      name: "zsh 1",
      cwd: "/repo",
      shell: "/bin/zsh",
      running: true,
    });

    expect(state.sessions[0]?.running).toBe(false);
    expect(state.pendingExitBySessionId["w:terminal-1"]).toBeUndefined();
  });

  test("exit after local close does not create pending terminal events", () => {
    const closed = closeTerminal(
      upsertTerminal(createTerminalState(), {
        id: "w:terminal-1",
        workspace_id: "w",
        name: "zsh 1",
        cwd: "/repo",
        shell: "/bin/zsh",
        running: true,
      }),
      "w:terminal-1",
    );

    const withLateExit = bufferTerminalExit(closed, "w:terminal-1");

    expect(withLateExit.ignoredSessionIds["w:terminal-1"]).toBe(true);
    expect(withLateExit.pendingExitBySessionId["w:terminal-1"]).toBeUndefined();
  });
});
