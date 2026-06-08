import {
  listWorkspaces,
  type WorkspaceRegistry,
} from "../features/workspace/workspace-api";

let registryPromise: Promise<WorkspaceRegistry> | null = null;

export function loadWorkspaceRegistry(): Promise<WorkspaceRegistry> {
  registryPromise ??= listWorkspaces().catch((err: unknown) => {
    registryPromise = null;
    throw err;
  });

  return registryPromise;
}

export function workspacePathLabel(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  const label = parts[parts.length - 1];

  return label ?? "workspace";
}

export function resetWorkspaceBootstrapForTests() {
  registryPromise = null;
}
