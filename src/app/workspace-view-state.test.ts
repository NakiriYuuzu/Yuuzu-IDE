/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { replaceDocsIndex } from "../features/docs/docs-model";
import { upsertTaskRun } from "../features/tasks/task-model";
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

  test("task runs are restored per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateTask("workspace-a", (task) =>
      upsertTaskRun(task, {
        id: "workspace-a:task-1",
        workspace_id: "workspace-a",
        label: "bun test",
        command: "bun test",
        cwd: "/repo-a",
        status: "Running",
        exit_code: null,
      }),
    );

    expect(store.getState().viewFor("workspace-a").task.activeRunId).toBe(
      "workspace-a:task-1",
    );
    expect(store.getState().viewFor("workspace-b").task.runs).toEqual([]);
  });

  test("docs state is restored per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateDocs("workspace-a", (docs) =>
      replaceDocsIndex(docs, [
        {
          path: "README.md",
          title: "Readme",
          section: "workspace",
          modified_ms: 1,
          size_bytes: 10,
          stale: false,
        },
      ]),
    );

    expect(store.getState().viewFor("workspace-a").docs.index).toHaveLength(1);
    expect(store.getState().viewFor("workspace-b").docs.index).toEqual([]);
  });

  test("unknown workspace task defaults cannot be mutated across future defaults", () => {
    const store = createWorkspaceViewStore();

    const unknownView = store.getState().viewFor("unknown");

    expect(() => {
      unknownView.task.customCommand = "bun test";
    }).toThrow(TypeError);

    expect(() => {
      unknownView.task.detectedTasks.push({
        id: "package:test",
        label: "bun run test",
        command: "bun run test",
        cwd: "/unknown",
        source: "package.json",
      });
    }).toThrow(TypeError);

    expect(() => {
      unknownView.task.outputByRunId["unknown:task-1"] = "boot";
    }).toThrow(TypeError);

    expect(store.getState().viewFor("other-unknown").task).toMatchObject({
      detectedTasks: [],
      runs: [],
      activeRunId: null,
      outputByRunId: {},
      problemsByRunId: {},
      pendingOutputByRunId: {},
      pendingFinishByRunId: {},
      customCommand: "",
    });
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

    expect(() => {
      unknownView.terminal.pendingExitBySessionId["unknown:terminal-1"] = true;
    }).toThrow(TypeError);

    expect(() => {
      unknownView.terminal.ignoredSessionIds["unknown:terminal-1"] = true;
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
        pendingExitBySessionId: {},
        ignoredSessionIds: {},
        cwdInput: "",
      },
      task: {
        detectedTasks: [],
        runs: [],
        activeRunId: null,
        outputByRunId: {},
        problemsByRunId: {},
        pendingOutputByRunId: {},
        pendingFinishByRunId: {},
        customCommand: "",
      },
      docs: {
        index: [],
        previewByPath: {},
        searchQuery: "",
        searchResult: null,
        selectedDocPaths: {},
        contextPacks: [],
        activePackId: null,
        packDraftName: "",
        loading: false,
        error: null,
      },
    });
  });

  test("unknown workspace docs defaults cannot be mutated across future defaults", () => {
    const store = createWorkspaceViewStore();

    const unknownView = store.getState().viewFor("unknown");

    expect(() => {
      unknownView.docs.packDraftName = "pack";
    }).toThrow(TypeError);

    expect(() => {
      unknownView.docs.index.push({
        path: "README.md",
        title: "Readme",
        section: "workspace",
        modified_ms: 1,
        size_bytes: 10,
        stale: false,
      });
    }).toThrow(TypeError);

    expect(() => {
      unknownView.docs.selectedDocPaths["README.md"] = true;
    }).toThrow(TypeError);

    expect(store.getState().viewFor("other-unknown").docs).toMatchObject({
      index: [],
      previewByPath: {},
      searchQuery: "",
      searchResult: null,
      selectedDocPaths: {},
      contextPacks: [],
      activePackId: null,
      packDraftName: "",
      loading: false,
      error: null,
    });
  });
});
