import { create } from "zustand";

import type { WorkspaceRegistry } from "../features/workspace/workspace-api";

type WorkspaceState = {
  registry: WorkspaceRegistry;
  setRegistry: (registry: WorkspaceRegistry) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  registry: {
    active_workspace_id: null,
    workspaces: [],
  },
  setRegistry: (registry) => set({ registry }),
}));
