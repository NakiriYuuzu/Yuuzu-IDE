/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";

import { replaceAgentSessions } from "../features/agents/agent-model";
import { replaceDocsIndex } from "../features/docs/docs-model";
import {
  createLanguageState,
  replaceDiagnostics,
  replaceServerStatuses,
} from "../features/language/language-model";
import { createBrowserState } from "../features/browser/browser-model";
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

  test("agent sessions are restored per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateAgent("workspace-a", (agent) =>
      replaceAgentSessions(agent, [
        {
          id: "agent-1",
          workspace_root: "/repo-a",
          mode: "plan",
          prompt: "Plan",
          context_items: [],
          transcript: [],
          created_ms: 1,
          updated_ms: 1,
        },
      ]),
    );

    expect(store.getState().viewFor("workspace-a").agent.activeSessionId).toBe(
      "agent-1",
    );
    expect(store.getState().viewFor("workspace-b").agent.sessions).toEqual([]);
  });

  test("browser state is restored per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateBrowser("workspace-a", (browser) => ({
      ...browser,
      activeUrl: "http://localhost:5173",
      urlInput: "http://localhost:5173",
      status: "ready",
    }));

    expect(store.getState().viewFor("workspace-a").browser.activeUrl).toBe(
      "http://localhost:5173",
    );
    expect(store.getState().viewFor("workspace-b").browser.activeUrl).toBeNull();
  });

  test("browser update is scoped by workspace key including shell workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateBrowser("workspace-a", (browser) => ({
      ...browser,
      activeUrl: "http://localhost:5173",
    }));
    store.getState().updateBrowser(null, (browser) => ({
      ...browser,
      activeUrl: "http://localhost:3000",
    }));

    expect(store.getState().viewFor("workspace-a").browser.activeUrl).toBe(
      "http://localhost:5173",
    );
    expect(store.getState().viewFor("workspace-b").browser.activeUrl).toBeNull();
    expect(store.getState().viewFor(null).browser.activeUrl).toBe(
      "http://localhost:3000",
    );
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

    expect(() => {
      unknownView.browser.urlInput = "http://localhost:8080";
    }).toThrow(TypeError);

    expect(Object.isFrozen(unknownView.browser)).toBe(true);
    expect(Object.isFrozen(unknownView.browser.screenshots)).toBe(true);
    expect(Object.isFrozen(unknownView.browser.consoleErrors)).toBe(true);

    expect(() => {
      unknownView.browser.screenshots.push({
        id: "shot-1",
        workspace_root: "/unknown",
        url: "http://localhost:5173",
        title: "shot",
        data_url: "data:image/png;base64,abc",
        width: 100,
        height: 100,
        captured_ms: 1,
      });
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
        activePreviewPath: null,
        searchQuery: "",
        searchResult: null,
        selectedDocPaths: {},
        contextPacks: [],
        activePackId: null,
        packDraftName: "",
        loading: false,
        error: null,
      },
      browser: createBrowserState(),
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
      activePreviewPath: null,
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

  test("unknown workspace language defaults cannot be mutated across future defaults", () => {
    const store = createWorkspaceViewStore();

    const unknownView = store.getState().viewFor("unknown");

    expect(() => {
      unknownView.language.serverStatuses.push({
        workspace_id: "workspace",
        workspace_root: "/workspace",
        language: "Rust",
        display_name: "Rust Analyzer",
        state: "Running",
        pid: 10,
        memory_bytes: 1024,
        open_documents: 1,
        last_error: null,
      });
    }).toThrow(TypeError);

    expect(() => {
      unknownView.language.serverLogs.push("initialized");
    }).toThrow(TypeError);

    expect(() => {
      unknownView.language.diagnosticsByPath["src/main.rs"] = [
        {
          path: "src/main.rs",
          range: {
            start_line: 1,
            start_character: 0,
            end_line: 1,
            end_character: 4,
          },
          severity: "error",
          message: "expected item",
          source: "rust-analyzer",
        },
      ];
    }).toThrow(TypeError);

    expect(() => {
      unknownView.language.activeHover = {
        path: "src/main.rs",
        line: 1,
        character: 1,
        contents: "fn main",
      };
    }).toThrow(TypeError);

    expect(store.getState().viewFor("other-unknown").language).toMatchObject({
      diagnosticsByPath: {},
      serverStatuses: [],
      activeHover: null,
      serverLogs: [],
      loading: false,
      error: null,
    });
  });

  test("language state is restored per workspace", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateView("workspace-a", {
      language: replaceDiagnostics(createLanguageState(), [
        {
          path: "src/main.rs",
          range: {
            start_line: 1,
            start_character: 0,
            end_line: 1,
            end_character: 4,
          },
          severity: "error",
          message: "expected item",
          source: "rust-analyzer",
        },
      ]),
    });

    expect(
      store
        .getState()
        .viewFor("workspace-a")
        .language.diagnosticsByPath["src/main.rs"],
    ).toHaveLength(1);
    expect(
      store.getState().viewFor("workspace-b").language.diagnosticsByPath,
    ).toEqual({});
  });

  test("language functional updates compose without dropping prior state", () => {
    const store = createWorkspaceViewStore();

    store.getState().updateLanguage("workspace-a", (language) =>
      replaceDiagnostics(language, [
        {
          path: "src/main.rs",
          range: {
            start_line: 1,
            start_character: 0,
            end_line: 1,
            end_character: 4,
          },
          severity: "error",
          message: "expected item",
          source: "rust-analyzer",
        },
      ]),
    );
    store.getState().updateLanguage("workspace-a", (language) =>
      replaceServerStatuses(language, [
        {
          workspace_id: "workspace-a",
          workspace_root: "/workspace-a",
          language: "Rust",
          display_name: "Rust Analyzer",
          state: "Running",
          pid: 10,
          memory_bytes: 1024,
          open_documents: 1,
          last_error: null,
        },
      ]),
    );

    const language = store.getState().viewFor("workspace-a").language;
    expect(language.diagnosticsByPath["src/main.rs"]).toHaveLength(1);
    expect(language.serverStatuses).toHaveLength(1);
  });
});
