import { Play } from "lucide-react";

import type { RemoteHostProfile, RemoteViewState } from "./remote-model";

type RemoteCommandPanelProps = {
  state: RemoteViewState;
  activeHost: RemoteHostProfile | null;
  onDraftChange: (value: string) => void;
  onRunCommand: () => void;
};

export function RemoteCommandPanel({
  state,
  activeHost,
  onDraftChange,
  onRunCommand,
}: RemoteCommandPanelProps) {
  const canRun =
    activeHost !== null && !state.loading && state.commandDraft.trim() !== "";

  return (
    <section className="remote-command-panel" aria-label="Remote commands">
      <div className="section-label">
        <span>
          {activeHost ? `${activeHost.username}@${activeHost.name}` : "No host"}
        </span>
      </div>
      <div className="remote-command-form">
        <input
          className="input2 mono"
          value={state.commandDraft}
          aria-label="Remote command"
          placeholder="Command"
          onChange={(event) => onDraftChange(event.currentTarget.value)}
        />
        <button
          type="button"
          className="iconbtn"
          title="Run remote command"
          aria-label="Run remote command"
          disabled={!canRun}
          onClick={onRunCommand}
        >
          <Play aria-hidden="true" />
        </button>
      </div>
      <div className="remote-command-results">
        {state.commandResults.slice(0, 25).map((result, index) => (
          <article
            className="remote-command-result"
            key={`${result.host_id}:${result.command}:${result.duration_ms}:${index}`}
          >
            <div className="remote-command-title">
              <span className="mono">{result.command}</span>
              <span className="mono">exit {result.exit_code ?? "?"}</span>
            </div>
            <pre className="remote-command-output">
              {result.stdout}
              {result.stderr}
            </pre>
          </article>
        ))}
      </div>
    </section>
  );
}
