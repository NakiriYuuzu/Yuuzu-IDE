import { FileCode2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useWorkspaceStore } from "../../app/workspace-store";
import { searchWorkspace } from "../files/file-api";
import {
  createSearchRequestIdentity,
  searchSummary,
  shouldApplySearchResult,
  type SearchRequestIdentity,
  type WorkspaceSearchResult,
} from "../files/search-model";

type SearchPanelProps = {
  onOpenFile: (path: string) => void;
};

type SearchResultState = {
  identity: SearchRequestIdentity;
  value: WorkspaceSearchResult;
};

type SearchErrorState = {
  identity: SearchRequestIdentity;
  message: string;
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
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const activeWorkspacePath = activeWorkspace?.path ?? null;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResultState | null>(null);
  const [error, setError] = useState<SearchErrorState | null>(null);
  const [loadingIdentity, setLoadingIdentity] =
    useState<SearchRequestIdentity | null>(null);
  const requestRef = useRef(0);
  const currentIdentityRef = useRef<SearchRequestIdentity>(
    createSearchRequestIdentity({
      requestId: 0,
      workspaceId: null,
      workspacePath: null,
      query: "",
    }),
  );

  const currentRenderIdentity = createSearchRequestIdentity({
    requestId: currentIdentityRef.current.requestId,
    workspaceId: activeWorkspaceId,
    workspacePath: activeWorkspacePath,
    query,
  });
  const visibleResult =
    result && shouldApplySearchResult(result.identity, currentRenderIdentity)
      ? result.value
      : null;
  const visibleError =
    error && shouldApplySearchResult(error.identity, currentRenderIdentity)
      ? error.message
      : null;
  const isLoading =
    loadingIdentity &&
    shouldApplySearchResult(loadingIdentity, currentRenderIdentity);

  function setCurrentIdentity(nextQuery: string): SearchRequestIdentity {
    const identity = createSearchRequestIdentity({
      requestId: requestRef.current + 1,
      workspaceId: activeWorkspaceId,
      workspacePath: activeWorkspacePath,
      query: nextQuery,
    });
    requestRef.current = identity.requestId;
    currentIdentityRef.current = identity;
    return identity;
  }

  useEffect(() => {
    setCurrentIdentity(query);
    setResult(null);
    setError(null);
    setLoadingIdentity(null);
  }, [activeWorkspaceId, activeWorkspacePath]);

  async function runSearch(nextQuery = query) {
    const requestIdentity = setCurrentIdentity(nextQuery);

    if (!requestIdentity.workspacePath || !requestIdentity.query) {
      setResult(null);
      setError(null);
      setLoadingIdentity(null);
      return;
    }

    setLoadingIdentity(requestIdentity);
    setError(null);

    try {
      const nextResult = await searchWorkspace(
        requestIdentity.workspacePath,
        requestIdentity.query,
      );
      if (
        !shouldApplySearchResult(requestIdentity, currentIdentityRef.current)
      ) {
        return;
      }

      setResult({ identity: requestIdentity, value: nextResult });
      setError(null);
    } catch (err) {
      if (
        !shouldApplySearchResult(requestIdentity, currentIdentityRef.current)
      ) {
        return;
      }

      setResult(null);
      setError({
        identity: requestIdentity,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (shouldApplySearchResult(requestIdentity, currentIdentityRef.current)) {
        setLoadingIdentity(null);
      }
    }
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setCurrentIdentity(nextQuery);
    setResult(null);
    setError(null);
    setLoadingIdentity(null);
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

      {isLoading ? <div className="search-summary">Searching...</div> : null}
      {!isLoading && visibleResult ? (
        <div className="search-summary">{searchSummary(visibleResult)}</div>
      ) : null}
      {visibleError ? (
        <div className="panel-error-inline">{visibleError}</div>
      ) : null}

      {visibleResult?.filename_matches.map((item) => (
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

      {visibleResult?.text_matches.map((file) => (
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
