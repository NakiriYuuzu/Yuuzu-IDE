import { create } from "zustand";

import type {
  Workspace,
  WorkspaceRegistry,
} from "../features/workspace/workspace-api";

type WorkspaceState = {
  registry: WorkspaceRegistry;
  setRegistry: (registry: WorkspaceRegistry) => void;
  activeWorkspace: () => Workspace | null;
};

function createEmptyRegistry(): WorkspaceRegistry {
  return {
    active_workspace_id: null,
    workspaces: [],
  };
}

export function createWorkspaceStore() {
  return create<WorkspaceState>((set, get) => ({
    registry: createEmptyRegistry(),
    setRegistry: (registry) => set({ registry }),
    activeWorkspace: () => {
      const registry = get().registry;
      return (
        registry.workspaces.find(
          (workspace) => workspace.id === registry.active_workspace_id,
        ) ?? null
      );
    },
  }));
}

export const workspaceStore = createWorkspaceStore();
export const useWorkspaceStore = workspaceStore;

export type WorkspaceStoreApi = typeof workspaceStore;
