import { create, type StoreApi, useStore } from "zustand";

import type { EditorFileState } from "../features/files/file-model";
import type { ActivityId } from "./activity-rail";

export type Surface = "empty" | "editor" | "terminal";

export type WorkspaceViewState = {
  activeActivity: ActivityId;
  panelOpen: boolean;
  surface: Surface;
  editor: EditorFileState;
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
};

function defaultWorkspaceView(): WorkspaceViewState {
  return {
    activeActivity: "explorer",
    panelOpen: true,
    surface: "empty",
    editor: { tabs: [], activePath: null },
  };
}

const defaultView: WorkspaceViewState = Object.freeze(defaultWorkspaceView());
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
  }));
}

export const workspaceViewStore = createWorkspaceViewStore();

export function useWorkspaceViewStore<T>(
  selector: (state: WorkspaceViewStore) => T,
): T {
  return useStore(workspaceViewStore, selector);
}

export type WorkspaceViewStoreApi = StoreApi<WorkspaceViewStore>;
