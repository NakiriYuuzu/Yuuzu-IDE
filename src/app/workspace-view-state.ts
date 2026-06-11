import { create, type StoreApi, useStore } from "zustand";

import {
  createAgentState,
  type AgentViewState,
} from "../features/agents/agent-model";
import {
  createDocsState,
  type DocsViewState,
} from "../features/docs/docs-model";
import type { EditorFileState } from "../features/files/file-model";
import {
  createLanguageState,
  type LanguageViewState,
} from "../features/language/language-model";
import {
  createBrowserState,
  type BrowserViewState,
} from "../features/browser/browser-model";
import {
  createDatabaseState,
  type DatabaseViewState,
} from "../features/database/database-model";
import {
  createDebugState,
  type DebugViewState,
} from "../features/debug/debug-model";
import {
  createRemoteState,
  type RemoteViewState,
} from "../features/remote/remote-model";
import {
  createGitState,
  type GitViewState,
} from "../features/git/git-model";
import {
  createTaskState,
  type TaskViewState,
} from "../features/tasks/task-model";
import {
  createTerminalState,
  type TerminalViewState,
} from "../features/terminal/terminal-model";
import type { ActivityId } from "./activity-rail";

export type Surface =
  | "empty"
  | "editor"
  | "terminal"
  | "git-diff"
  | "git-graph"
  | "docs-preview"
  | "browser-preview"
  | "database-result"
  | "debug-console"
  | "ssh-terminal"
  | "sftp-browser";

export type WorkspaceViewState = {
  activeActivity: ActivityId;
  panelOpen: boolean;
  surface: Surface;
  editor: EditorFileState;
  agent: AgentViewState;
  terminal: TerminalViewState;
  task: TaskViewState;
  git: GitViewState;
  docs: DocsViewState;
  language: LanguageViewState;
  browser: BrowserViewState;
  database: DatabaseViewState;
  remote: RemoteViewState;
  debug: DebugViewState;
};

type WorkspaceViewStore = {
  views: Record<string, WorkspaceViewState>;
  viewFor: (workspaceId: string | null) => WorkspaceViewState;
  updateView: (
    workspaceId: string | null,
    patch: Partial<WorkspaceViewState>,
  ) => void;
  updateEditor: (
    workspaceId: string | null,
    update: (editor: EditorFileState) => EditorFileState,
  ) => void;
  updateTerminal: (
    workspaceId: string | null,
    update: (terminal: TerminalViewState) => TerminalViewState,
  ) => void;
  updateTask: (
    workspaceId: string | null,
    update: (task: TaskViewState) => TaskViewState,
  ) => void;
  updateGit: (
    workspaceId: string | null,
    update: (git: GitViewState) => GitViewState,
  ) => void;
  updateDocs: (
    workspaceId: string | null,
    update: (docs: DocsViewState) => DocsViewState,
  ) => void;
  updateLanguage: (
    workspaceId: string | null,
    update: (language: LanguageViewState) => LanguageViewState,
  ) => void;
  updateAgent: (
    workspaceId: string | null,
    update: (agent: AgentViewState) => AgentViewState,
  ) => void;
  updateBrowser: (
    workspaceId: string | null,
    update: (browser: BrowserViewState) => BrowserViewState,
  ) => void;
  updateDatabase: (
    workspaceId: string | null,
    update: (database: DatabaseViewState) => DatabaseViewState,
  ) => void;
  updateRemote: (
    workspaceId: string | null,
    update: (remote: RemoteViewState) => RemoteViewState,
  ) => void;
  updateDebug: (
    workspaceId: string | null,
    update: (debug: DebugViewState) => DebugViewState,
  ) => void;
};

function defaultWorkspaceView(): WorkspaceViewState {
  return {
    activeActivity: "explorer",
    panelOpen: true,
    surface: "empty",
    editor: { tabs: [], activePath: null },
    agent: createAgentState(),
    terminal: createTerminalState(),
    task: createTaskState(),
    git: createGitState(),
    docs: createDocsState(),
    language: createLanguageState(),
    browser: createBrowserState(),
    database: createDatabaseState(),
    remote: createRemoteState(),
    debug: createDebugState(),
  };
}

