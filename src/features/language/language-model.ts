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
