/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  activateTerminal,
  appendTerminalOutput,
  bufferTerminalOutput,
  closeTerminal,
  createTerminalState,
  markTerminalExited,
  upsertTerminal,
} from "./terminal-model";

describe("terminal model", () => {
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

  test("output append is bounded per terminal and ignores missing session", () => {
    const missing = appendTerminalOutput(
      createTerminalState(),
      "missing",
      "ignored",
    );
    expect(missing.outputBySessionId).toEqual({});

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

    const withOutput = appendTerminalOutput(
      appendTerminalOutput(state, "w:terminal-1", "a".repeat(120_000)),
      "w:terminal-1",
      "tail",
    );
    const unchanged = appendTerminalOutput(
      withOutput,
      "missing",
      "still ignored",
    );

    expect(unchanged.outputBySessionId["w:terminal-1"]).toHaveLength(120_000);
    expect(unchanged.outputBySessionId["w:terminal-1"]).toEndWith("tail");
    expect(unchanged.outputBySessionId["w:terminal-2"]).toBe("");
    expect(unchanged.outputBySessionId.missing).toBeUndefined();
  });

  test("buffered output before upsert is preserved and merged into the session", () => {
    const buffered = bufferTerminalOutput(
      createTerminalState(),
      "w:terminal-1",
      "boot\n",
    );

    const state = upsertTerminal(buffered, {
      id: "w:terminal-1",
      workspace_id: "w",
      name: "zsh 1",
      cwd: "/repo",
      shell: "/bin/zsh",
      running: true,
    });

    expect(state.outputBySessionId["w:terminal-1"]).toBe("boot\n");
    expect(state.pendingOutputBySessionId["w:terminal-1"]).toBeUndefined();
  });

  test("terminal exit marks the session stopped while preserving output", () => {
    const state = appendTerminalOutput(
      upsertTerminal(createTerminalState(), {
        id: "w:terminal-1",
        workspace_id: "w",
        name: "zsh 1",
        cwd: "/repo",
        shell: "/bin/zsh",
        running: true,
      }),
      "w:terminal-1",
      "last output\n",
    );

    const next = markTerminalExited(state, "w:terminal-1");

    expect(next.sessions[0]?.running).toBe(false);
    expect(next.outputBySessionId["w:terminal-1"]).toBe("last output\n");
  });
});
