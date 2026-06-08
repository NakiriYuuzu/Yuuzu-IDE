import {
  addWorkspace,
  listWorkspaces,
  type Workspace,
  type WorkspaceRegistry,
} from "../features/workspace/workspace-api";

const seedWorkspaces: Workspace[] = [
  {
    id: "yuuzu-api",
    name: "Yuuzu API",
    path: "./workspaces/yuuzu-api",
    pinned: true,
  },
  {
    id: "yuuzu-web",
    name: "Yuuzu Web",
    path: "./workspaces/yuuzu-web",
    pinned: true,
  },
  {
    id: "yuuzu-cli",
    name: "Yuuzu CLI",
    path: "./workspaces/yuuzu-cli",
    pinned: false,
  },
];

let seededRegistryPromise: Promise<WorkspaceRegistry> | null = null;

export function loadSeededWorkspaceRegistry(): Promise<WorkspaceRegistry> {
  seededRegistryPromise ??= seedWorkspaceRegistry().catch((err: unknown) => {
    seededRegistryPromise = null;
    throw err;
  });

  return seededRegistryPromise;
}

export function workspacePathLabel(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  const label = parts[parts.length - 1];

  return label ?? "workspace";
}

export function resetWorkspaceBootstrapForTests() {
  seededRegistryPromise = null;
}

async function seedWorkspaceRegistry(): Promise<WorkspaceRegistry> {
  let registry = await listWorkspaces();

  for (const workspace of seedWorkspaces) {
    if (!registry.workspaces.some((item) => item.id === workspace.id)) {
      registry = await addWorkspace(workspace);
    }
  }

  return registry;
}
