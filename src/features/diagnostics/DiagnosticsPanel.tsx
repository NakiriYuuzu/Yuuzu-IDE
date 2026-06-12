import {
  Activity,
  BookOpenText,
  Clock3,
  FolderTree,
  HardDrive,
  Info,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import {
  formatBytes,
  formatUptime,
  type DiagnosticEvent,
  type DiagnosticsViewState,
} from "./diagnostics-model";

type DiagnosticsPanelProps = {
  state: DiagnosticsViewState;
  onRefresh: () => void;
};

function eventTimeLabel(event: DiagnosticEvent): string {
  if (!Number.isFinite(event.timestamp_ms) || event.timestamp_ms <= 0) {
    return "pending";
  }

  return new Date(event.timestamp_ms).toLocaleTimeString();
}

function levelIcon(level: DiagnosticEvent["level"]) {
  if (level === "warn" || level === "error") {
    return <TriangleAlert aria-hidden="true" />;
  }

  return <Info aria-hidden="true" />;
}

export function DiagnosticsPanel({ state, onRefresh }: DiagnosticsPanelProps) {
  const metric = state.metric;
  const events = state.events.slice(0, 50);

  return (
    <>
      <div className="panel-head">
        <span className="panel-title">Diagnostics</span>
        <div className="panel-acts">
          <button
            type="button"
            className="iconbtn"
            title="Refresh diagnostics"
            aria-label="Refresh diagnostics"
            disabled={state.loading}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="panel-body diagnostics-panel">
        {state.error ? <div className="panel-note">{state.error}</div> : null}
        <div className="section-label">
          <span>Performance</span>
          {metric ? <span className="meta mono">pid {metric.process_id}</span> : null}
        </div>
        {metric ? (
          <div className="diagnostics-metrics">
            <div className="row diagnostics-metric-row">
              <HardDrive aria-hidden="true" />
              <span className="nm">Memory</span>
              <span className="meta mono">{formatBytes(metric.memory_bytes)}</span>
            </div>
            <div className="row diagnostics-metric-row">
              <Clock3 aria-hidden="true" />
              <span className="nm">Uptime</span>
              <span className="meta mono">{formatUptime(metric.uptime_ms)}</span>
            </div>
            <div className="row diagnostics-metric-row">
              <BookOpenText aria-hidden="true" />
              <span className="nm">Docs index</span>
              <span className="meta mono">{metric.docs_index_entries}</span>
            </div>
            <div className="row diagnostics-metric-row">
              <FolderTree aria-hidden="true" />
              <span className="nm">File tree</span>
              <span className="meta mono">{metric.file_tree_entries}</span>
            </div>
            <div className="row diagnostics-metric-row">
              <Activity aria-hidden="true" />
              <span className="nm">Workspaces</span>
              <span className="meta mono">{metric.workspace_count}</span>
            </div>
          </div>
        ) : (
          <div className="panel-empty">
            <small>No performance snapshot</small>
          </div>
        )}

        <div className="section-label diagnostics-logs-label">
          <span>Logs</span>
          <span className="meta mono">{events.length}</span>
        </div>
        {events.length === 0 ? (
          <div className="panel-empty">
            <small>No diagnostic events</small>
          </div>
        ) : (
          events.map((event) => (
            <div
              className={`row diagnostics-event-row diagnostics-event-${event.level}`}
              key={event.id}
            >
              <span className={`badge2 diagnostics-level-${event.level}`}>
                {levelIcon(event.level)}
                {event.level}
              </span>
              <span className="nm diagnostics-event-message">{event.message}</span>
              <span className="meta mono">{event.source}</span>
              <span className="meta mono">{eventTimeLabel(event)}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
