/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test";

import { ensureTestDom } from "../../app/test-dom";
import {
  createRemoteState,
  replaceRemoteHosts,
  setRemoteMode,
  setSftpEntries,
  type RemoteViewState,
} from "./remote-model";
import { RemotePanel } from "./RemotePanel";

ensureTestDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});

function stateWithHost(): RemoteViewState {
  const state = replaceRemoteHosts(createRemoteState(), [
    {
      id: "edge",
      workspace_root: "/repo",
      name: "edge-01",
      host: "edge.example.com",
      port: 22,
      username: "deploy",
      auth: "Agent",
      default_remote_path: "/var/www",
      keepalive_seconds: 30,
      connect_timeout_seconds: 10,
      created_ms: 1,
      updated_ms: 1,
    },
  ]);

  return setSftpEntries(state, "edge", "/var/www", [
    {
      host_id: "edge",
      path: "/var/www/app.js",
      name: "app.js",
      kind: "File",
      size: 42,
      modified_ms: null,
      link_target: null,
    },
  ]);
}

describe("RemotePanel", () => {
  test("renders compact SSH host rows and opens SSH terminal", () => {
    const onOpenSsh = mock<(hostId: string) => void>(() => {});
    const view = render(
      <RemotePanel
        state={stateWithHost()}
        onModeChange={() => {}}
        onSelectHost={() => {}}
        onRefresh={() => {}}
        onCreateHost={() => {}}
        onConnectHost={() => {}}
        onOpenSsh={onOpenSsh}
        onOpenSftp={() => {}}
        onRunCommand={() => {}}
        onCommandDraftChange={() => {}}
        onListSftpDirectory={() => {}}
        onDownloadFile={() => {}}
        onUploadFile={() => {}}
      />,
    );

    expect(view.getByText("edge-01")).toBeTruthy();
    expect(view.getByText("deploy@edge.example.com")).toBeTruthy();

    fireEvent.click(view.getByLabelText("Open SSH for edge-01"));

    expect(onOpenSsh).toHaveBeenCalledWith("edge");
  });

  test("switches to SFTP and renders remote files", () => {
    const onModeChange = mock<(mode: RemoteViewState["mode"]) => void>(() => {});
    let state = stateWithHost();
    const view = render(
      <RemotePanel
        state={state}
        onModeChange={onModeChange}
        onSelectHost={() => {}}
        onRefresh={() => {}}
        onCreateHost={() => {}}
        onConnectHost={() => {}}
        onOpenSsh={() => {}}
        onOpenSftp={() => {}}
        onRunCommand={() => {}}
        onCommandDraftChange={() => {}}
        onListSftpDirectory={() => {}}
        onDownloadFile={() => {}}
        onUploadFile={() => {}}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "SFTP" }));
    expect(onModeChange).toHaveBeenCalledWith("sftp");

    state = setRemoteMode(state, "sftp");
    view.rerender(
      <RemotePanel
        state={state}
        onModeChange={onModeChange}
        onSelectHost={() => {}}
        onRefresh={() => {}}
        onCreateHost={() => {}}
        onConnectHost={() => {}}
        onOpenSsh={() => {}}
        onOpenSftp={() => {}}
        onRunCommand={() => {}}
        onCommandDraftChange={() => {}}
        onListSftpDirectory={() => {}}
        onDownloadFile={() => {}}
        onUploadFile={() => {}}
      />,
    );

    expect(view.getByText("deploy@edge-01:/var/www")).toBeTruthy();
    expect(view.getByText("app.js")).toBeTruthy();
  });

  test("enables remote command run only with active host and draft", () => {
    const onCommandDraftChange = mock<(value: string) => void>(() => {});
    const onRunCommand = mock<() => void>(() => {});
    const state = setRemoteMode(stateWithHost(), "commands");
    const view = render(
      <RemotePanel
        state={state}
        onModeChange={() => {}}
        onSelectHost={() => {}}
        onRefresh={() => {}}
        onCreateHost={() => {}}
        onConnectHost={() => {}}
        onOpenSsh={() => {}}
        onOpenSftp={() => {}}
        onRunCommand={onRunCommand}
        onCommandDraftChange={onCommandDraftChange}
        onListSftpDirectory={() => {}}
        onDownloadFile={() => {}}
        onUploadFile={() => {}}
      />,
    );

    const input = view.getByLabelText("Remote command") as HTMLInputElement;
    const runButton = view.getByRole("button", {
      name: "Run remote command",
    }) as HTMLButtonElement;

    expect(runButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "ls -la" } });
    expect(onCommandDraftChange).toHaveBeenCalledWith("ls -la");

    view.rerender(
      <RemotePanel
        state={{ ...state, commandDraft: "ls -la" }}
        onModeChange={() => {}}
        onSelectHost={() => {}}
        onRefresh={() => {}}
        onCreateHost={() => {}}
        onConnectHost={() => {}}
        onOpenSsh={() => {}}
        onOpenSftp={() => {}}
        onRunCommand={onRunCommand}
        onCommandDraftChange={onCommandDraftChange}
        onListSftpDirectory={() => {}}
        onDownloadFile={() => {}}
        onUploadFile={() => {}}
      />,
    );

    const enabledRunButton = view.getByRole("button", {
      name: "Run remote command",
    }) as HTMLButtonElement;
    expect(enabledRunButton.disabled).toBe(false);

    fireEvent.click(enabledRunButton);
    expect(onRunCommand).toHaveBeenCalled();
  });
});
