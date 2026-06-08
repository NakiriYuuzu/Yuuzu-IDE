import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useWorkspaceStore } from "../../app/workspace-store";
import {
  scanDirectory,
  scanWorkspace,
  type FileTreeEntry,
} from "./workspace-api";

type FileTreePanelProps = {
  refreshKey?: number;
  activeFilePath: string | null;
  onOpenFile: (path: string) => void;
  onCreateFile: (relativePath: string) => Promise<void>;
  onRenamePath: (path: string, newName: string) => Promise<void>;
  onDeletePath: (path: string) => Promise<void>;
};

type ExpandedPaths = Record<string, FileTreeEntry[]>;

function iconClass(entry: FileTreeEntry): string {
  if (entry.is_dir) {
    return "ico-folder";
  }

  const lowerName = entry.name.toLowerCase();
  if (lowerName.endsWith(".rs")) {
    return "ico-rs";
  }

  if (lowerName.endsWith(".md") || lowerName.endsWith(".mdx")) {
    return "ico-md";
  }

  if (lowerName.endsWith(".ts") || lowerName.endsWith(".tsx")) {
    return "ico-ts";
  }

  return "";
}

function iconForEntry(entry: FileTreeEntry) {
  if (entry.is_dir) {
    return Folder;
  }

  const lowerName = entry.name.toLowerCase();
  return lowerName.endsWith(".md") || lowerName.endsWith(".mdx")
    ? FileText
    : FileCode2;
}

function normalizeForCompare(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return (trimmed || path).replace(/\\/g, "/");
}

function relativePathFromWorkspace(
  workspaceRoot: string,
  path: string,
): string | null {
  const root = normalizeForCompare(workspaceRoot);
  const child = normalizeForCompare(path);

  if (child === root) {
    return "";
  }

  const prefix = `${root}/`;
  return child.startsWith(prefix) ? child.slice(prefix.length) : null;
}

function joinRelativePath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

function directoryAncestors(
  workspaceRoot: string,
  filePath: string,
): string[] {
  const root = normalizeForCompare(workspaceRoot);
  const file = normalizeForCompare(filePath);
  const relativePath = relativePathFromWorkspace(root, file);

  if (!relativePath) {
    return [];
  }

  const parts = relativePath.split("/");
  parts.pop();

  const ancestors: string[] = [];
  let current = root;
  for (const part of parts) {
    current = `${current}/${part}`;
    ancestors.push(current);
  }

  return ancestors;
}

function isExpanded(expandedPaths: ExpandedPaths, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(expandedPaths, path);
}