function freezeWorkspaceView(view: WorkspaceViewState): WorkspaceViewState {
  Object.freeze(view.editor.tabs);
  Object.freeze(view.editor);
  Object.freeze(view.terminal.sessions);
  Object.freeze(view.terminal.outputBySessionId);
  Object.freeze(view.terminal.pendingOutputBySessionId);
  Object.freeze(view.terminal.pendingExitBySessionId);
  Object.freeze(view.terminal.ignoredSessionIds);
  Object.freeze(view.terminal);
  Object.freeze(view.task.detectedTasks);
  Object.freeze(view.task.runs);
  Object.freeze(view.task.outputByRunId);
  Object.freeze(view.task.problemsByRunId);
  Object.freeze(view.task.pendingOutputByRunId);
  Object.freeze(view.task.pendingFinishByRunId);
  Object.freeze(view.task.contextPackByRunId);
  Object.freeze(view.task);
  if (view.git.status) {
    Object.freeze(view.git.status.changes);
    Object.freeze(view.git.status);
  }
  Object.freeze(view.git.diffByKey);
  Object.freeze(view.git.branches);
  for (const commit of view.git.graph) {
    Object.freeze(commit.refs);
  }
  Object.freeze(view.git.graph);
  Object.freeze(view.git);
  Object.freeze(view.docs.index);
  for (const preview of Object.values(view.docs.previewByPath)) {
    Object.freeze(preview.references);
    Object.freeze(preview);
  }
  Object.freeze(view.docs.previewByPath);
  if (view.docs.searchResult) {
    Object.freeze(view.docs.searchResult.matches);
    Object.freeze(view.docs.searchResult);
  }
  Object.freeze(view.docs.selectedDocPaths);
  for (const pack of view.docs.contextPacks) {
    Object.freeze(pack.doc_paths);
    Object.freeze(pack.linked_task_run_ids);
    Object.freeze(pack.linked_agent_session_ids);
    Object.freeze(pack);
  }
  Object.freeze(view.docs.contextPacks);
  Object.freeze(view.docs);
  Object.freeze(view.language.serverStatuses);
  for (const status of view.language.serverStatuses) {
    Object.freeze(status);
  }
  Object.freeze(view.language.diagnosticsByPath);
  for (const diagnostics of Object.values(view.language.diagnosticsByPath)) {
    Object.freeze(diagnostics);
  }
  if (view.language.activeHover) {
    Object.freeze(view.language.activeHover);
  }
  Object.freeze(view.language.serverLogs);
  Object.freeze(view.language);
  if (view.browser.bounds) {
    Object.freeze(view.browser.bounds);
  }
  for (const screenshot of view.browser.screenshots) {
    Object.freeze(screenshot);
  }
  for (const error of view.browser.consoleErrors) {
    Object.freeze(error);
  }
  Object.freeze(view.browser.screenshots);
  Object.freeze(view.browser.consoleErrors);
  Object.freeze(view.browser);
  Object.freeze(view.database.profiles);
  Object.freeze(view.database.history);
  for (const entry of view.database.history) {
    Object.freeze(entry);
  }
  Object.freeze(view.database.schemaByProfileId);
  for (const schema of Object.values(view.database.schemaByProfileId)) {
    Object.freeze(schema.tables);
    for (const table of schema.tables) {
      Object.freeze(table.columns);
    }
    Object.freeze(schema);
  }
  if (view.database.activeResult) {
    Object.freeze(view.database.activeResult.columns);
    Object.freeze(view.database.activeResult.rows);
    for (const row of view.database.activeResult.rows) {
      Object.freeze(row.cells);
      for (const cell of row.cells) {
        Object.freeze(cell);
      }
      Object.freeze(row);
    }
    Object.freeze(view.database.activeResult.classification);
    Object.freeze(view.database.activeResult);
  }
  if (view.database.confirmation) {
    Object.freeze(view.database.confirmation);
  }
  if (view.database.export) {
    Object.freeze(view.database.export);
  }
  Object.freeze(view.database);
  Object.freeze(view.remote.hosts);
  Object.freeze(view.remote.connectionByHostId);
  Object.freeze(view.remote.sshSessions);
  Object.freeze(view.remote.sshOutputBySessionId);
  Object.freeze(view.remote.pendingSshOutputBySessionId);
  Object.freeze(view.remote.pendingSshExitBySessionId);
  Object.freeze(view.remote.ignoredSshSessionIds);
  Object.freeze(view.remote.sftpPathByHostId);
  Object.freeze(view.remote.sftpEntriesByHostPath);
  for (const entries of Object.values(view.remote.sftpEntriesByHostPath)) {
    Object.freeze(entries);
  }
  Object.freeze(view.remote.commandResults);
  Object.freeze(view.remote.commandOutputByRunId);
  if (view.remote.transfer) {
    Object.freeze(view.remote.transfer);
  }
  Object.freeze(view.remote);
  for (const config of view.debug.launchConfigs) {
    Object.freeze(config.args);
    for (const env of config.env) {
      Object.freeze(env);
    }
    Object.freeze(config.env);
    if (config.attach) {
      Object.freeze(config.attach);
    }
    Object.freeze(config);
  }
  Object.freeze(view.debug.launchConfigs);
  for (const session of view.debug.sessions) {
    Object.freeze(session);
  }
  Object.freeze(view.debug.sessions);
  for (const breakpoints of Object.values(view.debug.breakpointsByPath)) {
    for (const breakpoint of breakpoints) {
      Object.freeze(breakpoint);
    }
    Object.freeze(breakpoints);
  }
  Object.freeze(view.debug.breakpointsByPath);
  for (const frames of Object.values(view.debug.stackBySessionId)) {
    for (const frame of frames) {
      Object.freeze(frame);
    }
    Object.freeze(frames);
  }
  Object.freeze(view.debug.stackBySessionId);
  for (const scopes of Object.values(view.debug.scopesByFrameId)) {
    for (const scope of scopes) {
      Object.freeze(scope);
    }
    Object.freeze(scopes);
  }
  Object.freeze(view.debug.scopesByFrameId);
  for (const variables of Object.values(view.debug.variablesByReference)) {
    for (const variable of variables) {
      Object.freeze(variable);
    }
    Object.freeze(variables);
  }
  Object.freeze(view.debug.variablesByReference);
  for (const watch of view.debug.watches) {
    Object.freeze(watch);
  }
  Object.freeze(view.debug.watches);
  Object.freeze(view.debug.consoleBySessionId);
  Object.freeze(view.debug.sessionSequenceById);
  Object.freeze(view.debug.consoleSequenceById);
  Object.freeze(view.debug.ignoredSessionIds);
  Object.freeze(view.debug);
  Object.freeze(view.agent.selectedContextIds);
  for (const session of view.agent.sessions) {
    Object.freeze(session.context_items);
    for (const contextItem of session.context_items) {
      Object.freeze(contextItem);
    }
    Object.freeze(session.transcript);
    for (const transcript of session.transcript) {
      Object.freeze(transcript);
    }
    Object.freeze(session);
  }
  Object.freeze(view.agent.sessions);
  Object.freeze(view.agent);
  return Object.freeze(view);
}

