import { open } from "@tauri-apps/plugin-dialog";

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

export type FileTreeEntry = {
  name: string;
  path: string;
  is_dir: boolean;
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

export function openWorkspacePath(path: string): Promise<WorkspaceRegistry> {
  return call<WorkspaceRegistry>("open_workspace_path", { path });
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false });

  return typeof picked === "string" ? picked : null;
}

export function removeWorkspace(id: string): Promise<WorkspaceRegistry> {
  return call<WorkspaceRegistry>("remove_workspace", { id });
}

export function pinWorkspace(
  id: string,
  pinned: boolean,
): Promise<WorkspaceRegistry> {
  return call<WorkspaceRegistry>("pin_workspace", { id, pinned });
}

export function scanWorkspace(path: string): Promise<FileTreeEntry[]> {
  return call<FileTreeEntry[]>("scan_workspace", { path });
}
