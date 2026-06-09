export type LspRange = {
  start_line: number;
  start_character: number;
  end_line: number;
  end_character: number;
};

export type LspDiagnostic = {
  path: string;
  range: LspRange;
  severity: "error" | "warning" | "information" | "hint" | string;
  message: string;
  source: string | null;
};

export type LanguageServerStatus = {
  workspace_id: string;
  workspace_root: string;
  language: "Rust" | "TypeScript" | "JavaScript" | "Python" | string;
  display_name: string;
  state: "Unsupported" | "MissingCommand" | "Running" | "Stopped" | "Error" | string;
  pid: number | null;
  memory_bytes: number | null;
  open_documents: number;
  last_error: string | null;
};

export type LanguageHover = {
  path: string;
  line: number;
  character: number;
  contents: string;
};

export type LanguageViewState = {
  diagnosticsByPath: Record<string, LspDiagnostic[]>;
  serverStatuses: LanguageServerStatus[];
  activeHover: LanguageHover | null;
  serverLogs: string[];
  loading: boolean;
  error: string | null;
};

export type LanguageRefreshRequestState = Record<
  string,
  { workspaceRoot: string; requestId: number }
>;

export type LanguageRefreshRequestNext = {
  state: LanguageRefreshRequestState;
  requestId: number;
};

export function diagnosticsForPath(
  state: LanguageViewState,
  path: string,
): LspDiagnostic[] {
  return state.diagnosticsByPath[path] ?? [];
}

export function severityToMonacoMarker(severity: string): number {
  if (severity === "error") {
    return 8;
  }

  if (severity === "warning") {
    return 4;
  }

  if (severity === "information") {
    return 2;
  }

  return 1;
}

export function lspDocumentPathForWorkspace(
  workspaceRoot: string,
  path: string,
): string {
  const normalizedRoot = workspaceRoot.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const normalizedPath = path.replace(/\\/g, "/");
  const prefix = `${normalizedRoot}/`;

  return normalizedPath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : path;
}

function normalizeDocumentPath(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/");
}

function isSameOrDescendantPath(path: string, parent: string): boolean {
  const normalizedPath = normalizeDocumentPath(path);
  const normalizedParent = normalizeDocumentPath(parent);

  return (
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent}/`)
  );
}

function replaceDocumentPathPrefix(
  path: string,
  oldPath: string,
  newPath: string,
): string {
  const normalizedPath = normalizeDocumentPath(path);
  const normalizedOldPath = normalizeDocumentPath(oldPath);
  const normalizedNewPath = normalizeDocumentPath(newPath);

  if (normalizedPath === normalizedOldPath) {
    return newPath;
  }

  if (normalizedPath.startsWith(`${normalizedOldPath}/`)) {
    return `${normalizedNewPath}${normalizedPath.slice(normalizedOldPath.length)}`;
  }

  return path;
}

export function isLspSupportedDocumentPath(path: string): boolean {
  const lower = path.toLowerCase();

  return (
    lower.endsWith(".rs") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".py") ||
    lower.endsWith(".pyw") ||
    lower.endsWith(".pyi")
  );
}

export function lspDocumentChangeForWorkspace(
  workspaceRoot: string,
  previousPath: string,
  nextPath: string | null,
): { closePath: string; openPath: string | null } {
  return {
    closePath: lspDocumentPathForWorkspace(workspaceRoot, previousPath),
    openPath: nextPath
      ? lspDocumentPathForWorkspace(workspaceRoot, nextPath)
      : null,
  };
}

export function lspDocumentChangesForWorkspacePaths(
  workspaceRoot: string,
  openPaths: string[],
  affectedPath: string,
  replacementPath: string | null,
): Array<{
  previousPath: string;
  nextPath: string | null;
  closePath: string | null;
  openPath: string | null;
}> {
  return openPaths.flatMap((previousPath) => {
    if (!isSameOrDescendantPath(previousPath, affectedPath)) {
      return [];
    }

    const nextPath = replacementPath
      ? replaceDocumentPathPrefix(previousPath, affectedPath, replacementPath)
      : null;
    const closePath = isLspSupportedDocumentPath(previousPath)
      ? lspDocumentPathForWorkspace(workspaceRoot, previousPath)
      : null;
    const openPath =
      nextPath && isLspSupportedDocumentPath(nextPath)
        ? lspDocumentPathForWorkspace(workspaceRoot, nextPath)
        : null;

    if (!closePath && !openPath) {
      return [];
    }

    return [{
      previousPath,
      nextPath,
      closePath,
      openPath,
    }];
  });
}

export function createLanguageState(): LanguageViewState {
  return {
    diagnosticsByPath: {},
    serverStatuses: [],
    activeHover: null,
    serverLogs: [],
    loading: false,
    error: null,
  };
}

export function nextLanguageRefreshRequest(
  state: LanguageRefreshRequestState,
  workspaceId: string,
  workspaceRoot: string,
): LanguageRefreshRequestNext {
  const requestId = (state[workspaceId]?.requestId ?? 0) + 1;

  return {
    state: {
      ...state,
      [workspaceId]: { workspaceRoot, requestId },
    },
    requestId,
  };
}

export function isCurrentLanguageRefreshRequest(
  state: LanguageRefreshRequestState,
  workspaceId: string,
  workspaceRoot: string,
  requestId: number,
): boolean {
  const current = state[workspaceId];

  return (
    current?.workspaceRoot === workspaceRoot &&
    current.requestId === requestId
  );
}

export function replaceDiagnostics(
  state: LanguageViewState,
  diagnostics: LspDiagnostic[],
): LanguageViewState {
  const diagnosticsByPath: Record<string, LspDiagnostic[]> = {};

  for (const diagnostic of diagnostics) {
    diagnosticsByPath[diagnostic.path] = [
      ...(diagnosticsByPath[diagnostic.path] ?? []),
      diagnostic,
    ];
  }

  return { ...state, diagnosticsByPath, loading: false, error: null };
}

export function replaceServerStatuses(
  state: LanguageViewState,
  serverStatuses: LanguageServerStatus[],
): LanguageViewState {
  return { ...state, serverStatuses, loading: false, error: null };
}

export function storeHover(
  state: LanguageViewState,
  activeHover: LanguageHover | null,
): LanguageViewState {
  return { ...state, activeHover };
}

export function storeServerLogs(
  state: LanguageViewState,
  serverLogs: string[],
): LanguageViewState {
  return { ...state, serverLogs: serverLogs.slice(-80) };
}

export function normalizeLanguageHover(value: unknown): LanguageHover | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("path" in value) ||
    !("line" in value) ||
    !("character" in value) ||
    !("contents" in value)
  ) {
    return null;
  }

  const hover = value as Record<string, unknown>;
  if (
    typeof hover.path !== "string" ||
    typeof hover.line !== "number" ||
    typeof hover.character !== "number" ||
    typeof hover.contents !== "string"
  ) {
    return null;
  }

  return {
    path: hover.path,
    line: hover.line,
    character: hover.character,
    contents: hover.contents,
  };
}

export function selectDiagnosticBadge(state: LanguageViewState): string | null {
  const count = Object.values(state.diagnosticsByPath).reduce(
    (sum, diagnostics) => sum + diagnostics.length,
    0,
  );

  return count > 0 ? String(count) : null;
}
