import {
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  openWorkspacePath,
  pickWorkspaceFolder,
  pinWorkspace,
  removeWorkspace,
  switchWorkspace,
  type Workspace,
} from "../features/workspace/workspace-api";
import {
  loadWorkspaceRegistry,
  workspacePathLabel,
} from "./workspace-bootstrap";
import { useWorkspaceStore } from "./workspace-store";

export function WorkspaceSwitcher() {
  const { registry, setRegistry } = useWorkspaceStore();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRegistry() {
      try {
        const next = await loadWorkspaceRegistry();

        if (!cancelled) {
          setRegistry(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void loadRegistry();

    return () => {
      cancelled = true;
    };
  }, [setRegistry]);

  const activeWorkspace = useMemo(
    () =>
      registry.workspaces.find(
        (workspace) => workspace.id === registry.active_workspace_id,
      ) ?? registry.workspaces[0],
    [registry],
  );

  async function selectWorkspace(id: string) {
    try {
      const next = await switchWorkspace(id);
      setRegistry(next);
      setOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openFolderWorkspace() {
    try {
      const path = await pickWorkspaceFolder();
      if (!path) {
        return;
      }
      const next = await openWorkspacePath(path);
      setRegistry(next);
      setOpen(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleWorkspacePinned(workspace: Workspace) {
    try {
      const next = await pinWorkspace(workspace.id, !workspace.pinned);
      setRegistry(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteWorkspace(id: string) {
    try {
      const next = await removeWorkspace(id);
      setRegistry(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="workspace-switcher">
      <button
        type="button"
        className="proj"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="glyph" aria-hidden="true">
          {(activeWorkspace?.name ?? "Y").slice(0, 1)}
        </span>
        <span className="pname">{activeWorkspace?.name ?? "Workspace"}</span>
        <span className="pbranch">
          <Folder aria-hidden="true" />
          {activeWorkspace ? workspacePathLabel(activeWorkspace.path) : "loading"}
        </span>
        <ChevronDown aria-hidden="true" />
      </button>

      {open ? (
        <div className="menu workspace-menu" role="menu">
          <div className="mlabel">Switch workspace</div>
          <button
            type="button"
            className="mi"
            role="menuitem"
            onClick={() => void openFolderWorkspace()}
          >
            <FolderOpen aria-hidden="true" />
            <span>Open folder</span>
          </button>
          <div className="msep" />
          {registry.workspaces.map((workspace) => {
            const pinLabel = workspace.pinned
              ? `Unpin ${workspace.name}`
              : `Pin ${workspace.name}`;
            const removeLabel = `Remove ${workspace.name}`;

            return (
              <div
                className="workspace-row"
                key={workspace.id}
                role="none"
              >
                <button
                  type="button"
                  className="mi workspace-row-main"
                  role="menuitem"
                  onClick={() => void selectWorkspace(workspace.id)}
                >
                  <span className="glyph" aria-hidden="true">
                    {workspace.name.slice(0, 1)}
                  </span>
                  <span className="workspace-copy">
                    <span>{workspace.name}</span>
                    <span className="mono">{workspace.path}</span>
                  </span>
                  {workspace.id === registry.active_workspace_id ? (
                    <Check className="chk" aria-hidden="true" />
                  ) : null}
                </button>
                <div className="workspace-row-actions">
                  <button
                    type="button"
                    className={`iconbtn${workspace.pinned ? " on" : ""}`}
                    role="menuitem"
                    title={pinLabel}
                    aria-label={pinLabel}
                    onClick={() => void toggleWorkspacePinned(workspace)}
                  >
                    {workspace.pinned ? (
                      <PinOff aria-hidden="true" />
                    ) : (
                      <Pin aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="iconbtn"
                    role="menuitem"
                    title={removeLabel}
                    aria-label={removeLabel}
                    onClick={() => void deleteWorkspace(workspace.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
          {error ? <div className="menu-error">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
