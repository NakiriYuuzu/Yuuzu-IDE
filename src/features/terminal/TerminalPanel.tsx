import { Play, Plus, RotateCw, SquareTerminal, X } from "lucide-react";

import type { TerminalSessionInfo } from "./terminal-model";

type TerminalPanelProps = {
  sessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  cwdInput: string;
  onCwdInputChange: (value: string) => void;
  onNewTerminal: () => void;
  onActivateTerminal: (id: string) => void;
  onCloseTerminal: (id: string) => void;
  onRestartTerminal: (id: string) => void;
};

export function TerminalPanel({
  sessions,
  activeTerminalId,
  cwdInput,
  onCwdInputChange,
  onNewTerminal,
  onActivateTerminal,
  onCloseTerminal,
  onRestartTerminal,
}: TerminalPanelProps) {
  return (
    <div className="panel-body terminal-panel">
      <div className="terminal-create">
        <input
          className="input2 mono"
          value={cwdInput}
          aria-label="Terminal working directory"
          placeholder="Working directory"
          onChange={(event) => onCwdInputChange(event.target.value)}
        />
        <button type="button" className="btn primary" onClick={onNewTerminal}>
          <Plus aria-hidden="true" />
          New
        </button>
      </div>

      <div className="section-label">
        <span>Terminals</span>
        <span>{sessions.length}</span>
      </div>

      {sessions.map((session) => {
        const active = session.id === activeTerminalId;

        return (
          <div
            className={`terminal-row${active ? " active" : ""}`}
            key={session.id}
          >
            <button
              type="button"
              className={`row tree-row${active ? " sel" : ""}`}
              title={session.cwd}
              onClick={() => onActivateTerminal(session.id)}
            >
              <SquareTerminal aria-hidden="true" />
              <span className="terminal-row-main">
                <span className="nm mono">{session.name}</span>
                <span className="terminal-row-sub mono">{session.cwd}</span>
              </span>
              <span className={`badge2${session.running ? " green" : ""}`}>
                <span className="d" />
                {session.running ? "running" : "stopped"}
              </span>
            </button>
            <div className="terminal-row-actions">
              <button
                type="button"
                className="iconbtn"
                title={`Restart ${session.name}`}
                aria-label={`Restart ${session.name}`}
                onClick={() => onRestartTerminal(session.id)}
              >
                <RotateCw aria-hidden="true" />
              </button>
              <button
                type="button"
                className="iconbtn"
                title={`Close ${session.name}`}
                aria-label={`Close ${session.name}`}
                onClick={() => onCloseTerminal(session.id)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}

      {sessions.length === 0 ? (
        <div className="panel-empty terminal-empty">
          <span>No terminal sessions</span>
          <button type="button" className="btn" onClick={onNewTerminal}>
            <Play aria-hidden="true" />
            Start terminal
          </button>
        </div>
      ) : null}
    </div>
  );
}
