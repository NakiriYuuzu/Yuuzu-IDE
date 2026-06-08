import { Check, ChevronDown, Folder } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { switchWorkspace } from "../features/workspace/workspace-api";
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
          {registry.workspaces.map((workspace) => (
            <button
              type="button"
              className="mi"
              key={workspace.id}
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
          ))}
          {error ? <div className="menu-error">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
