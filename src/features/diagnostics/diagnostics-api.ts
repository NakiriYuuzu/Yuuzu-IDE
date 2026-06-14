import { call } from "../../lib/tauri";
import type { AppMetricSnapshot, DiagnosticEvent } from "./diagnostics-model";

export function metricSnapshot(args: {
  workspaceCount: number;
  activeWorkspaceId: string | null;
  docsIndexEntries: number;
  fileTreeEntries: number;
}): Promise<AppMetricSnapshot> {
  return call("metric_snapshot", args);
}

export function listDiagnosticEvents(args: {
  limit: number;
}): Promise<DiagnosticEvent[]> {
  return call("list_diagnostic_events", args);
}

export function appendDiagnosticEvent(args: {
  level: DiagnosticEvent["level"];
  source: string;
  message: string;
}): Promise<DiagnosticEvent> {
  return call("append_diagnostic_event", { event: args });
}
