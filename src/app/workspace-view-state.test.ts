/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { upsertTerminal } from "../features/terminal/terminal-model";
import { createWorkspaceViewStore } from "./workspace-view-state";

describe("createWorkspaceViewStore", () => {
  test("restores surface and activity per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateView("alpha", {
      surface: "editor",
      activeActivity: "search",
    });
    store.getState().updateView("beta", {
      surface: "terminal",
      activeActivity: "terminal",
    });

    expect(store.getState().viewFor("alpha")).toMatchObject({
      surface: "editor",
      activeActivity: "search",
    });
    expect(store.getState().viewFor("beta")).toMatchObject({
      surface: "terminal",
      activeActivity: "terminal",
    });
  });

  test("empty workspace id uses a stable shell view", () => {
    const store = createWorkspaceViewStore();

    expect(store.getState().viewFor(null)).toMatchObject({
      surface: "empty",
      activeActivity: "explorer",
      panelOpen: true,
    });
  });

  test("shell view can be updated", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateView(null, {
      surface: "terminal",
      activeActivity: "terminal",
      panelOpen: false,
    });

    expect(store.getState().viewFor(null)).toMatchObject({
      surface: "terminal",
      activeActivity: "terminal",
      panelOpen: false,
    });
  });

  test("partial workspace updates preserve existing fields", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateView("alpha", {
      surface: "editor",
      panelOpen: false,
    });
    store.getState().updateView("alpha", {
      activeActivity: "search",
    });

    expect(store.getState().viewFor("alpha")).toMatchObject({
      surface: "editor",
      activeActivity: "search",
      panelOpen: false,
    });
  });

  test("editor tabs are restored per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateEditor("a", () => ({
      tabs: [
        {
          path: "/a/src/main.ts",
          name: "main.ts",
          dirty: false,
          tooLarge: false,
          version: { modified_ms: 1, len: 1 },
          externalChange: false,
        },
      ],
      activePath: "/a/src/main.ts",
    }));

    expect(store.getState().viewFor("a").editor.activePath).toBe(
      "/a/src/main.ts",
    );
    expect(store.getState().viewFor("b").editor.activePath).toBeNull();
  });

  test("terminal sessions are restored per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateTerminal("workspace-a", (terminal) =>
      upsertTerminal(terminal, {
        id: "workspace-a:terminal-1",
        workspace_id: "workspace-a",
        name: "zsh 1",
        cwd: "/repo-a",
        shell: "/bin/zsh",
        running: true,
      }),
    );

    expect(store.getState().viewFor("workspace-a").terminal.activeTerminalId).toBe(
      "workspace-a:terminal-1",
    );
    expect(store.getState().viewFor("workspace-b").terminal.sessions).toEqual([]);
  });

  test("unknown workspace defaults use a stable reference", () => {
    const store = createWorkspaceViewStore();

    expect(store.getState().viewFor("unknown")).toBe(
      store.getState().viewFor("unknown"),
    );
  });

  test("unknown workspace defaults cannot be mutated across future defaults", () => {
    const store = createWorkspaceViewStore();

    const unknownView = store.getState().viewFor("unknown");

    expect(() => {
      unknownView.surface = "terminal";
    }).toThrow(TypeError);

    expect(() => {
      unknownView.editor.tabs.push({
        path: "/unknown/src/main.ts",
        name: "main.ts",
        dirty: false,
        tooLarge: false,
        version: null,
        externalChange: false,
      });
    }).toThrow(TypeError);

    expect(() => {
      unknownView.terminal.cwdInput = "/unknown";
    }).toThrow(TypeError);

    expect(() => {
      unknownView.terminal.sessions.push({
        id: "unknown:terminal-1",
        workspace_id: "unknown",
        name: "zsh 1",
        cwd: "/unknown",
        shell: "/bin/zsh",
        running: true,
      });
    }).toThrow(TypeError);

    expect(() => {
      unknownView.terminal.pendingOutputBySessionId["unknown:terminal-1"] =
        "boot";
    }).toThrow(TypeError);

    expect(store.getState().viewFor("other-unknown")).toMatchObject({
      surface: "empty",
      activeActivity: "explorer",
      panelOpen: true,
      editor: { tabs: [], activePath: null },
      terminal: {
        sessions: [],
        activeTerminalId: null,
        outputBySessionId: {},
        pendingOutputBySessionId: {},
        cwdInput: "",
      },
    });
  });
});
