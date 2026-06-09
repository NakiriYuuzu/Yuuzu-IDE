import { create, type StoreApi, useStore } from "zustand";

import type { EditorFileState } from "../features/files/file-model";
import {
  createTerminalState,
  type TerminalViewState,
} from "../features/terminal/terminal-model";
import type { ActivityId } from "./activity-rail";

export type Surface = "empty" | "editor" | "terminal";

export type WorkspaceViewState = {
  activeActivity: ActivityId;
  panelOpen: boolean;
  surface: Surface;
  editor: EditorFileState;
  terminal: TerminalViewState;
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
};

function defaultWorkspaceView(): WorkspaceViewState {
  return {
    activeActivity: "explorer",
    panelOpen: true,
    surface: "empty",
    editor: { tabs: [], activePath: null },
    terminal: createTerminalState(),
  };
}

function freezeWorkspaceView(view: WorkspaceViewState): WorkspaceViewState {
  Object.freeze(view.editor.tabs);
  Object.freeze(view.editor);
  Object.freeze(view.terminal.sessions);
  Object.freeze(view.terminal.outputBySessionId);
  Object.freeze(view.terminal);
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
  }));
}

export const workspaceViewStore = createWorkspaceViewStore();

export function useWorkspaceViewStore<T>(
  selector: (state: WorkspaceViewStore) => T,
): T {
  return useStore(workspaceViewStore, selector);
}

export type WorkspaceViewStoreApi = StoreApi<WorkspaceViewStore>;
