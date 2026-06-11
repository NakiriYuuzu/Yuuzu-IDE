import { Plus, Server, X } from "lucide-react";
import { lazy, Suspense } from "react";

import type {
  RemoteViewState,
  SshTerminalSessionInfo,
} from "./remote-model";

const TerminalTab = lazy(() =>
  import("../terminal/TerminalTab").then((module) => ({
    default: module.TerminalTab,
  })),
);

type SshTerminalSurfaceProps = {
  state: RemoteViewState;
  activeSession: SshTerminalSessionInfo | null;
  activeOutput: string;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onInput: (sessionId: string, data: string) => void;
};

export function SshTerminalSurface({
  state,
  activeSession,
  activeOutput,
  onNewSession,
  onSelectSession,
  onCloseSession,
  onInput,
}: SshTerminalSurfaceProps) {
  if (!activeSession) {
    return (
      <div className="terminal-surface">
        <div className="terminal-empty-state">
          <Server aria-hidden="true" />
          <span>No SSH terminal sessions</span>
          <button
            type="button"
            className="btn primary"
            onClick={onNewSession}
          >
            <Plus aria-hidden="true" />
            Start SSH
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-surface">
      <div className="term-tabs" role="tablist">
        {state.sshSessions.map((session) => {
          const selected = session.id === activeSession.id;

          return (
            <button
              type="button"
              className={`tt${selected ? " active" : ""}`}
              role="tab"
              aria-selected={selected}
              title={session.name}
              key={session.id}
              onClick={() => onSelectSession(session.id)}
            >
              <Server aria-hidden="true" />
              <span className="tt-label">{session.name}</span>
              {!session.running ? <span className="meta">exit</span> : null}
            </button>
          );
        })}
        <div className="term-tabs-spacer" />
        <button
          type="button"
          className="iconbtn"
          title="New SSH terminal"
          aria-label="New SSH terminal"
          onClick={onNewSession}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="iconbtn"
          title="Close SSH terminal"
          aria-label="Close SSH terminal"
          onClick={() => onCloseSession(activeSession.id)}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <Suspense fallback={<div className="editor-loading">Loading terminal</div>}>
        <TerminalTab
          key={activeSession.id}
          sessionId={activeSession.id}
          output={activeOutput}
          onInput={onInput}
        />
      </Suspense>
    </div>
  );
}
