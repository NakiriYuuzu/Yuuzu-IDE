import { call } from "../../lib/tauri";

export type Workspace = {
  id: string;
  name: string;
  path: string;
  pinned: boolean;
};

export type WorkspaceRegistry = {
  active_workspace_id: string | null;
  workspaces: Workspace[];
};

export function listWorkspaces(): Promise<WorkspaceRegistry> {
  return call<WorkspaceRegistry>("list_workspaces");
}

export function addWorkspace(
  workspace: Workspace,
): Promise<WorkspaceRegistry> {
  return call<WorkspaceRegistry>("add_workspace", { workspace });
}

export function switchWorkspace(id: string): Promise<WorkspaceRegistry> {
  return call<WorkspaceRegistry>("switch_workspace", { id });
}
