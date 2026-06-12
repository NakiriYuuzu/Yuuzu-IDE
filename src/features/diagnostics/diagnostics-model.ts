export type AppMetricSnapshot = {
  timestamp_ms: number;
  process_id: number;
  memory_bytes: number;
  uptime_ms: number;
  workspace_count: number;
  active_workspace_id: string | null;
  docs_index_entries: number;
  file_tree_entries: number;
};

export type DiagnosticEventLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticEvent = {
  id: string;
  timestamp_ms: number;
  level: DiagnosticEventLevel;
  source: string;
  message: string;
};

export type DiagnosticsViewState = {
  metric: AppMetricSnapshot | null;
  events: DiagnosticEvent[];
  loading: boolean;
  error: string | null;
};

export function createDiagnosticsState(): DiagnosticsViewState {
  return {
    metric: null,
    events: [],
    loading: false,
    error: null,
  };
}

export function storeMetricSnapshot(
  state: DiagnosticsViewState,
  metric: AppMetricSnapshot,
): DiagnosticsViewState {
  return {
    ...state,
    metric,
    loading: false,
    error: null,
  };
}

export function storeDiagnosticEvents(
  state: DiagnosticsViewState,
  events: DiagnosticEvent[],
): DiagnosticsViewState {
  return {
    ...state,
    events: [...events]
      .sort((left, right) => right.timestamp_ms - left.timestamp_ms)
      .slice(0, 50),
    loading: false,
    error: null,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0
    ? `${Math.round(value)} ${units[unitIndex]}`
    : `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatUptime(uptimeMs: number): string {
  if (!Number.isFinite(uptimeMs) || uptimeMs <= 0) {
    return "0s";
  }

  const totalSeconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}
