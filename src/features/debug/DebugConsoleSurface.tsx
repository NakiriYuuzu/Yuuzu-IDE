import { Pause, Play, Square, StepForward, Terminal } from "lucide-react";

import type { DebugSessionInfo } from "./debug-model";

type DebugConsoleSurfaceProps = {
  session: DebugSessionInfo | null;
  consoleText: string;
  onContinue: (sessionId: string) => void;
  onStepOver: (sessionId: string) => void;
  onPause: (sessionId: string) => void;
  onDisconnect: (sessionId: string) => void;
};

export function DebugConsoleSurface({
  session,
  consoleText,
  onContinue,
  onStepOver,
  onPause,
  onDisconnect,
}: DebugConsoleSurfaceProps) {
  const sessionId = session?.id ?? null;

  return (
    <div className="debug-console-surface terminal-surface">
      <div className="term-tabs">
        <button className="tt active" type="button">
          <Terminal aria-hidden="true" />
          <span className="tt-label">{session?.name ?? "Debug Console"}</span>
        </button>
        <div className="term-tabs-spacer" />
        <button
          className="iconbtn"
          type="button"
          aria-label="Continue debug session"
          disabled={!sessionId}
          onClick={() => sessionId && onContinue(sessionId)}
        >
          <Play aria-hidden="true" />
        </button>
        <button
          className="iconbtn"
          type="button"
          aria-label="Step over debug session"
          disabled={!sessionId}
          onClick={() => sessionId && onStepOver(sessionId)}
        >
          <StepForward aria-hidden="true" />
        </button>
        <button
          className="iconbtn"
          type="button"
          aria-label="Pause debug session"
          disabled={!sessionId}
          onClick={() => sessionId && onPause(sessionId)}
        >
          <Pause aria-hidden="true" />
        </button>
        <button
          className="iconbtn"
          type="button"
          aria-label="Disconnect debug session"
          disabled={!sessionId}
          onClick={() => sessionId && onDisconnect(sessionId)}
        >
          <Square aria-hidden="true" />
        </button>
      </div>
      <pre className="terminal-shell terminal-output mono">{consoleText || "debug console ready"}</pre>
    </div>
  );
}
