import {
  AlertTriangle,
  Languages,
  RefreshCw,
  RotateCw,
} from "lucide-react";

import {
  type LanguageServerStatus,
  type LspDiagnostic,
  type LanguageViewState,
  serverMemoryLabel,
} from "./language-model";

type LanguagePanelProps = {
  state: LanguageViewState;
  onOpenDiagnostic: (diagnostic: LspDiagnostic & { path: string }) => void;
  onRefresh: () => void;
  onRestartServer: (server: LanguageServerStatus) => void;
};

function severityBadgeClass(severity: string): string {
  if (severity === "error") {
    return "badge2 danger";
  }

  if (severity === "warning") {
    return "badge2 warn";
  }

  return "badge2";
}

export function LanguagePanel({
  state,
  onOpenDiagnostic,
  onRefresh,
  onRestartServer,
}: LanguagePanelProps) {
  const diagnostics: Array<LspDiagnostic & { path: string }> = [];

  for (const [path, byPath] of Object.entries(state.diagnosticsByPath)) {
    for (const diagnostic of byPath) {
      diagnostics.push({ ...diagnostic, path });
    }
  }

  return (
    <div className="language-panel-shell">
      <div className="panel-head">
        <span className="panel-title">Language</span>
        <div className="panel-acts">
          <button
            type="button"
            className="iconbtn"
            title="Refresh language data"
            aria-label="Refresh language data"
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="panel-body language-panel">
        <section>
          <div className="section-label">
            <span>Language servers</span>
            <span>{state.serverStatuses.length}</span>
          </div>

          {state.serverStatuses.length > 0 ? (
            state.serverStatuses.map((server) => (
              <div
                className="row language-server-row"
                key={`${server.workspace_id}:${server.workspace_root}:${server.language}`}
              >
                <Languages aria-hidden="true" />
                <div className="language-row-main">
                  <span className="language-row-title">{server.display_name}</span>
                  <span className="language-row-sub mono">
                    {server.state} • pid {server.pid ?? "n/a"}
                  </span>
                  <span className="language-row-sub mono">
                    open {server.open_documents} • mem {serverMemoryLabel(server)}
                  </span>
                </div>
                <span className="badge2">
                  <span className="d" />
                  {server.state}
                </span>
                <button
                  type="button"
                  className="iconbtn"
                  title={`Restart ${server.display_name}`}
                  aria-label={`Restart ${server.display_name}`}
                  onClick={() => onRestartServer(server)}
                >
                  <RotateCw aria-hidden="true" />
                </button>
              </div>
            ))
          ) : (
            <div className="panel-empty">No language servers detected</div>
          )}
        </section>

        <section>
          <div className="section-label">
            <span>Diagnostics</span>
            <span>{diagnostics.length}</span>
          </div>

          {diagnostics.length > 0 ? (
            diagnostics.map((diagnostic, index) => {
              const line = diagnostic.range.start_line + 1;
              return (
                <button
                  type="button"
                  className="row language-diagnostic-row"
                  key={`${diagnostic.path}:${line}:${index}`}
                  onClick={() => onOpenDiagnostic(diagnostic)}
                  title={`Open ${diagnostic.path}`}
                >
                  <span
                    className={severityBadgeClass(diagnostic.severity)}
                    aria-label={`Severity ${diagnostic.severity}`}
                  >
                    <AlertTriangle aria-hidden="true" />
                    {diagnostic.severity}
                  </span>
                  <div className="language-row-main">
                    <span className="language-row-title">
                      {diagnostic.path}:{line}
                    </span>
                    <span className="language-row-sub mono">
                      {diagnostic.source ?? "unknown"}
                    </span>
                    <span className="language-row-sub mono">
                      {diagnostic.message}
                    </span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="panel-empty">No diagnostics</div>
          )}
        </section>

        <section>
          <div className="section-label">
            <span>Server logs</span>
            <span>{state.serverLogs.length}</span>
          </div>
          <pre className="language-log mono" aria-live="polite">
            {state.serverLogs.length > 0 ? state.serverLogs.join("\n") : "none"}
          </pre>
        </section>
      </div>
    </div>
  );
}
