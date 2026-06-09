/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test";

import type { WorkspaceRegistry } from "../features/workspace/workspace-api";

const listWorkspacesMock = mock<() => Promise<WorkspaceRegistry>>();

mock.module("../features/workspace/workspace-api", () => ({
  addWorkspace: mock(() => Promise.reject(new Error("unexpected addWorkspace call"))),
  listWorkspaces: listWorkspacesMock,
  openWorkspacePath: mock(() =>
    Promise.reject(new Error("unexpected openWorkspacePath call")),
  ),
  pickWorkspaceFolder: mock(() =>
    Promise.reject(new Error("unexpected pickWorkspaceFolder call")),
  ),
  pinWorkspace: mock(() => Promise.reject(new Error("unexpected pinWorkspace call"))),
  removeWorkspace: mock(() =>
    Promise.reject(new Error("unexpected removeWorkspace call")),
  ),
  scanDirectory: mock(() => Promise.reject(new Error("unexpected scanDirectory call"))),
  scanWorkspace: mock(() => Promise.reject(new Error("unexpected scanWorkspace call"))),
  switchWorkspace: mock(() =>
    Promise.reject(new Error("unexpected switchWorkspace call")),
  ),
}));

describe("workspace bootstrap", () => {
  test("loads the persisted registry once across concurrent callers", async () => {
    const {
      loadWorkspaceRegistry,
      resetWorkspaceBootstrapForTests,
    } = await import("./workspace-bootstrap");

    resetWorkspaceBootstrapForTests();
    listWorkspacesMock.mockClear();

    const persistedRegistry: WorkspaceRegistry = {
      active_workspace_id: null,
      workspaces: [],
    };

    listWorkspacesMock.mockResolvedValueOnce(persistedRegistry);

    const [first, second] = await Promise.all([
      loadWorkspaceRegistry(),
      loadWorkspaceRegistry(),
    ]);

    expect(first).toBe(persistedRegistry);
    expect(second).toBe(persistedRegistry);
    expect(listWorkspacesMock).toHaveBeenCalledTimes(1);
  });

  test("retries loading after a rejected registry request", async () => {
    const {
      loadWorkspaceRegistry,
      resetWorkspaceBootstrapForTests,
    } = await import("./workspace-bootstrap");

    resetWorkspaceBootstrapForTests();
    listWorkspacesMock.mockClear();

    const persistedRegistry: WorkspaceRegistry = {
      active_workspace_id: null,
      workspaces: [],
    };

    listWorkspacesMock
      .mockRejectedValueOnce(new Error("registry unavailable"))
      .mockResolvedValueOnce(persistedRegistry);

    await expect(loadWorkspaceRegistry()).rejects.toThrow(
      "registry unavailable",
    );

    await expect(loadWorkspaceRegistry()).resolves.toBe(persistedRegistry);
    expect(listWorkspacesMock).toHaveBeenCalledTimes(2);
  });

  test("displays path labels for POSIX and Windows separators", async () => {
    const { workspacePathLabel } = await import("./workspace-bootstrap");

    expect(workspacePathLabel("./workspaces/yuuzu-api")).toBe("yuuzu-api");
    expect(workspacePathLabel("C:\\workspaces\\yuuzu-web")).toBe("yuuzu-web");
    expect(workspacePathLabel("")).toBe("workspace");
  });
});
