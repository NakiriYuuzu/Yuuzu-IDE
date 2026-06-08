import { ChevronDown, ChevronRight, FileCode2, Folder } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useWorkspaceStore } from "../../app/workspace-store";
import { scanWorkspace, type FileTreeEntry } from "./workspace-api";

type FileTreePanelProps = {
  refreshKey?: number;
};

function iconClass(entry: FileTreeEntry): string {
  if (entry.is_dir) {
    return "ico-folder";
  }

  const lowerName = entry.name.toLowerCase();
  if (lowerName.endsWith(".rs")) {
    return "ico-rs";
  }

  if (lowerName.endsWith(".ts") || lowerName.endsWith(".tsx")) {
    return "ico-ts";
  }

  return "";
}

export function FileTreePanel({ refreshKey = 0 }: FileTreePanelProps) {
  const registry = useWorkspaceStore((state) => state.registry);
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activeWorkspace = useMemo(
    () =>
      registry.workspaces.find(
        (workspace) => workspace.id === registry.active_workspace_id,
      ),
    [registry],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadEntries(path: string) {
      setLoading(true);

      try {
        const next = await scanWorkspace(path);

        if (!cancelled) {
          setEntries(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setEntries([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (activeWorkspace) {
      void loadEntries(activeWorkspace.path);
    } else {
      setEntries([]);
      setError(null);
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, refreshKey]);

  if (!activeWorkspace) {
    return (
      <div className="panel-empty">
        <span>No workspace selected</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-empty">
        <span>Workspace path unavailable</span>
        <small>{error}</small>
      </div>
    );
  }

  return (
    <div className="panel-body">
      <div className="section-label">
        <span>{activeWorkspace.name}</span>
        <ChevronDown aria-hidden="true" />
      </div>

      {loading ? (
        <div className="row">
          <span className="tw" />
          <span className="nm mono">Scanning...</span>
        </div>
      ) : null}

      {!loading && !error && entries.length === 0 ? (
        <div className="row">
          <span className="tw" />
          <span className="nm mono">No top-level entries</span>
        </div>
      ) : null}

      {!loading && !error
        ? entries.map((entry) => {
            const className = iconClass(entry);
            const Icon = entry.is_dir ? Folder : FileCode2;

            return (
              <div className="row" key={entry.path} title={entry.path}>
                <span className="tw">
                  {entry.is_dir ? <ChevronRight aria-hidden="true" /> : null}
                </span>
                <Icon className={className} aria-hidden="true" />
                <span className="nm mono">{entry.name}</span>
              </div>
            );
          })
        : null}
    </div>
  );
}
