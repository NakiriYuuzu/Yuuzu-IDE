export type GitGraphEdge = {
  from_lane: number;
  to_lane: number;
  kind: "through" | "fork" | "join" | "stop";
};

export type GitRefKind = "head" | "branch" | "tag";

export type GitLogRef = { name: string; kind: GitRefKind };

export type GitLogRow = {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  when_unix: number;
  refs: GitLogRef[];
  parents: string[];
  lane: number;
  lane_overflow: boolean;
  merge: boolean;
  edges: GitGraphEdge[];
};

export type GitLogFilter = {
  branch?: string;
  author?: string;
  since?: string;
  grep?: string;
  path?: string;
};

export type GitLogPage = {
  rows: GitLogRow[];
  has_more: boolean;
  total_loaded: number;
  truncated: boolean;
};

export type CommitFileChange = {
  status: string;
  path: string;
  old_path: string | null;
  additions: number;
  deletions: number;
};

export type GitCommitDetail = {
  hash: string;
  short_hash: string;
  subject: string;
  body: string;
  author: string;
  author_email: string;
  when_unix: number;
  parents: string[];
  refs: GitLogRef[];
  files: CommitFileChange[];
  files_truncated: boolean;
};

export type GitExportScope = "changed_files" | "snapshot";
export type GitExportFormat = "folder" | "zip";

export type GitExportDialog = {
  hash: string;
  scope: GitExportScope;
  format: GitExportFormat;
  destination: string;
  overwrite: boolean;
};

export type GitExportReport = {
  written_files: number;
  total_bytes: number;
  skipped_deleted: number;
  destination: string;
};

export type GitResetMode = "soft" | "mixed" | "hard";

export type GitLogState = {
  rows: GitLogRow[];
  hasMore: boolean;
  truncated: boolean;
  loadedPages: number;
  loading: boolean;
  error: string | null;
  filter: GitLogFilter;
  selectedHash: string | null;
  detailByHash: Record<string, GitCommitDetail>;
  exportDialog: GitExportDialog | null;
};

export const LOG_PAGE_SIZE = 200;

export function createGitLogState(): GitLogState {
  return {
    rows: [],
    hasMore: false,
    truncated: false,
    loadedPages: 0,
    loading: false,
    error: null,
    filter: {},
    selectedHash: null,
    detailByHash: {},
    exportDialog: null,
  };
}

export function storeLogPage(state: GitLogState, page: GitLogPage): GitLogState {
  return {
    ...state,
    rows: page.rows,
    hasMore: page.has_more,
    truncated: page.truncated,
    loadedPages: Math.ceil(page.total_loaded / LOG_PAGE_SIZE),
    loading: false,
    error: null,
  };
}

export function setLogFilter(state: GitLogState, filter: GitLogFilter): GitLogState {
  return {
    ...state,
    filter,
    rows: [],
    hasMore: false,
    truncated: false,
    loadedPages: 0,
    selectedHash: null,
  };
}

export function selectLogCommit(state: GitLogState, hash: string | null): GitLogState {
  return { ...state, selectedHash: hash };
}

export function storeCommitDetail(state: GitLogState, detail: GitCommitDetail): GitLogState {
  return {
    ...state,
    detailByHash: { ...state.detailByHash, [detail.hash]: detail },
  };
}

export function setLogLoading(state: GitLogState, loading: boolean): GitLogState {
  return { ...state, loading };
}

export function setLogError(state: GitLogState, error: string | null): GitLogState {
  return { ...state, error, loading: false };
}

export function openExportDialog(state: GitLogState, hash: string): GitLogState {
  return {
    ...state,
    exportDialog: {
      hash,
      scope: "changed_files",
      format: "folder",
      destination: "",
      overwrite: false,
    },
  };
}

export function closeExportDialog(state: GitLogState): GitLogState {
  return { ...state, exportDialog: null };
}

export function setExportField<K extends keyof GitExportDialog>(
  state: GitLogState,
  field: K,
  value: GitExportDialog[K],
): GitLogState {
  if (!state.exportDialog) {
    return state;
  }
  return {
    ...state,
    exportDialog: { ...state.exportDialog, [field]: value },
  };
}

export const laneX = (lane: number) => 14 + lane * 20;

export function edgePath(edge: GitGraphEdge): string {
  const fx = laneX(edge.from_lane);
  const tx = laneX(edge.to_lane);
  switch (edge.kind) {
    case "through":
      return `M${fx} -4 L${fx} 40`;
    case "stop":
      return `M${fx} -4 L${fx} 18`;
    case "fork":
      return `M${fx} 18 C ${fx} 30, ${tx} 28, ${tx} 40`;
    case "join":
      return `M${fx} -4 C ${fx} 8, ${tx} 10, ${tx} 18`;
  }
}

export function formatWhen(whenUnix: number, nowUnix: number): string {
  const delta = Math.max(0, nowUnix - whenUnix);
  if (delta < 60) {
    return "just now";
  }
  if (delta < 3_600) {
    return `${Math.floor(delta / 60)}m ago`;
  }
  if (delta < 86_400) {
    return `${Math.floor(delta / 3_600)}h ago`;
  }
  if (delta < 30 * 86_400) {
    return `${Math.floor(delta / 86_400)}d ago`;
  }
  const date = new Date(whenUnix * 1000);
  return date.toISOString().slice(0, 10);
}
