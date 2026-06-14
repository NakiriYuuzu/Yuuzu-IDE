/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { createWorkspaceStore, useWorkspaceStore } from "./workspace-store";

describe("createWorkspaceStore", () => {
  test("starts empty and accepts a workspace registry", () => {
    const store = createWorkspaceStore();

    expect(store.getState().registry.workspaces).toHaveLength(0);

    store.getState().setRegistry({
      active_workspace_id: "one",
      workspaces: [
        {
          id: "one",
          name: "One",
          path: "/tmp/one",
          pinned: false,
        },
      ],
    });

    expect(store.getState().activeWorkspace()?.id).toBe("one");
  });

  test("reports missing active workspace as null", () => {
    const store = createWorkspaceStore();

    store.getState().setRegistry({
      active_workspace_id: "missing",
      workspaces: [],
    });

    expect(store.getState().activeWorkspace()).toBeNull();
  });

  test("keeps the initial registry isolated between store instances", () => {
    const first = createWorkspaceStore();

    first.getState().registry.workspaces.push({
      id: "leaked",
      name: "Leaked",
      path: "/tmp/leaked",
      pinned: false,
    });

    const second = createWorkspaceStore();

    expect(second.getState().registry.workspaces).toHaveLength(0);
  });

  test("preserves the exported bound store api", () => {
    expect(typeof useWorkspaceStore.getState).toBe("function");

    expect(useWorkspaceStore.getState().registry.workspaces).toHaveLength(0);
  });
});
