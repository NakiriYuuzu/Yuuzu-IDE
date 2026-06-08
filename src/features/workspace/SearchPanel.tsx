import { FileCode2, Search } from "lucide-react";
import { useRef, useState } from "react";

import { useWorkspaceStore } from "../../app/workspace-store";
import { searchWorkspace } from "../files/file-api";
import {
  searchSummary,
  type WorkspaceSearchResult,
} from "../files/search-model";

type SearchPanelProps = {
  onOpenFile: (path: string) => void;
};

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function SearchPanel({ onOpenFile }: SearchPanelProps) {
  const registry = useWorkspaceStore((state) => state.registry);
  const activeWorkspace =
    registry.workspaces.find(
      (workspace) => workspace.id === registry.active_workspace_id,
    ) ?? null;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<WorkspaceSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  async function runSearch(nextQuery = query) {
    const trimmedQuery = nextQuery.trim();

    if (!activeWorkspace || !trimmedQuery) {
      requestRef.current += 1;
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const nextResult = await searchWorkspace(activeWorkspace.path, trimmedQuery);
      if (requestId !== requestRef.current) {
        return;
      }

      setResult(nextResult);
      setError(null);
    } catch (err) {
      if (requestId !== requestRef.current) {
        return;
      }

      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
      }
    }
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    if (!nextQuery.trim()) {
      requestRef.current += 1;
      setResult(null);
      setError(null);
      setLoading(false);
    }
  }

  return (
    <div className="panel-body search-panel">
      <label className="search-box">
        <Search aria-hidden="true" />
        <input
          value={query}
          aria-label="Search workspace"
          placeholder="Search"
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void runSearch();
            }
          }}
        />
      </label>

      {loading ? <div className="search-summary">Searching...</div> : null}
      {!loading && result ? (
        <div className="search-summary">{searchSummary(result)}</div>
      ) : null}
      {error ? <div className="panel-error-inline">{error}</div> : null}

      {result?.filename_matches.map((item) => (
        <button
          type="button"
          className="row tree-row"
          key={`file-${item.path}`}
          title={item.path}
          onClick={() => onOpenFile(item.path)}
        >
          <FileCode2 aria-hidden="true" />
          <span className="nm mono">{item.name}</span>
          <span className="meta">filename</span>
        </button>
      ))}

      {result?.text_matches.map((file) => (
        <div key={`text-${file.path}`}>
          <button
            type="button"
            className="row tree-row"
            title={file.path}
            onClick={() => onOpenFile(file.path)}
          >
            <FileCode2 aria-hidden="true" />
            <span className="nm mono">{fileNameFromPath(file.path)}</span>
            <span className="meta">{file.hits.length}</span>
          </button>
          {file.hits.map((hit) => (
            <button
              type="button"
              className="row tree-row search-hit"
              key={`${file.path}:${hit.line_number}:${hit.line}`}
              title={`${file.path}:${hit.line_number}`}
              onClick={() => onOpenFile(file.path)}
            >
              <span className="tw mono">{hit.line_number}</span>
              <span className="nm mono">{hit.line.trim()}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
