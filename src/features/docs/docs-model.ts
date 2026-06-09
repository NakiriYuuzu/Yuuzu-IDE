export type DocIndexEntry = {
  path: string;
  title: string;
  section: string;
  modified_ms: number;
  size_bytes: number;
  stale: boolean;
};

export type DocReferenceHint = {
  target_path: string;
  exists: boolean;
  stale: boolean;
  reason: string;
};

export type DocPreview = {
  path: string;
  title: string;
  content: string;
  modified_ms: number;
  references: DocReferenceHint[];
};

export type DocSearchMatch = {
  path: string;
  title: string;
  line_number: number;
  line: string;
};

export type DocSearchResult = {
  matches: DocSearchMatch[];
  truncated: boolean;
};

export type ContextPack = {
  id: string;
  workspace_root: string;
  name: string;
  doc_paths: string[];
  linked_task_run_ids: string[];
  linked_agent_session_ids: string[];
  created_ms: number;
  updated_ms: number;
};

export type DocsRequestIdentity = {
  requestId: number;
  workspaceId: string | null;
  workspacePath: string | null;
  query: string;
};

export type DocsViewState = {
  index: DocIndexEntry[];
  previewByPath: Record<string, DocPreview>;
  searchQuery: string;
  searchResult: DocSearchResult | null;
  selectedDocPaths: Record<string, true>;
  contextPacks: ContextPack[];
  activePackId: string | null;
  packDraftName: string;
  loading: boolean;
  error: string | null;
};

export function createDocsState(): DocsViewState {
  return {
    index: [],
    previewByPath: {},
    searchQuery: "",
    searchResult: null,
    selectedDocPaths: {},
    contextPacks: [],
    activePackId: null,
    packDraftName: "",
    loading: false,
    error: null,
  };
}

export function createDocsRequestIdentity({
  requestId,
  workspaceId,
  workspacePath,
  query,
}: DocsRequestIdentity): DocsRequestIdentity {
  return {
    requestId,
    workspaceId,
    workspacePath,
    query: query.trim(),
  };
}

export function shouldApplyDocsResult(
  request: DocsRequestIdentity,
  current: DocsRequestIdentity,
): boolean {
  return (
    request.requestId === current.requestId &&
    request.workspaceId === current.workspaceId &&
    request.workspacePath === current.workspacePath &&
    request.query === current.query
  );
}

export function docsBadgeCount(state: DocsViewState): string | null {
  const count = state.index.filter((entry) => entry.stale).length;
  return count > 0 ? String(count) : null;
}

export function replaceDocsIndex(
  state: DocsViewState,
  index: DocIndexEntry[],
): DocsViewState {
  return { ...state, index, loading: false, error: null };
}

export function selectDocSource(
  state: DocsViewState,
  path: string,
  selected: boolean,
): DocsViewState {
  const nextSelected = { ...state.selectedDocPaths };

  if (selected) {
    nextSelected[path] = true;
  } else {
    delete nextSelected[path];
  }

  return { ...state, selectedDocPaths: nextSelected };
}

export function selectedDocPaths(state: DocsViewState): string[] {
  return Object.keys(state.selectedDocPaths);
}

export function storeContextPack(
  state: DocsViewState,
  pack: ContextPack,
): DocsViewState {
  const contextPacks = state.contextPacks.filter((item) => item.id !== pack.id);

  return {
    ...state,
    contextPacks: [...contextPacks, pack],
    activePackId: pack.id,
    packDraftName: "",
  };
}

export function updateContextPackDraftName(
  state: DocsViewState,
  packDraftName: string,
): DocsViewState {
  return { ...state, packDraftName };
}