export function FileTreePanel({
  refreshKey = 0,
  activeFilePath,
  onOpenFile,
  onCreateFile,
  onRenamePath,
  onDeletePath,
}: FileTreePanelProps) {
  const registry = useWorkspaceStore((state) => state.registry);
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<ExpandedPaths>({});
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>(
    {},
  );
  const [directoryErrors, setDirectoryErrors] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activeWorkspace = useMemo(
    () =>
      registry.workspaces.find(
        (workspace) => workspace.id === registry.active_workspace_id,
      ),
    [registry],
  );

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!activeWorkspace) {
        return;
      }

      setLoadingPaths((current) => ({ ...current, [path]: true }));
      setExpandedPaths((current) =>
        isExpanded(current, path) ? current : { ...current, [path]: [] },
      );

      try {
        const next = await scanDirectory(activeWorkspace.path, path);
        setExpandedPaths((current) => ({ ...current, [path]: next }));
        setDirectoryErrors((current) => {
          const { [path]: _removed, ...rest } = current;
          return rest;
        });
      } catch (err) {
        setDirectoryErrors((current) => ({
          ...current,
          [path]: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setLoadingPaths((current) => {
          const { [path]: _removed, ...rest } = current;
          return rest;
        });
      }
    },
    [activeWorkspace],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadEntries(path: string) {
      setLoading(true);
      setExpandedPaths({});
      setDirectoryErrors({});

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

  useEffect(() => {
    if (!activeWorkspace || !activeFilePath) {
      return;
    }

    const ancestors = directoryAncestors(activeWorkspace.path, activeFilePath);
    for (const path of ancestors) {
      if (!isExpanded(expandedPaths, path) && !loadingPaths[path]) {
        void loadDirectory(path);
      }
    }
  }, [
    activeFilePath,
    activeWorkspace,
    expandedPaths,
    loadingPaths,
    loadDirectory,
  ]);

  async function toggleDirectory(entry: FileTreeEntry) {
    if (isExpanded(expandedPaths, entry.path)) {
      setExpandedPaths((current) => {
        const { [entry.path]: _removed, ...rest } = current;
        return rest;
      });
      return;
    }

    await loadDirectory(entry.path);
  }

  async function promptCreateFileInDirectory(entry: FileTreeEntry) {
    if (!activeWorkspace) {
      return;
    }

    const fileName = window.prompt(`New file in ${entry.name}`, "");
    const trimmed = fileName?.trim();
    if (!trimmed) {
      return;
    }

    const parent = relativePathFromWorkspace(activeWorkspace.path, entry.path);
    if (parent === null) {
      return;
    }

    await onCreateFile(joinRelativePath(parent, trimmed));
  }

  async function promptRenameEntry(entry: FileTreeEntry) {
    const newName = window.prompt(`Rename ${entry.name}`, entry.name);
    const trimmed = newName?.trim();
    if (!trimmed || trimmed === entry.name) {
      return;
    }

    await onRenamePath(entry.path, trimmed);
  }

  async function confirmDeleteEntry(entry: FileTreeEntry) {
    const kind = entry.is_dir ? "folder" : "file";
    if (!window.confirm(`Delete ${kind} ${entry.name}?`)) {
      return;
    }

    await onDeletePath(entry.path);
  }

  function renderEntries(nextEntries: FileTreeEntry[], depth: number) {
    return nextEntries.map((entry) => {
      const className = iconClass(entry);
      const Icon = iconForEntry(entry);
      const isOpen = isExpanded(expandedPaths, entry.path);
      const childEntries = expandedPaths[entry.path] ?? [];
      const isLoadingChildren = Boolean(loadingPaths[entry.path]);
      const childError = directoryErrors[entry.path];

      return (
        <div className="tree-node" key={entry.path}>
          <div className="tree-item">
            <button
              type="button"
              className={`row tree-row${
                entry.path === activeFilePath ? " sel" : ""
              }`}
              style={{ paddingLeft: 12 + depth * 14 }}
              title={entry.path}
              onClick={() =>
                entry.is_dir
                  ? void toggleDirectory(entry)
                  : onOpenFile(entry.path)
              }
            >
              <span className="tw">
                {entry.is_dir ? (
                  isOpen ? (
                    <ChevronDown aria-hidden="true" />
                  ) : (
                    <ChevronRight aria-hidden="true" />
                  )
                ) : null}
              </span>
              <Icon className={className} aria-hidden="true" />
              <span className="nm mono">{entry.name}</span>
            </button>
            <div className="tree-row-actions">
              {entry.is_dir ? (
                <button
                  type="button"
                  className="iconbtn tree-action"
                  title={`New file in ${entry.name}`}
                  aria-label={`New file in ${entry.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void promptCreateFileInDirectory(entry);
                  }}
                >
                  <Plus aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                className="iconbtn tree-action"
                title={`Rename ${entry.name}`}
                aria-label={`Rename ${entry.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void promptRenameEntry(entry);
                }}
              >
                <Pencil aria-hidden="true" />
              </button>
              <button
                type="button"
                className="iconbtn tree-action"
                title={`Delete ${entry.name}`}
                aria-label={`Delete ${entry.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void confirmDeleteEntry(entry);
                }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </div>

          {entry.is_dir && isOpen ? (
            <>
              {isLoadingChildren ? (
                <div
                  className="row"
                  style={{ paddingLeft: 12 + (depth + 1) * 14 }}
                >
                  <span className="tw" />
                  <span className="nm mono">Scanning...</span>
                </div>
              ) : null}

              {childError ? (
                <div
                  className="panel-error-inline"
                  style={{ paddingLeft: 12 + (depth + 1) * 14 }}
                >
                  {childError}
                </div>
              ) : null}

              {!isLoadingChildren && !childError && childEntries.length === 0 ? (
                <div
                  className="row"
                  style={{ paddingLeft: 12 + (depth + 1) * 14 }}
                >
                  <span className="tw" />
                  <span className="nm mono">Empty</span>
                </div>
              ) : null}

              {renderEntries(childEntries, depth + 1)}
            </>
          ) : null}
        </div>
      );
    });
  }

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

      {!loading && !error ? renderEntries(entries, 0) : null}
    </div>
  );
}
