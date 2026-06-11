/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import {
  appendRemoteCommandOutput,
  appendSshTerminalOutput,
  bufferSshTerminalExit,
  bufferSshTerminalOutput,
  closeSshTerminal,
  createRemoteState,
  markRemoteConnection,
  replaceRemoteHosts,
  setRemoteCommandResult,
  setSftpEntries,
  upsertSshTerminal,
} from "./remote-model";

describe("remote model", () => {
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

  test("SSH output is bounded and buffered late output is flushed on upsert", () => {
    const buffered = bufferSshTerminalOutput(
      createRemoteState(),
      "edge:ssh-1",
      "boot\n",
    );
    const state = upsertSshTerminal(buffered, {
      id: "edge:ssh-1",
      host_id: "edge",
      workspace_id: "workspace",
      name: "deploy@edge",
      running: true,
    });
    const withOutput = appendSshTerminalOutput(
      appendSshTerminalOutput(state, "edge:ssh-1", "a".repeat(120_000)),
      "edge:ssh-1",
      "tail",
    );

    expect(state.sshOutputBySessionId["edge:ssh-1"]).toBe("boot\n");
    expect(withOutput.sshOutputBySessionId["edge:ssh-1"]).toHaveLength(120_000);
    expect(withOutput.sshOutputBySessionId["edge:ssh-1"]).toEndWith("tail");
    expect(withOutput.pendingSshOutputBySessionId["edge:ssh-1"]).toBeUndefined();
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

  test("closing a terminal ignores late output and exit for that session", () => {
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
    const withLateOutput = bufferSshTerminalOutput(closed, "edge:ssh-1", "late");
    const withLateExit = bufferSshTerminalExit(withLateOutput, "edge:ssh-1");

    expect(withLateExit.pendingSshOutputBySessionId["edge:ssh-1"]).toBeUndefined();
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
});
