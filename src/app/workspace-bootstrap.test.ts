/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test";

import type { WorkspaceRegistry } from "../features/workspace/workspace-api";

const listWorkspacesMock = mock<() => Promise<WorkspaceRegistry>>();
const addWorkspaceMock = mock<
  (
    workspace: WorkspaceRegistry["workspaces"][number],
  ) => Promise<WorkspaceRegistry>
>();

mock.module("../features/workspace/workspace-api", () => ({
  listWorkspaces: listWorkspacesMock,
  addWorkspace: addWorkspaceMock,
}));

describe("workspace bootstrap", () => {
  test("seeds portable workspaces once across concurrent callers", async () => {
    const {
      loadSeededWorkspaceRegistry,
      resetWorkspaceBootstrapForTests,
    } = await import("./workspace-bootstrap");

    resetWorkspaceBootstrapForTests();

    const emptyRegistry: WorkspaceRegistry = {
      active_workspace_id: null,
      workspaces: [],
    };
    const seededRegistry: WorkspaceRegistry = {
      active_workspace_id: "yuuzu-api",
      workspaces: [
        {
          id: "yuuzu-api",
          name: "Yuuzu API",
          path: "./workspaces/yuuzu-api",
          pinned: true,
        },
      ],
    };

    listWorkspacesMock.mockResolvedValueOnce(emptyRegistry);
    addWorkspaceMock.mockResolvedValue(seededRegistry);

    const [first, second] = await Promise.all([
      loadSeededWorkspaceRegistry(),
      loadSeededWorkspaceRegistry(),
    ]);

    expect(first).toBe(seededRegistry);
    expect(second).toBe(seededRegistry);
    expect(listWorkspacesMock).toHaveBeenCalledTimes(1);
    expect(addWorkspaceMock).toHaveBeenCalledTimes(3);
    expect(addWorkspaceMock.mock.calls.map(([workspace]) => workspace.path)).toEqual([
      "./workspaces/yuuzu-api",
      "./workspaces/yuuzu-web",
      "./workspaces/yuuzu-cli",
    ]);
  });

  test("displays path labels for POSIX and Windows separators", async () => {
    const { workspacePathLabel } = await import("./workspace-bootstrap");

    expect(workspacePathLabel("./workspaces/yuuzu-api")).toBe("yuuzu-api");
    expect(workspacePathLabel("C:\\workspaces\\yuuzu-web")).toBe("yuuzu-web");
    expect(workspacePathLabel("")).toBe("workspace");
  });
});
