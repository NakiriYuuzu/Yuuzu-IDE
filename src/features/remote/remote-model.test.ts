/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  appendRemoteCommandOutput,
  bufferSshTerminalExit,
  closeSshTerminal,
  createRemoteState,
  markRemoteConnection,
  recordRemoteTransfer,
  replaceRemoteHosts,
  setRemoteCommandResult,
  setSftpEntries,
  upsertSshTerminal,
} from "./remote-model";

describe("remote model", () => {
  test("remote view state no longer owns ssh scrollback output", () => {
    const keys = Object.keys(createRemoteState());

    expect(keys).not.toContain("sshOutputBySessionId");
    expect(keys).not.toContain("pendingSshOutputBySessionId");
  });

  test("replaces hosts, selects the first host initially, and keeps active host when present", () => {
    const edge = {
      id: "edge",
      workspace_root: "/repo",
      name: "edge-01",
      host: "edge.example.com",
      port: 22,
      username: "deploy",
      auth: "Agent" as const,
      default_remote_path: "/var/www",
      keepalive_seconds: 30,
      connect_timeout_seconds: 10,
      created_ms: 1,
      updated_ms: 1,
    };
    const worker = {
      ...edge,
      id: "worker",
      name: "worker-01",
      host: "worker.example.com",
      updated_ms: 2,
    };

    const first = replaceRemoteHosts(createRemoteState(), [edge, worker]);
    const second = replaceRemoteHosts(first, [worker, edge]);

    expect(first.activeHostId).toBe("edge");
    expect(second.activeHostId).toBe("edge");
  });

  test("upserting a later SSH terminal makes it active", () => {
    const state = upsertSshTerminal(
      upsertSshTerminal(createRemoteState(), {
        id: "edge:ssh-1",
        host_id: "edge",
        workspace_id: "workspace",
        name: "deploy@edge",
        running: true,
      }),
      {
        id: "edge:ssh-2",
        host_id: "edge",
        workspace_id: "workspace",
        name: "logs@edge",
        running: true,
      },
    );

    expect(state.activeSshSessionId).toBe("edge:ssh-2");
  });

  test("terminal exit buffered before upsert marks later session stopped", () => {
    const buffered = bufferSshTerminalExit(createRemoteState(), "edge:ssh-1");
    const state = upsertSshTerminal(buffered, {
      id: "edge:ssh-1",
      host_id: "edge",
      workspace_id: "workspace",
      name: "deploy@edge",
      running: true,
    });

    expect(state.sshSessions[0]?.running).toBe(false);
    expect(state.pendingSshExitBySessionId["edge:ssh-1"]).toBeUndefined();
  });

  test("closing a terminal ignores late exit for that session", () => {
    const closed = closeSshTerminal(
      upsertSshTerminal(createRemoteState(), {
        id: "edge:ssh-1",
        host_id: "edge",
        workspace_id: "workspace",
        name: "deploy@edge",
        running: true,
      }),
      "edge:ssh-1",
    );
    const withLateExit = bufferSshTerminalExit(closed, "edge:ssh-1");

    expect(withLateExit.ignoredSshSessionIds["edge:ssh-1"]).toBe(true);
    expect(withLateExit.pendingSshExitBySessionId["edge:ssh-1"]).toBeUndefined();
  });

  test("connection health and SFTP entries are host scoped", () => {
    const state = setSftpEntries(
      markRemoteConnection(createRemoteState(), {
        host_id: "edge",
        status: "Connected",
        message: null,
        checked_ms: 1,
      }),
      "edge",
      "/var/www",
      [
        {
          host_id: "edge",
          path: "/var/www/app.js",
          name: "app.js",
          kind: "File",
          size: 42,
          modified_ms: null,
          link_target: null,
        },
      ],
    );

    expect(state.connectionByHostId.edge?.status).toBe("Connected");
    expect(state.sftpEntriesByHostPath["edge:/var/www"]?.[0]?.name).toBe(
      "app.js",
    );
  });

  test("remote command output and result are bounded and recorded", () => {
    const state = setRemoteCommandResult(
      appendRemoteCommandOutput(createRemoteState(), "run-1", "a".repeat(120_000)),
      "run-1",
      {
        host_id: "edge",
        command: "uptime",
        stdout: "ok\n",
        stderr: "warn\n",
        exit_code: 0,
        duration_ms: 3,
      },
    );

    expect(state.commandOutputByRunId["run-1"]).toHaveLength(120_000);
    expect(state.commandOutputByRunId["run-1"]).toEndWith("ok\nwarn\n");
    expect(state.commandResults[0]?.command).toBe("uptime");
  });

  test("remote command results do not retain unbounded stdout or stderr", () => {
    const stdout = `${"o".repeat(120_000)}stdout-tail\n`;
    const stderr = `${"e".repeat(120_000)}stderr-tail\n`;
    const state = setRemoteCommandResult(createRemoteState(), "run-big", {
      host_id: "edge",
      command: "cat huge.log",
      stdout,
      stderr,
      exit_code: 0,
      duration_ms: 8,
    });
    const result = state.commandResults[0];
    const retainedOutput = `${result?.stdout ?? ""}${result?.stderr ?? ""}`;

    expect(retainedOutput.length).toBeLessThanOrEqual(120_000);
    expect(retainedOutput).toBe(state.commandOutputByRunId["run-big"]);
    expect(retainedOutput).toEndWith("stderr-tail\n");
  });

  test("records latest transfer result and clears stale errors", () => {
    const state = recordRemoteTransfer(
      { ...createRemoteState(), error: "old" },
      {
        remote_path: "/var/www/app.js",
        local_path: "/repo/downloads/app.js",
        bytes: 42,
      },
    );

    expect(state.transfer?.bytes).toBe(42);
    expect(state.error).toBeNull();
  });
});
