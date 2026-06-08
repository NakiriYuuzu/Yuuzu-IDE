/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { useWorkspaceStore } from "./workspace-store";

describe("useWorkspaceStore", () => {
  test("starts empty and accepts a workspace registry", () => {
    expect(useWorkspaceStore.getState().registry).toEqual({
      active_workspace_id: null,
      workspaces: [],
    });

    useWorkspaceStore.getState().setRegistry({
      active_workspace_id: "api",
      workspaces: [
        {
          id: "api",
          name: "API",
          path: "./workspaces/api",
          pinned: true,
        },
      ],
    });

    expect(useWorkspaceStore.getState().registry.active_workspace_id).toBe(
      "api",
    );
    expect(useWorkspaceStore.getState().registry.workspaces).toHaveLength(1);
    expect(useWorkspaceStore.getState().registry.workspaces[0]?.name).toBe(
      "API",
    );
  });
});