const defaultView: WorkspaceViewState = freezeWorkspaceView(
  defaultWorkspaceView(),
);
const shellKey = "__shell__";
const defaultViewsByKey: Record<string, WorkspaceViewState> = {};

function defaultViewForKey(key: string): WorkspaceViewState {
  if (key === shellKey) {
    return defaultView;
  }

  defaultViewsByKey[key] ??= freezeWorkspaceView(defaultWorkspaceView());
  return defaultViewsByKey[key];
}

export function createWorkspaceViewStore() {
  return create<WorkspaceViewStore>((set, get) => ({
    views: { [shellKey]: defaultWorkspaceView() },
    viewFor: (workspaceId) =>
      get().views[workspaceId ?? shellKey] ??
      defaultViewForKey(workspaceId ?? shellKey),
    updateView: (workspaceId, patch) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, ...patch },
          },
        };
      }),
    updateEditor: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, editor: update(current.editor) },
          },
        };
      }),
    updateTerminal: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, terminal: update(current.terminal) },
          },
        };
      }),
    updateTask: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, task: update(current.task) },
          },
        };
      }),
    updateGit: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, git: update(current.git) },
          },
        };
      }),
    updateDocs: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, docs: update(current.docs) },
          },
        };
      }),
    updateLanguage: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, language: update(current.language) },
          },
        };
      }),
    updateAgent: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, agent: update(current.agent) },
          },
        };
      }),
    updateBrowser: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, browser: update(current.browser) },
          },
        };
      }),
    updateDatabase: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, database: update(current.database) },
          },
        };
      }),
    updateRemote: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, remote: update(current.remote) },
          },
        };
      }),
    updateDebug: (workspaceId, update) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultViewForKey(key);

        return {
          views: {
            ...state.views,
            [key]: { ...current, debug: update(current.debug) },
          },
        };
      }),
  }));
}

export const workspaceViewStore = createWorkspaceViewStore();

export function useWorkspaceViewStore<T>(
  selector: (state: WorkspaceViewStore) => T,
): T {
  return useStore(workspaceViewStore, selector);
}

export type WorkspaceViewStoreApi = StoreApi<WorkspaceViewStore>;
