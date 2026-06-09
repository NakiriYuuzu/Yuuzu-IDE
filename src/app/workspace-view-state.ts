import { create, type StoreApi, useStore } from "zustand";

import {
  createDocsState,
  type DocsViewState,
} from "../features/docs/docs-model";
import type { EditorFileState } from "../features/files/file-model";
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
  terminal: TerminalViewState;
  task: TaskViewState;
  git: GitViewState;
  docs: DocsViewState;
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
};

function defaultWorkspaceView(): WorkspaceViewState {
  return {
    activeActivity: "explorer",
    panelOpen: true,
    surface: "empty",
    editor: { tabs: [], activePath: null },
    terminal: createTerminalState(),
    task: createTaskState(),
    git: createGitState(),
    docs: createDocsState(),
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
  }));
}

export const workspaceViewStore = createWorkspaceViewStore();

export function useWorkspaceViewStore<T>(
  selector: (state: WorkspaceViewStore) => T,
): T {
  return useStore(workspaceViewStore, selector);
}

export type WorkspaceViewStoreApi = StoreApi<WorkspaceViewStore>;
