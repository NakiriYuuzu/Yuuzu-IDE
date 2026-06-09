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
  activePreviewPath: string | null;
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
    activePreviewPath: null,
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

export function docsSearchSummary(result: DocSearchResult): string {
  const matchCount = result.matches.length;
  const docCount = new Set(result.matches.map((match) => match.path)).size;
  const matchLabel = matchCount === 1 ? "match" : "matches";
  const docLabel = docCount === 1 ? "doc" : "docs";

  return `${matchCount} ${matchLabel} in ${docCount} ${docLabel}`;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function contextPackSummary(pack: ContextPack): string {
  return [
    countLabel(pack.doc_paths.length, "doc"),
    countLabel(pack.linked_task_run_ids.length, "task link"),
    countLabel(pack.linked_agent_session_ids.length, "agent link"),
  ].join(" | ");
}

export function contextPackByLinkedTaskRunId(
  packs: ContextPack[],
): Record<string, string> {
  const contextPackByRunId: Record<string, string> = {};

  for (const pack of packs) {
    for (const runId of pack.linked_task_run_ids) {
      contextPackByRunId[runId] = pack.id;
    }
  }

  return contextPackByRunId;
}

export function beginDocPreview(
  state: DocsViewState,
  path: string,
): DocsViewState {
  return { ...state, activePreviewPath: path, error: null };
}

export function shouldApplyDocPreview(
  state: DocsViewState,
  path: string,
): boolean {
  return state.activePreviewPath === path;
}

export function storeDocPreview(
  state: DocsViewState,
  preview: DocPreview,
): DocsViewState {
  return {
    ...state,
    activePreviewPath: preview.path,
    previewByPath: {
      ...state.previewByPath,
      [preview.path]: preview,
    },
    error: null,
  };
}

export function activeDocPreview(state: DocsViewState): DocPreview | null {
  return state.activePreviewPath
    ? (state.previewByPath[state.activePreviewPath] ?? null)
    : null;
}

export function staleReferenceCount(
  preview: DocPreview | null | undefined,
): number {
  return preview?.references.filter((reference) => reference.stale).length ?? 0;
}

export function docsPreviewPathLabel(
  state: DocsViewState,
  fallback: string,
): string {
  return activeDocPreview(state)?.path ?? state.activePreviewPath ?? fallback;
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
  const existingIndex = state.contextPacks.findIndex(
    (item) => item.id === pack.id,
  );
  const contextPacks =
    existingIndex === -1
      ? [...state.contextPacks, pack]
      : state.contextPacks.map((item, index) =>
          index === existingIndex ? pack : item,
        );

  return {
    ...state,
    contextPacks,
    activePackId: pack.id,
    packDraftName: "",
    error: null,
  };
}

export function updateContextPackDraftName(
  state: DocsViewState,
  packDraftName: string,
): DocsViewState {
  return { ...state, packDraftName };
}
