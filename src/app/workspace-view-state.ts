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
  | "docs-preview";

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

export function createWorkspaceViewStore() {
  return create<WorkspaceViewStore>((set, get) => ({
    views: { [shellKey]: defaultWorkspaceView() },
    viewFor: (workspaceId) =>
      get().views[workspaceId ?? shellKey] ?? defaultView,
    updateView: (workspaceId, patch) =>
      set((state) => {
        const key = workspaceId ?? shellKey;
        const current = state.views[key] ?? defaultView;

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
        const current = state.views[key] ?? defaultView;

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
        const current = state.views[key] ?? defaultView;

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
        const current = state.views[key] ?? defaultView;

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
        const current = state.views[key] ?? defaultView;

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
        const current = state.views[key] ?? defaultView;

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
        const current = state.views[key] ?? defaultView;

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
        const current = state.views[key] ?? defaultView;

        return {
          views: {
            ...state.views,
            [key]: { ...current, agent: update(current.agent) },
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
