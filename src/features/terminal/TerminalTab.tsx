import { useEffect, useRef, useState } from "react";

import { loadXterm } from "./load-xterm";
import {
  terminalLoadFailureCopy,
  type TerminalLoadFailureCopy,
} from "./terminal-error";
import {
  createTerminalCleanup,
  createTerminalInputCleanup,
} from "./terminal-lifecycle";
import {
  replayTerminalOutput,
  subscribeTerminalChunks,
} from "./terminal-replay-buffer";

type TerminalTabProps = {
  sessionId: string;
  onInput: (sessionId: string, data: string) => void;
};

export function TerminalTab({ sessionId, onInput }: TerminalTabProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onInputRef = useRef(onInput);
  const [loadFailure, setLoadFailure] =
    useState<TerminalLoadFailureCopy | null>(null);

  onInputRef.current = onInput;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let inputCleanup: (() => void) | undefined;
    let unsubscribeChunks: (() => void) | undefined;

    setLoadFailure(null);

    async function startTerminal() {
      try {
        const { Terminal, FitAddon } = await loadXterm();

        if (disposed || !hostRef.current) {
          return;
        }

        const terminal = new Terminal({
          cursorBlink: true,
          fontSize: 13,
          theme: {
            background: "#0a0e15",
            foreground: "#e6edf3",
            cursor: "#a8e23f",
            selectionBackground: "#34421d",
          },
        });
        const fitAddon = new FitAddon();

        terminal.loadAddon(fitAddon);
        terminal.open(hostRef.current);
        fitAddon.fit();

        cleanup = createTerminalCleanup(terminal);

        const replay = replayTerminalOutput(sessionId);
        if (replay) {
          terminal.write(replay);
        }
        unsubscribeChunks = subscribeTerminalChunks(sessionId, (chunk) => {
          terminal.write(chunk);
        });

        const dataDisposable = terminal.onData((data) => {
          onInputRef.current(sessionId, data);
        });
        inputCleanup = createTerminalInputCleanup(dataDisposable);

        const resizeObserver = new ResizeObserver(() => fitAddon.fit());
        resizeObserver.observe(hostRef.current);
        cleanup = createTerminalCleanup(terminal, resizeObserver);
      } catch (error) {
        if (!disposed) {
          unsubscribeChunks?.();
          inputCleanup?.();
          cleanup?.();
          setLoadFailure(terminalLoadFailureCopy(error));
        }
      }
    }

    void startTerminal();

    return () => {
      disposed = true;
      unsubscribeChunks?.();
      inputCleanup?.();
      cleanup?.();
    };
  }, [sessionId]);

  if (loadFailure) {
    return (
      <div className="terminal-failure" role="alert">
        <span>{loadFailure.title}</span>
        <p>{loadFailure.detail}</p>
      </div>
    );
  }

  return <div ref={hostRef} className="terminal-host" />;
}
